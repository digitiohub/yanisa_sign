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

Full setup, environment table, post-deploy checks, backup and upgrade notes: [COOLIFY.md](COOLIFY.md).

The application health endpoint is `/api/health`. MongoDB is deployed as its own Coolify resource; protected original and signed PDFs persist in the app resource's `sign-storage` volume. Back up both resources.

## HRMS integration hooks

Uploads accept `relatedEntityType` and `relatedEntityId`, allowing an existing candidate or offer-letter record to be linked without exposing it publicly. The current repository does not contain HRMS candidate, offer-letter, notification, or SSO code; connect those hooks to the parent HRMS when that codebase is supplied. Replace the standalone administrator login with the parent application's JWT/SSO claims while retaining the `sign.*` permission checks.

## Production behavior

The Docker image builds the Vite app, installs production-only server dependencies, runs as the non-root `node` user, and serves both the SPA and REST API from port `5000`.

Signer links support expiry, revocation, cancellation, resend and decline. Completed PDFs are flattened and include an audit certificate unless `SIGN_CERTIFICATE_ENABLED=false`.
