# Access control setup

The family tree is private: only people you approve can open or edit it. A new sign-in lands in a **pending** state and sees nothing; you approve, revoke, or promote people from the app's **Members** panel (visible only to you). This guide wires up the email that tells you when someone is waiting. The approval gate itself works without any of the steps below — they only add the notification.

## 1. Owner email

The migration seeds `app_settings.owner_email` with `srujana.kalluru@gmail.com`. That account is auto-approved and is the admin. To change it, edit `db/changelog/changesets/002-access-columns.sql` before pushing, or run once in the Supabase SQL editor:

```sql
update app_settings set owner_email = 'you@example.com' where id = 1;
```

## 2. Resend (free email provider)

1. Create an account at https://resend.com.
2. Create an API key (API Keys → Create API Key).
3. For real delivery, verify a domain (Domains → Add Domain). For a quick test you can send from `onboarding@resend.dev` with no domain setup.

## 3. Deploy the Edge Function

Install the Supabase CLI (https://supabase.com/docs/guides/cli), link your project, then from the repo root:

```sh
supabase functions deploy notify-access-request --no-verify-jwt
supabase secrets set \
  RESEND_API_KEY=re_xxxxxxxx \
  OWNER_EMAIL=you@example.com \
  APP_URL=https://<your-username>.github.io/<repo> \
  FROM_EMAIL="Family Tree <onboarding@resend.dev>"
```

`--no-verify-jwt` is required so the database webhook can call the function server-side (there is no user token).

## 4. Database Webhook

Supabase Dashboard → Database → Webhooks → Create a new hook:

- Table: `person`
- Events: `Insert`
- Type: `Supabase Edge Functions` → `notify-access-request`
  (or HTTP `POST` to `https://<project-ref>.supabase.co/functions/v1/notify-access-request`)

Done. When someone new signs in, the function emails you; open **Members** to approve or revoke.

## How it works

- `person.approved` and `person.is_admin` flags gate every read and write through RLS, via the `is_approved()` and `is_admin()` security-definer functions.
- Signing in creates the user's `person` row as pending (`approved = false`). A `bootstrap_owner` trigger auto-approves and promotes whoever signs in with the `owner_email`.
- Approve / revoke / promote is a single flag flip from the Members panel; a revoked user loses access on their next request.
- A `guard_person_flags` trigger blocks anyone who is not an admin from changing those flags, even via the raw API.
