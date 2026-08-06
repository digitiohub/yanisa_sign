# Coolify deployment guide

Deploy this repository as one Coolify **Docker Compose** resource. The `app` service serves both React UI and Express API on port `5000`; `mongo` stays private.

## Before deployment

- Commit `Dockerfile`, `docker-compose.yml`, and this repository to Git.
- Create a DNS `A`/`AAAA` record for your chosen domain, pointing to the Coolify server.
- Use a domain such as `sign.example.com`. This exact HTTPS URL becomes `APP_URL` and is placed in signer emails.

## Create resource

1. In Coolify, open your project and environment, then create a new **Docker Compose** resource from the repository.
2. Select branch and set compose file to `docker-compose.yml`.
3. Add public domain to service **app**, port `5000`.
4. Do not add a domain, port mapping, or public proxy to **mongo**.
5. Enable Coolify's HTTPS/Let's Encrypt option, then deploy.

Coolify starts both services. Named volumes `mongo-data` and `sign-storage` preserve database and PDFs across normal redeploys.

## Required Coolify environment variables

Add values in resource environment variables. Mark secrets as secret values when Coolify offers that option.

| Variable | Value |
| --- | --- |
| `MONGO_USERNAME` | Mongo admin username, e.g. `signapp` |
| `MONGO_PASSWORD` | Long random password; use letters, numbers, `_`, or `-` to avoid URI-escaping issues |
| `JWT_SECRET` | Separate random value, at least 32 characters |
| `ADMIN_EMAIL` | Initial HR admin email |
| `ADMIN_PASSWORD` | Long unique admin password |
| `APP_URL` | Final public URL, e.g. `https://sign.example.com` |

`CLIENT_URL` should remain empty when UI and API share this domain. Set it only for a separate frontend origin, including protocol, e.g. `https://hr.example.com`.

## Email settings

SMTP required before sending signing requests in production:

| Variable | Typical value |
| --- | --- |
| `SMTP_HOST` | Mail provider SMTP host |
| `SMTP_PORT` | `587` for STARTTLS or `465` for TLS |
| `SMTP_USER` / `SMTP_PASSWORD` | SMTP credentials |
| `SMTP_SECURE` | `false` with port `587`; `true` with port `465` |
| `MAIL_FROM_NAME` | `Yanisa HR` |
| `MAIL_FROM_EMAIL` | Verified sender address |
| `HR_NOTIFICATION_EMAIL` | Optional completion-notice inbox |

Optional runtime variables: `MAX_PDF_SIZE_MB` (default `20`), `DEFAULT_SIGN_VALID_DAYS` (default `7`), and `SIGN_CERTIFICATE_ENABLED` (`false` disables certificates).

## Verify after deploy

1. Open `https://your-domain/api/health`; expected response includes `"ok": true` and `"database": "connected"`.
2. Open root URL; login page should load.
3. Log in with initial admin credentials.
4. Upload a test PDF and send it to a controlled email address. Confirm signing link begins with exact `APP_URL` and email arrives.

If deployment fails, check Coolify logs first. Missing required variables are reported during Compose interpolation; Mongo startup failures usually mean `MONGO_PASSWORD` differs from value used when volume was first initialized.

## Backups, updates, recovery

- Back up both Docker volumes: `mongo-data` (records, signer tokens, audit history) and `sign-storage` (original, signed, certificate PDFs).
- Test restore procedure on non-production server before relying on backups.
- Normal git-based redeploys retain named volumes. Do not use Coolify's destructive volume cleanup unless you intend permanent data loss.
- Changing `MONGO_USERNAME` or `MONGO_PASSWORD` after first Mongo initialization does not update existing Mongo credentials. Keep them stable, or rotate credentials manually inside Mongo first.
- Rotate `JWT_SECRET` only with a planned logout window; all active admin sessions become invalid.
