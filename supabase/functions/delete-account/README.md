## delete-account (Edge Function)

Deletes the signed-in user from:
- `auth.users` (actual account)
- `profiles` row
- any files in Storage bucket `avatars` under `${userId}/...` (best-effort)

### Deploy

1. Install + login Supabase CLI, then link your project.
2. Deploy the function:
   - `supabase functions deploy delete-account`

### Set required secret

Set the service role key as a secret (never put it in frontend code):
- `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY`

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are available automatically in Supabase Edge Functions.

### Frontend call

The app calls:
- `supabase.functions.invoke('delete-account')`

So the user must be logged in (Authorization header is required).

