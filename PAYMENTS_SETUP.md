# Korapay payments (SkillConnect)

This project uses **Supabase Edge Functions** + a Postgres ledger table to gate public profiles behind:

- **₦300 one-time activation** (makes profile public)
- **₦300 monthly subscription** (keeps profile public)

## 0) Rotate your keys (important)

You shared a live Korapay secret key in chat. Treat it as compromised and **rotate it in Korapay** immediately.

## 1) Database setup

Run the SQL migration:

- `supabase/migrations/20260330_korapay_billing.sql`
- `supabase/migrations/20260330_korapay_amount_units.sql`

You can paste it into the Supabase SQL editor, or use migrations if you already have them wired up.

## 2) Edge Functions

Functions added:

- `supabase/functions/korapay-initiate/index.ts`
- `supabase/functions/korapay-webhook/index.ts`

Deploy them (example):

```bash
supabase functions deploy korapay-initiate
supabase functions deploy korapay-webhook
```

Both functions include `config.toml` with `verify_jwt = false` so browser CORS preflight (OPTIONS) and Korapay webhooks aren’t blocked by Supabase’s JWT gate. `korapay-initiate` still enforces login by checking the `Authorization: Bearer <access_token>` header inside the function.

## 3) Secrets / env vars

Set these in your Supabase project secrets:

- `KORAPAY_SECRET_KEY` = your Korapay **secret** key (server-only)

Optional overrides:

- `ACTIVATION_FEE_NGN` (default `300`)
- `SUBSCRIPTION_FEE_NGN` (default `300`)

## 4) Korapay webhook URL

Set your Korapay webhook (notification URL) to:

- `https://<your-project-ref>.supabase.co/functions/v1/korapay-webhook`

The client also sends `notification_url` for each payment.

## 5) Front-end

The browser uses the Korapay public key inside `app.js`:

- `app.js:7`

After login, users will see billing status + buttons in the Profile page and can pay to activate/renew.

**Amount units:** Korapay Checkout expects the `amount` you pass from the browser in **major units** (e.g. `300` for NGN 300). The server still stores minor units (`amount_kobo`) for consistency.

## Troubleshooting

### CORS + `404 preflight` to `/functions/v1/korapay-initiate`

If DevTools shows `korapay-initiate` **404** on the **preflight (OPTIONS)** request, the URL route doesn’t exist on that Supabase project yet — this usually means the function is **not deployed** (or you’re calling the wrong Supabase project).

- Confirm the function exists in Supabase Dashboard → Edge Functions.
- Deploy with the CLI: `supabase link` then `supabase functions deploy korapay-initiate`.
- If you are running Supabase locally, use the local URL (`http://127.0.0.1:54321`) instead of the hosted `https://<project-ref>.supabase.co` in `app.js`.

### `401 Unauthorized` from `/functions/v1/korapay-initiate`

This means the function did not accept your auth/session.

- Confirm you can log in successfully (no `400` on `/auth/v1/token`).
- In DevTools → Network → the **POST** to `korapay-initiate`, check the **Response JSON**:
  - If it says `Missing Authorization header`: your request didn’t include `Authorization: Bearer <access_token>`.
  - If it says `Unauthorized` with a `detail` like “invalid JWT”: log out and log in again.
- If the response mentions `Invalid API key` / `No API key found`, replace `supabaseKey` in `app.js` with your Supabase **anon public key** (Project Settings → API). The `sb_publishable_...` key may not be accepted for Edge Functions.
