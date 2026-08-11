// CRM Gmail Relay - v16
// Based on חביב's v11. Changes from v11:
// 1) FIXED: WEBHOOK_URL was pointing at the Lovable preview domain
//    (vaadbneitora-crm.lovable.app), not the real production system
//    (vaadbneitora-crm.vercel.app). Everything "succeeded" but landed
//    nowhere you could see it.
// 2) FIXED: reply_() used thread.reply(), which addresses the email using
//    the REPLY-TO of the thread's LAST message. If the CRM sent two
//    messages before the customer answered, the last message was our own,
//    so the "reply" silently mailed itself back to us instead of the
//    customer. reply_() now finds the customer's own message in the thread
//    and replies to THAT specifically (guaranteed correct address). If the
//    customer hasn't written anything yet, it sends a fresh, correctly
//    addressed email instead of guessing.
// 3) NEW (per request): only CRM-related mail is synced into the CRM. A
//    Gmail thread only counts as "CRM-related" once the relay has sent at
//    least one message on it (via the 'send' or 'reply' actions below, or
//    is registered explicitly by a CRM send/reply action. Mail sent by
//    hand from Gmail no longer turns a thread into a CRM thread. Inbound mail on threads the
//    CRM never sent anything on (cold mail, personal mail sharing the same
//    inbox, newsletters, etc.) is skipped entirely — nothing about it is
//    posted to the CRM. This can be lifted later by clearing the
//    'only_crm_threads' setting (see ONLY_SYNC_CRM_THREADS below).
// 4) NEW (v13, per request): every thread the CRM sends on gets tagged with
//    the Gmail label configured in ניהול (CFG_().LABEL_NAME, default
//    'CRM'), and the label is kept on the thread for as long as the
//    conversation continues — whether the next message is the customer
//    replying, or an agent answering straight from Gmail instead of the
//    CRM. See applyCrmLabel_ below.
// 5) NEW (v14, per request): a customer's reply used to show up in "ראשי"
//    (inbox) for up to 10 minutes before the next poll re-archived it —
//    and worse, Gmail automatically re-adds an archived thread to the
//    inbox the instant a new message arrives on it, so polling alone can
//    never fully prevent that flash of visibility. ensureFilterForAddress_
//    creates a real Gmail filter (skip inbox + label) for the customer's
//    address as soon as the CRM sends them anything, so their replies are
//    filed straight to the label at delivery time — no inbox appearance,
//    no polling delay. Requires enabling the Gmail API advanced service
//    (see SETUP_GMAIL_FILTERS below); without it this silently falls back
//    to the v13 poll-based behavior.
// 6) NEW (v15, per request): the 'mark_read' action lets the CRM tell Gmail
//    a message was read the moment an agent opens it in the CRM — until
//    then, it stays unread in Gmail exactly as it arrived. See markRead_.

function CFG_() {
  return {
    SECRET: '0acbcb85408bac61290e49fac924746f',
    WEBHOOK_URL: 'https://vaadbneitora-crm.vercel.app/api/public/hooks/inbound-email',
    MAILBOX_EMAIL: 'a033135556@gmail.com',
    SENDER_NAME: 'CRM',
    // The Gmail label configured in ניהול → מיילים. Applied automatically
    // to every thread the CRM sends on, and kept on the thread for any
    // later message (inbound or outbound) as long as the conversation
    // continues — see applyCrmLabel_ below. Override per-call by having
    // the CRM app send a "label" field in the send/reply payload.
    LABEL_NAME: 'CRM',
    // Matches the "להוציא את השרשור מהדואר הנכנס (ארכיון) לאחר התיוג"
    // toggle in ניהול → מיילים. When true, any thread that gets the CRM
    // label is also archived out of the inbox right after tagging.
    ARCHIVE_AFTER_LABEL: true,
    // Addresses that should NEVER get an automatic Gmail filter created for
    // them — because a "from" filter applies to every future email from
    // that address, not just CRM threads, addresses you also use for
    // unrelated mail (shared test accounts, colleagues, etc.) would end up
    // mislabeled. These addresses still get labeled/archived per-thread via
    // the regular poll (thread-aware, correct), just not instantly via a
    // filter. Add addresses here in lowercase.
    EXCLUDE_FROM_FILTERS: ['7673952@gmail.com']
  };
}

// Set to false later if you want inbound mail from brand-new senders (mail
// on threads the CRM never sent anything on) to start syncing too.
var ONLY_SYNC_CRM_THREADS = true;

function SETUP() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) ScriptApp.deleteTrigger(triggers[i]);
  ScriptApp.newTrigger('POLL_MAILBOX').timeBased().everyMinutes(10).create();
  POLL_MAILBOX();
}

// Diagnostic only: run manually, then check the Execution log for the
// exact HTTP status + response body the CRM sent back.
function TEST_WEBHOOK() {
  var cfg = CFG_();
  var res = UrlFetchApp.fetch(cfg.WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: cfg.SECRET, Authorization: 'Bearer ' + cfg.SECRET },
    payload: JSON.stringify({
      gmailThreadId: 'diagnostic-test-' + new Date().getTime(),
      gmailMessageId: 'diagnostic-test-msg-' + new Date().getTime(),
      direction: 'inbound',
      from: 'diagnostic-test@example.com',
      to: cfg.MAILBOX_EMAIL,
      subject: 'בדיקת אבחון',
      body: 'זו הודעת בדיקה מ-TEST_WEBHOOK',
      receivedAt: new Date().toISOString()
    }),
    muteHttpExceptions: true
  });
  Logger.log('HTTP status: ' + res.getResponseCode());
  Logger.log('Response body: ' + res.getContentText());
}

function POLL_MAILBOX() {
  prepareSyncVersion_();
  var started = new Date().getTime();
  var props = store_();
  var lastSync = Number(props.getProperty('LAST_SYNC_MS') || 0);
  // On the first run inspect three days. Afterwards keep a 15-minute
  // overlap so delayed Gmail indexing cannot cause a missed reply.
  var floor = lastSync > 0 ? lastSync - 900000 : started - (3 * 24 * 60 * 60 * 1000);
  var afterSeconds = Math.floor(floor / 1000);
  var seen = {};
  var stats = { inserted: 0, existing: 0, failed: 0, skipped: 0, skippedNotCrm: 0, timedOut: false };

  // Sent mail is scanned FIRST: every thread we sent something on this pass
  // gets registered as "CRM-related" before inbound mail is evaluated, so a
  // reply that just came in on a thread we started is never missed.
  syncQuery_('in:sent after:' + afterSeconds, 50, seen, stats, started, /*isSentPass*/ true);
  syncQuery_('in:inbox after:' + afterSeconds, 50, seen, stats, started, /*isSentPass*/ false);

  // Advance the cursor only after a complete pass. Failed webhooks are not
  // marked and remain inside the overlap window for the next poll.
  if (!stats.timedOut) props.setProperty('LAST_SYNC_MS', String(started));
  Logger.log('V16 incremental sync: ' + JSON.stringify(stats));
  return stats;
}

// Optional manual recovery only. It is deliberately not called by the timer.
function BACKFILL_14_DAYS() {
  prepareSyncVersion_();
  var started = new Date().getTime();
  var seen = {};
  var stats = { inserted: 0, existing: 0, failed: 0, skipped: 0, skippedNotCrm: 0, timedOut: false };
  // Same two-pass order as POLL_MAILBOX, so "sent" threads get registered
  // before "inbox" mail is checked against the CRM-relatedness rule.
  syncQuery_('in:sent newer_than:14d', 150, seen, stats, started, true);
  syncQuery_('in:inbox newer_than:14d', 150, seen, stats, started, false);
  Logger.log('V16 manual backfill: ' + JSON.stringify(stats));
  return stats;
}

function SYNC_NOW() {
  var stats = POLL_MAILBOX();
  Logger.log('SYNC_NOW finished: ' + JSON.stringify(stats));
}

function syncQuery_(query, maxThreads, seen, stats, started, isSentPass) {
  var cfg = CFG_();
  var threads = GmailApp.search(query, 0, maxThreads);
  for (var i = 0; i < threads.length; i++) {
    if (new Date().getTime() - started > 270000) { stats.timedOut = true; return; }
    var threadId = threads[i].getId();
    var messages = threads[i].getMessages();

    for (var j = messages.length - 1; j >= 0; j--) {
      var m = messages[j];
      var id = m.getId();
      if (m.isDraft() || seen[id]) continue;
      seen[id] = true;
      if (isSynced_(id)) { stats.skipped++; continue; }

      var from = String(m.getFrom() || '');
      var isOutbound = from.toLowerCase().indexOf(cfg.MAILBOX_EMAIL.toLowerCase()) !== -1;
      var direction = isOutbound ? 'outbound' : 'inbound';

      // v16: only send_/reply_ (i.e. mail the CRM itself sent) may register a
      // thread. Treating any Gmail "sent" message as CRM mail is what made
      // ordinary personal correspondence show up in the CRM and get labeled.

      // Keep the label on the thread for as long as the conversation
      // continues — covers a customer's reply landing here, and any
      // outbound message an agent sent straight from Gmail instead of the
      // CRM (in:sent pass), as long as the thread is already CRM-related.
      if (isThreadKnown_(threadId)) applyCrmLabel_(threads[i], null, CFG_().ARCHIVE_AFTER_LABEL);

      if (ONLY_SYNC_CRM_THREADS && !isThreadKnown_(threadId)) {
        // Mail on a thread the CRM never sent anything on — not CRM-related.
        // Skip it entirely (don't post it, don't mark it synced) so it is
        // re-evaluated later if the CRM ever sends on that thread.
        stats.skippedNotCrm++;
        continue;
      }

      try {
        var res = UrlFetchApp.fetch(cfg.WEBHOOK_URL, {
          method: 'post',
          contentType: 'application/json',
          headers: { apikey: cfg.SECRET, Authorization: 'Bearer ' + cfg.SECRET },
          payload: JSON.stringify({
            gmailThreadId: threadId, gmailMessageId: id,
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
    if (d.action === 'mark_read') return json_(markRead_(d));
    if (d.action === 'ping') return json_({ ok: true, version: 16 });
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
}

function doGet() { return json_({ ok: true, service: 'crm-gmail-relay', version: 16 }); }

function send_(d) {
  var body = body_(d.body, d.agentSignature);
  GmailApp.sendEmail(d.to, d.subject || '(no subject)', plain_(body), { name: d.agentName || CFG_().SENDER_NAME, htmlBody: html_(body) });
  ensureFilterForAddress_(d.to, d.label, d.archive);
  var thread = findSent_(d.to, d.subject || '(no subject)');
  if (thread) {
    markThreadKnown_(thread.getId());
    applyCrmLabel_(thread, d.label, d.archive);
  }
  return { ok: true, gmailThreadId: thread && thread.getId(), gmailMessageId: lastId_(thread) };
}

function reply_(d) {
  var thread = GmailApp.getThreadById(d.gmailThreadId);
  if (!thread) return { ok: false, error: 'thread not found' };
  markThreadKnown_(thread.getId());

  var body = body_(d.body, d.agentSignature);
  var opts = { name: d.agentName || CFG_().SENDER_NAME, htmlBody: html_(body) };
  var target = findReplyTarget_(thread, d.to);
  if (!target.message && !target.address) return { ok: false, error: 'could not resolve reply recipient' };

  if (target.message) {
    // Safe path: an actual message the customer sent. Replying to THAT
    // specific message uses ITS reply-to address, which is always correct.
    target.message.reply(plain_(body), opts);
    ensureFilterForAddress_(target.address, d.label, d.archive);
    applyCrmLabel_(thread, d.label, d.archive);
    return { ok: true, gmailThreadId: thread.getId(), gmailMessageId: lastId_(thread) };
  }

  // Nobody but us has written on this thread yet — thread.reply() would
  // (incorrectly) reuse our own reply-to address, so send a fresh,
  // correctly addressed email instead of risking a silent misfire.
  var subject = thread.getFirstMessageSubject() || '';
  if (!/^re:/i.test(subject)) subject = 'Re: ' + subject;
  GmailApp.sendEmail(target.address, subject, plain_(body), opts);
  ensureFilterForAddress_(target.address, d.label, d.archive);
  var newThread = findSent_(target.address, subject);
  var effectiveThread = newThread || thread;
  markThreadKnown_(effectiveThread.getId());
  applyCrmLabel_(effectiveThread, d.label, d.archive);
  return { ok: true, gmailThreadId: effectiveThread.getId(), gmailMessageId: newThread ? lastId_(newThread) : null };
}

// Finds who a reply on this thread should actually go to: prefers an
// explicit "to" from the caller, then the most recent message actually
// sent BY the customer (safe to .reply() on), then falls back to the
// original recipient of the first message in the thread.
function findReplyTarget_(thread, explicitTo) {
  var cfg = CFG_();
  var messages = thread.getMessages();
  for (var i = messages.length - 1; i >= 0; i--) {
    var from = String(messages[i].getFrom() || '').toLowerCase();
    if (from.indexOf(cfg.MAILBOX_EMAIL.toLowerCase()) === -1) {
      return { message: messages[i], address: extractEmail_(messages[i].getFrom()) };
    }
  }
  var addr = explicitTo || extractEmail_(messages[0].getTo());
  return { message: null, address: addr };
}

function extractEmail_(headerValue) {
  var s = String(headerValue || '');
  var m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s.split(',')[0]).trim();
}

function backup_(d) {
  var options = { name: CFG_().SENDER_NAME };
  if (d.attachmentBase64) options.attachments = [Utilities.newBlob(Utilities.base64Decode(d.attachmentBase64), 'application/zip', d.attachmentName || 'backup.zip')];
  GmailApp.sendEmail(d.to, d.subject || 'CRM Backup', d.body || 'Backup attached.', options);
  return { ok: true };
}

// Keeps Gmail's own read/unread state in sync with the CRM: a message
// coming in via the relay is left unread in Gmail (we never touch it), and
// only gets marked read here, when an agent actually opens the thread in
// the CRM's mail view.
function markRead_(d) {
  if (!d.gmailThreadId) return { ok: false, error: 'missing gmailThreadId' };
  var thread = GmailApp.getThreadById(d.gmailThreadId);
  if (!thread) return { ok: false, error: 'thread not found' };
  try {
    thread.markRead();
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
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
  if (props.getProperty('SYNC_VERSION') === '16') return;
  // Keep old message markers — clearing them would make every timer
  // execution revisit the whole mailbox and burn the daily runtime quota.
  props.setProperty('SYNC_VERSION', '16');
  cleanupExcludedFilters_();
  Logger.log('V16 sync enabled; message markers preserved, unsafe address filters removed.');
}

function isSynced_(id) { return store_().getProperty('m_v10_' + id) === '1'; }
function markSynced_(id) { store_().setProperty('m_v10_' + id, '1'); }

// "CRM-related thread" registry: a thread is remembered once we see (or
// send) an outbound message on it. Kept as its own prefix so it can be
// wiped independently of the m_v10_ sync markers if ever needed.
function isThreadKnown_(threadId) { return store_().getProperty('crm16_t_' + threadId) === '1'; }
function markThreadKnown_(threadId) { if (threadId) store_().setProperty('crm16_t_' + threadId, '1'); }

// Applies the configured CRM label to a thread, and archives it out of the
// inbox afterward if ARCHIVE_AFTER_LABEL is on. Safe to call repeatedly —
// addLabel_/moveToArchive are no-ops if already applied. Never throws: a
// labeling failure should never break a send or a sync pass.
function applyCrmLabel_(thread, labelNameOverride, archiveOverride) {
  if (!thread) return;
  try {
    var name = labelNameOverride || CFG_().LABEL_NAME;
    if (name) {
      var label = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
      thread.addLabel(label);
    }
    var shouldArchive = (archiveOverride !== undefined && archiveOverride !== null)
      ? archiveOverride
      : CFG_().ARCHIVE_AFTER_LABEL;
    if (shouldArchive) thread.moveToArchive();
  } catch (err) {
    Logger.log('applyCrmLabel_ failed: ' + err);
  }
}

// Gmail auto-returns an archived thread to the inbox the instant a new
// message arrives on it — that happens at delivery time, before our poll
// ever runs, so re-archiving every 10 minutes always leaves a visible
// window in "ראשי". A real Gmail FILTER applied at delivery avoids that
// entirely: mail from this address never touches the inbox in the first
// place. Requires the "Gmail API" advanced service to be enabled (see
// SETUP_GMAIL_FILTERS comment below) — if it isn't, this silently no-ops
// and the poll-based archiving above is the fallback.
function ensureFilterForAddress_(address, labelNameOverride, archiveOverride) {
  recordFilterAttempt_('called for: ' + address);
  if (!address) { recordFilterAttempt_('no address, skipping'); return; }
  var normalized = extractEmail_(address).toLowerCase();
  if (isExcludedAddress_(normalized)) {
    recordFilterAttempt_('excluded from automatic filters: ' + normalized);
    return;
  }
  try {
    if (typeof Gmail === 'undefined') {
      recordFilterAttempt_('Gmail advanced service not enabled, skipping');
      return;
    }
    var shouldArchive = (archiveOverride !== undefined && archiveOverride !== null)
      ? archiveOverride
      : CFG_().ARCHIVE_AFTER_LABEL;

    var existing = Gmail.Users.Settings.Filters.list('me');
    var addrLower = normalized;
    if (existing.filter) {
      for (var i = 0; i < existing.filter.length; i++) {
        var f = existing.filter[i];
        if (f.criteria && f.criteria.from && f.criteria.from.toLowerCase() === addrLower) {
          recordFilterAttempt_('filter already exists for ' + address);
          return; // already set up
        }
      }
    }

    var labelId = getOrCreateLabelId_(labelNameOverride || CFG_().LABEL_NAME);
    var action = { addLabelIds: [labelId] };
    if (shouldArchive) action.removeLabelIds = ['INBOX'];

    var created = Gmail.Users.Settings.Filters.create({ criteria: { from: address }, action: action }, 'me');
    recordFilterAttempt_('SUCCESS - created filter for ' + address + ': ' + JSON.stringify(created));
  } catch (err) {
    recordFilterAttempt_('FAILED for ' + address + ': ' + err);
  }
}

// Addresses listed in EXCLUDE_FROM_FILTERS must never get a broad "from"
// filter: such a filter labels EVERY future mail from that address, not only
// CRM conversations.
function isExcludedAddress_(normalizedAddress) {
  var excluded = CFG_().EXCLUDE_FROM_FILTERS || [];
  for (var i = 0; i < excluded.length; i++) {
    if (String(excluded[i]).toLowerCase() === normalizedAddress) return true;
  }
  return false;
}

// Removes broad filters that earlier versions created for excluded addresses.
// Runs automatically once when v16 takes over (see prepareSyncVersion_), and
// can be run by hand at any time.
function CLEANUP_UNSAFE_FILTERS() {
  cleanupExcludedFilters_();
  Logger.log('Cleanup finished. ' + (store_().getProperty('LAST_FILTER_ATTEMPT') || ''));
}

function cleanupExcludedFilters_() {
  if (typeof Gmail === 'undefined') { recordFilterAttempt_('cleanup skipped: Gmail advanced service not enabled'); return; }
  try {
    var existing = Gmail.Users.Settings.Filters.list('me').filter || [];
    var removed = 0;
    for (var i = 0; i < existing.length; i++) {
      var criteria = existing[i].criteria;
      if (!criteria || !criteria.from) continue;
      if (!isExcludedAddress_(extractEmail_(criteria.from).toLowerCase())) continue;
      Gmail.Users.Settings.Filters.remove('me', existing[i].id);
      removed++;
    }
    recordFilterAttempt_('cleanup removed ' + removed + ' unsafe filter(s)');
  } catch (err) {
    recordFilterAttempt_('cleanup failed: ' + err);
  }
}

// Persists the outcome so it can be inspected without hunting through the
// Executions history — just run CHECK_LAST_FILTER_ATTEMPT below.
function recordFilterAttempt_(msg) {
  Logger.log('ensureFilterForAddress_: ' + msg);
  store_().setProperty('LAST_FILTER_ATTEMPT', new Date().toISOString() + ' — ' + msg);
}

// Run this MANUALLY, any time, to see exactly what happened the last time
// the relay tried to create a Gmail filter (from send_ or reply_). No need
// to dig through the Executions history — this is always current.
function CHECK_LAST_FILTER_ATTEMPT() {
  var v = store_().getProperty('LAST_FILTER_ATTEMPT');
  Logger.log(v || 'No filter attempt recorded yet — send or reply to something from the CRM first, then run this again.');
}

function getOrCreateLabelId_(name) {
  var labels = Gmail.Users.Labels.list('me').labels || [];
  for (var i = 0; i < labels.length; i++) if (labels[i].name === name) return labels[i].id;
  var created = Gmail.Users.Labels.create({ name: name }, 'me');
  return created.id;
}

// Run this manually once after enabling the Gmail API advanced service
// (Services (+) in the left sidebar → add "Gmail API"). Confirms the
// service is reachable and lists your current filters, so you can see
// exactly what SETUP will be creating going forward.
function SETUP_GMAIL_FILTERS() {
  if (typeof Gmail === 'undefined') {
    Logger.log('Gmail API advanced service is not enabled. Add it via Services (+) in the left sidebar, then run this again.');
    return;
  }
  var existing = Gmail.Users.Settings.Filters.list('me');
  Logger.log('Gmail API is reachable. Current filters: ' + JSON.stringify(existing.filter || []));
}

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
