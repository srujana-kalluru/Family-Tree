alter table person
  add column if not exists created_by       uuid        default auth.uid(),
  add column if not exists created_by_email  text        default (auth.jwt() ->> 'email'),
  add column if not exists created_at        timestamptz not null default now(),
  add column if not exists updated_by        uuid        default auth.uid(),
  add column if not exists updated_by_email  text        default (auth.jwt() ->> 'email'),
  add column if not exists updated_at        timestamptz not null default now();

alter table marriage
  add column if not exists created_by       uuid        default auth.uid(),
  add column if not exists created_by_email  text        default (auth.jwt() ->> 'email'),
  add column if not exists created_at        timestamptz not null default now();

alter table parent_child
  add column if not exists created_by       uuid        default auth.uid(),
  add column if not exists created_by_email  text        default (auth.jwt() ->> 'email'),
  add column if not exists created_at        timestamptz not null default now();
