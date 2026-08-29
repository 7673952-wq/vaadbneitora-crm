# סבב סגירה לפני DRY RUN אמיתי

בדקתי את 20 הסעיפים מול הקוד ומול מסד הנתונים. **כמעט כל הממצאים נכונים.** להלן מה אימתתי, ומה בכל זאת לא מדויק.

## מה אומת כנכון

- `CrmTabs` מקבל `isAdmin` ובמסך `_authenticated/route.tsx` מועבר `me.isSuperAdmin` — אין הרשאות בקשות ייעודיות (שורה 211).
- יש כפילות: `PERMISSION_DEFINITIONS` ב-`permissions.server.ts` מול `PERMISSION_KEYS` ב-`admin.functions.ts` (שורות 48-53), וגם רשימות ברירת מחדל כפולות.
- הרשאות שרת: `saveRequestRule` / `deleteRequestRule` / `setRequestAutomationSettings` דורשים `settings_manage`, ו-`getRequestAudio` דורש `systems_read` בלבד.
- RLS: `system_requests` פתוחה ל-SELECT לכל חבר CRM; `system_request_rules` פתוחה ל-ALL ל-admin/super_admin ול-SELECT לכל חבר CRM.
- `findSystemsByNormalizedCode` אכן מושך `limit(2000)` ומסנן ב-JS.
- `in_progress` מוחזר כ-`{ ok: true, skipped: true }`.
- ב-Apps Script קיים סוד קשיח כ-fallback, התגיות מוגדרות `pticha` / `sgira`, ה-cursor מתקדם גם כש-`stats.failed > 0`, ומנגנון `rq_<messageId>` פעיל ב-Script Properties.
- `name_pending` נכתב ב-`system-requests.server.ts` ואינו בשימוש באף מסך.
- אין רצועת סיכום בדשבורד ואין מקטע "בקשות אחרונות" בכרטיס מערכת.
- `RequestAutomationPanel` יושב תחת ניהול → כללי → הגדרות כלליות.

## הערה אחת שאינה מדויקת

- `markRead` בסקריפט קיים כפעולת `doPost` לזרימת המיילים הרגילה, אך לא מופעל בזרימת הבקשות. כלומר לא "חסר לגמרי" — רק לא מחובר לזרימה החדשה, ואחבר אותו לפי החוזה החדש.

## מה אבצע

**הרשאות (1-4, 6, 7)**
- מקור אמת אחד להרשאות: `PERMISSION_DEFINITIONS` יישאר היחיד, ו-`admin.functions.ts` ייגזר ממנו (`PERMISSION_KEYS` יהפוך לנגזרת) — כולל ברירות מחדל לפי תפקיד.
- שלוש הרשאות חדשות: `requests_view`, `requests_decide`, `requests_manage`. ברירת מחדל: פעילות ל-super_admin בלבד.
- אכיפה בשרת: `listSystemRequests` + `getRequestAudio` → `requests_view`; `decideSystemRequest` → `requests_decide`; כללים והגדרות → `requests_manage`. פונקציית read-only קטנה שמחזירה רק את מצב האוטומציה למי שיש `requests_view`.
- מיגרציה: ביטול SELECT ישיר של `authenticated` על `system_requests`, וצמצום `system_request_rules` לקריאה/כתיבה דרך שרת בלבד.
- העברת `RequestAutomationPanel` לטאב CRM "ימות המשיח" תחת "אוטומציית בקשות", מוצג רק עם `requests_manage`.
- מסך `/requests`: חסימה ללא `requests_view`; ללא `requests_decide` — תצוגה והשמעה בלבד; קישור להגדרות רק עם `requests_manage`.

**לשונית ותג (5)**
- `CrmTabs` יקבל `canRequests`, `canAdmin`, `canMail`, `pendingRequestsCount`. Server function שעושה count בלבד (`crm_key='yemot'`, `needs_decision`, `processing_state='done'`), רענון כל 60 שניות, `99+`, ללא badge כשאפס, ו-invalidate אחרי החלטה.

**אמינות הקליטה (10-16)**
- הסקריפט ישלח `sourceRequestType` ו-`sourceLabel`; בשרת התגית היא המקור הראשי, ואי-התאמה מול התוכן → `needs_decision` עם הסבר, ללא ברירת מחדל `pticha`.
- חוזה חדש: `in_progress` יחזיר `{ ok: false, retry: true }`; הסקריפט יסמן `markRead` רק על `completed=true` / `processing_state='done'` (כולל duplicate שכבר done), ולא על failed/in_progress.
- Cursor לא יתקדם כאשר `stats.failed > 0` או timeout; הסרת מנגנון `rq_<messageId>` (הייחודיות במסד היא מקור האמת) + ניקוי מפתחות ישנים.
- חיפוש מערכת יעבור ל-RPC במסד לפי מפתח ההשוואה, עם אינדקס רגיל על כל `systems` בנוסף לאינדקס הייחודי החלקי. 0/1/רבים → מסלול חדש / המשך / needs_decision.
- State machine אמיתי: `applied` → לא לבצע match ולא להריץ כללים מחדש, להשלים רק תופעות לוואי; `matched` → שימוש ב-`proposed_action`/`proposed_status`/`rule_id` השמורים. תוספת עמודה `side_effects_completed_at`.

**Secret ותגיות (8-9)**
- הסרת ה-fallback: `CRM_SECRET` מ-Script Properties בלבד, אחרת שגיאת הגדרה ברורה בלי ביצוע ובלי הדפסת הסוד.
- שמות התגיות מ-Script Properties: `CRM_PTICHA_LABEL` / `CRM_SGIRA_LABEL` עם ברירות מחדל "מספרים לפתיחה" / "מספרים לחסימה".
- מכיוון שהסוד היה בקוד — אחליף אותו לסוד חדש בצד השרת ואספק לך אותו להזנה ב-Script Properties.

**UI (17-19)**
- באנר "שם זמני" בכרטיס מערכת עם כפתור השמעה למי שיש `requests_view`, ואיפוס `name_pending=false` בעדכון שם ידני.
- מקטע "בקשות אחרונות" בכרטיס מערכת (סוג, מספר בקשה, פונה, מועד, החלטה, `proposed_action`, סטטוס קודם/מוצע, מי החליט, השמעה) — רק עם `requests_view`.
- רצועת סיכום קומפקטית בראש הדשבורד (נקלטו היום / טופלו אוטומטית / דורשים החלטה, עם קישור ל-/requests) — merge נקודתי בלבד.

**בדיקות (20-21)**
- בדיקות לפרסר מול המייל האמיתי, אי-התאמת תגית/תוכן, 0/1/רבים התאמות, אפס מוביל, duplicate, `in_progress` שאינו הצלחה, retry אחרי `status_applied_at`/`phone_added_at`, ובדיקות הרשאה לכל אחד מהתרחישים.
- בסיום: tests, TypeScript, build, רשימת מיגרציות וקבצים, ואימות שהמצב נשאר `dry_run`. **לא אעבור ל-live.**

## פרטים טכניים

- מיגרציות: (א) הרשאות ומדיניות — ביטול GRANT/policy ישירים על `system_requests` ו-`system_request_rules`; (ב) `side_effects_completed_at` + אינדקס match-key על `systems` + RPC חיפוש; (ג) שורות ברירת מחדל לשלוש ההרשאות החדשות.
- קבצים עיקריים: `src/lib/permissions.server.ts` (מקור אמת), `src/lib/admin.functions.ts`, `src/lib/system-requests.functions.ts`, `src/lib/system-requests.server.ts`, `src/components/CrmTabs.tsx`, `src/routes/_authenticated/route.tsx`, `requests.tsx`, `admin.tsx`, `systems.$id.tsx`, `dashboard.tsx`, `apps-script/email-relay.gs` (v21, merge נקודתי בלבד).
