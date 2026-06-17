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
