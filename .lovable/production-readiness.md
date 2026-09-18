# Production Readiness

עודכן: 18/09/2026.

## סטטוס אחד ויחיד

**NOT READY FOR LIVE.**

הסיבה: קיימים בנדים שסומנו `NOT RUN` (ראה "חסמים פתוחים"). אין במסמך הזה
אמירה אחרת — כל ניסוח קודם בסגנון "ניתן לעלות לאוויר" בוטל.

אוטומציית הבקשות נשארת תמיד `dry_run`.

## חסמים פתוחים

| # | חסם | סטטוס | מה נדרש |
|---|---|---|---|
| 1 | RLS mutation suite (שני משתמשים, שני CRM: systems, רשומות, הערות, מיילים, בקשות, הרשאות חלקיות, RPC פנימיים, Storage) | **NOT RUN** | סביבת staging/local. אסור על production. |
| 2 | Queue E2E: pending → cron arm → endpoint → processing → queue empty → job disarm | **NOT RUN** | staging + endpoints מותקנים |
| 3 | Apps Script Deploy | **פעולה ידנית שלך** | Deploy → Manage deployments → New version. הקוד החדש (`send_notification`) לא פעיל עד אז. |
| 4 | `APP_BASE_URL` ב-Script Properties + כתובות התור בכרטיס "תורי רקע" | **פעולה ידנית שלך** | להזין ולהריץ "בדיקת תקינות" |

## מה נסגר בסבב הזה

- מייל תיוג בפועל: `send_notification` ב-`apps-script/email-relay.gs` בונה את
  ה-HTML בעצמו עם escaping, מאמת origin+path של `buttonUrl` מול `APP_BASE_URL`,
  ודוחה URL מתחזה. `mentions.server.ts` שולח **שדות מובנים בלבד** (ללא HTML).
- חור הרשאות CRM notes/mentions נסגר במסד: ה-`crm_key` נלקח מהרשומה, לא מהלקוח.
- Health check של תורי הרקע קורא את המבנה האמיתי (`voice` / `mention`).
- מסך הבקשות מחובר ל-`matchRequestSystemName` — בלי הדבקת מזהים ידנית.
- Soft delete מכובד בכל הרשימות והמונים; dedup identity נשמר.
- `report_description` מוצג במסך הבקשות ובכרטיס המערכת (מתקפל, בלי קופסה ריקה).
- Idempotency לשליחת מייל בשלושת מסכי השליחה.
- `release_system_request_claim` וניקוי ה-intent — fail-closed, לא בולעים שגיאה.
- Rate limits לשבע הפעולות שנותרו חשופות.
- חבילת מסירה: `scripts/make-share-archive.sh` מאמת את תוכן ה-ZIP בפועל.

## תוצאות בדיקה בפועל

- `bunx vitest run` → 343 passed | 6 skipped (27 files).
- `npx tsgo --noEmit` → clean.
- Archive שנבדק: `dev-server-share-2026-09-18.zip` — 386 entries, secret scan clean
  (רק `.env.example`; אין `.env`, `.env.*`, credentials, secrets, `.pem`, `dev.vars`).

## המצב הצפוי של האבטחה

ראה `.lovable/security-expected-state.md`.
