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
- [ ] auto-assign: שגיאת RPC עוצרת; reminder_agent_ids מתעדכן גם כשהנציג זהה
- [ ] הורה/תתי-מערכות: שינוי נציג לא משנה סטטוס
- [ ] יצירת מערכת מבקשה — אטומית/retry בטוח
- [ ] escaping HTML בפלט Apps Script/ייצוא
- [ ] rate limit מבוסס DB + בדיקת error
- [ ] ביקורת RLS מול הרשאות שרת (profiles, role_permissions, user_permissions, notification_role_defaults)
- [ ] סקירת SECURITY DEFINER
- [ ] בדיקות RLS אמיתיות
- [ ] npm audit (+ --omit=dev), בדיקת xlsx
- [ ] עדכון מסמכי מוכנות/פיצ'רים
- [ ] דוח סיום. נשאר dry_run.
