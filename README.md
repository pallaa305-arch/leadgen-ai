# LeadGen AI

LeadGen AI is now structured as a real lead-gen workflow app instead of a demo-only prototype.

It supports:

- Real outreach email sending with Resend
- Real outbound voice calls with Twilio
- Real card checkout with Stripe Checkout
- Live website publishing for generated client sites through the Vercel Deployments API
- Firebase-backed CRM state, notes, tasks, and webhook updates

## Local development

Prerequisites:

- Node.js 20+
- A public HTTPS callback URL for Stripe and Twilio when testing real payments or calls
- Firebase project and admin credentials
- Resend, Stripe, Twilio, and Vercel accounts if you want every real integration enabled

### 1. Install dependencies

```bash
npm install
```

### 2. Create your environment file

Copy `.env.example` to `.env.local` or `.env` and fill in the required secrets.

Important:

- `APP_BASE_URL` must be a public URL for Twilio and Stripe webhooks.
- `CLIENT_APP_URL` should point to the frontend URL users will open in the browser.
- `RESEND_FROM_EMAIL` must be a verified sender in Resend.
- `FIREBASE_PRIVATE_KEY` must preserve newline escapes as `\n`.

### 3. Run the app

```bash
npm run doctor
npm run dev
```

This starts:

- Vite on `http://localhost:3000`
- Express API on `http://localhost:8787`

Vite proxies `/api/*` requests to the backend in development.

## Production notes

For real call + payment flows to work in production you need:

- the frontend hosted at `CLIENT_APP_URL`
- the backend hosted at `APP_BASE_URL`
- Stripe webhook pointing to `POST /api/payments/webhook`
- Twilio voice webhook + status/recording callbacks reachable through `APP_BASE_URL`

## Current implementation scope

The app now replaces these fake/demo behaviors:

- `mailto:` email sending -> Resend API
- call simulation -> Twilio outbound call flow
- manual payment logging -> Stripe Checkout session flow
- local-only preview URLs -> live Vercel deployment URLs for generated sites

Some business workflows are still intentionally operator-assisted:

- moving a lead from `EMAILED` to `RESPONDED` is still manual
- generated AI website code can be edited and republished manually
- incoming email reply parsing is not automated yet
