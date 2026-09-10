# סבב סגירה: כרטיס בקשה קומפקטי, מחיקת בקשות, ביקורת DB ומייל בתיוג

האוטומציה של הבקשות נשארת `dry_run` בכל שלב. לא עורכים מיגרציות שכבר הופעלו — כל שינוי DB במיגרציה חדשה. אין `USING (true)` או GRANT רחב.

## 1. כרטיס בקשה קומפקטי (מסך בקשות)

הכרטיס היום תופס 12–18 שורות. המבנה החדש:

```text
[בקשת פתיחה] 12345 · שם המערכת                         10/09 14:32
בקשה 8812 · פונה 052-1234567 · נוכחי: פתוח · מוצע: סגור · דורש החלטה · בדיקה
▸ תאור הדיווח (מקופל, שורה אחת עם תחילת הטקסט)   [השמע הקלטה]
שם: [__________] [שמור]   סטטוס: [▼] [החל] [השאר] [התעלם] [מחק]
```

- שורת הפרטים הופכת לשורה אחת מופרדת ב־"·" (עם גלישה רק במסך צר). "מצב בדיקה" ו"פעולה שהכלל קבע" הופכים לתגיות קצרות במקום משפטים.
- תאור הדיווח מקופל כברירת מחדל ומציג 80 תווים ראשונים בכותרת; "אין תאור דיווח" נעלם (נשאר רק כשאין תיאור ואין הקלטה — כתג קטן).
- טקסט ההסבר הארוך ("השאר ללא שינוי מסמן…") עובר ל־`title` על הכפתורים.
- שדה שם המערכת ובחירת הסטטוס באותה שורה.
- ההודעה על "פעולה שהתחילה ולא הושלמה" נשארת (חשובה), אבל בשורה אחת.

## 2. מחיקת בקשות + הרשאה חדשה

- הרשאה חדשה `requests_delete` ("מחיקת בקשות") ב־`permissions.config.ts`, עם תנאי מוקדם `requests_view`. תופיע אוטומטית במסך ניהול → הרשאות (הטבלה נבנית מהקונפיג).
- פעולת שרת `deleteSystemRequest(id)`: טוענת את הבקשה לפי ה־CRM השמור עליה (`loadAuthorizedRequest` עם `requests_delete`), הגנת קצב חדשה `request_delete`, מחיקה עם `.select("id")` ובדיקת affected rows. ה־FK `duplicate_of` כבר מוגדר `ON DELETE SET NULL`, כך שבקשות כפולות לא נשברות. רישום ליומן הפעילות של המערכת (אם משויכת) עם סיבה "מחיקת בקשה מהתור".
- UI: כפתור "מחק" (אייקון פח, וריאנט ghost) בכרטיס, מוצג רק כשיש הרשאה; חלון אישור קצר; מחיקה זמינה גם בבקשות שכבר הוכרעו (במצב "כל הבקשות").
- `getMyRole` מחזיר את ההרשאה החדשה כמו השאר — אין שינוי במנגנון.
- בדיקות: `permissions-coverage.test.ts` (ההרשאה קיימת ותנאי המוקדם נאכף), `rate-limit-coverage.test.ts` (הפעולה מסווגת), בדיקת יחידה שמשתמש ללא ההרשאה נדחה ושבקשה מ־CRM אחר לא נמחקת. אימות ידני בדפדפן: מחיקה מצליחה ומעדכנת את הרשימה ואת המונה.

## 3. Rate limit — ALREADY FIXED + ממצאי ביקורת

הכיסוי הקיים (`admin_user_manage`, `admin_permissions`, `email_send`, `mailbox_delete`, `system_delete`, `import_export`, `backup_*`, `request_manage`, `request_decide`, `voice_send`) לא ישוכתב ויסומן ALREADY FIXED.

הביקורת מצאה פעולות רגישות שעדיין ללא סיווג ויקבלו limiter (ורק הן):

| פעולה | למה רגישה | scope |
|---|---|---|
| `setEmailRelayConfig` | שומרת URL+סוד של הממסר ומבצעת ping לכתובת שנמסרה | `admin_integrations` |
| `setBackupWebhookConfig` | סוד גיבוי | `admin_integrations` |
| `deleteCrm`, `setCrmUserRole` | מחיקת CRM שלם / שינוי תפקיד ב־CRM | `admin_user_manage` |
| `deleteActivityLog`, `updateActivityLog` | שינוי יומן ביקורת | `history_edit` (חדש) |
| `deleteStatusSetting` | מוחקת סטטוס גלובלי | `request_manage` |
| `deleteSystemRequest` (חדש) | מחיקת נתוני מקור | `request_delete` |

פעולות קטנות (חתימת מייל, הגדרות תצוגה, העדפות התראה אישיות) לא יקבלו limiter. בדיקת הכיסוי תעודכן בהתאם.

## 4. SECURITY DEFINER — תוצאה מה־DB בפועל

השאילתה הורצה מול מסד הנתונים הפעיל (`pg_proc` + `has_function_privilege` + `aclexplode`), 10/09/2026:

```text
סה"כ SECURITY DEFINER: 28  (public: 19, private: 9)
נגישות ל-authenticated: 2  — private.has_role, private.is_app_member (נדרשות ל-RLS)
נגישות ל-PUBLIC/anon:   0
service_role בלבד:      26  (בקשות, voice queue, rate limit, MFA/OTP, טריגרים)
search_path מקובע בכולן.
add_system_status_enum_value(text): לא קיימת ב-DB (אין מה לסגור).
```

פער אמיתי שנמצא — שלוש פונקציות SECURITY INVOKER פתוחות ל־PUBLIC ו־anon:
`list_systems_page`, `reports_summary`, `systems_status_counts`. RLS מגן על הטבלאות, אבל ההרשאה מיותרת.

- מיגרציה חדשה: `REVOKE EXECUTE … FROM PUBLIC, anon` על שלושתן, ו־`GRANT EXECUTE TO authenticated, service_role` מפורש (כדי לא לחזור על תקלת ההרשאות הקודמת — בדיקה בדפדפן מיד אחרי ההחלה: דשבורד, דוחות, מונים).
- `.lovable/security-expected-state.md` (או הרחבת `DEPLOY.md`): snapshot מלא של הפלט (schema, שם, חתימה, owner, secdef, search_path, PUBLIC/anon/authenticated/service_role) + השאילתה עצמה לשחזור. ללא סודות.
- בדיקה `security-expected-state.test.ts`: רשימת ה־RPC המותרות ל־authenticated מוגדרת בקוד, וכל קריאת `.rpc("…")` בקוד הלקוח/משתמש חייבת להיות ברשימה; פונקציה שמופיעה ב־snapshot כ־service_role-only ונקראת דרך `context.supabase` — הבדיקה נופלת.
- הרצה חוזרת של השאילתה אחרי המיגרציה החדשה ותיעוד הפלט השני בדוח.

## 5. פיצ'ר: מייל אוטומטי בכל תיוג @

### זרימה

```text
שמירת הערה (system_notes / crm_record_notes)
  └─ באותה קריאת שרת, אחרי INSERT מוצלח:
     יצירת שורות outbox ב-mention_email_deliveries (idempotent)
     → ההערה נשמרה, המשתמש רואה "ההערה נוספה"
  └─ ניסיון שליחה מיידי best-effort + חימוש job
pg_cron (self-arming, כמו תור הקול) → /api/public/hooks/process-mention-emails
  └─ claim אטומי → שליחה דרך Apps Script (send_notification) → sent / retry
```

### מזהי משתמש ולא שמות
- כרטיס מערכת: ה־chip מקבל גם `data-mention-user-id` (ה־id כבר קיים ב־`allMentionOptions`); `serializeNote` מחזיר `{ body, mentionedUserIds, mentionAll }`. `addNote` ו־`updateNote` מקבלים את השדות החדשים.
- כרטיס CRM (`c.$crm.$id.tsx`): ה־datalist מוחלף באותו composer chip (קומפוננטה משותפת `MentionEditor`), כך ששני המסלולים שולחים IDs.
- הטקסט השמור נשאר `@שם` (הפעמון והתצוגה ממשיכים לעבוד ללא שינוי).

### אימות בשרת (`mention-deliveries.server.ts`)
- לכל `user_id`: קיים ב־`profiles`, יש לו גישה ל־CRM (`has_crm_access`) ולמערכת/רשומה; המחבר עצמו מסונן; כפילויות מסוננות; ID לא מורשה נזרק בשקט ונרשם ב־log (ללא כשל של ההערה).
- `@כולם`: מורחב בשרת לכל חברי ה־CRM הרלוונטי (למעט המחבר), שורה נפרדת לכל נמען.
- מכבד את העדפת הפעמון הקיימת "תיוג בהערה (@)": משתמש שכיבה אותה יקבל `skipped_disabled`.

### טבלת outbox — מיגרציה חדשה `mention_email_deliveries`
```text
id, source_type ('system_note'|'crm_note'), source_note_id, system_id, record_id, crm_key,
mentioned_user_id, mentioned_by, status ('pending'|'sending'|'sent'|'failed'|'retry'|
'skipped_no_email'|'skipped_disabled'|'unknown'), attempts, next_retry_at, claim_at,
last_error, created_at, sent_at
UNIQUE (source_type, source_note_id, mentioned_user_id)   ← מונע כפילות
```
GRANT ל־service_role בלבד + RLS ללא מדיניות (server-only, כמו `system_requests`). RPCs חדשות (SECURITY DEFINER, service_role בלבד): `enqueue_mention_deliveries(...)` (INSERT … ON CONFLICT DO NOTHING, מחזירה כמה נוצרו), `claim_mention_deliveries(limit, stale)` (FOR UPDATE SKIP LOCKED), `ensure_mention_queue_job()` / `drain_mention_queue_job()` באותו מנגנון של תור הקול (`private.cron_config`/`cron_tokens`).

### עריכת הערה
ה־UNIQUE הוא מנגנון ה־diff: עריכה שמוסיפה משתמש חדש יוצרת שורה חדשה (מייל אחד), משתמש קיים לא נוצר שוב, טקסט בלבד — 0 שורות. הסרה והוספה מחדש לא שולחת שוב (לא ניתן להבחין חד־משמעית — לפי ההנחיה).

### כתובת נמען ו־URL
- אימייל נפתר בשרת בלבד דרך `supabaseAdmin.auth.admin.getUserById` (לא מ־`profiles`, לא מהלקוח). אין מייל → `skipped_no_email`.
- משתנה סביבה חדש `APP_BASE_URL` (ב־`env.server.ts`, `.env.example`, `DEPLOY.md`, `ENV_FEATURES`). קישור: `${APP_BASE_URL}/systems/{id}` או `${APP_BASE_URL}/c/{crmKey}/{recordId}`. חסר → השורה נשארת `failed` עם שגיאה ברורה (לא נשלח קישור שגוי). אין שימוש ב־Host.

### שליחה — Apps Script v22
- action חדש `send_notification` עם `{ to, subject, greeting, intro, recordTitle, excerpt, buttonText, buttonUrl }`. הסקריפט בונה HTML בעצמו: `escapeHtml_` על כל שדה, כפתור בולט, `buttonUrl` מאומת מול Script Property חדש `APP_BASE_URL` (חייב להתחיל בו). לא נשלח HTML מהשרת.
- נשלח מהחיבור הקיים של ה־CRM (`app_settings` relay) בשם המערכת, לא נדרשת הרשאת `emails_send` למתייג, ולא נרשם ב־`email_messages`.
- המקבל אחראי לפרוס גרסה חדשה ולהוסיף `APP_BASE_URL` ב־Script Properties — ייכתב בדוח.

### אמינות
- claim אטומי עם `claim_at` (שני workers — אחד שולח). backoff: 1, 5, 15, 60 דק', עד 6 ניסיונות ואז `failed`.
- תוצאה לא ודאית (timeout/רשת אחרי שליחה): המצב עובר ל־`unknown` ולא חוזר לתור אוטומטית — כמו בתור הקול; מנהל יכול ללחוץ "נסה שוב" במודע.
- ה־job מתחמש כשיש שורות ממתינות ומתפרק כשהתור ריק (אפס עלות במנוחה), ללא תלות בדשבורד.

### ניטור
טאב "משלוחי תיוג" במסך ניהול → התראות: טבלה של שורות ב־`retry/failed/unknown/pending` (נמען, הערה, מערכת/רשומה, סטטוס, ניסיונות, ניסיון הבא, שגיאה) + "נסה שוב". ללא גוף מייל, ללא סודות.

## 6. בדיקות (חדשות)

- `mention-deliveries.test.ts` — 22 התרחישים מהדרישה (תיוג יחיד, כפול, מרובה, עצמי, @כולם עם הרחקת המחבר ומשתמש CRM אחר, שמות זהים, שינוי שם, ID מזויף, נמען לא מורשה, ללא מייל, הצלחה, כשל זמני, retry, שני workers, שלושת תרחישי העריכה, URL למערכת/ל־CRM, origin מאושר, HTML escaping, תוצאה לא ודאית).
- `notifications-bell.test.ts` — רגרסיה: `isMentioned` ממשיך לזהות `@שם` ו־`@כולם`; הפעמון לא מייצר פריט כפול.
- `apps-script-html.test.ts` — הרחבה ל־`send_notification` (escaping ואימות URL).
- עדכוני `permissions-coverage`, `rate-limit-coverage`, `security-expected-state`.

## 7. דוח סיום (יוחזר בסוף הביצוע)

סטטוס לכל סעיף (DONE / ALREADY FIXED / NOT RUN), קבצים, מיגרציות, מבנה ה־outbox, טיפול ב־@כולם, פתרון כתובת המייל, בניית ה־URL, מניעת כפילות, כשל זמני, תוצאה לא ודאית, retry ללא דשבורד, שינויי Apps Script ו־Script Properties הנדרשים, פלט 22 בדיקות התיוג ובדיקת הרגרסיה, ופלט השאילתה מה־DB לפני ואחרי המיגרציה. כתובת תור הקול בפרודקשן נשארת NOT RUN, ולכן הסטטוס הכולל יישאר NOT READY FOR LIVE.

## פרטים טכניים

- קבצים: `requests.tsx`, `permissions.config.ts`, `system-requests.functions.ts`, `requests-access.server.ts` (הרחבת טיפוס ההרשאה), `db-rate-limit.server.ts`, `email.functions.ts`, `crms.functions.ts`, `admin.functions.ts`, `systems.functions.ts` (addNote/updateNote), `crm-records.functions.ts` (addRecordNote/updateRecordNote), חדשים: `components/MentionEditor.tsx`, `lib/mention-deliveries.server.ts`, `lib/mention-deliveries.functions.ts`, `routes/api/public/hooks/process-mention-emails.ts`, `env.server.ts`, `apps-script/email-relay.gs`, `DEPLOY.md`, `.env.example`, `.lovable/security-expected-state.md`, `.lovable/production-readiness.md`.
- מיגרציות חדשות (2): (א) REVOKE PUBLIC/anon משלוש ה־RPC + GRANT מפורש; (ב) טבלת `mention_email_deliveries` + RPCs + grants ל־service_role.
- ה־endpoint החדש משתמש באותו אימות של תור הקול (`x-cron-token` מ־`private.cron_tokens` או סוד webhook) ובאותו rate limit ציבורי.
