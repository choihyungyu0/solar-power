-- 참고 구현용 캐시 테이블 (services/climate_proxy 의 FastAPI 백엔드를 채택할 경우에만 적용)
-- 메인 schema.sql 과 분리되어 있으며, MVP 운영 경로에는 포함되지 않음.

create table if not exists public.bundle_cache (
  grid_key text primary key,
  unq_id text,
  bundle jsonb not null,
  panels_geojson jsonb not null,
  source text not null default 'live'
    check (source in ('live', 'seed_fixture', 'manual')),
  computed_at timestamptz not null default now()
);

create index if not exists bundle_cache_unq_id_idx on public.bundle_cache(unq_id);
create index if not exists bundle_cache_computed_at_idx on public.bundle_cache(computed_at desc);

alter table public.bundle_cache enable row level security;

drop policy if exists "bundle_cache_no_anon" on public.bundle_cache;
create policy "bundle_cache_no_anon"
on public.bundle_cache for select
to anon, authenticated
using (false);
