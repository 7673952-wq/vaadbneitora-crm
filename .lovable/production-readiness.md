# דוח Production Readiness

עודכן: 17/06/2026 — לאחר ביצוע סבב ה-Code Review.

## תקציר מנהלים

המערכת **מוכנה לעלייה לאוויר** עם הסתייגויות בודדות. כל הבעיות הקריטיות
שאותרו ב-Code Review טופלו: סטנדרט הרשאות אחיד (`assertRole`/`hasRole`),
שחזור גיבוי מוגן בסופר־אדמין + double-confirm + audit log מלא, אימות
Zod מלא בכל ה-server functions, וחיזוק חיפוש Audit Log מפני ערכים זדוניים.

הערכת מוכנות: **8/10**.

---

## מה תוקן בסבב הזה

### תפקידים
- `permissions.server.ts` — היררכיית התפקידים צומצמה ל-`super_admin > admin > agent`.
  הוסרו `manager`, `team_lead`, `viewer` שלא היו ב-DB ולא ניתנים להקצאה.
- `admin.functions.ts` — `getMyRole` חישוב `isAgent` ניקה הפניות לתפקידי רפאים.
- Shims `isAdminUserId/assertAdminUserId/...` הוסרו — כל הקוד עובר דרך
  `assertRole`/`hasRole`.

### אחידות הרשאות
- כל server function בקבצי `admin.functions.ts`, `audit.functions.ts`,
  `backups.functions.ts`, `system-files.functions.ts`, `systems.functions.ts`
  משתמשת **רק** ב-`assertRole(userId, role)` או `hasRole(userId, role)`
  ממקור אחד (`@/lib/permissions.server`).
- ב-`systems.functions.ts` ה-helper המבלבל `isAdminUser` (שבפועל בדק `agent`)
  הוחלף ב-`userHasRole(userId, "admin"|"super_admin"|"agent")` עם הרשאה
  אמיתית בכל call-site.
- `listWeeklyCrmReportRecipients` — תוקן: הצ'ק כעת באמת בודק `admin`,
  כפי שהודעת השגיאה מצהירה.

### גיבויים ושחזורים
- `backupNow`, `listBackups`, `getBackupFileUrl`, `deleteBackup` →
  דורשים `admin` (נשאר זהה).
- `restoreBackup` → דורש **`super_admin`** (היה `admin`).
- אישור כפול בצד הקליינט: דיאלוג חדש עם:
  1. רשימת קבצים שייובאו + מצב (merge/replace).
  2. checkbox "אני מבין שזו פעולה הרסנית".
  3. הקלדת המילה `שחזר` כ-token אישור.
- שרת בודק שה-`confirm_token` הוא בדיוק `"שחזר"` (ב-Zod `z.literal`).
- **Audit Log מלא**: כתיבת `backup_restore_started` לפני, ו-
  `backup_restore_completed` / `backup_restore_failed` אחרי, עם מצב, פירוט
  טבלאות, מספר שורות, שגיאות.
- בקליינט הכפתור "ייבוא גיבוי" מוצג רק ל-`me.isSuperAdmin`.

### אימות קלט (Zod)
- `listSystems` — היה pass-through `(d) => d`. כעת: `z.object({ status: enum,
  agentId: uuid, period: enum }).strict()`.
- `backupNow` — נוסף `z.object({}).optional()`.
- כל שאר ה-server functions עברו סקירה: כולן בעלות `inputValidator` עם
  schema אמיתי או שאינן מקבלות קלט כלל.

### חיפוש Audit Log
- `q.or(...ilike...)` בנייה ידנית הייתה פגיעה לטקסט חופשי המכיל `.`, `(`, `)`,
  `*` שמעניינים את ה-PostgREST filter DSL.
- כעת: regex חזק יותר מנקה `[%,()*."\\]`, מגביל ל-100 תווים, ומשתמש
  ב-`*` כתוו wildcard (במקום `%`) — תואם לתיעוד הרשמי של PostgREST ל-`ilike`
  בתוך `or()`.

### ניקוי קוד
- נמחקו: `src/lib/api/example.functions.ts`, `src/lib/config.server.ts`
  (boilerplate שלא היה בשימוש), `src/lib/admin-role.server.ts` (shim שנוקה).
- תיקיית `src/lib/api/` הוסרה.
- Helpers מובסולטיים ב-`systems.functions.ts` (`isAdminUser`,
  `isAgentOrAbove`) הוחלפו ב-helper יחיד מבוסס `hasRole`.

---

## בעיות שנותרו / המלצות

### בעדיפות בינונית

1. **`manager-dashboard.functions.ts` ו-`reports.functions.ts` פתוחים לכל
   משתמש מאומת.** המסכים נקראים "דשבורד מנהלים" אך אין בדיקת תפקיד.
   המלצה: להוסיף `assertRole(context.userId, "admin")` ב-`getManagerDashboard`
   וב-`getReports`, ולהסתיר את הקישורים בתפריט למשתמשים שאינם מנהלים. לא
   ביצענו בסבב הזה כדי לא לשבור UX קיים — נדרשת החלטה עסקית.

2. **`listStatusSettings`** קריא לכל משתמש מאומת. כתיבה (`upsertStatusSetting`,
   `deleteStatusSetting`) מוגנת ב-`super_admin`. הקריאה ככל הנראה תקינה
   (תוויות סטטוס נדרשות בכל מסך) אך כדאי לאמת.

3. **`updateSystem` / `transferAgent` / `addNote` ב-`systems.functions.ts`**
   — בודקות שהמשתמש הוא `admin` או הנציג המטפל. אין `agent`-gate כללי,
   כך שמשתמש מאומת שאינו אדמין ואינו הנציג יחזיר שגיאה ברורה. נכון, אך
   אין הגנה ברמת ה-DB (RLS) — ראו סעיף RLS למטה.

4. **ה-CRM Report (`listWeeklyCrmReportRecipients`)** מחזיר רשימת כל
   המשתמשים שיש להם email דרך `auth.admin.listUsers()`. זה PII. החזרה
   מוגבלת לאדמין, אך כדאי לצמצם את השדות (כיום `id, email`).

### בוצע בסבב האחרון (ביקורות Claude/GPT)

- **RLS על `systems` הודק** — נציג יכול לעדכן רק מערכות המשויכות אליו,
  ללא שיוך, או שהוא נמען תזכורת בהן. אדמין/סופר־אדמין ללא הגבלה.
- **סינון, מיון וספירה עברו ל-SQL** — `list_systems_page` ו-
  `systems_status_counts`; אין יותר מיון JS על אלפי שורות בדשבורד.
- **חיפוש בדשבורד רץ בשרת** על כל המערכות (שם, מזהה, טלפון, מספר פונה,
  מיילים נוספים, הערות, מקור, סטטוסים), כולל התאמת טלפון לפי 9 ספרות
  אחרונות (0/972 לא משנים תוצאה).
- **`findSystemsByCallerPhone` תוקן** — ה-cast של JSONB בתוך `or()` לא נתמך
  ב-PostgREST; החיפוש פוצל לשתי שאילתות ואיחוד בצד השרת.
- **`/api/public/health`** לא מחזיר יותר פרטי שגיאות DB לאנונימיים.
- **Retention ליומני פעילות** — `purge_old_activity_logs` רצה אוטומטית
  אחרי גיבוי מוצלח ב-`scheduled-backup-check`.
- **Ctrl+K** פותח את החיפוש הגלובלי מכל מסך; `/` ממקד את סינון הדשבורד.

### בעדיפות נמוכה



6. **N+1 ב-`listBackups`** — לולאה של `storage.list` פר folder. עם 50+
   גיבויים יורגש איטיות. לבדוק batching.

7. **`updateSystem` `audio_url: z.string().url()`** — דוחה מחרוזת ריקה.
   ה-handler ממיר `email || null`, אבל `audio_url` לא. ניתן לרכך
   עם `.or(z.literal(""))`.

8. **Indexes ב-DB**: לוודא אינדקסים על
   `systems.parent_system_id`, `systems.assigned_agent_id`, `systems.status`,
   `system_activity_log.system_id`, `system_activity_log.created_at`,
   `system_activity_log.actor_id`.

---

## סיכוני אבטחה

### גבוה
אין.

### בינוני

- **RLS ב-`systems`** — כדאי לבדוק שהמדיניות (4 policies לפי המידע) באמת
  מגבילה משתמש לא-אדמין לפעולות שהוא מורשה אליהן (קריאה/עדכון של מערכות
  המשויכות אליו). הלוגיקה ב-server function נכונה, אך אם מישהו יצליח
  להגיע ל-Supabase Data API ישירות עם anon-key, ה-DB צריך להגן.

- **`status_settings` עם `assigned_agent_ids`** — הקריאה פתוחה. רשימת
  ה-UUIDs של נציגים שמטפלים בסטטוס מסוים נחשפת לכל משתמש מאומת. מקובל
  ברוב המקרים אך כדאי לוודא שזה תואם לציפיות.

### נמוך

- **`audit.functions.ts` חיפוש** — חוזק לאחר התיקון, אך עדיין מומלץ
  להוסיף Index חלקי על השדות שמחפשים בהם, או לעבור ל-`tsvector` עם
  `to_tsvector(...)` ו-`@@`.

- **Secrets**: `LOVABLE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` בלבד שמורים
  ב-Lovable Cloud. אין secret חשוף בקוד.

- **Webhooks**: `/api/public/hooks/*` ו-`/api/public/weekly-crm-report` —
  לוודא שיש אימות חתימה/קוד-קריאה לפני שמתחילים לעבוד עם ה-payload.

---

## רשימת בדיקות לפני Production

- [ ] להפעיל את `supabase--linter` ולוודא שאין warnings פתוחים.
- [ ] לוודא שיש Google OAuth מוגדר (אם דרוש למשתמשי קצה).
- [ ] להגדיר אסטרטגיית גיבוי externalit (העתקה ל-S3/Drive פעם בשבוע).
- [ ] להריץ load test בסיסי (100 משתמשים במקביל קוראים `listSystems`).
- [ ] להגדיר monitoring/alerts (Sentry, או דרך `error-capture.ts`).
- [ ] לעבור על תפקידים ב-DB ולוודא שיש לפחות 2 super_admins (אחד backup).
- [ ] לאמת תזמונים: ה-heartbeat היחיד (`scheduled-backup-check`) שמכבד את הגדרות הגיבוי בניהול, ו-`weekly-crm-report`. ה-crons הישנים `daily-backup`/`weekly-backup` הוסרו כדי למנוע כפילות.
- [ ] לסקור את כל מדיניות ה-RLS במסך ה-Backend.

---

## הערכה כללית

| תחום | סטטוס |
| --- | --- |
| הרשאות ואותנטיקציה | ✅ אחיד, מבוסס `assertRole` בלבד |
| גיבוי ושחזור | ✅ מאובטח, מתועד, double-confirm |
| אימות קלט | ✅ Zod מלא |
| אבטחת חיפוש | ✅ חוזק |
| ניקוי קוד | ✅ הוסרו כל ה-shims וה-boilerplate |
| RLS | ⚠️ לבדוק שוב במסך ה-Backend |
| ביצועים | ⚠️ Pagination ל-`listSystems` כשהמערכת גדלה |
| Monitoring | ⚠️ להוסיף לפני production |

**המלצה**: ניתן לעלות לאוויר. מומלץ לבצע את 3 פריטי ה-Warning תוך 2 שבועות
מהעלייה.

---

## עדכון — סבב חוסן וניטור

- **תזמונים**: הוסרו ה-crons הכפולים מ-`vercel.json`; הגיבוי רץ רק דרך
  ה-heartbeat (`/api/public/hooks/scheduled-backup-check`) לפי ההגדרה בניהול.
- **גיבוי**: `systems.xlsx` נוצר תמיד, נשמר `manifest.json`, מייל הגיבוי מסומן
  ב-⚠️ כשהאימות נכשל, ומדיניות שמירה (`pruneOldBackups`) מוחקת גיבויים ישנים
  לפי `retentionDailyDays` / `retentionWeeklyDays`.
- **Rate limiting**: `src/lib/public-rate-limit.server.ts` (מגובה DB) מוחל על
  כל נקודות הקצה תחת `/api/public/*`.
- **הרשאות**: `getManagerDashboard` ו-`getReports` מוגבלים ל-`admin`.
  `weekly-crm-report` עבר לאימות בכותרת `apikey` עם השוואה timing-safe.
- **בריאות**: `/api/public/health` מחזיר בדיקת DB וזמן הגיבוי האחרון, ו-503
  כשיש תקלה — מתאים לחיבור מוניטור חיצוני.
- **משתני סביבה**: `src/lib/env.server.ts` מרכז את כל המשתנים ואת הפיצ'רים
  התלויים בהם.
- **בדיקות**: `bun run test` (vitest) — כיסוי לתזמון הגיבוי, מדיניות השמירה
  והגנת CSV.
- **UX**: סינוני הדשבורד נשמרים ב-localStorage, נוסף כפתור "המערכות שלי",
  ומצב "אין תוצאות" מציע ניקוי סינון.
