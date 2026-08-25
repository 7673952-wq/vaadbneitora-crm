# סבב P0+P1 מרוכז: זכור-אותי, MFA מחייב בשרת, ומהירות כניסה/דשבורד

מטרה מרכזית: לתקן את ~10 השניות מקוד MFA → דשבורד, ואת השניות הנוספות עד שהמערכות שמישות — באמצעות מדידה אמיתית, לא ניחושים.

## P0-A — מדידה, זכור-אותי, Session

### 1. Instrumentation של תהליך הכניסה
הרחבת `src/lib/perf.ts` עם סימוני הכניסה: `OTP_SUBMIT_START`, `OTP_VERIFY_DONE`, `SUPABASE_SIGNIN_START/DONE`, `SESSION_READY`, `SESSION_SECURITY_START/DONE`, `AUTH_COMPLETE`, `NAVIGATE_START`, `DASHBOARD_ROUTE_READY`, `STATUS_SETTINGS_START/READY`, `SYSTEMS_QUERY_START/DONE`, `DASHBOARD_ABOVE_FOLD_READY`, `DASHBOARD_FULL_READY`. הפאנל הצף (dev / `?perf=1`) יציג גם משך מהשלב הקודם וגם מתחילת הכניסה. מדידת "לפני" תתבצע בפריוויו לפני שאר השינויים.

### 2. "זכור אותי" — סוג האחסון נקבע בזמן ההתחברות
בלי signOut בדיעבד, בלי BroadcastChannel כמנגנון החלטה:
- מתאם אחסון חדש `src/lib/remember-storage.ts`: אם "זכור אותי" מסומן → `localStorage` (שרדות מלאה); אם לא → `sessionStorage` (נמחק בסגירת הדפדפן). הבחירה נכתבת לפני `signInWithPassword`, כך שה-Session נכתב מלכתחילה למקום הנכון.
- שילוב חד-שורי סוגר במתאם של הקליינט (הקובץ הגנרטיבי) — נקודת החיבור היחידה האפשרית; יסומן בהערה ברורה. המתאם גם עוטף את בroker הפריוויו עם cache בזיכרון כדי שלא כל קריאת session תשלם roundtrip.
- Logout מוחק: session, remember flag, device-trust (שרת), וכל state מקומי.
- Cleanup של מפתחות ישנים (`crm_active_session`, `crm_login_logged`, `crm_session_temp`) בטעינה.

### 3. איחוד Session אמיתי
- מאזין auth יחיד ב-`useSession`; מחיקת המאזין הכפול ב-`StatusSettingsHydrator` (יעבור ל-`useSession`).
- מטמון token ברמת מודול (`src/lib/session-cache.ts`) עם תוקף — ה-functionMiddleware ב-`src/start.ts` יוחלף במתאם פרויקטי שקורא מהמטמון במקום `getSession()` בכל קריאת ServerFn.
- אחרי `signInWithPassword` מוצלח — ה-session מוזן ישירות ל-cache (`queryClient.setQueryData(["session"])`) בלי קריאה נוספת לאחסון.

### 4. getAuthHeaders — צמצום מבוקר, לא החלפה עיוורת
חלוקה לפני מחיקה:
- A) קריאות ServerFn רגילות (~120) — ה-middleware כבר מצרף bearer; מסירים את `headers: await getAuthHeaders()` ואת ה-import. batch לפי קובץ + typecheck אחרי כל batch.
- B) raw fetch (העלאת קבצים וכד') — נשאר, אך `getAuthHeaders` עצמה תקרא מהמטמון.

### 5. previewAuthStorage
הקובץ גנרטיבי ולא ניתן לעריכה — אך המתאם החדש (סעיף 2) עוטף אותו: cache בזיכרון לקריאות, כך ש-timeout של 2 שניות יכול להתרחש לכל היותר פעם אחת בטעינה, ו-production (לא בפריים) ממשיך לעבוד ישירות מול localStorage. נמדוד ונדווח בפועל.

## P0-B — MFA

### 6. MFA קשור ל-Session בצד שרת (לא X-Device-Id כהוכחה)
- טבלה חדשה `mfa_passed_sessions` (session_id מתוך ה-JWT, user_id, תוקף) — נכתבת ע"י ServerFn `confirmMfaSession` מיד אחרי שהדפדפן משלים sign-in שעבר OTP.
- `crm_mfa_just_passed` ישמש רק לאופטימיזציית UI, לא כהרשאה.
- Logout מוחק את רשומת ה-session ואת אמון המכשיר → התחברות חדשה עם סיסמה תמיד דורשת קוד חדש. session משוחזר (זכור-אותי) לא דורש קוד כל עוד ה-session תקף.

### 7. אכיפה בשכבה משותפת
middleware חדש `requireMfaCompleted` (מורכב מעל `requireSupabaseAuth`): אם למשתמש `mfa_enabled` — חייבת להיות רשומת `mfa_passed_sessions` תקפה ל-`claims.session_id`, אחרת 403. ייושם על כל קובצי ה-`.functions.ts` המוגנים (החלפת `.middleware([requireSupabaseAuth])` ב-pattern אחד). יוצאים מן הכלל: `login.functions.ts` (pre-MFA בdefinition) ו-journaling.

### 8. Resend נכון + קובץ 004
- סדר אטומי: הפקת קוד → שליחת ימות → רק בהצלחה commit של ה-hash החדש וביטול הישן; כשל משאיר את הקוד הקודם בתוקף.
- cooldown 30 שניות (קיים), תקרת 5 resends (`resend_count`), לוג שרת לכל כשל.
- קובץ ההשמעה ישונה ל-`004.tts` כמבוקש; הקוד נשאר 8 ספרות; מנגנון החיוג עצמו לא נשכתב.

### 9. Migration (אחת, מאושרת)
`mfa_passed_sessions` (GRANT SELECT ל-authenticated לשורה עצמית בלבד, ALL ל-service_role, RLS), `login_otp_challenges.resend_count`, אינדקסים: `login_otp_challenges(user_id)`, `(expires_at)`, `login_events(user_id, created_at)`, `mfa_trusted_devices(expires_at)`.

## P0-C — דשבורד בשני שלבים
שלב 1 (חוסם): Header, חיפוש, סינונים, סיכום סטטוסים, רשימת מערכות. שלב 2 (נדחה): תרשימים (כבר lazy — יישאר), `pokeVoiceQueue` יעבור ל-`requestIdleCallback` (בלי poke בטעינה הראשונית), `NotificationBell` ייטען אחרי שהרשימה usable.

## P1
- A) הוצאת `YemotCreateModal` (שורות 1464-1805) ל-`src/components/YemotCreateModal.tsx`; `NewRecordButton` ייבא משם.
- B) `import * as XLSX` → dynamic import ב-2 פונקציות ה-export בלבד (ExcelJS כבר דינמי). אימות ב-bundle.
- C+D) כנ"ל ב-P0-C.
- G) `useStatusSettings`: `initialDataUpdatedAt` מה-`savedAt` של ה-cache + refetch ברקע.
- H) "טען עוד" (50) ל-notes/transfers בכרטיס מערכת.
- I) Reports: העברת COUNT/GROUP BY ל-RPC (בלי שינוי תוצאות).
- J) Export: בלוקים במקום `pageSize: 100000` (בלי לשבור את הקיים).
- K) file validation: דחיית `application/octet-stream`/MIME ריק ללא חתימה מזוהה.
- L) `device_id` ביומן הכניסות (listLoginEvents + תצוגת Admin).

## בדיקות (חובה לפני "הושלם")
vitest: מתאם האחסון (remembered/not/logout-clears), OTP (hash/generate 8 ספרות), resend (כשל משאיר קוד ישן, cooldown, תקרה), לוגיקת MFA (enabled/disabled/wrong/expired/used/max), session logging חד-פעמי, כשל `user_security` חוסם. ריצת `bun run test` + typecheck + build. מדידת E2E בפריוויו עם `?perf=1` (לפני/אחרי).

## דוח סיום
טבלה מלאה | סעיף | מצב | לפני | אחרי | קבצים | + רשימת קבצים, migrations, typecheck/build/tests, זמנים נמדדים, מוני getSession/onAuthStateChange/getAuthHeaders לפני/אחרי, גודל bundle, זמן listSystems, ויתרות פתוחות. לא יסומן "בוצע" ללא בדיקה.

## מגבלות מוסכמות
לא נוגעים ב: מנגנון החיוג הקולי שעובד, עיצוב כרטיסיית המערכת, סטטוסים/לוגיקה עסקית, RLS קיים, מיגרציות ישנות.
