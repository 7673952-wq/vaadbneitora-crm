# Security Audit — 2026-06-17

## ✅ תוקן בסבב הזה

### 1. Storage Permissions — `system-files`
- **לפני**: כל משתמש מחובר היה יכול להעלות / לקרוא / למחוק קבצים בכל מערכת ישירות דרך Supabase Storage API, בלי לעבור דרך ה-server function שמאמת הרשאות.
- **אחרי**: ה-RLS על `storage.objects` נאכף לפי `bucket_id='system-files'` + אחד מהבאים:
  - `admin` או `super_admin` (דרך `private.has_role`)
  - הנציג המשויך למערכת (לפי `system_id` שמופיע כתיקייה הראשונה ב-path: `{system_id}/{filename}`)
- DELETE מוגבל ל-admin/super_admin או ל-`owner = auth.uid()` (המעלה).

### 2. Storage Permissions — `system-audio`
- אותה התקשות בדיוק (היה פתוח לחלוטין לכל authenticated). כעת תואם ל-system-files.

### 3. RLS Consistency
- כל ה-policies בטבלאות עברו לפונקציה מאוחדת `private.has_role`. בוטלו שאריות של `public.has_role` ב-:
  - `app_settings.Admins can manage app_settings`
  - `system_files.system_files_insert_admin_or_assigned`
  - `system_files.system_files_delete_admin_or_uploader`
- מקור אמת יחיד להרשאות: `private.has_role`.

### 4. Auth — Signup Lockdown
- `disable_signup = true` — אי אפשר ליצור משתמש חדש דרך טופס הרשמה ציבורי.
- `external_anonymous_users_enabled = false` — אין משתמשים אנונימיים.
- `auto_confirm_email = false` — אם בעתיד מפעילים הרשמה, נדרש אימות אימייל.
- `password_hibp_enabled = true` — הגנה מסיסמאות שדלפו (Have I Been Pwned).
- משתמשים חדשים נוצרים אך ורק דרך ה-Admin API (פאנל מנהל) — `handle_new_user` הטריגר ממשיך להקצות role של `agent` אוטומטית, וזה תקין כי הוא רץ רק כשמנהל יוצר משתמש.

## ⚠️ נותרו לתשומת לב (לא קריטי)

### Linter warnings — SECURITY DEFINER functions
ה-linter מסמן 5 פונקציות `SECURITY DEFINER` ב-public כניתנות להרצה ע"י authenticated/anon:
- `public.has_role` — תיק "shim" לתאימות, לא בשימוש בקוד. ניתן למחוק בעתיד.
- `public.handle_new_user`, `public.log_*`, `public.touch_updated_at`, `public.propagate_parent_changes`, `public.inherit_parent_on_insert`, `public.reset_reminder_handled_on_status_change`, `public.set_change_reason` — כולם trigger functions שרצות אך ורק בהקשר של triggers; ההרצה הישירה ע"י משתמש לא מסוכנת כי הם פועלים על NEW/OLD שמגיע מ-trigger context. עם זאת, אפשר להעביר אותן ל-schema `private` בעתיד או להפעיל REVOKE EXECUTE FROM authenticated.
- Extension in public — `pgcrypto` או דומה ב-public schema. רק warning, לא חשיפת נתונים.

### Extension in Public
שום פעולה דחופה. אפשרי בעתיד להעביר extensions ל-`extensions` schema.

## 🔒 הערכת מצב אבטחה כוללת

| תחום | מצב |
|---|---|
| RLS על כל הטבלאות | ✅ מאוכף |
| Storage policies | ✅ מאוכף לפי תפקיד + שיוך |
| Service role usage | ✅ רק בתוך server functions שמאמתות הרשאות |
| Signup hardening | ✅ סגור |
| Password leak protection | ✅ מופעל |
| Role escalation | ✅ נשמר רק דרך Admin API + `assertRole`/`hasRole` |
| Audit log search injection | ✅ control chars מסולקים |
| Validation (Zod) | ✅ על כל server functions |

**מוכנות ל-Production: 9/10.** ה-warnings שנותרו הם best-practice ולא חורים פעילים.

## 🛡️ המלצות להמשך (אופציונלי)
1. למחוק את `public.has_role` shim — אחרי וידוא ששום שאילתה לא קוראת לו.
2. להעביר trigger functions מ-`public` ל-`private` כדי שלא יופיעו ב-Data API.
3. להוסיף Rate Limiting ל-`createUser` admin endpoint (כרגע מוגן ב-`assertRole("admin")` אבל ללא הגבלת קצב).
4. להפעיל MFA למשתמשים עם תפקיד `super_admin`.
