# תכנון סופי — הודעה קולית לפי סטטוס + אוטומציית מיילי פתיחה/סגירה

## 1. תכנון סופי (סקירה)

שלושה גושים:
- **חלק א׳ — תיקונים קטנים מדו"ח קלוד.** בדקתי בפועל: הטבלאות ללא Policies מכוונות ותקינות; העימוד להערות **כבר קיים** (`listSystemNotes`) — הממצא שגוי; `confirm()` ו-`any` נדחים. מבצעים רק: העברת 3 קריאות `readStatusSettings` ל-`supabaseAdmin` (systems.functions 1079/2285, audit.functions 82) ועדכון `.lovable/features.md` + `production-readiness.md`.
- **חלק ב׳ — הודעה קולית: פעם אחת לכל צירוף פונה+סטטוס**, עם debounce של 90 שניות.
- **חלק ג׳ — אוטומציית מיילי pticha/sgira** מ-Gmail דרך הסקריפט הקיים, עם state machine, idempotency, מנוע כללים שהמנהל עורך, ומצב DRY RUN לפני הפעלה אמיתית.

---

## 2. מבנה טבלאות סופי

### `system_requests` (חדשה)
```
id uuid pk
crm_key text not null                      -- נכתב מפורשות בשרת, לא נשען על default
gmail_message_id text not null             -- UNIQUE
gmail_thread_id text
request_type text not null                 -- 'pticha' | 'sgira'
request_number text
system_code_raw text
system_code_norm text                      -- דרך normalizeSystemCode() בלבד
caller_phone text
caller_phone_norm text
system_id uuid references systems(id) on delete set null
processing_state text not null default 'received'   -- received|parsed|matched|done|failed
decision_status text                       -- auto_applied|kept|needs_decision|ignored|manual_applied
dry_run boolean not null default false
rule_id uuid references system_request_rules(id) on delete set null
prev_status text
proposed_status text                       -- מה הכללים החליטו (גם ב-DRY RUN)
new_status text                            -- מה בוצע בפועל
status_applied_at timestamptz              -- מפתח ה-idempotency לשינוי הסטטוס
phone_added_at timestamptz                 -- מפתח ה-idempotency להוספת הפונה
attempts int not null default 0
error_message text
attachment_name text
attachment_index int
decided_by uuid
decided_at timestamptz
received_at timestamptz
created_at / updated_at timestamptz not null default now()
```

### `system_request_rules` (חדשה)
```
id uuid pk
crm_key text not null
request_type text not null                 -- 'pticha' | 'sgira'
from_status text                           -- NULL = כלל ברירת מחדל
action text not null                       -- set_status | keep | needs_decision | ignore
to_status text                             -- חובה רק כאשר action='set_status'
is_active boolean not null default true
sort_order int not null default 0
created_by uuid / created_at / updated_at
```

### שינויים בטבלאות קיימות
- `systems.name_pending boolean not null default false` — `true` במערכת שנוצרה ממייל ללא שם, מתאפס ל-`false` ברגע שהנציג משנה את השם.
- אין עמודת `voice_message_sent_status` — מקור האמת לשליחות הקוליות הוא `voice_message_log` (ראה §6).

### הגדרות ב-`app_settings`
`request_automation_mode` = `off` | `dry_run` | `live` (ברירת מחדל `dry_run`), `request_default_status_pticha`, `request_default_status_sgira`, `voice_debounce_seconds` (ברירת מחדל 90).

---

## 3. Indexes ו-Constraints סופיים

```sql
-- system_requests
ALTER TABLE public.system_requests
  ADD CONSTRAINT system_requests_gmail_message_id_key UNIQUE (gmail_message_id);
ALTER TABLE public.system_requests
  ADD CONSTRAINT system_requests_type_chk CHECK (request_type IN ('pticha','sgira')),
  ADD CONSTRAINT system_requests_state_chk CHECK (processing_state IN ('received','parsed','matched','done','failed')),
  ADD CONSTRAINT system_requests_decision_chk CHECK (decision_status IS NULL OR decision_status IN
    ('auto_applied','kept','needs_decision','ignored','manual_applied'));
CREATE INDEX system_requests_queue_idx ON public.system_requests (crm_key, decision_status, received_at DESC);
CREATE INDEX system_requests_state_idx ON public.system_requests (processing_state) WHERE processing_state <> 'done';
CREATE INDEX system_requests_system_idx ON public.system_requests (system_id, received_at DESC);
CREATE INDEX system_requests_code_idx   ON public.system_requests (system_code_norm);

-- system_request_rules — כלל פעיל אחד לכל צירוף, כולל כלל ברירת המחדל (from_status IS NULL).
-- Postgres 17.6 בפרויקט → NULLS NOT DISTINCT נתמך ומטפל בדיוק במקרה הזה.
CREATE UNIQUE INDEX system_request_rules_active_uniq
  ON public.system_request_rules (crm_key, request_type, from_status)
  NULLS NOT DISTINCT
  WHERE is_active;
ALTER TABLE public.system_request_rules
  ADD CONSTRAINT rules_action_chk CHECK (action IN ('set_status','keep','needs_decision','ignore')),
  ADD CONSTRAINT rules_to_status_chk CHECK (action <> 'set_status' OR to_status IS NOT NULL);

-- systems: מניעת שתי מערכות-אב עם אותו מספר מנורמל (תת-מערכות עם אותו מספר נשארות מותרות)
CREATE UNIQUE INDEX systems_root_code_norm_uniq
  ON public.systems (regexp_replace(system_code, '\D', '', 'g'))
  WHERE parent_system_id IS NULL;

-- voice_message_log: שליפה מהירה של "האם הפונה הזה כבר קיבל את הסטטוס הזה"
CREATE INDEX voice_log_dedupe_idx
  ON public.voice_message_log (system_id, phone, status_key) WHERE success;
```
בדקתי לפני התכנון: 6 מערכות, 6 מספרים מנורמלים ייחודיים — **אין כפילויות**. הבדיקה תוצג לך שוב רגע לפני הרצת המיגרציה.

RLS: קריאה למאומתים עם `has_crm_access(auth.uid(), crm_key)`; עריכת כללים רק להרשאת ניהול; כתיבה מהוובהוק דרך service role בלבד. GRANTs מלאים ל-`authenticated` (קריאה) ו-`service_role`.

---

## 4. State machine סופי

שני צירים נפרדים, כפי שביקשת:

```text
processing_state:  received → parsed → matched → done
                              ↘ failed (עם error_message, attempts++) → ניסיון חוזר ממשיך מהשלב שנעצר

decision_status:   auto_applied | kept | needs_decision | ignored | manual_applied
```
- קליטה שהצליחה אך אין כלל מתאים → `processing_state = done` + `decision_status = needs_decision`. **Gmail מסומן כנקרא** — הקליטה הצליחה, רק ההחלטה ממתינה.
- `mark_read` נשלח אך ורק כשהתשובה היא `processing_state = done`.
- `failed` → לא מסומן כנקרא; הסריקה הבאה מנסה שוב.

---

## 5. מנגנון Idempotency סופי

מפתח הפעולה: `system_requests.id` (שנגזר חד-חד-ערכית מ-`gmail_message_id` דרך ה-UNIQUE). כל שלב בודק חותמת לפני שהוא פועל:

| פעולה | הגנה |
|---|---|
| כתיבת הבקשה | `INSERT … ON CONFLICT (gmail_message_id) DO NOTHING RETURNING *`, ואם ריק — קריאה של השורה הקיימת |
| שתי הרצות במקביל | נעילת `bump_rate_limit('req:<message_id>', 60)` — השנייה מקבלת skip |
| יצירת מערכת | `INSERT … ON CONFLICT` על `systems_root_code_norm_uniq` `DO NOTHING`, ואז `SELECT` חוזר |
| הוספת מספר פונה | מבוצע רק אם `phone_added_at IS NULL`; ובנוסף השוואת ספרות מול `caller_phone` + `additional_caller_phones` לפני הוספה |
| שינוי סטטוס | מבוצע רק אם `status_applied_at IS NULL`; העדכון עצמו הוא `UPDATE … WHERE id = ? AND status = prev_status` (compare-and-set) |
| `system_activity_log` | נכתב ע"י הטריגר הקיים רק כשהסטטוס באמת השתנה — compare-and-set מונע רשומה כפולה |
| החלטה ידנית | `UPDATE … WHERE id = ? AND decision_status = 'needs_decision'` — שנייה לא תחול |
| שמירת כלל מהחלטת נציג | `INSERT … ON CONFLICT` על `system_request_rules_active_uniq` `DO UPDATE` |

תרחישים שביקשת:
- **א. הסטטוס שונה אך השרת נפל לפני `done`:** `status_applied_at` כבר נכתב באותה טרנזקציה עם העדכון, לכן הניסיון החוזר מדלג על שינוי הסטטוס וממשיך לשלב הסיום בלבד.
- **ב. הפונה נוסף והשלב הבא נכשל:** `phone_added_at` מסומן; הריצה הבאה לא תוסיף שוב ותמשיך משינוי הסטטוס.
- **ג. אותה בקשה חוזרת אחרי timeout:** אם `done` → `{ok:true, duplicate:true}` ו-`mark_read`; אחרת המשך מהשלב שנעצר, כל פעולה מוגנת בחותמת שלה.

---

## 6. מנגנון הודעה קולית סופי

**מקור האמת: `voice_message_log` הקיים** — צדקת. הוא כבר רושם `system_id`, `phone`, `status_key`, `success`, ולכן "האם הפונה הזה כבר קיבל את הסטטוס הזה" הוא שאילתה ישירה. זה עדיף על עמודה "הסטטוס האחרון שנשלח", שהייתה שולחת שוב בחזרה ל-A. לא נוסיף `voice_message_sent_status`.

- **כשירות לשליחה:** אין שורה ב-`voice_message_log` עם `success = true` לאותו `system_id` + `phone` (מנורמל לספרות) + `status_key` הנוכחי. אינדקס `voice_log_dedupe_idx` תומך בזה.
- `voice_message_sent_at` ו-`sent_at` שב-`additional_caller_phones` נשארים לתצוגה בלבד ("נשלח לאחרונה"), לא כתנאי שליחה.
- **Debounce:** שינוי סטטוס (ידני או אוטומטי) קובע `pending_voice_send_at = now + voice_debounce_seconds` (90 כברירת מחדל, ניתן להגדרה, 0 = מיידי). מעבד התור הקיים קורא מחדש את הסטטוס לפני השליחה ושולח רק לפי המצב העדכני. שליחה ידנית מהכרטיס — מיידית, ללא debounce, עם אישור אם כבר נשלח.
- חלון השעות ונעילת `bump_rate_limit` לפי טלפון — נשארים כמות שהם.

---

## 7. קבצים שישתנו
`src/lib/systems.functions.ts` (חילוץ `applySystemStatusChange`, כשירות שליחה מ-`voice_message_log`, debounce), `src/lib/status-settings.ts` (שדה השהיה), `src/lib/audit.functions.ts` (`supabaseAdmin`), `apps-script/email-relay.gs` (סריקת שתי התגיות לפי cursor, `get_attachment`, `mark_read` מותנה), `src/routes/_authenticated/dashboard.tsx` (רצועת בקרה בלבד), `src/routes/_authenticated/systems.$id.tsx` (מקטע "בקשות" + באנר `name_pending`), `src/routes/_authenticated/admin.tsx` (טאב כללים + מצב אוטומציה), `.lovable/features.md`, `.lovable/production-readiness.md`.

## 8. קבצים חדשים
`src/lib/system-code.ts` (**פונקציית נרמול יחידה** — ספרות בלבד, ללא היפוך וללא התאמה משוערת; משמשת בפרסור, בחיפוש, ביצירה, בבדיקת כפילויות ובאינדקס), `src/lib/system-requests.server.ts` (פרסור + מנוע כללים + idempotency), `src/lib/system-requests.functions.ts` (תור, החלטות, השמעת הקלטה), `src/routes/api/public/hooks/system-request.ts`, `src/routes/_authenticated/requests.tsx`, `src/lib/system-requests.test.ts`.

## 9. רשימת Migrations
1. `systems.name_pending` + `voice_log_dedupe_idx` (לחלק ב׳).
2. בדיקת כפילויות → `systems_root_code_norm_uniq`.
3. `system_request_rules` + GRANTs + RLS + `NULLS NOT DISTINCT` unique.
4. `system_requests` + GRANTs + RLS + אינדקסים + CHECKs.
5. זריעת ברירות מחדל ב-`app_settings` (`request_automation_mode = 'dry_run'` וכו׳).

## 10. מקרי קצה
נושא בפורמט שונה/שדה חסר → `needs_decision`; יותר מהתאמה אחת (אב + תת) → `needs_decision`, לעולם לא ניחוש; מייל ישן שמגיע אחרי שינוי ידני → compare-and-set נכשל → `needs_decision`; אותה בקשה כפתיחה וגם כסגירה; אפסים מובילים/רווחים → מטופל בנרמול היחיד; מערכת שנמחקה → `failed` עם הודעה ברורה; הקלטה שנמחקה מ-Gmail → "ההקלטה אינה זמינה עוד ב-Gmail"; פונה שכבר קיים בתת-מערכת אחרת; חוסר הגדרת סטטוס ברירת מחדל → לא יוצרים מערכת, `needs_decision`.

**השמעת הקלטה:** `gmail_message_id` → פונקציית שרת מאומתת → Apps Script → Gmail. אימות MIME (audio/* בלבד), מגבלת גודל 15MB, הודעה ברורה כשהקובץ חסר, אין שמירה ב-Supabase, הסוד נשאר בצד שרת בלבד.

## 11. תוכנית בדיקות
בדיקות יחידה: נרמול מספר מערכת, פרסור נושא+גוף (כולל פורמטים פגומים), מנוע כללים (כלל מדויק גובר על ברירת מחדל, אין כלל → `needs_decision`), כשירות שליחה קולית (A→B→A לא שולח A פעמיים). בדיקות אינטגרציה: הרצת אותו payload פעמיים ושלוש פעמים, קריסה מדומה בכל שלב, שתי בקשות במקביל לאותו מספר מערכת. בדיקות ידניות: DRY RUN על מיילים אמיתיים והשוואת ההחלטה המוצעת מול החלטת אדם.

## 12. סדר ביצוע
1. הודעה קולית לפי סטטוס + debounce + מניעת שליחה חוזרת לאותו פונה על אותו סטטוס.
2. תיקוני חלק א׳.
3. Migrations של אוטומציית המייל.
4. פרסור + מנוע כללים + בדיקות אוטומטיות.
5. Webhook + state machine + idempotency.
6. הפעלה ב-DRY RUN בלבד.
7. בדיקה על מיילים אמיתיים.
8. תור "דורש החלטה" + מסך כללים + כרטיס מערכת + רצועת דשבורד.
9. רק אחרי אישור מפורש שלך — מעבר ל-`live` והפעלת שינויי סטטוס אוטומטיים.

---

לא ביצעתי שום שינוי בפרויקט. ממתין לאישור לביצוע.
