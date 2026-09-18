# Expected Security State

עודכן: 18/09/2026. זהו המצב הצפוי (source of truth) — כל חריגה ממנו היא ממצא.
Snapshot נלקח מ-production ב**קריאה בלבד** (`pg_catalog` / `aclexplode`).

## Effective table grants (public schema, roles: anon / authenticated / service_role)

| טבלה | anon | authenticated | service_role |
|---|---|---|---|
| `profiles` | — | **column-level SELECT בלבד**: `id`, `display_name`, `email_display_name`, `created_at`. אין table-level SELECT, אין INSERT, אין UPDATE, אין DELETE | ALL |
| `mail_thread_state` | — | — (service-role בלבד) | ALL |
| `system_requests` | — | — | ALL |
| `note_mentions` | — | — | ALL |
| `mention_email_deliveries` | — | — | ALL |
| `email_deliveries` | — | — | ALL |
| `voice_deliveries` | — | — | ALL |
| `crm_records` | — | SELECT, INSERT, UPDATE, DELETE (מסונן ב-RLS לפי `crm_key`) | ALL |

כללים קבועים:
- `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN` — **הוסרו** מ-`anon` ומ-`authenticated` בכל הטבלאות.
- אין `USING (true)` באף policy, ואין grants רחבים ל-`anon`.
- `email_signature` נכתב דרך `supabaseAdmin` בלבד.

## SECURITY DEFINER / INVOKER

- SECURITY DEFINER + `EXECUTE` ל-`service_role` בלבד (לא `authenticated`):
  `add_note_with_mentions`, `update_note_with_mentions`, `soft_delete_system_request`,
  `restore_system_request`, `requeue_mention_delivery`, `release_system_request_claim`,
  `set_user_role_atomic`, `get_queue_status`, פונקציות claim/finish של
  `voice_deliveries` ו-`email_deliveries`.
- `add_note_with_mentions` אינו מקבל `crm_key` מהלקוח כמקור אמת: הוא טוען את
  הרשומה לפי `record_id` מ-`crm_records`, לוקח את ה-`crm_key` האמיתי, ומשתמש בו
  גם לבדיקת ההרשאה, גם ל-`note_mentions` וגם ל-deliveries. חריגה → שגיאה
  "קוד CRM לא תואם לרשומה"; רשומה חסרה → "הרשומה לא נמצאה".
- Tokens של תורי הרקע יושבים ב-`private.cron_tokens` — לא נגישים ל-`authenticated`.

## Rate limiting

DB limiter **fail-closed**. Scopes: `request_delete`, `request_decide`,
`mention_requeue`, `mention_process`, `queue_config`, `admin_integrations`,
`crm_manage`, `status_manage`, `history_edit`. כיסוי נאכף ב-
`src/lib/rate-limit-coverage.test.ts` (source-verified, לא רשימה ידנית).

## Known open linter findings

`RLS Enabled No Policy` על 10 טבלאות service-role-only — קיים מלפני הסבב, לא
נגרם ממיגרציה של הסבב, ואינו חושף נתונים (אין grant ל-`anon`/`authenticated`).

## Not verified

- RLS mutation suite (שני משתמשים / שני CRM): **NOT RUN** — אין סביבת staging.
  אסור להריץ mutation tests על production; `rls-integration.test.ts` מדלג
  בקול אלא אם מוגדרים `RLS_TEST_SUPABASE_URL`, `RLS_TEST_SERVICE_KEY`,
  `RLS_TEST_ALLOW_MUTATIONS=1`, וזורק אם ה-host זהה ל-`VITE_SUPABASE_URL`.
- Queue E2E (pending → cron arm → endpoint → processing → empty → disarm): **NOT RUN**.
