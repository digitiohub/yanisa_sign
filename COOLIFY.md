# Coolify deployment — step by step

Deploy two separate Coolify resources in same project and environment:

1. MongoDB database resource.
2. Yanisa Sign Docker Compose application resource.

Do not put MongoDB into this application's Compose stack. `docker-compose.yml` deploys only app and a persistent PDF volume.

## Before starting

1. Push this repository, including `Dockerfile` and `docker-compose.yml`, to GitHub/GitLab/Bitbucket.
2. Pick public domain, for example `sign.example.com`.
3. Create DNS `A` record from `sign.example.com` to Coolify server public IP. Wait until DNS resolves.
4. In Coolify, create/select project, then open target environment, usually `production`.

Both resources must use same Coolify server/destination. Because app is Docker Compose service stack, you must also enable its **Connect to Predefined Network** setting in Step 4a. Without it, Mongo internal hostname cannot resolve.

## Service 1 — MongoDB

### 1. Create database resource

1. Click **New Resource**.
2. Select **Database**.
3. Select **MongoDB**.
4. Enter resource name, for example `yanisa-sign-mongo`.
5. Select same server/destination and `production` environment chosen above.
6. Leave **Public Port** and public access disabled.
7. Click **Deploy**.

Coolify creates persistent database storage and database credentials. You do not need to invent Mongo username or password.

### 2. Copy internal Mongo connection URL

1. Open deployed MongoDB resource.
2. Find exact Mongo root username, root password, and database resource UUID in database resource's environment variables/configuration. Copy values exactly; these are often `MONGO_INITDB_ROOT_USERNAME` and `MONGO_INITDB_ROOT_PASSWORD`.
3. Copy internal hostname exactly as Coolify displays it. Do not add a prefix or alter it. Some Coolify versions use bare resource UUID; others use a service-prefixed hostname.
4. URL-encode username and password before placing them in URL. This is required when either value contains `@`, `:`, `/`, `?`, `#`, `%`, or other reserved URL characters. In Windows PowerShell:

   ```powershell
   [uri]::EscapeDataString('PASTE_PASSWORD_HERE')
   ```

5. Build/copy internal connection URL. It looks like:

   ```text
   mongodb://USERNAME:PASSWORD@INTERNAL_HOST_FROM_COOLIFY:27017/signapp?authSource=admin&directConnection=true
   ```

6. Save this full URL privately. It becomes app's `MONGO_URI` variable.

Never use MongoDB public URL for app when both resources share Coolify environment. Do not expose port `27017` to internet unless separate external tool requires it.

## Service 2 — Yanisa Sign app

### 3. Create application resource

1. Return to project/environment and click **New Resource**.
2. Choose your Git repository.
3. Select deployment type **Docker Compose**.
4. Choose production branch.
5. Set compose file path to `docker-compose.yml`.
6. Confirm service list contains only `app`.
7. Do not deploy yet; add environment variables first.

### 4. Connect app to Coolify predefined network

1. Open Yanisa Sign application resource.
2. Open **Settings** / **General** / **Service Stack** settings.
3. Enable **Connect to Predefined Network** (may read **Connect to Predefined Networks**).
4. Save.
5. Do not add `networks:` section to `docker-compose.yml`; Coolify manages it.

### 4a. Add required app environment variables

Open app resource **Environment Variables**. Add each item below as runtime variable. Mark secret values as secret/hidden in Coolify.

| Name | Required value |
| --- | --- |
| `MONGO_URI` | Internal URL from Step 2, with `signapp`, `authSource=admin`, and any URL-encoded credentials |
| `JWT_SECRET` | Unique random value, minimum 32 characters |
| `ADMIN_EMAIL` | Initial HR administrator email address |
| `ADMIN_PASSWORD` | Unique, long admin password |
| `APP_URL` | Exact public HTTPS URL, e.g. `https://sign.example.com` |

Generate secrets with password manager. On Windows PowerShell, use this for `JWT_SECRET`:

```powershell
[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

On Linux/macOS, use `openssl rand -hex 32`. Never reuse Mongo password as `JWT_SECRET` or admin password.

### 5. Add email variables

Signing requests cannot send in production without SMTP. Add these before sending real documents:

| Name | Value |
| --- | --- |
| `SMTP_HOST` | SMTP hostname from email provider |
| `SMTP_PORT` | `587` for STARTTLS, or `465` for TLS |
| `SMTP_USER` | SMTP username |
| `SMTP_PASSWORD` | SMTP password/API key |
| `SMTP_SECURE` | `false` for port `587`; `true` for port `465` |
| `MAIL_FROM_NAME` | Sender name, e.g. `Yanisa HR` |
| `MAIL_FROM_EMAIL` | Verified sender email address |
| `HR_NOTIFICATION_EMAIL` | Optional inbox for completion notices |

Optional app variables: `MAX_PDF_SIZE_MB=20`, `DEFAULT_SIGN_VALID_DAYS=7`, `SIGN_CERTIFICATE_ENABLED=true`. Leave `CLIENT_URL` blank because UI and API share same domain.

### 6. Set domain and deploy

1. Open app resource **Domains** or **Network** settings.
2. Add `https://sign.example.com` to service `app`, port `5000`.
3. Enable automatic HTTPS/Let's Encrypt.
4. Save settings.
5. Click **Deploy**.
6. Watch deployment logs until app reports `MongoDB connected` and `Server running on port 5000`.

## Verify deployment

1. Open `https://sign.example.com/api/health`.
2. Confirm response contains:

   ```json
   { "ok": true, "database": "connected" }
   ```

3. Open `https://sign.example.com` and log in using `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
4. Upload non-sensitive test PDF.
5. Send it to controlled email address.
6. Confirm email link starts with exact `APP_URL`, opens signing page, and completes successfully.

## Problems

| Symptom | Check |
| --- | --- |
| App stops at deploy | Required `MONGO_URI`, `JWT_SECRET`, `ADMIN_EMAIL`, or `ADMIN_PASSWORD` missing |
| `getaddrinfo EAI_AGAIN` / `ENOTFOUND` | Enable **Connect to Predefined Network** on app resource. Keep internal hostname exactly as Coolify displays it |
| Health shows `database: "disconnected"` | Verify both resources share Coolify server/destination and app network setting is enabled |
| `Authentication failed` | Use exact `MONGO_INITDB_ROOT_USERNAME` and `MONGO_INITDB_ROOT_PASSWORD`; URL-encode credentials; verify URI ends in `?authSource=admin` |
| Signer link wrong | Set `APP_URL` to exact HTTPS app domain, no trailing path |
| Emails fail | Verify SMTP host, port, `SMTP_SECURE`, sender identity, and provider logs |
| PDF gone after redeploy | Confirm app resource's `sign-storage` volume was not deleted |

## Backups and updates

1. Back up MongoDB database resource. It contains documents, signers, tokens, and audit history.
2. Back up app `sign-storage` volume. It contains original, signed, and certificate PDFs.
3. Test restoration on non-production server.
4. Normal application redeploys retain `sign-storage`. Do not use destructive volume/resource cleanup.
5. If rotating Mongo credentials, update Mongo first, then replace app `MONGO_URI` and redeploy app.
6. If rotating `JWT_SECRET`, all active app admin sessions are invalidated.
