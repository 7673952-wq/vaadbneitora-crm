# סבב תיקונים אחרון לפני DRY RUN אמיתי

בדקתי את הסעיפים מול הקוד והמסד לפני הכתיבה. להלן מה שאושר, מה שכבר תקין, ומה שאבצע.

## מה שאומת בפועל

- **סעיף 2 נכון ומסוכן.** ה-CHECK במסד מתיר רק `set_status | keep | needs_decision | ignore`. הערך `create_system` שהקוד מנסה לשמור ב-DRY RUN נדחה — וכיוון ש-`finish()` לא בודק שגיאות, העדכון נכשל בשקט והבקשה מוחזרת כאילו הצליחה. סעיפים 2 ו-3 הם למעשה אותה תקלה.
- **סעיף 13 כבר תקין.** שני ה-webhooks בסקריפט כבר מפנים ל-`vaadbneitora-crm.vercel.app`. האזכור של lovable קיים רק בהערה היסטורית בראש הקובץ — אשאיר.
- **סעיף 9 נכון.** `syncRequestLabel_` קורא `GmailApp.search(query, 0, 100)` בלי עימוד.
- **סעיף 10 חלקית.** יש `msg.markRead()` בתוך try ריק שבולע כשל — יתוקן.
- **סעיף 15 נכון.** השיוך האוטומטי מעדכן `assigned_agent_id` ישירות, ולכן נרשם גם ב-`system_activity_log` וגם ב-`system_transfers` בלי שום סימון שמבדיל אותו משינוי ידני.

## מסד נתונים (מיגרציה אחת)

- החלפת `system_requests_proposed_action_chk` בגרסה שמתירה גם `create_system` (drop + create באותה מיגרציה, בלי חלון בלי constraint).
- הוספת סימון מקור לשיוך אוטומטי: `system_transfers.reason` יקבל את הערך הקבוע `__auto_status_assignment__`, וב-`system_activity_log` ה-trigger יסמן את שורת ה-`assigned_agent_id` באותו `reason` כשה-`app.change_reason` הוא הסימון הזה. אין מחיקת היסטוריה — רק סינון בתצוגה.

## צד שרת — זרימת הבקשות

- `finish()` יבדוק `error` ויזרוק. `completed=true` רק אחרי כתיבה מוצלחת.
- כל RPC (`add_request_caller_phone`, `apply_request_status_change`, `find_systems_by_code_key`, `bump_rate_limit`) יבדוק `error`. הבחנה מפורשת: תקלה טכנית → `failed` + `retry`, לעומת CAS שהחזיר `false` בלי שגיאה → `needs_decision`.
- Resume אמיתי: כאשר `last_completed_state='matched'` לא מריצים מחדש התאמה ולא את מנוע הכללים — ממשיכים מ-`rule_id`/`proposed_action`/`proposed_status` השמורים. `status_applied_at`, `phone_added_at` ו-`side_effects_completed_at` חוסמים חזרה על השלב שלהם.
- מסלול מערכת חדשה: ב-LIVE נוצרת פעם אחת לפי `request_default_status_{pticha|sgira}`, ואינה עוברת שוב דרך מטריצת הכללים של מערכת קיימת; אחריה טלפון פונה אטומי + תופעות לוואי + סיום. ב-DRY RUN רק `proposed_action=create_system` + `proposed_status`, בלי שום כתיבה תפעולית. אין ברירת מחדל → `needs_decision`.
- `request_automation_mode` נשאר `dry_run`.

## Google Apps Script — Merge נקודתי בלבד

עריכה על הקובץ הקיים, בלי שכתוב. כל הפונקציות הקיימות (send_, reply_, backup_, markRead_, syncQuery_, applyCrmLabel_, ensureFilterForAddress_, findReplyTarget_, markThreadKnown_/isThreadKnown_, markSynced_/isSynced_, SETUP_GMAIL_FILTERS, REMOVE_ALL_CRM_FILTERS, RESET_ALL_KNOWN_THREADS, FORGET_THREAD, BACKFILL_14_DAYS, SYNC_NOW) נשארות כפי שהן, וכך גם ONLY_SYNC_CRM_THREADS, התיוג, הארכוב וה-filters.

- `doPost` יעצור מיד עם `CRM_SECRET is not configured` כשאין סוד, לפני השוואת `d.secret`. כל מסלול שקורא ל-CRM לא יבצע fetch בלי סוד. אין סוד קשיח, אין fallback, אין הדפסה ל-Logger.
- תקציב זמן משותף: `POLL_MAILBOX` יקבע `started` אחד ויעביר אותו גם ל-`syncQuery_` וגם ל-`POLL_REQUEST_LABELS`/`syncRequestLabel_`, עם תקרה של ~270 שניות ואי-התחלת עבודה חדשה כשנשאר מעט זמן.
- עימוד בסריקת התגיות: `0-99, 100-199, ...` תחת אותו תקציב זמן, בלי לקדם cursor מעבר לעמוד שלא נסרק.
- Cursor בטוח: התקדמות רק עד `lastSafeCompletedTimestamp`; `failed`/`retry`/`timeout`/`in_progress` עוצרים את הקידום.
- `markRead` בזרימת הבקשות רק כאשר `completed=true` ו-`processing_state=done` (או כפילות שכבר done). כשל ב-markRead יירשם ב-Logger, יעלה `stats.failedRead`, והמייל יישאר בטווח retry.
- `SETUP` ממשיך למחוק רק את הטריגר של `POLL_MAILBOX`.
- כיווני התקשורת נשמרים: Google → CRM ל-Vercel, CRM → Google דרך `email_relay_url`.

## כרטיס מערכת — פאנל עליון ופעילות

- הסרת `#מספר` מהפאנל העליון כדי שהשם המלא לא ייחתך.
- שכתוב תצוגת "פעילות" לקריאה נוחה: שורה אחת לכל אירוע — זמן קצר יחסי (למשל "לפני 3 שעות") + מי + מה השתנה, כשהשינוי המרכזי (סטטוס/נציג) בולט וכל השאר משני. הערות ומיילים מקבלים סגנון נפרד. הפילטרים מתקפלים לשורה אחת ולא תופסים את ראש הפאנל, ואירועים באותו רגע מאותו משתמש מקובצים לכרטיס אחד.
- שיוך נציג אוטומטי לא יוצג כאירוע נפרד — לא ב-`listSystemActivity`, לא ב-`listSystemTransfers` ולא בעימוד; רק שינוי הסטטוס מוצג. שינוי נציג ידני ממשיך להופיע.

## בדיקות וסיום

בדיקות ל-16 התרחישים שנמסרו (create_system ב-dry run, כשל finish, כשלי RPC, CAS false, resume לפי החותמות, יצירה חד-פעמית ב-live, עימוד מעל 100, cursor אחרי timeout, in_progress, כתובות ה-webhook, ושתי בדיקות הפעילות ידני/אוטומטי). בסיום: tests, TypeScript, build, בדיקת תחביר ל-`email-relay.gs`, רשימת קבצים ומיגרציות, ואימות ש-`request_automation_mode` נשאר `dry_run`.
