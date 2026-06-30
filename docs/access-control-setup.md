# Access control + email setup (no CLI)

The tree is private: only people you approve can open or edit it. A new sign-in lands in a **pending** state and sees nothing; you approve, revoke, or promote people from the app's **Members** panel (visible only to you). This guide wires up the email that pings you when someone is waiting - entirely from the Supabase dashboard, with **no CLI and no Edge Function**.

## What the migration already does

It adds an `AFTER INSERT` trigger on `person` that emails you (via Resend, using the `pg_net` extension) whenever a new pending user appears. It is best-effort and self-contained: if `pg_net` or the key isn't set up yet, sign-in still works - you just won't get the email until you finish the steps below.

## One-time setup (all in the dashboard)

1. **Resend key** - create a free account at https://resend.com and make an API key. To email your own inbox, the default `onboarding@resend.dev` sender works with no domain setup; to email anyone else, verify a domain.

2. **Enable pg_net** - Dashboard → Database → Extensions → search `pg_net` → enable.

3. **Store the key in Vault** - Dashboard → SQL Editor, run:

   ```sql
   select vault.create_secret('re_your_key_here', 'resend_api_key');
   ```

   The trigger looks it up by the name `resend_api_key`. The value is encrypted at rest and never lives in the repo.

4. **Owner email + app link** - the migration seeds `owner_email` with `srujana.kalluru@gmail.com` (auto-approved admin). To change it, or to add a clickable link in the email, run:

   ```sql
   update app_settings
     set owner_email = 'you@example.com',
         app_url = 'https://<your-username>.github.io/<repo>'
     where id = 1;
   ```

That's all. Push the migration, finish these four steps once, and every new sign-in emails you.

## How it works

- `person.approved` and `person.is_admin` gate every read and write through RLS, via the `is_approved()` / `is_admin()` security-definer functions.
- Signing in creates a pending `person` row; a `bootstrap_owner` trigger auto-approves and promotes whoever signs in with `owner_email`.
- A `notify_access_request` trigger calls Resend over HTTP straight from Postgres via `pg_net` when a pending row is inserted. Any failure is swallowed, so sign-in never breaks.
- Approve / revoke / promote is a flag flip from the Members panel; a revoked user loses access on their next request. A `guard_person_flags` trigger blocks non-admins from changing those flags.
