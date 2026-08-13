# תיקוני גיבוי, אבטחה ואיכות — לפי הביקורות

סדר עבודה: קודם מה שמסוכן/מטעה בפועל, אחר כך שיפורי חוסן, ולבסוף UX ואיכות קוד.

## שלב 1 — דחוף (מאומת בקוד)

1. **כפילות תזמון גיבויים** — `vercel.json` מכיל crons קבועים ל-`daily-backup` ו-`weekly-backup` במקביל ל-heartbeat של `scheduled-backup-check` שמכבד את הגדרות האדמין. אסיר את שתי השורות ואשאיר רק את `process-voice-queue`, כך שהתזמון היחיד הוא זה שנקבע במסך "ניהול → גיבויים".
2. **מייל גיבוי חלקי** — כרגע גוף המייל תמיד אופטימי ("מצורף קובץ הגיבוי..."). אוסיף לנושא ולגוף אזהרה ברורה כאשר `verification.ok === false`, כולל רשימת הבעיות מה-manifest.
3. **קובץ אקסל תמיד בגיבוי** — כיום `systems.xlsx` נוצר בתוך לולאת הטבלאות. אוודא שהוא נכתב תמיד (גם ב-0 מערכות), נכלל ב-ZIP ובמייל, ומופיע ב-manifest וב-verification כפריט חובה.
4. **הרשאות למסכי מנהלים** — `getManagerDashboard` ו-`getReports` מוגנים כרגע רק ב-`requireSupabaseAuth`. אוסיף בדיקת תפקיד `admin`/`super_admin` ואסתיר את הקישורים בתפריט למי שלא מורשה.
5. **טוקן בכתובת ה-URL** — `weekly-crm-report` מקבל `?token=` ומשווה בהשוואה רגילה, בעוד שהוא מחזיר CSV עם טלפונים ופרטי פונים. אעביר לכותרת (`apikey`/`Bearer`) עם ההשוואה ה-timing-safe הקיימת, ואשאיר תמיכה זמנית בפרמטר עם רישום אזהרה.
6. **השוואה timing-safe אחידה** — `inbound-email` משווה `apikey !== expected` ישירות; יעבור לאותו helper של `webhook-auth.server.ts`.

## שלב 2 — חוסן

7. **מדיניות שמירה (retention)** — ניקוי אוטומטי של גיבויים ישנים (ברירת מחדל: יומיים 30 יום, שבועיים שנה), ניתן לשינוי במסך הגיבויים, מופעל מה-heartbeat הקיים.
8. **Rate limit ל-`/api/public/*`** — הגבלת קצב לכל ה-endpoints הציבוריים, לא רק אימות.
9. **ולידציית משתני סביבה** — מודול zod יחיד שמאמת את המשתנים הנדרשים ומחזיר שגיאה ברורה.
10. **בדיקות אוטומטיות ראשונות** — `shouldRunScheduledBackup`, `parseCSV`/`upsertResilient`, ולוגיקת ההרשאות.
11. **עדכון מסמכי התיעוד** — `.lovable/features.md` ו-`.lovable/production-readiness.md` מתארים לוח גיבויים ישן ופריטים שכבר טופלו (RLS, pagination). אעדכן כך שהקוד יהיה מקור האמת היחיד.

## שלב 3 — UX ואיכות

12. החלפת `window.confirm` בדיאלוג מותאם RTL בפעולות הרסניות, עם Undo ב-Toast למחיקות קלות.
13. שמירת פילטרים בדשבורד ב-localStorage + כפתור "המערכות שלי" + "נקה סינון" בתוך ה-Empty State.
14. Skeleton loaders ברשימות, קיצור `/` לחיפוש ו-`Esc` לניקוי, ותיוג `aria-label` לכפתורי אייקון.
15. העברת `console.log` של `[auto-voice]` ל-`logger`, ותיקון `audio_url` שיקבל מחרוזת ריקה.

## מה לא בתוכנית כרגע

- **גיבוי off-site** (S3/Drive) ו-**Sentry** — דורשים חשבון/מפתח חיצוני; אבצע כשתאשר ותספק גישה.
- **MFA והגבלת דומיין ל-Google** — שינוי מדיניות התחברות; אצטרך אישור נפרד.
- **הסרת `any` בקנה מידה רחב** — עדיף בהדרגה תוך כדי פיתוח.

## פרטים טכניים

- `vercel.json`: הסרת שני ה-cron entries של הגיבוי.
- `src/lib/backups.server.ts`: אזהרה במייל, אקסל מובטח, hook ל-retention.
- `src/lib/manager-dashboard.functions.ts`, `src/lib/reports.functions.ts`: `assertRole` מ-`permissions.server`.
- `src/routes/api/public/weekly-crm-report.ts`, `src/routes/api/public/hooks/inbound-email.ts`: `verifyWebhookAuth` משותף.
- `src/lib/rate-limit.server.ts`: שכבת DB לספירה חוצת-instances.
