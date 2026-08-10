// CRM Gmail Relay - v11
// Incremental sync: only mail newer than the last successful poll is scanned.

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
  ScriptApp.newTrigger('POLL_MAILBOX').timeBased().everyMinutes(10).create();
  POLL_MAILBOX();
}

function POLL_MAILBOX() {
  prepareSyncVersion_();
  var started = new Date().getTime();
  var props = store_();
  var lastSync = Number(props.getProperty('LAST_SYNC_MS') || 0);
  // On the first v11 run inspect three days. Afterwards keep a 15-minute
  // overlap so delayed Gmail indexing cannot cause a missed reply.
  var floor = lastSync > 0 ? lastSync - 900000 : started - (3 * 24 * 60 * 60 * 1000);
  var afterSeconds = Math.floor(floor / 1000);
  var seen = {};
  var stats = { inserted: 0, existing: 0, failed: 0, skipped: 0, timedOut: false };
  syncQuery_('in:inbox after:' + afterSeconds, 50, seen, stats, started);
  syncQuery_('in:sent after:' + afterSeconds, 50, seen, stats, started);
  // Advance the cursor only after a complete pass. Failed webhooks are not
  // marked and remain inside the overlap window for the next poll.
  if (!stats.timedOut) props.setProperty('LAST_SYNC_MS', String(started));
  Logger.log('V11 incremental sync: ' + JSON.stringify(stats));
  return stats;
}

// Optional manual recovery only. It is deliberately not called by the timer.
function BACKFILL_14_DAYS() {
  prepareSyncVersion_();
  var started = new Date().getTime();
  var seen = {};
  var stats = { inserted: 0, existing: 0, failed: 0, skipped: 0, timedOut: false };
  syncQuery_('in:anywhere newer_than:14d', 100, seen, stats, started);
  Logger.log('V11 manual backfill: ' + JSON.stringify(stats));
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
    if (new Date().getTime() - started > 270000) { stats.timedOut = true; return; }
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
    if (d.action === 'ping') return json_({ ok: true, version: 11 });
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
}

function doGet() { return json_({ ok: true, service: 'crm-gmail-relay', version: 11 }); }
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
  if (props.getProperty('SYNC_VERSION') === '11') return;
  // Keep v10 message markers. Clearing them caused every timer execution to
  // revisit the mailbox and consume the Apps Script daily runtime quota.
  props.setProperty('SYNC_VERSION', '11');
  props.deleteProperty('LAST_SYNC_MS');
  Logger.log('V11 incremental sync enabled; existing message markers preserved.');
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
