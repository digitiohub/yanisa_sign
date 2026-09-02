# Yanisa Sign

React/Vite frontend and Express API packaged as one production container, with MongoDB provided by Docker Compose.

## Local development

```bash
npm install
cd client && npm install
cd .. && npm run dev
```

The frontend runs at `http://localhost:5173` and proxies `/api` to Express on port `5000`.

On first boot the server seeds the built-in roles, the default company and workspace, and one Super Admin taken from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Everyone else is invited from the UI. Documents created before multi-user support are adopted by that company automatically.

Without `SMTP_HOST`, development writes every outgoing email to `storage/dev-outbox.log` (one JSON line per message) so invitations and verification codes can be followed end to end.

## Users, roles and permissions

Five roles ship as built-ins and more can be created under Administration → Roles:

| Role | Intended for | Notably cannot |
| --- | --- | --- |
| Super Admin | Owns the organisation | — |
| Admin | Manages users, documents and templates | System settings, creating Super Admins |
| Manager | Runs a workspace | See documents outside their team |
| Editor | Prepares and sends their own documents | Manage users, delete documents |
| Viewer | Read-only on permitted documents | Create, edit, send |

Permissions are strings such as `documents.send` or `users.create`, stored per role in the database. `hasPermission` is shared by both sides: the UI hides what a user cannot do, and every API route checks the same permission again — the backend is the authority.

Document visibility follows ownership and scope: `documents.view` covers your own and explicitly shared documents, `documents.view_team` adds your workspace, and `documents.view_all` covers the whole company.

## Security model

- Passwords are bcrypt hashes; they are never returned by any endpoint, and administrators cannot see or set one. "Reset access" ends sessions and emails a fresh code instead.
- Sign-in issues a short-lived access token (Authorization header, in browser memory) plus a rotating refresh token in an HttpOnly, SameSite cookie. Nothing long-lived is kept in `localStorage`.
- Invitations, email verification, password reset and email changes all use 6-digit codes that are stored only as hashes, expire, are single-use, capped at five attempts and rate limited. A throttled request for a known address answers exactly like one for an unknown address, so the endpoint cannot be used to discover who has an account.
- Five failed sign-ins lock that account temporarily. This per-account lockout, not the looser per-IP rate limit, is the real brute-force defence, so a shared office address is never locked out by one colleague's typo. Attempts are recorded without any part of the password.
- Deactivating a user, changing their role, resetting their access or changing a password revokes the affected sessions immediately.
- Every query is scoped to the company on the authenticated session. A `companyId` supplied by the client is ignored.

## Activity and audit trail

One event stream feeds two views. **Activity** is the operational timeline (documents created, fields moved or reassigned, requests sent, signers opening and signing). **Audit** is the administrative trail (roles changed, users suspended, sessions revoked, passwords reset). Important events record `before` and `after`, and anything password-, token- or code-shaped is stripped before an event is written.

Administrators follow what their team is doing through these logs, through document timelines and through per-user detail pages — there is deliberately no screen watching or impersonation.

Useful endpoints: `GET /api/admin/activity`, `GET /api/admin/audit-logs`, `GET /api/sign/:id/activity`, `GET /api/admin/dashboard`, `GET /api/admin/online`.

## Deploy with Coolify

Full setup, environment table, post-deploy checks, backup and upgrade notes: [COOLIFY.md](COOLIFY.md).

The application health endpoint is `/api/health`. MongoDB is deployed as its own Coolify resource; protected original and signed PDFs persist in the app resource's `sign-storage` volume. Back up both resources.

## HRMS integration hooks

Uploads accept `relatedEntityType` and `relatedEntityId`, allowing an existing candidate or offer-letter record to be linked without exposing it publicly. The current repository does not contain HRMS candidate, offer-letter or notification code; connect those hooks to the parent HRMS when that codebase is supplied. To adopt the parent application's SSO, replace the credential check in `POST /api/auth/login` with the SSO claims and keep `startSession`, the role lookup and the permission middleware as they are.

## Production behavior

The Docker image builds the Vite app, installs production-only server dependencies, runs as the non-root `node` user, and serves both the SPA and REST API from port `5000`.

Signer links support expiry, revocation, cancellation, resend and decline. Completed PDFs are flattened and include an audit certificate unless `SIGN_CERTIFICATE_ENABLED=false`.

## Tests

```bash
npm test
```

Covers the permission model, password policy, email masking, audit sanitising and anonymous rejection of the protected APIs.
