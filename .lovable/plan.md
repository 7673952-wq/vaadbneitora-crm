# שיפורי Code Review

מצאתי שב-DB enum `app_role` קיימים רק שלושה תפקידים: `admin`, `agent`, `super_admin`. התפקידים `manager`, `team_lead`, `viewer` מופיעים רק ב-`permissions.server.ts` ובדיקה ב-`getMyRole` — אינם ניתנים להקצאה דרך ה-UI ולא קיימים ב-DB.

הערה חשובה: "manager-dashboard" הוא **שם מסלול** (דשבורד למנהלים) ולא תפקיד — נשאר.

---

## 1. ניקוי תפקידים לא קיימים

**`src/lib/permissions.server.ts`**
- `ROLE_HIERARCHY` יצומצם ל-`["super_admin", "admin", "agent"]`.
- מפת התרגום לעברית — רק שלושת התפקידים.
- ה-type `Role` יגזר מהאיחוד החדש (תואם ל-`app_role` ב-`types.ts`).

**`src/lib/admin.functions.ts`**
- `getMyRole`: הסרת ההפניות ל-`manager`/`team_lead` ב-חישוב `isAgent`.

## 2. סטנדרט הרשאות אחיד

כל server-fn יקרא ל-`assertRole(context.userId, <role>)` ממקור אחד (`@/lib/permissions.server`). לא יהיו עוד וריאציות `isAdmin/RPC has_role/בדיקות inline`.

קבצים שייסרקו ויותאמו: `admin.functions.ts`, `audit.functions.ts`, `backups.functions.ts`, `system-files.functions.ts`, `systems.functions.ts`, `manager-dashboard.functions.ts`, `reports.functions.ts`.

מחיקת השכבה הכפולה: `src/lib/admin-role.server.ts` (re-export shim שכבר לא נחוץ — אעדכן את הקבצים הבודדים שעדיין מייבאים ממנו).

## 3. גיבויים ושחזורים

**`src/lib/backups.functions.ts`**
- `backupNow`, `listBackups`, `getBackupFileUrl`, `deleteBackup` → `assertRole(..., "admin")`.
- `restoreBackup` → `assertRole(..., "super_admin")` + רישום audit log לפני ואחרי (`action: "backup_restore"`, מספר טבלאות, מצב merge/replace, תוצאה).

**`src/routes/_authenticated/backups.tsx`** (UI דק בלבד, ללא שינוי לוגיקה):
- כפתור "ייבוא גיבוי" יוצג רק ל-`me.isSuperAdmin`.
- לפני שחזור: דיאלוג אזהרה עם **אישור כפול** (Checkbox "אני מבין שזו פעולה הרסנית" + הקלדת המילה `שחזר`).

## 4. אימות קלט Zod מלא

סקירה ב-כל `createServerFn`:
- כל פונקציה תקבל `.inputValidator(d => z.object({...}).parse(d))` עם schema מדויק.
- פונקציות בלי פרמטרים יקבלו `inputValidator` ריק (`z.void().parse`) או יישארו ללא — מה שעקבי.
- מטרה עיקרית: `listSystems`, וכל פונקציה שכרגע מקבלת `any`/אובייקט לא מאומת.

## 5. חיפוש Audit Log בטוח

**`src/lib/audit.functions.ts`** — `q.or(...ilike...)` בנייה ידנית של מחרוזות עם `%` ו-`,` היא שביר ופגיע ל-PostgREST injection אם המשתמש יזין `,` או `)` בטקסט.

תיקון:
- escape מלא של תווי הבקרה של PostgREST (`,`, `(`, `)`, `*`, `%`).
- שימוש ב-`textSearch` של Supabase במקום `or` ידני, או לפחות מעבר ל-`.ilike()` נפרד פר שדה עם UNION בצד JS.
- הוצאת לוגיקת ה-escape ל-helper `safeIlikePattern(s)` שניתן לבדוק.

## 6. ניקוי קוד

- מחיקה: `src/lib/api/example.functions.ts` (boilerplate, לא בשימוש).
- מחיקה: `src/lib/admin-role.server.ts` לאחר עדכון הצרכנים האחרונים.
- חיפוש imports יתומים והסרתם.
- איתור פונקציות כפולות (אם יש כאלו ב-`systems.functions.ts`/`backups.functions.ts`).

## 7. דוח Production Readiness

קובץ חדש: `.lovable/production-readiness.md` עם הסעיפים:
1. בעיות שנותרו (אם נמצאו במהלך הסריקה).
2. המלצות לשיפור (אינדקסים ב-DB, pagination ב-UI, rate limiting, monitoring).
3. סיכוני אבטחה (RLS coverage, secrets handling, public endpoints).
4. הערכת מוכנות לעלייה לאוויר.

---

## דברים שלא ייגעו בהם
- רכיבי UI/עמודים מלבד התוספת הקטנה ב-`backups.tsx` (כפתור Restore + דיאלוג).
- DB schema — ה-enum כבר נכון.
- קבצי auto-gen של supabase ו-router.

## סדר עבודה
1. ניקוי תפקידים (`permissions.server.ts`, `admin.functions.ts`).
2. אחידות הרשאות + מחיקת `admin-role.server.ts`.
3. גיבויים — backend ואז UI.
4. Zod ל-listSystems וכל החסרים.
5. Audit search hardening.
6. ניקוי קוד + מחיקת example.
7. דוח Production Readiness.

אפעל קובץ-קובץ ואוודא שה-build עובר אחרי כל שלב.