-- The person table is also the user directory. A signed-in user becomes a person, additionally keyed by their
-- Google auth UUID (and email). created_by/updated_by (UUIDs) on person/marriage/parent_child join back to person.uuid.
alter table person
  add column if not exists uuid  uuid unique,
  add column if not exists email text;

-- marriage and parent_child already carry created_by (003-audit); give them updated_by too. Both are UUIDs -> person.uuid.
alter table marriage     add column if not exists updated_by uuid default auth.uid();
alter table parent_child add column if not exists updated_by uuid default auth.uid();
