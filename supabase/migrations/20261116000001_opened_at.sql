-- =====================================================================
-- `opened_at` debe admitir NULL
-- ---------------------------------------------------------------------
-- Una ronda 'prepared' todavía no tiene hora de apertura: el reloj no
-- arranca hasta que el presentador pulsa «Iniciar». El esquema original
-- la declaró NOT NULL porque en aquel momento la pregunta nacía ya abierta.
-- =====================================================================

alter table public.rounds alter column opened_at drop not null;

-- `elapsed_ms` y el resto ya toleran NULL: solo se usan con la ronda abierta.
create or replace function public.elapsed_ms(p_round public.rounds)
returns int
language sql stable
as $$
  select case
    when p_round.opened_at is null then 0
    else greatest(0,
      (extract(epoch from (clock_timestamp() - p_round.opened_at)) * 1000)::bigint
      - p_round.paused_total_ms
    )::int
  end;
$$;
