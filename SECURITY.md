# Security Policy

Tele-OPC OS is designed around a strict approval boundary: read, summarize, classify, draft, and queue low-risk internal work; require explicit owner approval before external or destructive actions.

## Supported Versions

The current repository is V2 work in progress. Security fixes should target the `main` branch unless a maintained release branch exists.

## Reporting a Vulnerability

If this repository is public, please report vulnerabilities privately through GitHub Security Advisories when enabled. If advisories are not enabled, contact the repository owner through a private channel.

Do not open a public issue that includes:

- Real Telegram bot tokens.
- API keys.
- OAuth refresh tokens.
- Browser cookies or sessions.
- Customer data.
- Financial data.
- Database dumps.

## Secrets

Never commit:

- `.env`
- `config/tele-opc.yaml`
- OAuth refresh tokens
- Browser profiles or cookies
- Runtime artifacts containing customer or financial data
- Database dumps

Only commit templates such as `.env.example` and `config/tele-opc.example.yaml`.

## Deployment Safety

Production deployments should:

- Expose only the API through HTTPS.
- Keep PostgreSQL and Redis private.
- Restrict Telegram access with `TELEGRAM_OWNER_IDS`.
- Use a random `TELEGRAM_WEBHOOK_SECRET`.
- Keep high-risk actions behind approvals.
- Limit browser automation to an allowlist.
- Rotate secrets if they may have been exposed.

## Approval Boundary

These actions should require approval:

- Send, forward, or delete email.
- Contact a customer.
- Create, update, or cancel external calendar events.
- Make payments, refunds, transfers, or subscription changes.
- Submit browser forms.
- Publish content.
- Deploy to production.
- Delete records.
- Share files externally.

Low-risk internal actions such as summarizing, drafting, classification, internal notes, and screenshots can be automated within configured permissions.
