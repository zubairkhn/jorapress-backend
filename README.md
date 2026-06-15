# JoraPress Backend — license, updates & Stripe fulfillment

A Node/Express + MongoDB (Mongoose) service that turns a Stripe payment into a
working licensed plugin. It is the single owner of everything commercial:

- **Products** — plans + pricing are defined HERE (`src/config.ts` → `PLANS`),
  not in Stripe. Stripe only collects the payment via an inline price.
- **Checkout** — creates Stripe Checkout Sessions for the marketing site.
- **Fulfillment** — Stripe webhook → generates a license key, stores it, emails it.
- **Licensing** — activate / validate / deactivate a key on a site, enforcing
  each tier's site limit (Pro = 1, Agency = 25).
- **Updates** — serves version info + the plugin zip to licensed sites only.

```
src/
  index.ts            Express app (CORS, routing, raw-body webhook, error mw)
  config.ts           env + the PLANS catalog (source of truth for pricing)
  db.ts               Mongoose connection
  models/license.ts   License schema (activations embedded)
  license.ts          key generation, activation/validation logic (async)
  stripe.ts           Stripe client
  mailer.ts           emails the license key (SMTP)
  util.ts             asyncHandler + JSON error middleware
  routes/
    checkout.ts       POST /api/checkout, GET /api/checkout/session
    webhook.ts        POST /api/stripe/webhook
    license.ts        POST /api/license/{activate,validate,deactivate}
    update.ts         GET  /api/update/{check,download}
releases/jorapress.zip   the build served to licensed sites for auto-update
```

Data lives in MongoDB (collection `licenses`); each license embeds its site
`activations`.

## Run

```bash
npm install
cp .env.example .env     # set MONGODB_URI + Stripe keys (SMTP is pre-filled)
npm run dev              # http://localhost:4000  (tsx watch)
# production:
npm run build && npm start
```

Requires a MongoDB instance (local `mongod` or a MongoDB Atlas URI).

## Changing plans / pricing

Edit `PLANS` in `src/config.ts` — name, `amount` (cents), `currency`,
`interval`, and `maxSites` per tier. No Stripe dashboard changes needed.

## Endpoints

| Method | Path | Caller | Purpose |
|--------|------|--------|---------|
| POST | `/api/checkout` | marketing site | create a Checkout Session → `{url}` |
| GET  | `/api/checkout/session?id=` | success page | session summary (plan, email) |
| POST | `/api/stripe/webhook` | Stripe | fulfillment (issue/renew/cancel) |
| POST | `/api/license/activate` | plugin | `{key, site, version}` → bind to site |
| POST | `/api/license/validate` | plugin | `{key}` → status + tier |
| POST | `/api/license/deactivate` | plugin | `{key, site}` → free a seat |
| GET  | `/api/update/check?key=&site=&version=` | plugin | is a newer build available? |
| GET  | `/api/update/download?key=&site=` | plugin | download the zip (licensed only) |
| POST | `/api/account/request-link` | account page | `{email}` → email a magic sign-in link |
| POST | `/api/account/verify` | account page | `{token}` → exchange magic token for a session |
| GET  | `/api/account/me` | account page | (Bearer) licenses, sites, days left |
| POST | `/api/account/portal` | account page | (Bearer) `{key}` → Stripe billing portal URL |
| GET  | `/api/account/download?key=` | account page | (Bearer) download the licensed zip |
| POST | `/api/admin/login` | admin page | `{password}` → admin session token |
| GET  | `/api/admin/stats` | admin page | (Bearer) customers, MRR/ARR, counts |
| GET  | `/api/admin/licenses?search=&status=&tier=&page=` | admin page | (Bearer) paginated list |
| GET  | `/api/admin/licenses/:key` | admin page | (Bearer) full license detail |
| GET  | `/health` | you | liveness |

### Customer accounts & admin

- **Customer account** (`/account` on the marketing site): passwordless. The
  customer enters their email, gets a magic link, and lands on a dashboard with
  their license key (copy), linked sites, days left, a licensed re-download, and
  a **Manage billing** button (Stripe Customer Portal). Auth is a short-lived
  signed token in the `Authorization: Bearer` header — set `AUTH_SECRET`.
- **Admin** (`/admin` on the marketing site): a single `ADMIN_PASSWORD` unlocks
  a dashboard of customers, subscriptions, MRR/ARR and per-license detail.

## Stripe webhook

Point Stripe at `https://<this-host>/api/stripe/webhook` for events
`checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`.
Locally: `stripe listen --forward-to localhost:4000/api/stripe/webhook`.

## Publishing a plugin update

1. Bump `Version:` in the plugin header and re-zip it.
2. Copy the zip to `releases/jorapress.zip`.
3. Set `PLUGIN_VERSION` in `.env` to the new version and restart.

Licensed sites then see the update via `/api/update/check` and can install it
from the WordPress updates screen.

## Notes

- The data layer is isolated in `models/license.ts` + `license.ts`.
- Back up the MongoDB database regularly (Atlas does automated backups) — it is
  your customer + license record.
- Tip: include a database name in `MONGODB_URI` (e.g. `…mongodb.net/jorapress`),
  otherwise MongoDB defaults to a database called `test`.
# jorapress-backend
