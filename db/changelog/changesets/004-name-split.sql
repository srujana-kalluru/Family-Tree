alter table person add column if not exists first_name text;
alter table person add column if not exists last_name text;

update person
set first_name = split_part(name, ' ', 1),
    last_name  = nullif(trim(substr(name, length(split_part(name, ' ', 1)) + 1)), '')
where name is not null and first_name is null;

alter table person alter column first_name set not null;
alter table person drop column if exists name;
