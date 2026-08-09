// CRM Gmail Relay - v10
// New inbox mail is always processed before historical backfill.

function CFG_() {
  return {
    SECRET: '0acbcb85408bac61290e49fac924746f',
    WEBHOOK_URL: 'https://vaadbneitora-crm.lovable.app/api/public/hooks/inbound-email',
    MAILBOX_EMAIL: 'a033135556@gmail.com',
    SENDER_NAME: 'CRM'
  };
}

function SETUP() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) ScriptApp.deleteTrigger(triggers[i]);
  ScriptApp.newTrigger('POLL_MAILBOX').timeBased().everyMinutes(5).create();
  POLL_MAILBOX();
}

function POLL_MAILBOX() {
  prepareSyncVersion_();
  var started = new Date().getTime();
  var seen = {};
  var stats = { inserted: 0, existing: 0, failed: 0, skipped: 0 };
  // Priority order is intentional. A large mailbox can no longer starve new replies.
  syncQuery_('in:inbox newer_than:3d', 100, seen, stats, started);
  syncQuery_('in:sent newer_than:3d', 100, seen, stats, started);
  syncQuery_('in:anywhere newer_than:14d', 80, seen, stats, started);
  Logger.log('V10 sync: ' + JSON.stringify(stats));
  return stats;
}

function SYNC_NOW() {
  var stats = POLL_MAILBOX();
  Logger.log('SYNC_NOW finished: ' + JSON.stringify(stats));
}

function syncQuery_(query, maxThreads, seen, stats, started) {
  var cfg = CFG_();
  var threads = GmailApp.search(query, 0, maxThreads);
  for (var i = 0; i < threads.length; i++) {
    if (new Date().getTime() - started > 270000) return;
    var messages = threads[i].getMessages();
    for (var j = messages.length - 1; j >= 0; j--) {
      var m = messages[j];
      var id = m.getId();
      if (m.isDraft() || seen[id]) continue;
      seen[id] = true;
      if (isSynced_(id)) { stats.skipped++; continue; }
      var from = String(m.getFrom() || '');
      var direction = from.toLowerCase().indexOf(cfg.MAILBOX_EMAIL.toLowerCase()) !== -1 ? 'outbound' : 'inbound';
      try {
        var res = UrlFetchApp.fetch(cfg.WEBHOOK_URL, {
          method: 'post',
          contentType: 'application/json',
          headers: { apikey: cfg.SECRET, Authorization: 'Bearer ' + cfg.SECRET },
          payload: JSON.stringify({
            gmailThreadId: threads[i].getId(), gmailMessageId: id,
            direction: direction, from: from, to: m.getTo(),
            subject: m.getSubject(), body: m.getPlainBody(),
            receivedAt: m.getDate().toISOString()
          }),
          muteHttpExceptions: true
        });
        var text = res.getContentText() || '{}';
        var parsed = JSON.parse(text);
        if (res.getResponseCode() >= 200 && res.getResponseCode() < 300 && parsed.ok) {
          markSynced_(id);
          if (parsed.duplicate) stats.existing++; else stats.inserted++;
        } else {
          stats.failed++;
          Logger.log('Rejected ' + id + ': ' + res.getResponseCode() + ' ' + text);
        }
      } catch (err) {
        stats.failed++;
        Logger.log('Failed ' + id + ': ' + err);
      }
    }
  }
}

function doPost(e) {
  var d;
  try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (!d || d.secret !== CFG_().SECRET) return json_({ ok: false, error: 'unauthorized' });
  try {
    if (d.action === 'send') return json_(send_(d));
    if (d.action === 'reply') return json_(reply_(d));
    if (d.action === 'send_backup') return json_(backup_(d));
    if (d.action === 'ping') return json_({ ok: true, version: 10 });
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
}

function doGet() { return json_({ ok: true, service: 'crm-gmail-relay', version: 10 }); }
function send_(d) {
  var body = body_(d.body, d.agentSignature);
  GmailApp.sendEmail(d.to, d.subject || '(no subject)', plain_(body), { name: d.agentName || CFG_().SENDER_NAME, htmlBody: html_(body) });
  var thread = findSent_(d.to, d.subject || '(no subject)');
  return { ok: true, gmailThreadId: thread && thread.getId(), gmailMessageId: lastId_(thread) };
}
function reply_(d) {
  var thread = GmailApp.getThreadById(d.gmailThreadId);
  if (!thread) return { ok: false, error: 'thread not found' };
  var body = body_(d.body, d.agentSignature);
  thread.reply(plain_(body), { name: d.agentName || CFG_().SENDER_NAME, htmlBody: html_(body) });
  return { ok: true, gmailThreadId: thread.getId(), gmailMessageId: lastId_(thread) };
}
function backup_(d) {
  var options = { name: CFG_().SENDER_NAME };
  if (d.attachmentBase64) options.attachments = [Utilities.newBlob(Utilities.base64Decode(d.attachmentBase64), 'application/zip', d.attachmentName || 'backup.zip')];
  GmailApp.sendEmail(d.to, d.subject || 'CRM Backup', d.body || 'Backup attached.', options);
  return { ok: true };
}
function REMOVE_OLD_LABEL() {
  var label = GmailApp.getUserLabelByName('CRM-Processed');
  if (!label) return;
  for (var n = 0; n < 30; n++) {
    var threads = label.getThreads(0, 100);
    if (!threads.length) break;
    label.removeFromThreads(threads);
  }
  try { label.deleteLabel(); } catch (err) { Logger.log('Run REMOVE_OLD_LABEL again'); }
}
function store_() { return PropertiesService.getScriptProperties(); }
function prepareSyncVersion_() {
  var props = store_();
  if (props.getProperty('SYNC_VERSION') === '10') return;
  var all = props.getProperties();
  var stale = [];
  for (var key in all) {
    if (key.indexOf('m_') === 0) stale.push(key);
  }
  for (var i = 0; i < stale.length; i++) props.deleteProperty(stale[i]);
  props.setProperty('SYNC_VERSION', '10');
  Logger.log('V10 reset ' + stale.length + ' stale sync markers; Gmail messages will be verified again.');
}
function isSynced_(id) { return store_().getProperty('m_v10_' + id) === '1'; }
function markSynced_(id) { store_().setProperty('m_v10_' + id, '1'); }
function json_(x) { return ContentService.createTextOutput(JSON.stringify(x)).setMimeType(ContentService.MimeType.JSON); }
function body_(b, s) { return String(b || '') + (s ? '\n\n' + s : ''); }
function plain_(s) { return String(s || '').replace(/<[^>]*>/g, ''); }
function html_(s) { return String(s || '').replace(/\n/g, '<br>'); }
function lastId_(t) { if (!t) return null; var m = t.getMessages(); return m.length ? m[m.length - 1].getId() : null; }
function findSent_(to, subject) {
  var q = 'in:sent to:' + to + ' subject:"' + String(subject).replace(/"/g, '') + '"';
  for (var i = 0; i < 4; i++) { var f = GmailApp.search(q, 0, 1); if (f.length) return f[0]; Utilities.sleep(1200); }
  return null;
}
