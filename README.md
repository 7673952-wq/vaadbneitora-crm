# CRM מערכות

מערכת CRM פנימית לניהול מערכות, מבוססת TanStack Start + Lovable Cloud (Supabase).

## Environment Variables

הקובץ `.env.example` בשורש הפרויקט מכיל את כל המשתנים הנדרשים עם ערכי דוגמה.
ב-Lovable Cloud רוב המשתנים מוזרקים אוטומטית — קובץ זה רלוונטי בעיקר להרצה מקומית או לדיבוג.

| משתנה | מטרה | היכן למצוא |
| --- | --- | --- |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | כתובת ה-API של ה-Backend | מסופק אוטומטית ע"י Lovable Cloud |
| `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | מפתח ציבורי לדפדפן (אנונימי, RLS פעיל) | מסופק אוטומטית ע"י Lovable Cloud |
| `SUPABASE_SERVICE_ROLE_KEY` | מפתח אדמין צד-שרת בלבד — עוקף RLS | מנוהל אוטומטית; **אל תחשוף לדפדפן** |
| `BACKUP_WEBHOOK_SECRET` | מאמת את ה-Webhook של גיבוי יומי/שבועי | יש לייצר עם `openssl rand -hex 32` ולהוסיף ב-Project Settings → Secrets |
| `WEEKLY_REPORT_EMAIL` | כתובת מקבל הדוח השבועי | קונפיגורציה ידנית ב-Secrets |
| `LOVABLE_API_KEY` | גישה ל-Lovable AI Gateway | מנוהל אוטומטית — ניתן לסיבוב דרך הסוכן |

### יצירת `BACKUP_WEBHOOK_SECRET`

```bash
openssl rand -hex 32
```

הוסף את הערך כ-secret דרך Project Settings → Secrets (לא מאוחסן ב-`.env`).

## Security notes

* כל הפעולות בקלט חופשי עוברות sanitization ב-`src/lib/sanitize.ts`.
* יש rate limiting in-memory ב-`src/lib/rate-limit.server.ts` על פעולות רגישות.
* שגיאות שרת נכתבות ב-JSON-lines דרך `src/lib/logger.server.ts`.
* `.env` אינו נכלל ב-Git — `.env.example` כן, ללא ערכים אמיתיים.

### הקשחה (ספטמבר 2026, שלב ב׳)

* **אין גישת אורח למסד** — כל הרשאות `anon` על טבלאות `public` בוטלו. בדיקה בפועל עם המפתח הציבורי מחזירה `401` לכל טבלה.
* **טבלאות אימות סגורות גם למשתמשים מחוברים** — `mfa_grants`, `mfa_passed_sessions`, `mfa_trusted_devices`, `login_otp_challenges`, `api_rate_limits` נגישות ל-`service_role` בלבד; הן מופיעות בלינטר כ-"RLS ללא מדיניות" וזו התוצאה המכוונת.
* **בקשות המייל** (`system_requests`, `system_request_rules`) — ללא SELECT/UPDATE ישיר מהדפדפן; כל גישה עוברת פונקציות שרת עם בדיקת הרשאה.
* **SECURITY DEFINER** — כל הפונקציות נבדקו; רק `mfa_session_ok` נגישה למשתמש מחובר, והיא משווה `auth.uid()` למשתמש המבוקש ומשמשת את כללי הגישה עצמם.
* **הגבלת קצב חוצת-שרתים** — כל נתיב `/api/public/*` עובר `enforcePublicRateLimit` מבוסס טבלה (`bump_rate_limit`), עם כשל-פתוח מתועד בלוג.
* **מיילים יוצאים** — גוף ההודעה עובר escaping מלא ב-Apps Script לפני המרה ל-HTML, כך שטקסט שהוקלד לא הופך לתגיות פעילות.
* **שיוך אוטומטי לנציג** — מתבצע ב-RPC אטומי; שגיאה טכנית עוצרת את התהליך (ולא מסמנת אותו כהושלם), ורשימת נמעני התזכורת מתעדכנת גם כשהנציג נשאר אותו נציג.
* **`xlsx@0.18.5`** — משמש לכתיבת גיבויים בשרת ולקריאת קובץ גיבוי שאדמין בוחר ידנית בלבד; אין קריאה של קבצים ממקור חיצוני לא מאומת.
