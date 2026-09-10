# סבב סגירה: כרטיס בקשה, שם מערכת בבקשה, מחיקה רכה, הרשאות DB בפועל ומייל בתיוג

עקרונות מחייבים: האוטומציה נשארת `dry_run`. אין עריכה של מיגרציה שהופעלה — רק מיגרציות חדשות. אין `USING (true)` או GRANT רחב. לכל תיקון בדיקה. סעיף שכבר תוקן מסומן ALREADY FIXED רק עם הוכחה על ה־artifact עצמו. בדיקות שיוצרות נתונים (משתמשים/CRM/רשומות) לא רצות מול פרודקשן. סדר ביצוע: 1) הרשאות DB + `.env` ארכיון, 2) כרטיס בקשה + מחיקה רכה + שם מערכת, 3) outbox למייל רגיל + voice `sending/unknown` + אטומיות ניהול, 4) תיוגים (טבלאות, RPC, עורך, worker, Apps Script, endpoint config), 5) בדיקות, מסמכים, דוח.

## 1. חסמים מהסבב הקודם — מצב מאומת (נבדק בקוד ובמסד, 10/09/2026)

| נושא | מצב | ממצא / מה ייעשה |
|---|---|---|
| `report_description` — parser עם `:` | לבדיקה | תיווסף בדיקה עם נקודתיים בגוף ובכותרת; אם הפרסר חותך — תיקון. |
| `report_description` בכרטיס המערכת | OPEN | `SystemRequestsCard` לא מציג את התיאור — יתווסף (מקופל). |
| שגיאת DB ב־rescan של התיאור | OPEN | ב־`system-requests.server.ts` העדכון של התיאור לא בודק `error` — יתוקן ויוחזר `retry`. |
| Voice: ספק הצליח + DB נכשל | OPEN | אחרי `CallExtensionBridging` מוצלח, כשל בעדכון `sent_at` זורק שגיאה → התור מנסה שוב → שיחה כפולה. תיקון: לפני הפנייה לספק נכתב `voice_pending_reason='sending'` + `voice_claim_at`; הצלחה → `sent`; כשל DB אחרי הצלחת ספק → ניסיון סימון `unknown`. אם גם זה נכשל, השורה נשארת `sending`: worker שתופס `sending` ישן (מעל `stale_seconds`) **לא** פונה לספק — מעביר ל־`unknown` עם `voice_last_error`, רושם ב־`voice_message_log` (`send_mode='unknown'`) ומציג בכרטיס "תוצאה לא ודאית — לבדיקה ידנית"; שליחה חוזרת רק ידנית. |
| `voice_queue_url` deployment | חלקית | הכתובת מוגדרת במסד ל־URL הפרודקשן הקבוע. בדיקת קצה־לקצה ללא דשבורד: תתועד ב־`DEPLOY.md` כשלב; אם לא ניתן להריץ מהסנדבוקס — NOT RUN. |
| effective privileges של `profiles` | OPEN — ממצא אמיתי | `authenticated` מחזיק TRUNCATE/REFERENCES/TRIGGER/MAINTAIN על 26 טבלאות (כולל `profiles`, `systems`, `user_roles`). TRUNCATE עוקף RLS. בנוסף ב־`profiles`: SELECT/INSERT/UPDATE/DELETE ברמת טבלה שמבטלים בפועל את ה־grants ברמת עמודות. מיגרציה: REVOKE של ארבע ההרשאות מ־`anon, authenticated` על כל `public` + הידוק `profiles` לעמודות בלבד (פירוט בסעיף 6). |
| Expected Security State מול DB | OPEN | ראו סעיף 6. |
| בדיקות RLS אמיתיות (2 משתמשים / 2 CRM) | OPEN | snapshot קריאה־בלבד ירוץ מול המסד החי; בדיקות ה־mutation (יצירת משתמשים/CRM) רק מול staging/local — בסנדבוקס הזה קיים רק מסד הפרודקשן, ולכן ידווחו NOT RUN עד שתוגדר סביבת staging (סעיף 6). |
| `.env` מחוץ לארכיונים | OPEN — ממצא אמיתי | `.env` **עוקב ב־git** (`git ls-files`) ולכן כל ארכיון מבוסס git כולל אותו; `.dockerignore` אינו הוכחה. תוכנו: 6 מפתחות בלבד — `SUPABASE_URL/PROJECT_ID/PUBLISHABLE_KEY` וגרסאות `VITE_` שלהם (ערכים ציבוריים; הקובץ מנוהל ע"י הפלטפורמה ואסור לערוך אותו). תיקון: סקריפט `scripts/make-share-archive.sh` שמפיק את ארכיון השיתוף עם `export-ignore` ב־`.gitattributes` ל־`.env`, `.env.*` (למעט `.env.example`), `*credentials*`, `*secret*`, `*.pem`, `.dev.vars`; בדיקה שמפיקה את הארכיון בפועל, פותחת את רשימת הקבצים ונכשלת אם אחד מהם קיים. ALREADY FIXED יסומן רק אחרי שה־artifact עצמו עבר. |
| `mail_thread_state` | OPEN — ממצא אמיתי | `anon` מחזיק את כל ההרשאות על הטבלה, ו־`authenticated` INSERT/UPDATE/DELETE; השרת קורא וכותב רק דרך service_role. מיגרציה: REVOKE ALL מ־`anon`, `authenticated` (המדיניות הקיימת נשארת לא־פעילה בפועל). |
| אטומיות `createUser` / `setUserRole` / `updateUserDisplayName` | OPEN (2 מתוך 3) | `createUser`: משתמש auth נוצר ואז profile+role — כשל משאיר משתמש יתום → פיצוי: מחיקת ה־auth user בכשל. `setUserRole`: delete ואז insert לא אטומי → RPC חדש `set_user_role_atomic` (service_role בלבד, טרנזקציה אחת). `updateUserDisplayName`: עדכון יחיד — ALREADY FIXED. |
| מייל רגיל: relay הצליח + DB/תהליך נכשל | OPEN | `sendSystemEmail`/`sendRecordEmail`/`sendMailboxMessage` פונים ל־relay ורק אחר כך כותבים ל־DB; קריסה או כשל אחרי הצלחת relay → לחיצה חוזרת שולחת שוב. תיקון: טבלת outbox `email_deliveries` (service_role בלבד) עם `idempotency_key` ייחודי שהלקוח מייצר בפתיחת החלון (`crypto.randomUUID`) ונשלח בכל ניסיון; מצבים `pending → sending → sent | failed | unknown`. הרשומה נכתבת **לפני** הפנייה ל־relay; מפתח קיים במצב `sending/sent/unknown` → אין פנייה נוספת לספק, מוחזר המצב הקיים. הצלחת relay + כשל finalization → `unknown` + הודעה למשתמש "ייתכן שנשלח — בדוק בתיבה"; אין resend אוטומטי. `sending` ישן (מעל 10 דק') → `unknown`. |
| cron גיבויים מול הטקסט | ALREADY FIXED | ה־job `scheduled-backup-heartbeat` רץ `5 * * * *` והטקסט ב־`backup-schedule-text.ts` אומר "בראש כל שעה". אין פער של 15 דקות. |
| Production Readiness | OPEN (מסמך) | יעודכן בסוף עם הסטטוס האמיתי. |
| Rate limit על פעולות רגישות | ALREADY FIXED + פערים | ראו סעיף 5. |

## 2. כרטיס בקשה קומפקטי

```text
[בקשת פתיחה] 12345 · שם המערכת                              10/09 14:32
בקשה 8812 · פונה 052-1234567 · נוכחי: פתוח · מוצע: סגור · [דורש החלטה] [בדיקה]
▸ תאור הדיווח: 80 תווים ראשונים…                          [השמע הקלטה]
שם מערכת: [___________] ← תוצאות התאמה מתחת (סעיף 3)
סטטוס: [▼]  [החל] [השאר] [התעלם] [מחק]
```

- שורת פרטים אחת מופרדת ב־"·"; מצב האוטומציה ופעולת הכלל כתגיות קצרות.
- הסברי הכפתורים ב־Tooltip נגיש (`@/components/ui/tooltip`) + `aria-label`, לא `title` בלבד.
- הודעת "פעולה שהתחילה ולא הושלמה" נשארת גלויה, בשורה אחת.
- "אין תאור דיווח" רק כתג קטן כשאין תיאור ואין הקלטה.

## 3. שם מערכת בבקשה — אותו מנגנון כמו בפתיחת פנייה

המנגנון הקיים ב־`YemotCreateModal`: `findSystemByName` (שרת) → התאמות מדויקות מנורמלות → פתרון שורש (`resolveRoot`) → אפשרויות אב → בחירה sub/root → `addSubSystem` / `createSystem` / `ensureCategoryRoot` לקטגוריות.

- חילוץ הלוגיקה הטהורה (נרמול, סינון התאמות, פתרון שורש, בניית אפשרויות אב, קטגוריות וירטואליות) למודול משותף `src/lib/system-name-match.ts`, והוק `useSystemNameMatch(name)` עם debounce 250ms. המודאל עובר להשתמש בו ללא שינוי התנהגות (regression test על הלוגיקה שחולצה).
- במסך הבקשות, מתחת לשדה השם: "לא נמצאה מערכת → תיווצר מערכת חדשה" או רשימת התאמות (מספר + שם) ובחירה מפורשת: קישור לקיימת / תת־מערכת תחתיה / מערכת ראשית חדשה בכל זאת. כמה התאמות — המשתמש בוחר; אין ניחוש. שינוי השם מאפס את הבחירה.
- אין "החל" שיוצר מערכת בשקט כשיש התאמה — הכפתור נחסם עד לבחירה.
- intent: מיגרציה חדשה מוסיפה ל־`system_requests`: `manual_system_action` (`link_existing|create_root|create_subsystem`), `manual_target_system_id`, `manual_target_parent_system_id`, ו־`manual_root_confirmed_matches` (jsonb — רשימת מזהי המערכות שהוצגו למשתמש כשבחר במפורש "מערכת ראשית חדשה בכל זאת"). נשמרים לפני הביצוע; retry/refresh ממשיכים בדיוק אותה בחירה ולא מחפשים מחדש.
- שרת: `decideSystemRequest` מקבל את הבחירה, מאמת דרך ה־supabase של המשתמש (RLS) שהמערכת/האב נראים לו ושייכים ל־CRM של הבקשה, בודק `systems_write`. יצירת תת־מערכת דרך helper משותף `createSubSystemCore` שגם `addSubSystem` משתמש בו (לא העתקה).
- שני מצבי root — הבחנה מפורשת:
  - מצב א׳ (conflict אמיתי): בזמן הבחירה לא הוצגה התאמה (`manual_root_confirmed_matches` ריק/NULL) ובזמן הביצוע השרת מוצא התאמה → לא יוצר, מחזיר `{ ok:false, conflict:true, matches }`, המסך מציג את ההתאמות ומבקש בחירה מחדש.
  - מצב ב׳ (אישור מפורש): הלקוח שולח את מזהי ההתאמות שהוצגו לו; השרת מריץ את ההתאמה בעצמו ומאשר את הבחירה רק אם קבוצת ההתאמות הנוכחית מוכלת בקבוצה שאושרה (השרת מאמת — לא סומך על boolean מהלקוח). אם צצה התאמה חדשה שלא הוצגה → חוזרים למצב א׳ עם ההתאמות המעודכנות. אחרי אימות נשמר ה־snapshot ב־intent, וה־retry משתמש בו במקום לחסום שוב.
  - יצירה עם קוד קיים נדחית ע"י האילוץ הקיים במסד בכל מקרה.

## 4. מחיקת בקשות — soft delete + הרשאה

- מיגרציה: `deleted_at`, `deleted_by`, `delete_reason` על `system_requests`. RPC `soft_delete_system_request(id, actor, reason)` service_role בלבד, מחזיר affected rows.
- הרשאה חדשה `requests_delete` ("מחיקת בקשות", דורשת `requests_view`) ב־`permissions.config.ts` — מופיעה אוטומטית בניהול → הרשאות.
- שרת `deleteSystemRequest`: `loadAuthorizedRequest` עם `requests_delete`, rate limit `request_delete`, קריאה ל־RPC, רישום ביומן המערכת אם משויכת.
- כל הרשימות, המונים, ה־Badge, כרטיס המערכת והרצועה בדשבורד מסננים `deleted_at IS NULL`. סינון "נמחקו" זמין למי שיש לו `requests_delete`. אין purge פיזי בסבב זה.
- UI: כפתור פח עם אישור, סיבה אופציונלית.

## 5. Rate limit

ALREADY FIXED: `admin_user_manage`, `admin_permissions`, `email_send`, `mailbox_delete`, `system_delete`, `import_export`, `backup_*`, `request_manage`, `request_decide`, `voice_send` — לא ישוכתבו.

פערים אמיתיים שנמצאו ויקבלו limiter: `setEmailRelayConfig` ו־`setBackupWebhookConfig` (סודות + ping לכתובת חיצונית) → `admin_integrations`; `deleteCrm`, `setCrmUserRole` → `admin_user_manage`; `deleteActivityLog`, `updateActivityLog` → `history_edit`; `deleteStatusSetting` → `request_manage`; חדשים: `request_delete`, `mention_email_send` (batch של worker התיוג, ברירת מחדל 20 לדקה, התור ממשיך בסבב הבא בלי לאבד שורות), `mention_retry_unknown`. פעולות זעירות (חתימה, העדפות אישיות) — לא.

## 6. הרשאות DB בפועל — snapshot + מיגרציה + integration test

תוצאה מה־DB הפעיל (`pg_proc`, `has_function_privilege`, `aclexplode`, `pg_policies`):

```text
SECURITY DEFINER: 28 (public 19, private 9). search_path מקובע בכולן.
נגישות ל-authenticated: private.has_role, private.is_app_member בלבד (נדרשות ל-RLS).
נגישות ל-PUBLIC/anon: 0.  service_role בלבד: 26.
add_system_status_enum_value(text): לא קיימת ב-DB.
INVOKER פתוחות ל-PUBLIC+anon: list_systems_page, reports_summary, systems_status_counts.
טבלאות: authenticated עם TRUNCATE/REFERENCES/TRIGGER/MAINTAIN על 26 טבלאות;
        mail_thread_state פתוחה ל-anon (כל ההרשאות).
```

- מיגרציה אחת: REVOKE EXECUTE FROM PUBLIC, anon על שלוש ה־RPC בחתימה המלאה מ־`pg_proc` (בדיקת overloads מראש), GRANT מפורש ל־`authenticated, service_role`; REVOKE TRUNCATE/REFERENCES/TRIGGER/MAINTAIN מ־`anon, authenticated` על כל `public`; REVOKE ALL על `mail_thread_state` מ־`anon, authenticated`. אימות מיידי בדפדפן אחרי ההחלה (דשבורד, דוחות, כרטיס, תיבת דואר) — למניעת חזרה על תקלת ההרשאות.
- `profiles` — effective privileges מלאים (נבדק): `authenticated` מחזיק SELECT/INSERT/UPDATE/DELETE ברמת טבלה, ולכן ה־grants ברמת עמודות (`id, display_name, email_display_name, created_at`) חסרי משמעות בפועל — כל חבר קורא גם `email_signature` של אחרים. מסלולי הקוד: קריאות משתמש רק ל־`id, display_name` (ועמודות החתימה של עצמו ב־`email.functions.ts`); כל הכתיבות המנהליות דרך service_role; יצירת פרופיל דרך טריגר `handle_new_user`; אין INSERT/DELETE מהלקוח. לכן באותה מיגרציה: REVOKE ALL ברמת טבלה מ־`authenticated`; GRANT SELECT (`id, display_name, email_display_name, created_at`) ברמת עמודות; GRANT UPDATE (`display_name, email_display_name, email_signature`) ברמת עמודות — נאכף ע"י המדיניות `self_or_admin`; קריאת/כתיבת החתימה של המשתמש עצמו עוברת ל־service_role אחרי אימות `context.userId` (אין חשיפת חתימות בין חברים). המדיניות `insert_self`/`delete_admin` נשארות אך ללא grant — לא פעילות. אין שינוי בממשק למנהלים.
- `.lovable/security-expected-state.md`: הפלט המלא לפני ואחרי + השאילתות. ללא סודות.
- `src/lib/db-security.integration.test.ts` (קריאה בלבד — מותר מול production): רץ רק כש־`SECURITY_SNAPSHOT_DB_URL` קיים, אחרת מדווח NOT RUN במפורש. דרך `pg`: כל SECURITY DEFINER ורשימת המותרות ל־authenticated/PUBLIC/anon, grants אפקטיביים ברמת טבלה לכל `public`, grants ברמת עמודות ל־`profiles` במפורש (SELECT/UPDATE המותרות בלבד, אפס table-level), RLS דלוק, policies צפויות. שינוי עתידי לא מכוון מפיל את הבדיקה.
- `src/lib/rls-two-crms.integration.test.ts` (יוצר fixtures — staging/local בלבד): רץ רק עם `RLS_TEST_DB_URL` + `RLS_TEST_SERVICE_KEY` + `RLS_TEST_ALLOW_MUTATIONS=1`, ומסרב לרוץ אם ה־host הוא של פרויקט הפרודקשן. יוצר 2 CRM זמניים ו־4 משתמשים (עורך ב־CRM א׳, עורך ב־CRM ב׳, `requests_view` בלבד, viewer) ומוכיח עם JWT של כל אחד: SELECT/INSERT/UPDATE/DELETE חוצי CRM נחסמים ב־`systems`, `crm_records`, `crm_record_notes`, `email_messages`; `system_requests` חסומה ישירות לכולם; `requests_view` ללא `requests_decide` לא מחליט; viewer לא כותב; משתמש לא מחובר מקבל 401 בכל הטבלאות; טבלאות server-only (`login_otp_challenges`, `mfa_*`, `system_request_rules`, `mail_thread_state`, `note_mentions`) לא נקראות; RPC של service_role (`claim_system_request`, `apply_request_status_change`) נדחות; Storage — קריאה/העלאה/מחיקה חוצת CRM ב־`system-files`/`system-audio` נחסמת; `TRUNCATE` ישיר נכשל. ניקוי מלא בסוף גם בכשל. בסביבת הסנדבוקס הנוכחית יש רק את מסד הפרודקשן — ולכן בדוח הבדיקה הזו תסומן NOT RUN עד שתוגדר סביבת staging.

## 7. מייל אוטומטי בכל תיוג @

### מקור אמת עמיד: `note_mentions`
מיגרציה: `note_mentions(id, source_type, source_note_id, mentioned_user_id, mentioned_by, crm_key, system_id, record_id, created_at, UNIQUE(source_type, source_note_id, mentioned_user_id))` ו־`mention_email_deliveries(id, mention_id UNIQUE → note_mentions, status, attempts, next_retry_at, claim_at, last_error, retry_requested_by, retry_requested_at, created_at, sent_at)`. שתיהן service_role בלבד, RLS ללא מדיניות.

### אטומיות
RPC אחת `add_note_with_mentions(source_type, target_id, crm_key, body, author, mentioned_user_ids[], mention_all)` (SECURITY DEFINER, service_role בלבד) — בטרנזקציה אחת: INSERT ההערה, אימות הנמענים בצד ה־DB (קיימים, `has_crm_access`, לא המחבר, ייחודיים; ב־`mention_all` הרחבה לכל בעלי גישה ל־CRM עם תפקיד פעיל ב־`crm_user_roles`, לא המחבר), INSERT ל־`note_mentions` ו־`mention_email_deliveries` (`pending`). כשל באחד → rollback, ההערה לא נשמרת, המשתמש רואה שגיאה ברורה. `update_note_with_mentions` — אותו דבר לעריכה: ON CONFLICT DO NOTHING יוצר delivery רק לנמען חדש. השרת בודק הרשאות (`notes_write`, בעלות/`history_edit`) לפני הקריאה. הערות ישנות ללא `note_mentions` — הפעמון ממשיך עם ה־parser הקיים כ־fallback.

### זיהוי לפי ID בממשק
קומפוננטה משותפת `MentionEditor` (מבוססת ה־chip של כרטיס המערכת) עם `data-mention-user-id`, מחזירה `{ body, mentionedUserIds, mentionAll }`; מחליפה גם את ה־datalist בכרטיס CRM. הטקסט השמור נשאר `@שם`.

### עצמאות מהפעמון
המייל לא תלוי בהעדפת "תיוג בהערה (@)" — נשלח בכל תיוג. הפעמון ממשיך לכבד את ההעדפה שלו ולא יוצר פריט כפול. לא נוספת העדפת כיבוי בסבב זה.

### שליחה ואמינות
- worker: `/api/public/hooks/process-mention-emails` עם אותו אימות של תור הקול (`x-cron-token` מ־`private.cron_tokens` + סוד webhook), job self-arming `ensure_mention_queue_job()/drain_mention_queue_job()` (אפס עלות במנוחה). claim אטומי (`claim_mention_deliveries` — SKIP LOCKED). backoff 1/5/15/60 דק', עד 6 ניסיונות → `failed`.
- מחזור חיים של delivery: `pending → sending → sent | failed | unknown`. המעבר ל־`sending` נכתב לפני הפנייה ל־Apps Script; `sending` ישן (מעל 10 דק') שנתפס ע"י worker חדש עובר ל־`unknown` ולא נשלח שוב.
- כתובת נמען: `auth.admin.getUserById` בשרת בלבד; אין → `skipped_no_email`.
- `APP_BASE_URL` (env, `.env.example`, `DEPLOY.md`, `ENV_FEATURES`); חסר → `failed` עם הודעה, אין קישור מ־Host.
- Apps Script v22: action `send_notification` עם שדות מובנים; הסקריפט בונה HTML עם `escapeHtml_` על כל שדה; אימות `buttonUrl` ע"י parsing — `protocol`+`hostname`+`port` שווים ל־`APP_BASE_URL` (Script Property) ו־path תואם `^/systems/[0-9a-f-]+$` או `^/c/[a-z0-9_-]+/[0-9a-f-]+$`; אחרת דחייה. נשלח מהחיבור הקיים, בלי `emails_send`, בלי רישום ב־`email_messages`.
- תוצאה לא ודאית (timeout/רשת אחרי POST): `unknown` — לא חוזר לתור.
- ניטור: טאב "משלוחי תיוג" בניהול → התראות (נמען, הערה, מערכת/רשומה, סטטוס, ניסיונות, ניסיון הבא, שגיאה; ללא גוף מייל). "נסה שוב" ל־`failed` רגיל; ל־`unknown` — אזהרה "ייתכן שהמייל כבר נשלח", אישור, שמירת `retry_requested_by/at`, הרשאת `users_manage`/super_admin, rate limit `mention_retry_unknown`.

### כתובת ה־endpoint כחלק מה־deployment (לא ערך מקרי במסד)
- מפתח `mention_queue_url` ב־`private.cron_config` (אותו מנגנון כמו `voice_queue_url`), עם `set_mention_queue_endpoint(_url)` (https בלבד, service_role בלבד) ו־`get_mention_queue_endpoint()`. `ensure_mention_queue_job()` מסרב להיחמש בלי כתובת ומחזיר שגיאה ברורה שנרשמת ב־`last_error` של ה־delivery — לא נכשל בשקט.
- bootstrap: בניהול → התראות, כרטיס "תור תיוגים" מציג את הכתובת הנוכחית, כפתור "הגדר לסביבה זו" (נגזר מ־`APP_BASE_URL`, לא מ־Host), ו־health check שקורא ל־endpoint עם ה־token ומציג `ok/מספר ממתינים/job חמוש`. staging ו־production מחזיקים ערכים נפרדים כי כל אחד מצביע על ה־`APP_BASE_URL` שלו. ללא סוד במיגרציה — ה־token נשאר ב־`private.cron_tokens`.
- `DEPLOY.md`: סדר הפעולות (הגדרת `APP_BASE_URL` → הגדרת הכתובת → health check → תרחיש קצה־לקצה) ותרחיש החובה: delivery ב־`pending` → הדשבורד סגור → cron מחמש → ה־endpoint נקרא → המייל נשלח → התור ריק → ה־job מתפרק. אם ה־endpoint לא מוגדר או שהתרחיש לא הורץ בפועל → NOT READY FOR LIVE.

## 8. בדיקות חדשות

- `mention-deliveries.test.ts` — 22 התרחישים + failure-injection (כשל ביצירת ה־outbox → אין הערה ללא אירוע) + `@כולם` לא כולל משתמש ללא תפקיד פעיל.
- `notifications-bell.test.ts` — הפעמון ממשיך לזהות `@שם`/`@כולם`, אין כפילות.
- `system-name-match.test.ts` — 12 תרחישי שם המערכת + regression למודאל פתיחת הפנייה.
- `apps-script-html.test.ts` — `send_notification`: escaping ואימות origin (דומיין מתחזה, protocol אחר, URL שבור).
- `voice-queue.test.ts` — (1) ספק הצליח + DB נכשל → `unknown`, אין שיחה שנייה; (2) ספק הצליח + כל ה־finalization נכשל → worker חדש רואה `sending` ישן → הספק לא נקרא שוב, השורה עוברת ל־`unknown`.
- `email-send-idempotency.test.ts` — (1) relay הצליח + כתיבת finalization נכשלה → אין זריקה, אין שליחה שנייה; (2) failure-injection: התהליך "קורס" מיד אחרי הצלחת relay ולפני finalization; ניסיון חוזר של המשתמש עם אותו idempotency key → הספק לא נקרא, מוחזר `unknown`.
- `admin-atomicity.test.ts` — `createUser` מפצה, `setUserRole` דרך RPC.
- `system-requests.test.ts` — parser עם `:`, rescan error, soft delete מסתיר מהתורים; שני מצבי ה־root מסעיף 3 (conflict אמיתי מול אישור מפורש שאומת מול snapshot).
- `share-archive.test.ts` — בונה את ארכיון השיתוף בפועל דרך `scripts/make-share-archive.sh`, פותח את רשימת הקבצים ונכשל אם קיימים `.env`, `.env.*` (למעט `.env.example`), `*credentials*`, `*secret*`, `*.pem`, `.dev.vars`.
- `mention-queue.e2e.test.ts` — התרחיש המלא מסעיף 7 (pending → arm → endpoint → sent → drain) מול staging בלבד; אחרת NOT RUN.
- `permissions-coverage`, `rate-limit-coverage`, שני ה־integration tests מסעיף 6.

## 9. דוח סיום

טבלת חסמים `issue | FIXED / ALREADY FIXED / NOT RUN / OPEN | proof` לכל שורה בסעיף 1; סעיף מפורש לשם המערכת בבקשות (מיקום הלוגיקה המשותפת, זיהוי, בחירה, תת־מערכת, intent, מניעת כפילות, בדיקות); סעיף התיוג לפי 15 הפריטים שנדרשו; פלט השאילתות מה־DB לפני ואחרי; פלט הבדיקות המלא. אם חסם LIVE כלשהו `NOT RUN`/`OPEN` — הסטטוס נשאר NOT READY FOR LIVE. האוטומציה נשארת `dry_run`.

## פרטים טכניים

- מיגרציות חדשות (6): (א) REVOKE הרשאות טבלאות/RPC + `mail_thread_state` + הידוק `profiles` לרמת עמודות; (ב) `system_requests`: עמודות intent לשם מערכת (כולל snapshot אישור root) + soft delete + RPC; (ג) `note_mentions` + `mention_email_deliveries` + RPCs (add/update/claim/ensure/drain) + `mention_queue_url` ב־`private.cron_config` עם setter/getter; (ד) `set_user_role_atomic`; (ה) `voice_message_log`/systems: מצב `sending`/`unknown`; (ו) `email_deliveries` (outbox למייל רגיל עם idempotency key).
- קבצים עיקריים: `requests.tsx`, `SystemRequestsCard.tsx`, `YemotCreateModal.tsx`, חדש `lib/system-name-match.ts`, `permissions.config.ts`, `system-requests.functions.ts`, `system-requests.server.ts`, `requests-access.server.ts`, `db-rate-limit.server.ts`, `email.functions.ts`, `mail.functions.ts`, חדש `lib/email-deliveries.server.ts`, `crms.functions.ts`, `admin.functions.ts`, `systems.functions.ts`, `crm-records.functions.ts`, חדשים `components/MentionEditor.tsx`, `lib/mention-deliveries.server.ts`, `lib/mention-deliveries.functions.ts`, `routes/api/public/hooks/process-mention-emails.ts`, `env.server.ts`, `apps-script/email-relay.gs`, `.env.example`, `DEPLOY.md`, `.lovable/security-expected-state.md`, `.lovable/production-readiness.md`, `roadmap.md`, חדש `scripts/make-share-archive.sh`.
- חבילה חדשה לבדיקות בלבד: `pg` (devDependency) ל־integration tests. משתני סביבה לבדיקות: `SECURITY_SNAPSHOT_DB_URL` (קריאה בלבד, מותר production) ו־`RLS_TEST_DB_URL` + `RLS_TEST_SERVICE_KEY` + `RLS_TEST_ALLOW_MUTATIONS=1` (רק staging/local; בדיקת ה־mutations מסרבת לרוץ מול ה־host של הפרודקשן).
