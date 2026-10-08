-- Eki Stamp Tracker: per-user progress on the shared txmnzia-dbs project.
-- Run once in the Supabase SQL editor, then add `eki` under
-- Settings > Data API > Exposed schemas.
--
-- One row per collected stamp and one per ridden segment, so a change on one
-- device is an insert/delete that never clobbers another device's edits
-- (js/cloud.js does a three-way merge against the last synced snapshot).

create schema if not exists eki;
grant usage on schema eki to anon, authenticated;
alter default privileges in schema eki
  grant select, insert, update, delete on tables to authenticated;

create table eki.stamps (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  code       text not null check (length(code) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (user_id, code)
);

create table eki.rides (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  line       text not null check (length(line) between 1 and 200),
  seg        text not null check (length(seg) between 1 and 200),   -- "codeA|codeB" (or a legacy station code)
  created_at timestamptz not null default now(),
  primary key (user_id, line, seg)
);

alter table eki.stamps enable row level security;
alter table eki.rides  enable row level security;

create policy "own rows" on eki.stamps
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on eki.rides
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on all tables in schema eki to authenticated;
