
## שלב 1/4 — באגים קריטיים (א+ב+ה+ד)

לאחר אישור — ממשיך לשלב 2 (יצוא CRM חדש), 3 (סטטוסים משניים), 4 (זיהוי סדרות).

### א. דשבורד

**1. ספירת סטטוסים גלובלית**
- כיום `StatusFilterBar` סופר מתוך `systems` שהוחזרו לדף הנוכחי בלבד.
- אוסיף server fn חדש `getStatusCounts` ב-`src/lib/systems.functions.ts` שמחזיר `{ [status_key]: count }` לכל ה-CRM (עם אותם פילטרים של חיפוש/נציג, **בלי** pagination).
- הדשבורד יקרא אותו עם `useQuery` נפרד שמתרענן עם שאר ה-cache. הסרגל יציג ספירות גלובליות תמיד.

**2. בדיקה מהירה — שדה מאוחד + זיהוי שם קיים**
- אאחד את שני השדות (מספר/שם) ב`QuickCheckBar` לשדה אחד שמחפש לפי שני העמודות (LIKE על `system_code` וגם `name`).
- בכפתור "הוסף מערכת" וב"בדיקה מהירה" — בלחיצה על "צור", אם השם כבר קיים, ייפתח דיאלוג: "מערכת בשם X כבר קיימת. ליצור אב-מערכת חדשה / לפתוח כתת-מערכת של [רשימה]". בחירה ממשיכה ליצירה עם `parent_system_id` המתאים.

**3. בורר כמות-לעמוד למעלה**
- אעביר את ה-PageSizeSelector מתחתית הדשבורד אל שורת הפילטרים העליונה לצד החיפוש/סינון נציג.

### ב. כללי

- **בדיקה מהירה — שדה אחד** (ראה למעלה).
- **דשבורד מנהלים — הסרת "גיבויים"**: אוודא ש-`ManagerDashboard` לא טוען/מציג את הטאב/הכרטיס "גיבויים". כרגע עדיין מופיע — אסיר אותו לחלוטין.

### ה. ייבוא אקסל — שמירת סטטוסים לכל שורה

הבעיה: כשמייבאים, כל השורות בעלות אותו שם הופכות לתת-מערכת תחת הראשונה, ומקבלות את הסטטוס שלה דרך הטריגר/הקוד.
- אוודא ב-`importSystems` שכאשר שורה נוצרת כתת-מערכת (auto-link או דרך resolution), הסטטוס שמגיע מהאקסל **נשמר**. אבטל כל override של סטטוס בנתיב הייבוא.
- אוודא שהטריגר `inherit_parent_on_insert` כבר לא מעדכן status (כפי שכבר תוקן בעבר). אם עדיין יש cascade ב-`propagate_parent_changes` שמופעל בזמן insert של אב חדש — אגביל אותו רק ל-UPDATE.

### ד. גיבוי

**1. שליחת מייל ידנית שהפסיקה לעבוד**
- אקרא את `backups.functions.ts` ואת ה-route של `send-backup-email` כדי לראות מה השגיאה (ה-secret `RESEND_API_KEY` קיים).
- אוסיף לוגים מפורטים + טיפול שגיאות נכון, ואחזיר הודעה ברורה ב-UI במקום destructure error.

**2. גיבוי שבועי אוטומטי לא רץ**
- אבדוק `cron.job` ב-DB; אם חסר/שבור — אקבע מחדש pg_cron שיקרא ל-`/api/public/hooks/weekly-backup` עם ה-`apikey`/secret.
- אאמת ש-handler שולח מייל דרך Resend עם הקובץ המכווץ (zip של ה-JSON), לא רק קישור.

### פרטים טכניים

- שינויים ב-DB: בדיקת/תיקון טריגרים `propagate_parent_changes` ו-`inherit_parent_on_insert`; וידוא pg_cron של weekly-backup. ייתכן migration אחד קטן.
- שינויי קוד: `src/lib/systems.functions.ts`, `src/routes/_authenticated/dashboard.tsx` (StatusFilterBar, QuickCheckBar, PageSizeSelector, AddSystemDialog, ImportModal), `src/routes/_authenticated/manager-dashboard.tsx`, `src/lib/backups.functions.ts`, `src/routes/api/public/hooks/weekly-backup.ts`, `src/routes/api/public/hooks/daily-backup.ts` (אם רלוונטי).
- אין שינוי schema לטבלאות; רק טריגרים + cron.

### מה לא נכנס בשלב הזה
- ייצוא CRM החדש לפי תבנית האקסל (שלב 2).
- מערך סטטוסים משני (שלב 3).
- פיצ'ר זיהוי סדרות מזהים (שלב 4).
