# מדריך פריסה (Deploy)

האפליקציה בנויה על TanStack Start + Nitro, כך שניתן לפרוס אותה
לכמה יעדים שונים על ידי שינוי משתנה הסביבה `NITRO_PRESET` בזמן ה־build.

| יעד                | NITRO_PRESET       | פלט              |
| ------------------ | ------------------ | ---------------- |
| Lovable Cloud      | `cloudflare-module` (ברירת מחדל) | `.output/` עבור Workers |
| Vercel             | `vercel`           | `.vercel/output/` |
| שרת עצמי (Docker)  | `node-server`      | `.output/server/index.mjs` |

---

## א. פריסה ל-Vercel

1. דחוף את הריפו ל-GitHub / GitLab / Bitbucket.
2. ב-Vercel → **Add New Project** → ייבוא הריפו.
3. Vercel יזהה את `vercel.json` (כבר נוצר עבורך) שמגדיר:
   - `buildCommand`: `NITRO_PRESET=vercel bun run build`
   - `installCommand`: `bun install`
   - `outputDirectory`: `.vercel/output`
4. ב-Project Settings → **Environment Variables** הוסף:
   ```
   VITE_SUPABASE_URL
   VITE_SUPABASE_PUBLISHABLE_KEY
   VITE_SUPABASE_PROJECT_ID
   SUPABASE_URL
   SUPABASE_PUBLISHABLE_KEY
   SUPABASE_SERVICE_ROLE_KEY
   BACKUP_WEBHOOK_SECRET
   WEEKLY_REPORT_EMAIL
   ```
5. לחץ **Deploy**.
6. אחרי שהאתר עולה, בדוק:
   `https://<your-app>.vercel.app/api/public/health`
   צריך לחזור: `{"ok":true,"ts":"..."}`

---

## ב. פריסה לשרת עצמי (Docker)

### דרישות מקדימות בשרת
- Docker + docker compose מותקנים
- פורט 3000 פתוח (או reverse-proxy מול nginx/Caddy ל-443)

### שלבים

1. העלה את הקוד לשרת (git clone או scp).
2. צור קובץ `.env` בתיקיית הפרויקט עם הערכים האמיתיים
   (השתמש ב-`.env.example` כתבנית).
3. בנה והפעל:
   ```bash
   docker compose up -d --build
   ```
4. בדוק שהשירות עולה:
   ```bash
   curl http://localhost:3000/api/public/health
   ```
5. עדכון לגרסה חדשה:
   ```bash
   git pull
   docker compose up -d --build
   ```

### Reverse proxy (Nginx לדוגמה)
```nginx
server {
  listen 443 ssl http2;
  server_name app.example.com;

  ssl_certificate     /etc/letsencrypt/live/app.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

  location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
  }
}
```

---

## ג. בדיקת תקינות (Health check)

נקודת קצה ציבורית, ללא אימות, להצבה בכל מנגנון ניטור:

```
GET /api/public/health  →  { "ok": true, "ts": "<ISO timestamp>" }
```

ב-Dockerfile ו-docker-compose.yml כבר מוגדר HEALTHCHECK שמשתמש בה.

---

## ד. כתובת מייל לגיבויים שבועיים

המערכת שולחת את הגיבוי השבועי עם הקישורים החתומים אל הכתובת
שמוגדרת במשתנה הסביבה `WEEKLY_REPORT_EMAIL`.

איפה זה נקרא בקוד:
- `src/routes/api/public/hooks/weekly-backup.ts` קורא ל-
  `process.env.WEEKLY_REPORT_EMAIL` בזמן הריצה.

איך לעדכן בכל סביבה:

| סביבה          | איפה לערוך                                     |
| -------------- | ---------------------------------------------- |
| Lovable Cloud  | Backend → Secrets → `WEEKLY_REPORT_EMAIL`     |
| Vercel         | Project Settings → Environment Variables       |
| שרת עצמי       | קובץ `.env` ליד `docker-compose.yml`, ואז `docker compose up -d` |

לכמה נמענים: ניתן לשים מחרוזת מופרדת בפסיקים, למשל
`admin@example.com,owner@example.com`, ולעדכן את הקוד שיפצל ויעביר
מערך כתובות ל-API של המייל. תגיד לי אם אתה רוצה שאוסיף את זה.
