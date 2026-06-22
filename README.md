# Family Tree (Angular + Supabase)

An interactive, pannable/zoomable family tree. Pick any person as the *viewpoint* and the
canvas shows their blood relatives + spouse, sizes the immediate family largest, boxes the
nuclear family, and switches names between English and Telugu (auto-transliterated). Built
with **Angular 19 (standalone + signals)** and **Supabase** (Postgres + Google sign-in). The
schema is managed with **Liquibase**, and the site deploys to **GitHub Pages** as a static build.

## Data model

```
person(id, first_name, last_name)
marriage(id, partner1_id -> person, partner2_id -> person)
parent_child(parent_id -> person, child_id -> person)   -- PK(parent_id, child_id)
```

Every table also carries audit columns - `created_by`, `created_by_email`, `created_at`,
`updated_by`, `updated_by_email`, `updated_at` - set from the signed-in user's identity:
`created_*` via Postgres column defaults (`auth.uid()` / `auth.jwt()`), `updated_*` written by
the app on edit (so you can see who added or last edited each person). All higher
relationships (parents, siblings, grandparents, the "blood + spouse" set, the immediate-family
box) are **derived** in the client from the three base tables.

## 1. Database - Supabase + Liquibase

Schema lives as Liquibase changesets under `db/` (no manual SQL, **no seed** - the tree starts
empty and you build it in the app):

```
db/changelog/changesets/001-schema.sql   # tables + indexes
db/changelog/changesets/002-rls.sql      # row level security: public read, authenticated write
db/changelog/changesets/003-audit.sql    # audit columns + trigger
```

1. Create a project at https://supabase.com (set + save a database password).
2. Click **Connect** (top of the project) → **Session pooler** (IPv4, what CI needs) and turn it
   into a JDBC URL: `jdbc:postgresql://HOST:5432/postgres?sslmode=require`, with username
   `postgres.<project-ref>`.
3. Migrations run in CI (see step 3 below) - the `db-migrate.yml` workflow runs `liquibase update`.
   To run them yourself instead: `cp db/.env.example db/.env`, fill it in, `npm run db:update`
   (Docker), or `cd db && liquibase update` with the native CLI.

## 2. Google sign-in (required to edit)

The tree is **public to read**; **editing requires signing in with Google**. Set it up once:

1. **Google Cloud Console** → create an OAuth 2.0 Client ID (type: Web application).
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
2. **Supabase → Authentication → Providers → Google** → enable, paste the Google **Client ID**
   and **Client secret**.
3. **Supabase → Authentication → URL Configuration** → set **Site URL** and add a **Redirect URL**
   matching your site: `https://<user>.github.io/<repo>/` (and `http://localhost:4200` for local dev).

## 3. Run the app + deploy

```bash
npm install
# paste your Supabase Project URL + anon (publishable) key into src/environments/environment.ts
npm start          # http://localhost:4200  -> "Sign in with Google" to edit
```

GitHub Pages (project site, `https://<user>.github.io/<repo>/`):

1. Push this folder to a repo; **Settings → Pages → Source: GitHub Actions**.
2. Add repo **secrets**: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (app build), and
   `LIQUIBASE_URL`, `LIQUIBASE_USERNAME`, `LIQUIBASE_PASSWORD` (migrations).
3. Push - `deploy.yml` builds + publishes; `db-migrate.yml` runs `liquibase update` on `db/**` changes.

## Project structure

```
src/app/core/      pure logic (no Angular): models, graph, layout, transliteration
src/app/data/      DataService - Supabase client + Google auth + optimistic CRUD + audit
src/app/app.component.*  the canvas UI (pan/zoom, nodes, wires, box, modals, sign-in, language)
db/                Liquibase changelog (schema + RLS + audit)
.github/workflows/ Pages deploy + Liquibase migrate
```

## Notes

- **Empty start:** with no rows, the app shows "Add the first person". Use the header **+ Add
  person** for an unrelated person, or the **+** handles on a face to add a **spouse** or **child**
  (each can be a new person or an existing one). Parents are never added directly: when you add a
  child to someone with a spouse, you pick the **second parent** - their partner, or none/unknown
  (e.g. a child from a previous marriage) - defaulting to the sole spouse when there's exactly one.
  The tree shows first names only; first and last names are entered separately.
- **Audit:** no triggers - `created_*` come from Postgres column defaults (`auth.uid()` /
  `auth.jwt()`), set server-side on insert; `updated_*` are written by the app on edit. The edit
  dialog shows "Added by / last edited by".
- **Auth:** anon reads; writing requires Google sign-in, enforced by the policies in `002-rls.sql`.
- **Telugu** names are auto-transliterated from the English first/last names.
- **Edits are optimistic** - they apply instantly, persist in the background, and roll back with an
  error toast on failure.
- **No bundled data:** the app is Supabase-only, so local behaves exactly like production. Without
  Supabase keys in `environment.ts` it simply shows an empty, read-only screen.
