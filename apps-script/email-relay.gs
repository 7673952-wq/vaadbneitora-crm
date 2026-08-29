// CRM Gmail Relay - v19
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
//    was discovered as sent-by-us in a poll). Inbound mail on threads the
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
// 7) CHANGED (v17, per request): automatic Gmail filters are now OFF by
//    default (USE_GMAIL_FILTERS = false). Filters apply to every future
//    email from an address, not just CRM threads, which mislabeled mail
//    that had nothing to do with a CRM conversation. Tagging/archiving is
//    back to the thread-aware poll only — a customer's reply can flash in
//    "ראשי" for up to the poll interval before it's archived, but nothing
//    unrelated ever gets swept in. Run REMOVE_ALL_CRM_FILTERS once to clean
//    up any filters created automatically before this change.
// 8) CHANGED (v18, per request): filters are back on, but now scoped to
//    from AND subject together, not from alone — the flash into "ראשי" is
//    avoided again, without sweeping in unrelated mail from the same
//    address, since only this specific conversation's subject matches.
//    Trade-off: if the customer changes the subject line, or Gmail's
//    subject match is imprecise for the way threading rewrites it, an
//    edge-case reply could still flash before the poll catches it.
// 9) FIXED (v19): "CRM-related thread" was being decided by sender address
//    alone during polling — any mail sent FROM the shared mailbox address,
//    even sent manually through Gmail and not through the CRM at all, got
//    treated as CRM-related and swept in, dragging entirely unrelated
//    conversations into whatever system happened to be linked. A thread is
//    now ONLY ever marked known inside send_/reply_ — i.e. only when the
//    relay itself actually sent something on it. Run RESET_ALL_KNOWN_THREADS
//    once after installing this to clear out anything wrongly marked known
//    by the old logic.

// v20 additions (nothing from v19 was changed or removed):
//  - POLL_REQUEST_LABELS scans the two request labels (pticha / sgira) and
//    posts each message to the CRM's /api/public/hooks/system-request
//    endpoint. It has its own cursor and its own message markers, and is
//    completely independent of ONLY_SYNC_CRM_THREADS and of the CRM label.
//  - doPost supports 'get_attachment', so the CRM can stream a request's
//    recording straight out of Gmail without ever storing a copy.
//  - SETUP() now deletes and replaces only the POLL_MAILBOX trigger instead
//    of wiping every trigger in the project.
//  - The secret can be stored in Script Properties (key: CRM_SECRET); the
//    value below is used only when that property is not set.

function CFG_() {
  return {
    SECRET: PropertiesService.getScriptProperties().getProperty('CRM_SECRET')
      || '0acbcb85408bac61290e49fac924746f',
    // Gmail labels that carry the automatic open/close request emails.
    PTICHA_LABEL: 'pticha',
    SGIRA_LABEL: 'sgira',
    REQUEST_WEBHOOK_URL: 'https://vaadbneitora-crm.vercel.app/api/public/hooks/system-request',
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
    // Master switch: when false, no automatic Gmail filter is EVER created
    // for any address — tagging/archiving relies entirely on the
    // thread-aware poll (only a customer replying to a thread the CRM
    // actually sent something on gets tagged; nothing else). Trade-off: a
    // reply can flash in "ראשי" for up to the poll interval before it's
    // archived, since filters (which avoid that flash) are off.
    USE_GMAIL_FILTERS: true,
    // Addresses that should NEVER get an automatic Gmail filter created for
    // them — because a "from" filter applies to every future email from
    // that address, not just CRM threads, addresses you also use for
    // unrelated mail (shared test accounts, colleagues, etc.) would end up
    // mislabeled. These addresses still get labeled/archived per-thread via
    // the regular poll (thread-aware, correct), just not instantly via a
    // filter. Add addresses here in lowercase. (Only relevant if
    // USE_GMAIL_FILTERS is ever turned back on.)
    EXCLUDE_FROM_FILTERS: ['7673952@gmail.com']
  };
}

// Set to false later if you want inbound mail from brand-new senders (mail
// on threads the CRM never sent anything on) to start syncing too.
var ONLY_SYNC_CRM_THREADS = true;

function SETUP() {
  // Only this relay's own trigger is replaced — any other trigger in the
  // project (yours or someone else's) is left exactly as it is.
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'POLL_MAILBOX') ScriptApp.deleteTrigger(triggers[i]);
  }
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

  // Threads are only ever "known" (CRM-related) because send_/reply_
  // marked them so when the CRM itself sent something — not because of
  // scan order here. Sent mail is still scanned first purely so any of the
  // CRM's own messages show up before inbound replies in the sync stats.
  syncQuery_('in:sent after:' + afterSeconds, 50, seen, stats, started);
  syncQuery_('in:inbox after:' + afterSeconds, 50, seen, stats, started);

  // Advance the cursor only after a complete pass. Failed webhooks are not
  // marked and remain inside the overlap window for the next poll.
  if (!stats.timedOut) props.setProperty('LAST_SYNC_MS', String(started));
  Logger.log('V19 incremental sync: ' + JSON.stringify(stats));

  // Request emails (pticha/sgira) are a separate pipeline with its own
  // cursor — deliberately unaffected by ONLY_SYNC_CRM_THREADS above.
  try { POLL_REQUEST_LABELS(); } catch (err) { Logger.log('POLL_REQUEST_LABELS failed: ' + err); }
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
  syncQuery_('in:sent newer_than:14d', 150, seen, stats, started);
  syncQuery_('in:inbox newer_than:14d', 150, seen, stats, started);
  Logger.log('V19 manual backfill: ' + JSON.stringify(stats));
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

      // NOTE: a thread only becomes "known" (CRM-related) via markThreadKnown_
      // calls inside send_ / reply_ above — i.e. when the relay itself sent
      // something on it. We deliberately do NOT mark a thread known just
      // because its sender matches MAILBOX_EMAIL here: that would treat any
      // mail a human sends manually from this shared mailbox (not through
      // the CRM) as CRM-related too, which is exactly the bug that caused
      // unrelated conversations to get swept in.

      // Keep the label on the thread for as long as the conversation
      // continues — covers a customer's reply landing here, and any
      // outbound message an agent sent straight from Gmail instead of the
      // CRM (in:sent pass), as long as the thread is already CRM-related.
      if (isThreadKnown_(threadId)) applyCrmLabel_(threads[i], null, CFG_().ARCHIVE_AFTER_LABEL);

      if (ONLY_SYNC_CRM_THREADS && !isThreadKnown_(threadId)) {
        // Not a thread the CRM ever sent anything on — not CRM-related,
        // skip it entirely regardless of direction (don't post it, don't
        // mark it synced, so it's re-evaluated later if the thread ever
        // becomes known, e.g. an agent replies to it from the CRM).
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
    if (d.action === 'get_attachment') return json_(getAttachment_(d));
    if (d.action === 'ping') return json_({ ok: true, version: 20 });
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
}

function doGet() { return json_({ ok: true, service: 'crm-gmail-relay', version: 20 }); }

function send_(d) {
  var body = body_(d.body, d.agentSignature);
  GmailApp.sendEmail(d.to, d.subject || '(no subject)', plain_(body), { name: d.agentName || CFG_().SENDER_NAME, htmlBody: html_(body) });
  ensureFilterForAddress_(d.to, d.subject, d.label, d.archive);
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
    ensureFilterForAddress_(target.address, target.message.getSubject() || thread.getFirstMessageSubject(), d.label, d.archive);
    applyCrmLabel_(thread, d.label, d.archive);
    return { ok: true, gmailThreadId: thread.getId(), gmailMessageId: lastId_(thread) };
  }

  // Nobody but us has written on this thread yet — thread.reply() would
  // (incorrectly) reuse our own reply-to address, so send a fresh,
  // correctly addressed email instead of risking a silent misfire.
  var subject = thread.getFirstMessageSubject() || '';
  if (!/^re:/i.test(subject)) subject = 'Re: ' + subject;
  GmailApp.sendEmail(target.address, subject, plain_(body), opts);
  ensureFilterForAddress_(target.address, subject, d.label, d.archive);
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
  if (props.getProperty('SYNC_VERSION') === '19') return;
  // Keep old message markers — clearing them would make every timer
  // execution revisit the whole mailbox and burn the daily runtime quota.
  props.setProperty('SYNC_VERSION', '19');
  Logger.log('V19 sync enabled; existing message markers preserved.');
}

function isSynced_(id) { return store_().getProperty('m_v10_' + id) === '1'; }
function markSynced_(id) { store_().setProperty('m_v10_' + id, '1'); }

// "CRM-related thread" registry: a thread is remembered once we see (or
// send) an outbound message on it. Kept as its own prefix so it can be
// wiped independently of the m_v10_ sync markers if ever needed.
function isThreadKnown_(threadId) { return store_().getProperty('t_' + threadId) === '1'; }
function markThreadKnown_(threadId) { if (threadId) store_().setProperty('t_' + threadId, '1'); }

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
function ensureFilterForAddress_(address, subject, labelNameOverride, archiveOverride) {
  if (!CFG_().USE_GMAIL_FILTERS) return; // master switch is off — poll-based tagging only
  recordFilterAttempt_('called for: ' + address + ' / subject: ' + subject);
  if (!address) { recordFilterAttempt_('no address, skipping'); return; }
  var subj = baseSubject_(subject);
  if (!subj) { recordFilterAttempt_('no usable subject for ' + address + ', skipping (avoids an overly broad from-only filter)'); return; }
  var addrLower = address.toLowerCase();
  var excluded = CFG_().EXCLUDE_FROM_FILTERS || [];
  for (var e = 0; e < excluded.length; e++) {
    if (String(excluded[e]).toLowerCase() === addrLower) {
      recordFilterAttempt_(address + ' is in EXCLUDE_FROM_FILTERS, skipping (falls back to per-thread poll archiving)');
      return;
    }
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
    if (existing.filter) {
      for (var i = 0; i < existing.filter.length; i++) {
        var f = existing.filter[i];
        if (f.criteria && f.criteria.from && f.criteria.from.toLowerCase() === addrLower
            && f.criteria.subject && f.criteria.subject.toLowerCase() === subj.toLowerCase()) {
          recordFilterAttempt_('filter already exists for ' + address + ' / ' + subj);
          return; // already set up for this exact conversation
        }
      }
    }

    var labelId = getOrCreateLabelId_(labelNameOverride || CFG_().LABEL_NAME);
    var action = { addLabelIds: [labelId] };
    if (shouldArchive) action.removeLabelIds = ['INBOX'];

    // Both from AND subject must match — this is what keeps the filter
    // scoped to this one conversation instead of every future email from
    // this address, unlike a from-only filter.
    var created = Gmail.Users.Settings.Filters.create({ criteria: { from: address, subject: subj }, action: action }, 'me');
    recordFilterAttempt_('SUCCESS - created filter for ' + address + ' / ' + subj + ': ' + JSON.stringify(created));
  } catch (err) {
    recordFilterAttempt_('FAILED for ' + address + ' / ' + subj + ': ' + err);
  }
}

// Strips leading "Re:"/"Fwd:" (repeated, any casing/language variant with
// a colon) so the same underlying conversation subject matches regardless
// of how many times it's been replied to. Falls back to '' (no filter) if
// nothing usable is left — a filter needs a real, specific subject to stay
// narrow; matching on a blank/near-blank subject would be as broad as a
// from-only filter, defeating the whole point.
function baseSubject_(s) {
  var t = String(s || '').replace(/^(re|fwd?)\s*:\s*/i, '').trim();
  while (/^(re|fwd?)\s*:\s*/i.test(t)) t = t.replace(/^(re|fwd?)\s*:\s*/i, '').trim();
  return t.length >= 3 ? t : '';
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

// Run this MANUALLY once, after turning USE_GMAIL_FILTERS off, to remove
// every filter this relay ever created automatically (any filter whose
// action applies the CRM label). Filters you or חביב created manually for
// unrelated things (IVR recordings, etc.) are left untouched.
function REMOVE_ALL_CRM_FILTERS() {
  if (typeof Gmail === 'undefined') {
    Logger.log('Gmail API advanced service is not enabled.');
    return;
  }
  var labelName = CFG_().LABEL_NAME;
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) { Logger.log('No "' + labelName + '" label found — nothing to remove.'); return; }
  var labelId = getOrCreateLabelId_(labelName);

  var existing = Gmail.Users.Settings.Filters.list('me');
  var removed = 0;
  if (existing.filter) {
    for (var i = 0; i < existing.filter.length; i++) {
      var f = existing.filter[i];
      // Only remove filters that (a) apply exactly this CRM label and
      // (b) key off a bare "from" address — i.e. filters this relay's own
      // ensureFilterForAddress_ would have created, not something you or
      // חביב set up manually with additional criteria.
      var appliesCrmLabel = f.action && f.action.addLabelIds && f.action.addLabelIds.indexOf(labelId) !== -1;
      var isSimpleFromFilter = f.criteria && f.criteria.from && !f.criteria.subject && !f.criteria.query && !f.criteria.hasAttachment;
      if (appliesCrmLabel && isSimpleFromFilter) {
        Gmail.Users.Settings.Filters.remove('me', f.id);
        removed++;
        Logger.log('Removed filter for: ' + f.criteria.from);
      }
    }
  }
  Logger.log('Done. Removed ' + removed + ' filter(s) total.');
}

// Run this MANUALLY once after installing this fix. Older versions marked
// a thread "known" (CRM-related) whenever mail was sent FROM the shared
// mailbox address — including mail sent manually, not through the CRM —
// which could have polluted the registry with unrelated conversations.
// This wipes the whole "known threads" list clean; going forward it will
// only be populated by actual CRM sends/replies, which is what you asked
// for. Safe to run: it does not touch email content, sync markers, or
// anything already in the CRM's database — it only means threads won't
// sync/tag again until the CRM sends something on them.
function RESET_ALL_KNOWN_THREADS() {
  var props = store_().getProperties();
  var removed = 0;
  for (var k in props) {
    if (k.indexOf('t_') === 0) { store_().deleteProperty(k); removed++; }
  }
  Logger.log('Cleared ' + removed + ' known-thread marker(s). Threads will re-register only via actual CRM sends/replies from now on.');
}

// Run this MANUALLY to make the relay "forget" a Gmail thread completely —
// it stops being treated as CRM-related (won't sync, won't get tagged)
// until the CRM sends something on it again. Use this to clean up test
// threads that got merged together by Gmail (same subject → same thread)
// and are now incorrectly still being treated as CRM-related.
//   FORGET_THREAD('19fd8b01d318b826')
function FORGET_THREAD(threadId) {
  if (!threadId) { Logger.log('Usage: FORGET_THREAD("gmailThreadId")'); return; }
  store_().deleteProperty('t_' + threadId);
  Logger.log('Forgot thread ' + threadId + ' — it will no longer sync or be tagged unless the CRM sends on it again.');
}

// Run this MANUALLY to remove a filter that was already created for an
// address that turned out to be too broad (e.g. a shared test/personal
// account). Pass the address as a string, e.g.:
//   REMOVE_FILTER_FOR_ADDRESS('7673952@gmail.com')
// Also add the address to CFG_().EXCLUDE_FROM_FILTERS above so a new one
// doesn't get created again automatically.
function REMOVE_FILTER_FOR_ADDRESS(address) {
  if (typeof Gmail === 'undefined') {
    Logger.log('Gmail API advanced service is not enabled.');
    return;
  }
  if (!address) {
    Logger.log('Usage: REMOVE_FILTER_FOR_ADDRESS("someone@example.com")');
    return;
  }
  var addrLower = address.toLowerCase();
  var existing = Gmail.Users.Settings.Filters.list('me');
  var removed = 0;
  if (existing.filter) {
    for (var i = 0; i < existing.filter.length; i++) {
      var f = existing.filter[i];
      if (f.criteria && f.criteria.from && f.criteria.from.toLowerCase() === addrLower) {
        Gmail.Users.Settings.Filters.remove('me', f.id);
        removed++;
      }
    }
  }
  Logger.log('Removed ' + removed + ' filter(s) for ' + address + '.');
}

// Convenience: run this one directly from the dropdown (no editing
// needed) to remove the filter created earlier for the shared test
// address. Add more one-line calls here for any other address you need
// to clean up the same way.
function CLEANUP_TEST_ADDRESS_FILTER() {
  REMOVE_FILTER_FOR_ADDRESS('7673952@gmail.com');
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


// ============ v20: pticha / sgira request emails ============
// Scans the two request labels and forwards every new message to the CRM.
// Runs off its own cursor and its own message markers ('rq_'), so it can never
// interfere with the CRM-thread sync above, and ONLY_SYNC_CRM_THREADS does not
// apply to it — these emails are machine-generated and never part of a CRM
// conversation thread.
function POLL_REQUEST_LABELS() {
  var cfg = CFG_();
  var props = store_();
  var started = new Date().getTime();
  var last = Number(props.getProperty('LAST_REQ_SYNC_MS') || 0);
  var floor = last > 0 ? last - 900000 : started - (3 * 24 * 60 * 60 * 1000);
  var afterSeconds = Math.floor(floor / 1000);
  var stats = { sent: 0, duplicate: 0, failed: 0, skipped: 0, timedOut: false };

  var labels = [cfg.PTICHA_LABEL, cfg.SGIRA_LABEL];
  for (var i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    syncRequestLabel_(labels[i], afterSeconds, stats, started);
    if (stats.timedOut) break;
  }
  if (!stats.timedOut) props.setProperty('LAST_REQ_SYNC_MS', String(started));
  Logger.log('V20 request sync: ' + JSON.stringify(stats));
  return stats;
}

function syncRequestLabel_(labelName, afterSeconds, stats, started) {
  var cfg = CFG_();
  var query = 'label:"' + String(labelName).replace(/"/g, '') + '" after:' + afterSeconds;
  var threads = GmailApp.search(query, 0, 100);
  for (var t = 0; t < threads.length; t++) {
    if (new Date().getTime() - started > 240000) { stats.timedOut = true; return; }
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      var id = msg.getId();
      if (msg.isDraft()) continue;
      if (store_().getProperty('rq_' + id) === '1') { stats.skipped++; continue; }

      var att = firstAudioAttachment_(msg);
      try {
        var res = UrlFetchApp.fetch(cfg.REQUEST_WEBHOOK_URL, {
          method: 'post',
          contentType: 'application/json',
          headers: { apikey: cfg.SECRET, Authorization: 'Bearer ' + cfg.SECRET },
          payload: JSON.stringify({
            gmailMessageId: id,
            gmailThreadId: threads[t].getId(),
            subject: msg.getSubject(),
            body: msg.getPlainBody(),
            receivedAt: msg.getDate().toISOString(),
            attachmentName: att ? att.name : null,
            attachmentIndex: att ? att.index : null
          }),
          muteHttpExceptions: true
        });
        var text = res.getContentText() || '{}';
        var parsed = JSON.parse(text);
        if (res.getResponseCode() >= 200 && res.getResponseCode() < 300 && parsed.ok) {
          store_().setProperty('rq_' + id, '1');
          if (parsed.duplicate) stats.duplicate++; else stats.sent++;
        } else {
          stats.failed++;
          Logger.log('Request rejected ' + id + ': ' + res.getResponseCode() + ' ' + text);
        }
      } catch (err) {
        stats.failed++;
        Logger.log('Request failed ' + id + ': ' + err);
      }
    }
  }
}

// Index is the position within getAttachments(), so the CRM can ask for the
// exact same attachment later without storing anything.
function firstAudioAttachment_(msg) {
  var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
  for (var i = 0; i < atts.length; i++) {
    var type = String(atts[i].getContentType() || '').toLowerCase();
    var name = String(atts[i].getName() || '').toLowerCase();
    if (type.indexOf('audio') === 0 || /\.(mp3|wav|ogg|m4a|amr|aac|wma)$/.test(name)) {
      return { index: i, name: atts[i].getName() };
    }
  }
  return atts.length ? { index: 0, name: atts[0].getName() } : null;
}

// Streams one attachment back to the CRM as base64. Nothing is stored on the
// Gmail side and nothing is stored in the CRM — the recording stays in Gmail.
function getAttachment_(d) {
  if (!d.gmailMessageId) return { ok: false, error: 'missing gmailMessageId' };
  var msg;
  try { msg = GmailApp.getMessageById(d.gmailMessageId); }
  catch (err) { return { ok: false, error: 'message not found' }; }
  if (!msg) return { ok: false, error: 'message not found' };

  var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
  var idx = typeof d.attachmentIndex === 'number' ? d.attachmentIndex : 0;
  if (!atts.length || idx < 0 || idx >= atts.length) return { ok: false, error: 'attachment not found' };

  var blob = atts[idx].copyBlob();
  var bytes = blob.getBytes();
  if (bytes.length > 15 * 1024 * 1024) return { ok: false, error: 'attachment too large' };

  return {
    ok: true,
    name: atts[idx].getName(),
    mimeType: blob.getContentType() || 'audio/mpeg',
    base64: Utilities.base64Encode(bytes)
  };
}

// Run MANUALLY once if you ever need the request pipeline to re-send
// everything from the last 3 days (it does not touch the CRM-thread sync).
function RESET_REQUEST_CURSOR() {
  var props = store_().getProperties();
  var removed = 0;
  for (var k in props) { if (k.indexOf('rq_') === 0) { store_().deleteProperty(k); removed++; } }
  store_().deleteProperty('LAST_REQ_SYNC_MS');
  Logger.log('Cleared ' + removed + ' request marker(s) and the request cursor.');
}
