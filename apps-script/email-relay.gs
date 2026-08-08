/**
 * ===== CRM Gmail Relay — Google Apps Script =====
 *
 * Lets every agent send email from a single shared Gmail address, with a
 * per-agent "From" display name + personal signature on each message, and
 * threads every reply from the recipient back into the right system card
 * in the CRM — based on Gmail's own Thread-Id, not on subject text, so it
 * survives subject changes / Re: / Fwd:.
 *
 * ---------- ONE-TIME SETUP ----------
 * 1. Go to https://script.google.com → New project. Paste this whole file
 *    in (replacing the default Code.gs content).
 * 2. Project Settings (gear icon) → Script Properties → add:
 *      SHARED_SECRET   = <same long random value you'll enter in
 *                          ניהול → מיילים in the CRM>
 *      INBOUND_WEBHOOK_URL = <your CRM site URL>/api/public/hooks/inbound-email
 *      INBOUND_WEBHOOK_SECRET = <same secret as SHARED_SECRET, or reuse it>
 * 3. Deploy → New deployment → type: "Web app".
 *      Execute as: Me
 *      Who has access: Anyone
 *    Copy the resulting Web App URL — that's what you paste into
 *    ניהול → מיילים → "כתובת Web App" in the CRM.
 * 4. Run setupTrigger() once (select it in the function dropdown above and
 *    click ▶ Run) — this creates the recurring inbox-scan trigger and will
 *    prompt you to authorize Gmail access. Also creates the Gmail label
 *    "CRM-Thread" used to mark tracked threads.
 *
 * ---------- HOW IT WORKS ----------
 * - Sending (new thread or reply) comes in as a POST to this Web App from
 *   the CRM. We send/reply via GmailApp, label the thread "CRM-Thread", and
 *   return the Gmail thread/message id synchronously so the CRM can store
 *   them right away.
 * - Every few minutes, scanInbox() scans recent Gmail threads and forwards
 *   messages to the CRM. Synced message IDs are stored in Script Properties;
 *   no Gmail label is created and messages are not marked as read.
 */

const CRM_LABEL_NAME = "CRM-Thread";

function getProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function getOrCreateLabel_() {
  return GmailApp.getUserLabelByName(CRM_LABEL_NAME) || GmailApp.createLabel(CRM_LABEL_NAME);
}

function buildBody_(bodyText, agentSignature) {
  return agentSignature ? (bodyText + "\n\n--\n" + agentSignature) : bodyText;
}

/**
 * Web App entry point. Body (JSON): { secret, action, ... }
 * action = "send"  → { to, subject, body, agentName, agentSignature, systemId }
 * action = "reply" → { gmailThreadId, body, agentName, agentSignature }
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");
    if (payload.secret !== getProp_("SHARED_SECRET")) {
      return jsonResponse_({ ok: false, error: "unauthorized" }, 401);
    }

    if (payload.action === "send") {
      return handleSend_(payload);
    }
    if (payload.action === "reply") {
      return handleReply_(payload);
    }
    if (payload.action === "send_backup") {
      return handleSendBackup_(payload);
    }
    return jsonResponse_({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) }, 500);
  }
}

function handleSend_(payload) {
  const fullBody = buildBody_(payload.body || "", payload.agentSignature);
  const draft = GmailApp.createDraft(payload.to, payload.subject || "", fullBody, {
    name: payload.agentName || undefined,
  });
  const message = draft.send();
  const thread = message.getThread();
  thread.addLabel(getOrCreateLabel_());
  // New replies land in the inbox but Apps Script marks sent threads read
  // by default — fine, since we only care about *unread* future replies.

  return jsonResponse_({
    ok: true,
    gmailThreadId: thread.getId(),
    gmailMessageId: message.getId(),
  });
}

function handleReply_(payload) {
  const thread = GmailApp.getThreadById(payload.gmailThreadId);
  if (!thread) return jsonResponse_({ ok: false, error: "thread not found" }, 404);

  const fullBody = buildBody_(payload.body || "", payload.agentSignature);
  const messages = thread.getMessages();
  const last = messages[messages.length - 1];
  const sent = last.reply(fullBody, { name: payload.agentName || undefined });
  thread.addLabel(getOrCreateLabel_());

  return jsonResponse_({
    ok: true,
    gmailThreadId: thread.getId(),
    gmailMessageId: sent.getId(),
  });
}

/**
 * Sends a CRM backup email with a base64-encoded zip attachment — used by
 * runBackup()/sendBackupEmail() in the CRM as an alternative to a
 * transactional email provider, so backups can go out through the same
 * Gmail account. payload: { to, subject, body, attachmentBase64, attachmentName }
 */
function handleSendBackup_(payload) {
  const bytes = Utilities.base64Decode(payload.attachmentBase64);
  const blob = Utilities.newBlob(bytes, "application/zip", payload.attachmentName || "backup.zip");
  GmailApp.sendEmail(payload.to, payload.subject || "גיבוי CRM", payload.body || "", { attachments: [blob] });
  return jsonResponse_({ ok: true });
}

function jsonResponse_(obj, _status) {
  // Apps Script Web Apps can't set a real HTTP status code on the response;
  // the CRM side checks the "ok" field in the JSON body instead.
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Scans "CRM-Thread" labeled threads for unread messages (i.e. replies
 * from the recipient) and forwards each one to the CRM's inbound webhook.
 * Run this on a time-driven trigger (see setupTrigger below) — every 2-5
 * minutes is reasonable.
 */
function scanInbox() {
  const threads = GmailApp.search("in:anywhere newer_than:14d", 0, 200);
  const url = getProp_("INBOUND_WEBHOOK_URL");
  const secret = getProp_("INBOUND_WEBHOOK_SECRET") || getProp_("SHARED_SECRET");
  if (!url) { Logger.log("INBOUND_WEBHOOK_URL not configured — skipping scan"); return; }

  threads.forEach((thread) => {
    thread.getMessages().forEach((msg) => {
      if (msg.isDraft() || isSynced_(msg.getId())) return;
      try {
        const res = UrlFetchApp.fetch(url, {
          method: "post",
          contentType: "application/json",
          headers: { apikey: secret, Authorization: "Bearer " + secret },
          payload: JSON.stringify({
            gmailThreadId: thread.getId(),
            gmailMessageId: msg.getId(),
            from: msg.getFrom(),
            to: msg.getTo(),
            subject: msg.getSubject(),
            body: msg.getPlainBody(),
            receivedAt: msg.getDate().toISOString(),
          }),
          muteHttpExceptions: true,
        });
        const parsed = JSON.parse(res.getContentText() || "{}");
        if (res.getResponseCode() >= 200 && res.getResponseCode() < 300 && parsed.ok) {
          markSynced_(msg.getId());
        } else {
          Logger.log("inbound webhook failed: " + res.getContentText());
        }
      } catch (err) {
        Logger.log("inbound webhook error: " + err);
      }
    });
  });
}

function isSynced_(messageId) {
  return PropertiesService.getScriptProperties().getProperty("mail_" + messageId) === "1";
}

function markSynced_(messageId) {
  PropertiesService.getScriptProperties().setProperty("mail_" + messageId, "1");
}

/** Run once manually to create the recurring scan trigger + the label. */
function setupTrigger() {
  getOrCreateLabel_();
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "scanInbox")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("scanInbox").timeBased().everyMinutes(5).create();
  Logger.log("Trigger created — scanInbox will run every 5 minutes.");
}
