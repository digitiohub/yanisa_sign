# Yanisa Sign

React/Vite frontend and Express API packaged as one production container, with MongoDB provided by Docker Compose.

## Local development

```bash
npm install
cd client && npm install
cd .. && npm run dev
```

The frontend runs at `http://localhost:5173` and proxies `/api` to Express on port `5000`.

## Deploy with Coolify

1. Push this directory to a Git repository and create a **Docker Compose** resource in Coolify.
2. Set the compose file to `docker-compose.yml`.
3. Add these environment variables in Coolify:
   - `MONGO_USERNAME` — for example, `signapp`
   - `MONGO_PASSWORD` — a long random password (avoid URL-reserved characters)
   - `JWT_SECRET` — a separate long random value
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD` — standalone HR administrator login
   - `APP_URL` — the final public HTTPS URL used in signing emails
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`
   - `HR_NOTIFICATION_EMAIL` — recipient for completion notices
   - `CLIENT_URL` — optional; leave empty when the UI and API use the same domain
4. Assign your public domain to the `app` service on port `5000`. Do not expose the `mongo` service publicly.
5. Enable HTTPS in Coolify and deploy.

The application health endpoint is `/api/health`. MongoDB data is persisted in `mongo-data`; protected original and signed PDFs are persisted in `sign-storage`. Both survive application redeployments and should be included in VPS backups.

## HRMS integration hooks

Uploads accept `relatedEntityType` and `relatedEntityId`, allowing an existing candidate or offer-letter record to be linked without exposing it publicly. The current repository does not contain HRMS candidate, offer-letter, notification, or SSO code; connect those hooks to the parent HRMS when that codebase is supplied. Replace the standalone administrator login with the parent application's JWT/SSO claims while retaining the `sign.*` permission checks.

## Production behavior

The Docker image builds the Vite app, installs production-only server dependencies, runs as the non-root `node` user, and serves both the SPA and REST API from port `5000`.

Signer links support expiry, revocation, cancellation, resend and decline. Completed PDFs are flattened and include an audit certificate unless `SIGN_CERTIFICATE_ENABLED=false`.
