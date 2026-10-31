# Salon Application — Submission Build

## Project
Vynster / MedhikaArts Salon Management & Online Booking System

## Verified before submission
- Node.js backend syntax: PASS
- Frontend inline JavaScript syntax sweep: PASS (79 scripts checked)
- Server startup: PASS on port 5000
- `/api/ping`: PASS
- Public services API: PASS
- Public staff API: PASS
- Branch/search APIs: PASS
- Authenticated clients API: PASS
- Authenticated staff API: PASS
- Authenticated bookings API: PASS
- Authenticated inventory API: PASS
- Authenticated expenses API: PASS
- Public booking validation: PASS
- Booking create → retrieve → delete integration test: PASS
- Protected client API rejects unauthenticated access: PASS
- Environment secret file excluded from this submission package
- `node_modules` excluded; run `npm install` before starting

## Run locally
1. Copy `.env.example` to `.env`.
2. Set a secure `JWT_SECRET` (32+ characters).
3. Set `MONGODB_URI` if MongoDB is required. The application has a local `db.json` fallback.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:5000/`.

## Important
Never submit or commit `.env`. Keep production credentials in the deployment platform's environment-variable settings.

## Final release hardening
- WhatsApp disconnect/logout endpoint requires authenticated Super Admin/Owner/Manager access.
- WhatsApp dashboard sends the admin bearer token for disconnect requests.
- QA/test booking records removed from the packaged local database snapshot.
- No `.env` or production secret file is included.
