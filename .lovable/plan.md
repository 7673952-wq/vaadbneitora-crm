# סבב סגירה: כרטיס בקשה, שם מערכת בבקשה, מחיקה רכה, הרשאות DB בפועל ומייל בתיוג

עקרונות מחייבים: האוטומציה נשארת `dry_run`. אין עריכה של מיגרציה שהופעלה — רק מיגרציות חדשות. אין `USING (true)` או GRANT רחב. לכל תיקון בדיקה. סעיף שכבר תוקן מסומן ALREADY FIXED עם הוכחה.

## 1. חסמים מהסבב הקודם — מצב מאומת (נבדק בקוד ובמסד, 10/09/2026)

| נושא | מצב | ממצא / מה ייעשה |
|---|---|---|
| `report_description` — parser עם `:` | לבדיקה | תיווסף בדיקה עם נקודתיים בגוף ובכותרת; אם הפרסר חותך — תיקון. |
| `report_description` בכרטיס המערכת | OPEN | `SystemRequestsCard` לא מציג את התיאור — יתווסף (מקופל). |
| שגיאת DB ב־rescan של התיאור | OPEN | ב־`system-requests.server.ts` העדכון של התיאור לא בודק `error` — יתוקן ויוחזר `retry`. |
| Voice: ספק הצליח + DB נכשל | OPEN | אחרי `CallExtensionBridging` מוצלח, כשל בעדכון `sent_at` זורק שגיאה → התור מנסה שוב → שיחה כפולה. תיקון: סימון `voice_pending_reason='sending'` לפני הפנייה לספק; כשל DB אחרי הצלחה → מצב `unknown` (לא retry אוטומטי), רישום ב־`voice_message_log`. |
| `voice_queue_url` deployment | חלקית | הכתובת מוגדרת במסד ל־URL הפרודקשן הקבוע. בדיקת קצה־לקצה ללא דשבורד: תתועד ב־`DEPLOY.md` כשלב; אם לא ניתן להריץ מהסנדבוקס — NOT RUN. |
| effective privileges של `profiles` | OPEN — ממצא אמיתי | `authenticated` מחזיק TRUNCATE/REFERENCES/TRIGGER/MAINTAIN על 26 טבלאות (כולל `profiles`, `systems`, `user_roles`). TRUNCATE עוקף RLS. מיגרציה: REVOKE של ארבע ההרשאות מ־`anon, authenticated` על כל טבלאות `public`. |
| Expected Security State מול DB | OPEN | ראו סעיף 6. |
| בדיקות RLS אמיתיות (2 משתמשים / 2 CRM) | OPEN | `SUPABASE_DB_URL` ו־service key זמינים בסביבת הבדיקה — ייכתב integration test אמיתי (סעיף 6). |
| `.env` מחוץ לארכיונים | ALREADY FIXED | `.dockerignore` מחריג `.env`, `.env.local`; גיבויי ה־CRM הם ייצוא טבלאות בלבד; נוהל ב־`DEPLOY.md`. תתווסף בדיקה שמוודאת שההחרגה קיימת. |
| `mail_thread_state` | OPEN — ממצא אמיתי | `anon` מחזיק את כל ההרשאות על הטבלה, ו־`authenticated` INSERT/UPDATE/DELETE; השרת קורא וכותב רק דרך service_role. מיגרציה: REVOKE ALL מ־`anon`, `authenticated` (המדיניות הקיימת נשארת לא־פעילה בפועל). |
| אטומיות `createUser` / `setUserRole` / `updateUserDisplayName` | OPEN (2 מתוך 3) | `createUser`: משתמש auth נוצר ואז profile+role — כשל משאיר משתמש יתום → פיצוי: מחיקת ה־auth user בכשל. `setUserRole`: delete ואז insert לא אטומי → RPC חדש `set_user_role_atomic` (service_role בלבד, טרנזקציה אחת). `updateUserDisplayName`: עדכון יחיד — ALREADY FIXED. |
| מייל: relay הצליח + כתיבת DB נכשלה | OPEN | `sendSystemEmail`/`sendRecordEmail`/תיבת הדואר זורקים שגיאה אחרי שליחה מוצלחת → לחיצה חוזרת שולחת שוב. תיקון: אחרי הצלחת relay מחזירים `{ ok: true, recorded: false }` עם אזהרה למשתמש, ניסיון חוזר לכתיבה (upsert לפי `gmail_message_id`), בלי לזרוק. |
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
- intent: מיגרציה חדשה מוסיפה ל־`system_requests`: `manual_system_action` (`link_existing|create_root|create_subsystem`), `manual_target_system_id`, `manual_target_parent_system_id`. נשמרים לפני הביצוע; retry/refresh ממשיכים בדיוק אותה בחירה ולא מחפשים מחדש.
- שרת: `decideSystemRequest` מקבל את הבחירה, מאמת דרך ה־supabase של המשתמש (RLS) שהמערכת/האב נראים לו ושייכים ל־CRM של הבקשה, בודק `systems_write`. יצירת תת־מערכת דרך helper משותף `createSubSystemCore` שגם `addSubSystem` משתמש בו (לא העתקה).
- race: ברגע הביצוע השרת מריץ שוב את ההתאמה; אם ב־`create_root` נמצאה עכשיו התאמה שלא הייתה — לא יוצר, מחזיר `{ ok:false, conflict:true, matches }` והמסך מציג שוב את הבחירה. יצירה עם קוד קיים נדחית ע"י האילוץ הקיים.

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
- `.lovable/security-expected-state.md`: הפלט המלא לפני ואחרי + השאילתות. ללא סודות.
- `src/lib/db-security.integration.test.ts`: רץ רק כש־`SUPABASE_DB_URL` קיים (אחרת מדווח NOT RUN במפורש, לא PASSED). דרך `pg`: כל SECURITY DEFINER ורשימת המותרות ל־authenticated/PUBLIC/anon, grants אפקטיביים לטבלאות ועמודות, RLS דלוק, policies צפויות. שינוי עתידי לא מכוון מפיל את הבדיקה.
- `src/lib/rls-two-crms.integration.test.ts`: יוצר 2 משתמשים זמניים ב־2 CRM דרך service key, מתחבר כל אחד עם JWT שלו ומוכיח: אין קריאה/כתיבה חוצת CRM ב־`crm_records`, `crm_record_notes`, `email_messages`, `system_requests` (חסומה ישירות), ומשתמש רגיל לא יכול TRUNCATE. ניקוי בסוף.

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
- כתובת נמען: `auth.admin.getUserById` בשרת בלבד; אין → `skipped_no_email`.
- `APP_BASE_URL` (env, `.env.example`, `DEPLOY.md`, `ENV_FEATURES`); חסר → `failed` עם הודעה, אין קישור מ־Host.
- Apps Script v22: action `send_notification` עם שדות מובנים; הסקריפט בונה HTML עם `escapeHtml_` על כל שדה; אימות `buttonUrl` ע"י parsing — `protocol`+`hostname`+`port` שווים ל־`APP_BASE_URL` (Script Property) ו־path תואם `^/systems/[0-9a-f-]+$` או `^/c/[a-z0-9_-]+/[0-9a-f-]+$`; אחרת דחייה. נשלח מהחיבור הקיים, בלי `emails_send`, בלי רישום ב־`email_messages`.
- תוצאה לא ודאית (timeout/רשת אחרי POST): `unknown` — לא חוזר לתור.
- ניטור: טאב "משלוחי תיוג" בניהול → התראות (נמען, הערה, מערכת/רשומה, סטטוס, ניסיונות, ניסיון הבא, שגיאה; ללא גוף מייל). "נסה שוב" ל־`failed` רגיל; ל־`unknown` — אזהרה "ייתכן שהמייל כבר נשלח", אישור, שמירת `retry_requested_by/at`, הרשאת `users_manage`/super_admin, rate limit `mention_retry_unknown`.

## 8. בדיקות חדשות

- `mention-deliveries.test.ts` — 22 התרחישים + failure-injection (כשל ביצירת ה־outbox → אין הערה ללא אירוע) + `@כולם` לא כולל משתמש ללא תפקיד פעיל.
- `notifications-bell.test.ts` — הפעמון ממשיך לזהות `@שם`/`@כולם`, אין כפילות.
- `system-name-match.test.ts` — 12 תרחישי שם המערכת + regression למודאל פתיחת הפנייה.
- `apps-script-html.test.ts` — `send_notification`: escaping ואימות origin (דומיין מתחזה, protocol אחר, URL שבור).
- `voice-queue.test.ts` — ספק הצליח + DB נכשל → `unknown`, אין שיחה שנייה.
- `email-send-idempotency.test.ts` — relay הצליח + insert נכשל → אין זריקה, אין שליחה שנייה.
- `admin-atomicity.test.ts` — `createUser` מפצה, `setUserRole` דרך RPC.
- `system-requests.test.ts` — parser עם `:`, rescan error, soft delete מסתיר מהתורים.
- `archive-exclusions.test.ts`, `permissions-coverage`, `rate-limit-coverage`, שני ה־integration tests מסעיף 6.

## 9. דוח סיום

טבלת חסמים `issue | FIXED / ALREADY FIXED / NOT RUN / OPEN | proof` לכל שורה בסעיף 1; סעיף מפורש לשם המערכת בבקשות (מיקום הלוגיקה המשותפת, זיהוי, בחירה, תת־מערכת, intent, מניעת כפילות, בדיקות); סעיף התיוג לפי 15 הפריטים שנדרשו; פלט השאילתות מה־DB לפני ואחרי; פלט הבדיקות המלא. אם חסם LIVE כלשהו `NOT RUN`/`OPEN` — הסטטוס נשאר NOT READY FOR LIVE. האוטומציה נשארת `dry_run`.

## פרטים טכניים

- מיגרציות חדשות (5): (א) REVOKE הרשאות טבלאות/RPC + `mail_thread_state`; (ב) `system_requests`: עמודות intent לשם מערכת + soft delete + RPC; (ג) `note_mentions` + `mention_email_deliveries` + RPCs (add/update/claim/ensure/drain); (ד) `set_user_role_atomic`; (ה) `voice_message_log`/systems: תמיכה במצב `unknown` (עמודה או ערך reason — לפי הסכימה הקיימת, בלי לגעת במיגרציות ישנות).
- קבצים עיקריים: `requests.tsx`, `SystemRequestsCard.tsx`, `YemotCreateModal.tsx`, חדש `lib/system-name-match.ts`, `permissions.config.ts`, `system-requests.functions.ts`, `system-requests.server.ts`, `requests-access.server.ts`, `db-rate-limit.server.ts`, `email.functions.ts`, `mail.functions.ts`, `crms.functions.ts`, `admin.functions.ts`, `systems.functions.ts`, `crm-records.functions.ts`, חדשים `components/MentionEditor.tsx`, `lib/mention-deliveries.server.ts`, `lib/mention-deliveries.functions.ts`, `routes/api/public/hooks/process-mention-emails.ts`, `env.server.ts`, `apps-script/email-relay.gs`, `.env.example`, `DEPLOY.md`, `.lovable/security-expected-state.md`, `.lovable/production-readiness.md`, `roadmap.md`.
- חבילה חדשה לבדיקות בלבד: `pg` (devDependency) ל־integration tests מול `SUPABASE_DB_URL`.
