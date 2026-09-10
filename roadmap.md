# מפת דרכים

## שלב א׳ — אוטומציית בקשות המייל (dry_run)
- [x] כפילות מייל: דחיית הודעה בלי מספר מערכת לפני insert (שרת) + סינון ב-Apps Script
- [x] כפילות אמיתית לפי (crm_key, request_type, system_code_norm, request_number) — אינדקס ייחודי במסד, רק כשיש request_number
- [x] הפרדה: ignore = אפס שינויים; keep = מוסיף מספר פונה; needs_decision = שום שינוי. סדר: החלטה לפני הוספת טלפון
- [x] שמירת automation_mode בזמן הקליטה + תצוגה מדויקת (כבוי / בדיקה / פעיל)
- [x] מסך בקשות: בחירת סטטוס אמיתית, "צור מערכת", תיקון מספר מערכת לרשומות ישנות בלבד
- [x] ניהול: רשימות בחירה מ-status_settings בכל ארבעת השדות + הסברים
- [x] מספר פונה: אידמפוטנטי, ראשי/נוספים
- [x] החלטה ידנית מתבצעת בפועל גם ב-dry_run
- [x] "צור מערכת" כשהמערכת כבר קיימת → שיוך לבקשה (system_id + prev_status), בלי שינוי סטטוס ובלי מספר פונה; שתי התאמות → דורש החלטה; כפתור שיוך לבקשות ישנות
- [x] בדיקות + TypeScript + build

## שלב ב׳ — הקשחה
- [x] auto-assign: שגיאת RPC עוצרת; reminder_agent_ids מתעדכן גם כשהנציג זהה
- [x] הורה/תתי-מערכות: שינוי נציג מקבל מהאב, הסטטוס לא מופץ אוטומטית (אומת בטריגר)
- [x] יצירת מערכת מבקשה — אטומית, קריאה חוזרת בעת התנגשות
- [x] escaping HTML בפלט Apps Script
- [x] rate limit מבוסס DB בכל נתיב ציבורי + בדיקת error
- [x] ביקורת RLS: ביטול כל הרשאות anon, סגירת טבלאות האימות
- [x] סקירת SECURITY DEFINER (רק mfa_session_ok נגישה למחובר)
- [x] בדיקות RLS אמיתיות מול המסד (anon → 401)
- [x] סריקת תלויות (npm audit חסום בסביבה) + בדיקת xlsx
- [x] עדכון מסמכי מוכנות/פיצ׳רים
- [x] דוח סיום. נשאר dry_run.

## סבב סגירה — כרטיס בקשה, מחיקה רכה, הרשאות DB, outbox, תיוגים (dry_run נשמר)
- [ ] מיגרציה א: REVOKE TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, RPC INVOKER, mail_thread_state, profiles לעמודות בלבד
- [ ] מיגרציה ב: system_requests — intent שם מערכת + snapshot אישור root + soft delete + RPCs
- [ ] מיגרציה ג: note_mentions + mention_email_deliveries + RPCs + mention_queue_url
- [ ] מיגרציה ד: set_user_role_atomic
- [ ] מיגרציה ה: voice sending/unknown
- [ ] מיגרציה ו: email_deliveries outbox
- [ ] report_description: parser (שרת + Apps Script) עוצר רק על כותרות מוכרות; הצגה בכרטיס מערכת; rescan error
- [ ] כרטיס בקשה קומפקטי + Tooltip/aria
- [ ] שם מערכת בבקשה: system-name-match משותף, בחירה, intent, שני מצבי root
- [ ] מחיקה רכה + requests_delete + restore + dedup אחרי מחיקה
- [ ] rate limits לפערים (admin_integrations, crm, history_edit, status delete, request_delete, mention)
- [ ] outbox מייל רגיל עם idempotency key עמיד (sessionStorage)
- [ ] voice: sending/unknown, stale sending לא פונה לספק
- [ ] createUser פיצוי, setUserRole אטומי
- [ ] תיוגים: MentionEditor, RPC אטומי, worker, endpoint, Apps Script send_notification, ניטור, @כולם פעילים בלבד
- [ ] כרטיס "תורי רקע" בניהול לשני התורים (endpoint, הגדרה, health)
- [ ] share archive script + בדיקה על ה-artifact
- [ ] integration tests: snapshot (קריאה) + RLS two CRMs (staging בלבד)
- [ ] מסמכים: security-expected-state, DEPLOY, production-readiness, דוח סיום
