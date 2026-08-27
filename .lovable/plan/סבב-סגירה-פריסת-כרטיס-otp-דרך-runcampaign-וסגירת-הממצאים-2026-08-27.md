# סבב סגירה: פריסת כרטיס, OTP דרך RunCampaign, וסגירת הממצאים

## 1. כרטיס מערכת — שני חצאים שווים

היום הפריסה היא `xl:grid-cols-[minmax(0,1fr)_380px]` — טור פרטים צר וקבוע מול טור פעילות רחב.
השינוי: `xl:grid-cols-2` (שני חצאים שווים, `minmax(0,1fr)` בכל צד), כולל התאמת הגריד הפנימי
בטור הפעילות (`lg:grid-cols-[minmax(0,1fr)_290px]`) כדי שלא יידחס בחצי מסך. שאר העיצוב נשאר.

## 2. שליחת קוד האימות דרך RunCampaign

רק זרימת ה-OTP משתנה. שליחת ההודעות הקוליות בשינוי סטטוס לא נוגעים בה בכלל.

`src/lib/otp.server.ts` — `sendOtpByPhone` נכתב מחדש:

- קריאה אחת ל-`POST https://www.call2all.co.il/ym/api/RunCampaign`
- פרמטר `phones` = אובייקט JSON: `{ "<phone>": { "text": "<הטקסט>" } }`
- הטקסט מקריא את הקוד **פעמיים**:
  `קוד האימות הוא: 1 2 3 4 5 6 7 8 . השמעה חוזרת: 1 2 3 4 5 6 7 8`
- כל ספרה מופרדת ברווח, וגם רווח לפני ואחרי רצף הספרות (דרישת הרפורמה בימות).
- כל הלוגיקה הישנה (UpdateExtension / GetIVR2Dir / FileAction / TTS / CallExtensionBridging
  ו-`YEMOT_OTP_TEMPLATE`) יורדת ממסלול ה-OTP.
- טיפול שגיאות נשמר: אם `responseStatus !== "OK"` נזרקת שגיאה בעברית עם הודעת הספק.

## 3. ממצאי הביקורת

### P0 — הגבלת שליחת OTP שאינה תלויה ב-Challenge
Rate limit חדש במפתח `otp_send:<userId>` (מעל `bump_rate_limit`), שחל גם על `beginLogin`
וגם על `resendLoginOtp`: מינימום 30 שניות בין שליחות ותקרה של 5 שליחות ל-15 דקות.
סיסמה תקינה לא מאפסת אותו.

### אטומיות זרימת OTP/MFA
שלוש פעולות דו-שלביות עוברות ל-RPC יחיד ב-DB (SECURITY DEFINER):
- `otp_consume_and_grant` — סימון ה-Challenge כנוצל + יצירת ה-grant בטרנזקציה אחת.
- `mfa_consume_grant` — סימון ה-grant כנוצל + כתיבת `mfa_passed_sessions` יחד.
- `otp_activate_resend` — הפעלת הקוד החדש וביטול הישן בפעולה אחת, אחרי שהשיחה הצליחה.
כולל בדיקת שגיאה בכל קריאה.

### ניקוי מנגנון ה"נוכחות" הישן
הסרת `crm_active_session` / BroadcastChannel / ping-pong / טיימר 300ms / signOut כפוי
מ-`__root.tsx`. נשאר מקור Auth אחד — `useSession`.

### מדידות ביצועים
הוספת `LOGIN_FLOW_START`; `resetPerfTimings()` לא מוחק יותר את `APP_START`,
ומדידות תהליך הכניסה נמדדות מול הסימון החדש.

### P1 שנשארו פתוחים
- הוצאת `YemotCreateModal` לקובץ עצמאי, כדי ש-`NewRecordButton` בהדר לא יגרור את `dashboard.tsx`.
- דחיית `NotificationBell` (3 השאילתות) עד שרשימת המערכות מוכנה.
- ייצוא: החלפת `pageSize: 100000` בשליפה בבאצ'ים.
- `reports.functions.ts`: העברת הספירות לפי סטטוס/נציג/תתי-מערכות ל-SQL aggregation.
- `useStatusSettings`: `readStatusCache()` יחזיר גם `savedAt`, שיועבר כ-`initialDataUpdatedAt`.
- בדיקת קבצים: MIME ריק או `application/octet-stream` יידחה אם אין חתימת תוכן מוכרת.
- `getSystem`: עימוד ל-Notes ו-Transfers ("טען עוד"), כמו שכבר קיים ב-Activity.
- `SecurityPanel`: הצגת `device_id` ביומן הכניסות, ותיקון הטקסט שמדבר על "מכשיר מאושר ל-30 יום"
  לתיאור הנכון — האישור קשור ל-Session.

### בדיקות
הוספת בדיקות ל-`rememberAwareStorage`, מכונת המצבים של Resend, ה-cooldown ותקרת השליחות,
החלפת grant ב-`confirmMfaSession`, וקוד שנוצל/פג.

## פרטים טכניים
קבצים עיקריים: `src/routes/_authenticated/systems.$id.tsx`, `src/lib/otp.server.ts`,
`src/lib/login.functions.ts`, `src/lib/login.server.ts`, `src/routes/__root.tsx`,
`src/lib/perf.ts`, `src/components/NewRecordButton.tsx`, `src/components/NotificationBell.tsx`,
`src/lib/reports.functions.ts`, `src/lib/use-status-settings.ts`, `src/lib/file-signature.ts`,
`src/lib/system-files.functions.ts`, `src/components/SecurityPanel.tsx`, ומיגרציה אחת ל-RPCs.
