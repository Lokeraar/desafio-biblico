-- Shim mínimo de piezas que Supabase ya trae y Postgres pelado no.
do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema if not exists realtime;
grant usage on schema realtime to anon, authenticated;

create table realtime.messages (
  id bigserial primary key,
  topic text not null,
  extension text not null,
  event text,
  payload jsonb,
  private boolean not null default true,
  inserted_at timestamptz not null default now()
);

create or replace function realtime.topic() returns text
language sql stable as $$ select current_setting('realtime.topic', true) $$;

-- firma real de Supabase: (payload, event, topic, private)
create or replace function realtime.send(
  payload jsonb, event text, topic text, private boolean default true
) returns void
language plpgsql as $$
begin
  insert into realtime.messages (topic, extension, event, payload, private)
  values (topic, 'broadcast', event, payload, private);
end;
$$;
