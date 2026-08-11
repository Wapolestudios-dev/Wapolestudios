# WAPOLE STUDIOS — Order Website

## Requirements
- Node.js 18+
- npm

## Setup
1. Copy `.env.example` to `.env`.
2. Set a strong `ADMIN_PASSWORD` and `SESSION_SECRET`.
3. Put the **actual Wapole Studios logo supplied by the owner** at:
   `public/assets/wapole-logo.png`
   Do not replace it with a generated logo.
4. Install and start:
   `npm install`
   `npm start`
5. Open `http://localhost:3000`.

## Admin
Open `/admin` and use the credentials from `.env`.

## Production notes
- Serve over HTTPS.
- Use a reverse proxy such as Nginx.
- Keep `private/` outside any public/static directory (already done).
- Back up `private/wapole.db`, `private/uploads/`, and `private/completed/`.
- Change the default admin credentials before deployment.
- For multi-server deployment, move SQLite/files to managed persistent storage.
