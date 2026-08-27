# תוכנית: ביקורת קלוד, אוטומציית מיילי פתיחה/סגירה, ושליחה קולית לפי סטטוס

## חלק א׳ — מה מהדו"ח של קלוד באמת שווה ביצוע

בדקתי בפועל בקוד. הסיווג שלי:

| ממצא | בדיקה בפועל | המלצה |
|---|---|---|
| טבלאות ללא Policies (mfa_*, otp, rate limits) | נכון ומכוון — נגישות רק דרך service role | לא לגעת |
| `readStatusSettings` עם `context.supabase` ב-3 מקומות | נכון (systems.functions 1079/2285, audit.functions 82). לא באג פעיל — המקור הוא `app_settings` | לתקן, זול: להעביר ל-`supabaseAdmin` בתוך ה-handler |
| עימוד להערות/מעברים "לא בוצע" | **שגוי** — `listSystemNotes` קיים ומעמד | לא לבצע |
| `confirm()` במקום Undo — 8 מופעים | נכון | דחייה: משפר UX אבל לא קריטי. לא בסבב הזה |
| `dashboard_saved_views` לא מחוברת ל-UI | נכון (רק בגיבויים) | להשאיר; תשמש בהמשך או תימחק בהחלטה נפרדת |
| תיעוד `.lovable/features.md` / `production-readiness.md` מיושן | נכון | לעדכן — זול ומונע החלטות שגויות |
| 751 מופעי `any` | נכון | לא כדאי כסעיף עצמאי; לצמצם תוך כדי עבודה |

**מה אבצע מחלק א׳:** עקביות `readStatusSettings` + עדכון שני מסמכי התיעוד. השאר — לא.

---

## חלק ב׳ — שינוי ההודעה הקולית האוטומטית (הבקשה השלישית שלך)

### הבעיה היום
הסימון "נשלח" הוא חד-פעמי לכל פונה: `systems.voice_message_sent_at` לפונה הראשי, ו-`sent_at` בכל רשומה ב-`additional_caller_phones`. הוא **לא מתאפס בשינוי סטטוס**, ולכן פונה שקיבל הודעה על סטטוס קודם לעולם לא יקבל על החדש.

### התיקון
לזכור **לאיזה סטטוס** נשלחה ההודעה, לא רק מתי:
- עמודה חדשה `systems.voice_message_sent_status` (טקסט) לפונה הראשי.
- שדה `sent_status` בתוך כל רשומה ב-`additional_caller_phones` (JSONB — אין צורך במיגרציה למבנה).
- `autoSendUnsentVoiceMessages` יבחר יעדים לפי `sent_status !== הסטטוס הנוכחי` במקום "אין sent_at".
- בשינוי סטטוס (`updateSystem`) — אם הסטטוס החדש שונה מהקודם ומוגדר לשליחה אוטומטית, כל הפונים שטרם קיבלו הודעה **על הסטטוס הזה** נכנסים לשליחה (מיידית בתוך חלון השעות, או לתור).
- בכרטיס המערכת יוצג ליד כל פונה "נשלח: <תווית סטטוס> בתאריך…", וכפתור השליחה יסומן כפעיל כשהפונה טרם קיבל את הסטטוס הנוכחי.
- הגנת הכפילות הקיימת (`bump_rate_limit` לפי מספר טלפון) נשארת כמות שהיא.

---

## חלק ג׳ — מסמך תכנון: אוטומציית מיילי פתיחה/סגירה (ללא ביצוע)

### הרעיון בקצרה
לא לבנות ערוץ מייל שני. הסקריפט הקיים כבר סורק כל 10 דקות, כבר יודע למנוע כפילויות (`ScriptProperties`) וכבר מדבר עם `/api/public/hooks/inbound-email`. נוסיף **וובהוק אחד נוסף** ייעודי לשתי התגיות, ו**טבלה אחת חדשה** לתור/היסטוריה, ועוד טבלה קטנה לכללים.

### זרימה
```text
Gmail (תגיות: מספרים לפתיחה / מספרים לסגירה)
  → Apps Script (כל 10 דק׳, מדלג על message-id שכבר סומן)
  → POST /api/public/hooks/system-request  (secret + rate limit)
  → פרסור נושא+גוף: סוג (pticha/sgira), מס׳ בקשה, מספר מערכת, מספר פונה
  → INSERT ב-system_requests עם UNIQUE(gmail_message_id)  ← מונע עיבוד כפול
  → התאמת מערכת לפי system_code מנורמל (אב + תת-מערכות)
       נמצאה בדיוק אחת → מנוע כללים (סוג + סטטוס נוכחי)
       לא נמצאה        → יצירה בסטטוס ברירת-מחדל לפי סוג
       נמצאה יותר מאחת → "דורש החלטה"
  → הוספת מספר פונה (ללא כפילות) + רישום ב-system_activity_log
  → תשובה ל-Script → רק אז mark as read ב-Gmail
```

### תשתית קיימת שננצל
`verifyWebhookAuth` / `timingSafeEqualStr`, `enforcePublicRateLimit`, `supabaseAdmin` בתוך handler, `bump_rate_limit` כנעילה, `normalizeAdditionalCallerPhones`, `readStatusSettings`, `system_activity_log`, מערכת ההרשאות (`role_permissions`/`user_permissions`), ותשתית ה-Apps Script + `mark_read` שכבר קיימת בו.

### שינויי בסיס נתונים (להרצה רק אחרי אישור)
1. **`system_requests`** (חדשה) — `id`, `gmail_message_id UNIQUE`, `gmail_thread_id`, `request_type` (pticha/sgira), `request_number`, `system_code_raw`, `system_code_norm`, `caller_phone`, `system_id`, `status` (auto_applied / needs_decision / ignored), `rule_id`, `prev_status`, `new_status`, `decided_by`, `decided_at`, `manual_override boolean`, `audio_attachment_id`, `received_at`, `created_at`. + GRANTs + RLS (קריאה למאומתים עם הרשאת CRM, כתיבה רק service role).
2. **`system_request_rules`** (חדשה) — `id`, `request_type`, `from_status` (null = כל סטטוס), `action` (`set_status` / `keep` / `needs_decision` / `ignore`), `to_status`, `is_active`, `sort_order`. מנהל עורך אותה במסך ניהול. אין כללים תואמים → `needs_decision` (לא לנחש).
3. `systems.voice_message_sent_status` (מחלק ב׳).
4. אינדקס על `systems.system_code` מנורמל לשליפה בטוחה.

### החלטות מפתח
- **מניעת עיבוד כפול:** ה-UNIQUE על `gmail_message_id` הוא הסמכות, לא מצב "נקרא" ב-Gmail. `mark_read` רק אחרי 200 מהשרת.
- **מניעת מערכת כפולה:** אינדקס ייחודי + `INSERT … ON CONFLICT DO NOTHING` על `system_code` ברמת האב, ואז קריאה חוזרת של השורה.
- **מספרי פונה:** השוואה על ספרות בלבד; אין ראשי → נכנס ל-`caller_phone`; אחרת מתווסף ל-`additional_caller_phones` רק אם אינו קיים.
- **הקלטה:** לא נשמרת ב-Supabase. נשמרים רק `gmail_message_id` + `attachment_id`; לחיצה על "השמע" קוראת לפונקציית שרת שמושכת מה-Apps Script (סוד בצד שרת) ומזרימה לדפדפן. אין הצטברות קבצים.
- **Audit:** אין טבלה שלישית — `system_requests` היא היסטוריית הבקשות, וכל שינוי סטטוס נרשם כרגיל ב-`system_activity_log` עם `reason` = "בקשה אוטומטית #<מס׳>". כך אין כפילות.
- **שינוי כללים:** משפיע רק על בקשות חדשות. כפתור נפרד "הרץ מחדש על הממתינות". "שמור החלטה זו ככלל" בתור הנציג — יוצר שורה ב-`system_request_rules`.

### UI
- **דשבורד:** רצועת בקרה דקה בראש הדשבורד הקיים (merge נקודתי, לא החלפת קובץ): "נקלטו היום / טופלו אוטומטית / דורשים החלטה". לחיצה פותחת מסך תור נפרד `/requests`. המערכות עצמן נשארות בתצוגה הרגילה לפי סטטוס.
- **כרטיס מערכת:** טאב/מקטע "בקשות" עם היסטוריה מלאה (סוג, מס׳ בקשה, פונה, תאריך, החלטת האוטומציה, אם שונתה ידנית ועל ידי מי) + כפתור השמעה.
- **ניהול:** טאב "כללי אוטומציה" לעריכת המטריצה.

### מקרי קצה שזיהיתי
נושא בפורמט שונה או שדה חסר → `needs_decision` ולא ניחוש; מייל ישן שמגיע אחרי שינוי סטטוס ידני; אותה בקשה נשלחת גם כפתיחה וגם כסגירה; מספר מערכת עם אפסים מובילים/מרווחים; התאמה לשתי מערכות (אב+תת) → החלטת נציג; timeout של Apps Script אחרי שהשרת כבר כתב (מכוסה ע"י ה-UNIQUE); מערכת שנמחקה; הקלטה שנמחקה מ-Gmail; פונה שכבר קיים בתת-מערכת אחרת.

### סיכונים
עדכון סטטוס שגוי במערכת לא נכונה (מנוטרל ע"י התאמה מחמירה + `needs_decision`); הצפת התור אם הכללים חסרים (מקובל — עדיף על טעות); תלות ב-Apps Script כנקודת כשל יחידה.

### קבצים שישתנו/ייווצרו (לא כעת)
חדשים: `src/routes/api/public/hooks/system-request.ts`, `src/lib/system-requests.functions.ts`, `src/lib/system-requests.server.ts` (פרסור + מנוע כללים + טסטים), `src/routes/_authenticated/requests.tsx`.
Merge נקודתי: `apps-script/email-relay.gs`, `dashboard.tsx` (רצועה בלבד), `systems.$id.tsx` (מקטע בקשות), `admin.tsx` (טאב כללים), `systems.functions.ts`.

### הפתרון שאני ממליץ עליו
**וובהוק ייעודי אחד + טבלת `system_requests` כמקור אמת ותור + טבלת כללים שהמנהל עורך.** למה: משתמש בכל התשתית הקיימת (סקריפט, אימות וובהוק, rate limit, יומן פעילות), מוסיף שכבה אחת בלבד, מניעת הכפילות נשענת על אילוץ בבסיס הנתונים ולא על מצב ב-Gmail, וההקלטות נשארות ב-Gmail בלי אחסון.

---

## סדר עבודה מוצע
1. חלק ב׳ (הודעה קולית לפי סטטוס) — קטן ומיידי.
2. חלק א׳ (עקביות + תיעוד).
3. חלק ג׳ — רק אחרי שתאשר את התכנון: מיגרציות → פרסור+מנוע כללים עם טסטים → וובהוק → תור נציג → דשבורד/כרטיס/ניהול → סקריפט Gmail → הפעלה.
