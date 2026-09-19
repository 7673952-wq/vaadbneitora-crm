# סבב סגירה סופי — בקשות, אישור ידני, וניווט ממיילי תיוג

האוטומציה נשארת `dry_run`. לא מועברת ל-live בסבב הזה.

## א. ההערות שלך

1. **הבקשות ייפתחו מלא כברירת מחדל.** כרגע כל בקשה מקופלת (`useState(highlighted)`
   ב-`requests.tsx`). ישונה לפתוח כברירת מחדל, עם אפשרות לקפל ידנית ושמירת
   הבחירה (מקופל/פתוח) בדפדפן כדי שלא תאבד ברענון.
2. **שם המערכת יחזור להיות קישור לכרטיס המערכת.** בשורת הבקשה, כששויכה מערכת
   קיימת, `קוד · שם` יהיה קישור ל-`/systems/$id` (נפתח בלי לקפל/לפתוח את הבקשה).
   אותו קישור יתווסף גם בגוף הבקשה הפתוחה.
3. **תהליך אחד ואחיד לפתיחת מערכת מבקשה.** כיום הבחירה "מערכת ראשית / תת־מערכת"
   מסתיימת בהודעה "הבקשה בוצעה", ורק אחר כך המשתמש נשאל שוב מה הסטטוס. במקום זה
   יוצג טופס אחד: שם המערכת, בחירת סוג הפתיחה (ראשית או תת־מערכת תחת המערכת
   הראשית שנמצאה), ובחירת הסטטוס — והכול נשלח בלחיצה אחת שיוצרת, מקשרת וקובעת
   סטטוס. אין הודעת הצלחה בשלב אמצע, ואין שאלה שנייה לאחר מכן. אם חלק כלשהו
   נכשל — הבקשה נשארת פתוחה עם הסבר, וה-retry ממשיך מאותה נקודה (סעיף ב.1).


## ב. הסעיפים מהדוח

### 1. Retry-safe ביצירת מערכת/תת־מערכת (OPEN)
כיום אין checkpoint: אם המערכת נוצרה והקישור נכשל, retry יוצר מערכת נוספת או
מפרש את החדשה כ-conflict. מיגרציה חדשה תוסיף `manual_created_system_id` ל-
`system_requests`. ב-`system-requests.server.ts`: מיד לאחר ה-INSERT של המערכת
נשמר ה-id בעמודה הזאת (לפני כל המשך); ב-retry, אם העמודה מלאה — משתמשים באותה
מערכת, בלי INSERT נוסף ובלי בדיקת conflict מחדש, ומשלימים רק את השלבים החסרים.
ייחוד לפי הבקשה מונע יצירה כפולה גם ב-retry מקבילי.
בדיקות: create_sub → כשל קישור → retry (אין duplicate); create_root → אותו דבר
(אין conflict שגוי); crash מיד אחרי INSERT (checkpoint מזוהה); retry מקבילי
(מערכת אחת).

### 2. חיפוש שם — helper אחד באמת (OPEN)
`queryCandidateSystemsByName` ב-`system-requests.server.ts` הוא חיפוש שני ושונה
(exact-only, projection אחר, ללא fuzzy/ordering) מול `searchCandidateSystems`
ש-`findSystemByName` כבר משתמש בו. הוא יימחק ו-`matchSystemNameForRequest` יקרא
ל-`searchCandidateSystems`. בדיקת regression תפעיל את **שני** ה-entry points
בפועל (`findSystemByName` ו-`matchRequestSystemName`) ותשווה את קבוצת ה-candidates
והסדר עבור: exact, partial, normalized, מספר התאמות, אין התאמות.

### 3. Idempotency בשלושת מסכי השליחה
`sendSystemEmail` ו-`sendRecordEmail` יקבלו `idempotencyKey` מ-`systems.$id.tsx`
ומ-`c.$crm.$id.tsx` לפי אותו מנגנון send intent עמיד שתיבת הדואר משתמשת בו
(`send-intent-key.ts`), כולל הישרדות refresh/reopen. `unknown` לא נשלח מחדש
אוטומטית ומוצג למשתמש. בדיקות: relay הצליח → כשל בהמשך → retry ללא קריאה נוספת
ל-relay; refresh של אותו intent ללא duplicate — לכל אחד משלושת המסכים.

### 4. סגירת המסלול הישן של retry ל-unknown (OPEN)
`requeueMentionDelivery` ב-`queues.functions.ts` עוקף את ה-guard של
`retryMentionDelivery`. הוא יופנה לאותו guard (`assertMentionRetryAllowed` +
`performMentionRetry`) כך שאין דרך לשלוח מחדש `unknown` בלי אישור מפורש.
בדיקות: unknown בלי אישור → נדחה; unknown עם אישור מורשה → נשלח מחדש.

### 5. פיצ'ר חדש — "דרוש אישור ידני לכל בקשה" (per-CRM)
הגדרה חדשה נפרדת מ-off/dry_run/live, בשם `request_require_manual_approval`,
נשמרת ב-`app_settings` לכל CRM בנפרד דרך
`getRequestAutomationSettings`/`setRequestAutomationSettings`.
- live + כבוי: אין שינוי בהתנהגות הקיימת.
- live + מופעל: המנוע רץ במלואו (קליטה, סוג בקשה, זיהוי מערכת, rules, חישוב
  פעולה/סטטוס/הצעת יצירה) אך **לא מבצע שום שינוי תפעולי**: לא סטטוס, לא יצירת
  מערכת/תת־מערכת, לא קישור שמשנה state, לא הוספת מספר, לא side effects, לא
  שליחה קולית, לא ignore/keep אוטומטי. הבקשה נשמרת `decision_status =
  needs_decision`, `dry_run = false`, `automation_mode = live` ועם snapshot
  שמסביר שהיא נעצרה לאישור (עמודה חדשה `manual_approval_required` במיגרציה
  חדשה) כדי ששינוי ההגדרה בהמשך לא ישנה היסטוריה.
- dedup של אותה הודעת Gmail ממשיך אוטומטית; rescan לא יוצר בקשה חדשה.
- לחיצה של משתמש מורשה מבצעת את הפעולה דרך מנגנון ההחלטות הידני הקיים, עם כל
  ה-side effects.
- UI: checkbox במסך ניהול → אוטומציית בקשות ליד "מצב אוטומציה", עם ההסבר
  "האוטומציה תנתח כל בקשה ותציע את הפעולה המתאימה, אך לא תבצע שינוי לפני אישור
  ידני"; במסך הבקשות badge "פעיל · ממתין לאישור ידני" (נפרד מ"בדיקה בלבד").
- בדיקות: 10 התרחישים מהדוח (live±manualApproval עבור set_status / keep /
  ignore / create_system, אישור ידני מבצע בפועל, dry_run ו-off ללא שינוי, שינוי
  הגדרה לא משנה היסטוריה, duplicate של Gmail).

### 6. deep-link ממיילי תיוג
- **origin קנוני**: `buildAppLink` ב-`mentions.server.ts` יבנה תמיד מ-
  `APP_BASE_URL` (ההגדרה בכרטיס תורי הרקע היא מקור האמת), ותיווסף בדיקה שה-URL
  במייל תואם בדיוק את origin האפליקציה הפעילה.
- **שמירת יעד דרך login**: ה-gate ב-`src/routes/_authenticated/route.tsx` יפנה
  ל-`/auth?next=<pathname+search>` במקום ל-`/auth` חלק; `auth.tsx` יקרא `next`
  ויחזור אליו אחרי התחברות במקום ל-`/dashboard`. עם session תקף אין הפניה כלל
  (אין flash). ולידציה ל-`next`: רק נתיב פנימי שמתחיל ב-`/` ולא ב-`//`, בלי
  host חיצוני — אחרת fallback ל-`/dashboard`.
- בדיקות: מחובר → נפתחת המערכת/הרשומה; לא מחובר → login → היעד המקורי; query
  params נשמרים; `next=https://evil.example` נדחה; session תקף ללא redirect.
  מנגנון שליחת מייל התיוג עצמו לא נוגעים בו.

### 7. אימותים לפני LIVE
RLS suite ו-Queue E2E ירוצו רק מול staging/local. אין סביבת staging בפועל, ולכן
הם ידווחו `NOT RUN` והסטטוס הכולל יישאר **NOT READY FOR LIVE**.

## פרטים טכניים
- מיגרציה חדשה אחת: `system_requests.manual_created_system_id`,
  `system_requests.manual_approval_required`; אין עריכה של מיגרציות קיימות.
- קבצים עיקריים: `src/routes/_authenticated/requests.tsx`,
  `src/lib/system-requests.server.ts`, `src/lib/system-requests.functions.ts`,
  `src/lib/queues.functions.ts`, `src/lib/mentions.server.ts`,
  `src/routes/_authenticated/{admin,systems.$id,c.$crm.$id,route}.tsx`,
  `src/routes/auth.tsx`, `src/lib/system-search.ts`.
- בסיום יורצו `bunx vitest run`, `npx tsgo --noEmit`, production build ובדיקות
  Apps Script, עם דוח FIXED / ALREADY FIXED / NOT RUN / OPEN לכל סעיף ודיווח
  נפרד לארבעת המצבים (live, live+אישור ידני, dry_run, off).
