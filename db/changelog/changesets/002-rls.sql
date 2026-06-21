alter table person       enable row level security;
alter table marriage     enable row level security;
alter table parent_child enable row level security;

create policy "read person"       on person       for select using (true);
create policy "read marriage"     on marriage     for select using (true);
create policy "read parent_child" on parent_child for select using (true);

create policy "write person"       on person       for all to authenticated using (true) with check (true);
create policy "write marriage"     on marriage     for all to authenticated using (true) with check (true);
create policy "write parent_child" on parent_child for all to authenticated using (true) with check (true);
