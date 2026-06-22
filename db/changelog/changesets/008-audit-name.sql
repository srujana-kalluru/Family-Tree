-- Display name (First Last) of the editor, captured from the Google sign-in JWT.
-- Mirrors the created_by_email default but reads the name claim, falling back to email.
alter table person
  add column if not exists created_by_name text
    default coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'name', auth.jwt() ->> 'email'),
  add column if not exists updated_by_name text
    default coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'name', auth.jwt() ->> 'email');
