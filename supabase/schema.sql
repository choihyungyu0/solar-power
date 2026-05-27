-- Supabase schema for the apartment/public-housing solar adoption MVP.
-- Run this in the Supabase SQL editor after creating a Supabase project.
-- Frontend keys must be VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY only.

create extension if not exists pgcrypto;
create extension if not exists vector with schema extensions;

-- 1. User profile linked to Supabase Auth users.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  phone text,
  birth_date date,
  privacy_agreed boolean not null default false,
  privacy_agreed_at timestamptz,
  privacy_consent_version text,
  user_type text not null default 'resident'
    check (user_type in ('resident', 'manager', 'owner', 'public_officer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists birth_date date,
  add column if not exists privacy_agreed boolean not null default false,
  add column if not exists privacy_agreed_at timestamptz,
  add column if not exists privacy_consent_version text;

-- 2. Apartment/public-housing solar installation request.
create table if not exists public.apartment_solar_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  apartment_name text not null,
  address text not null,
  household_count integer check (household_count is null or household_count > 0),
  roof_area_m2 numeric check (roof_area_m2 is null or roof_area_m2 >= 0),
  monthly_electric_bill_krw integer check (monthly_electric_bill_krw is null or monthly_electric_bill_krw >= 0),
  contact_method text check (contact_method in ('kakao', 'sms', 'email')),
  contact_value text,
  status text not null default 'submitted'
    check (status in ('draft', 'submitted', 'reviewing', 'reported', 'closed')),
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Compatibility columns for projects that already ran an older scaffold.
alter table public.apartment_solar_requests
  add column if not exists monthly_electric_bill_krw integer,
  add column if not exists contact_value text,
  add column if not exists memo text;

-- 3. Saved solar simulation result.
create table if not exists public.solar_simulations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.apartment_solar_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  suitability_score integer check (suitability_score is null or suitability_score between 0 and 100),
  suitability_grade text,
  recommended_capacity_kw numeric,
  panel_count integer,
  expected_monthly_generation_kwh numeric,
  expected_yearly_generation_kwh numeric,
  expected_yearly_saving_krw integer,
  estimated_install_cost_krw integer,
  estimated_subsidy_krw integer,
  estimated_policy_loan_limit_krw integer,
  estimated_self_payment_krw integer,
  payback_years numeric,
  household_monthly_benefit_krw integer,
  calculation_version text not null default 'demo-v1',
  created_at timestamptz not null default now()
);

alter table public.solar_simulations
  add column if not exists suitability_grade text,
  add column if not exists expected_yearly_saving_krw integer,
  add column if not exists estimated_install_cost_krw integer,
  add column if not exists estimated_subsidy_krw integer,
  add column if not exists estimated_policy_loan_limit_krw integer,
  add column if not exists estimated_self_payment_krw integer,
  add column if not exists household_monthly_benefit_krw integer;

-- 4. Notification preference. Real Kakao/SMS sending is not part of the MVP.
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid references public.apartment_solar_requests(id) on delete cascade,
  method text not null check (method in ('kakao', 'sms', 'email')),
  destination text,
  enabled boolean not null default true,
  mock_status text not null default 'mock_ready',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences
  add column if not exists mock_status text not null default 'mock_ready';

-- 5. Public subsidy/policy program candidates.
create table if not exists public.subsidy_programs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  region text,
  target text,
  support_type text,
  amount_text text,
  source_name text,
  source_url text,
  status text not null default '확인 필요'
    check (status in ('확인 필요', '접수중', '마감 임박', '마감')),
  last_checked_at date,
  note text,
  created_at timestamptz not null default now(),
  unique (title, region)
);

-- Compatibility columns for projects that already ran the subsidy RAG/admin schema.
-- Older schemas used program_name/region_sido/source_title and did not have the
-- landing-page policy card columns used by apps/web.
alter table public.subsidy_programs
  add column if not exists title text,
  add column if not exists region text,
  add column if not exists target text,
  add column if not exists support_type text,
  add column if not exists amount_text text,
  add column if not exists source_name text,
  add column if not exists source_url text,
  add column if not exists status text default '확인 필요',
  add column if not exists last_checked_at date,
  add column if not exists note text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists program_name text,
  add column if not exists region_sido text,
  add column if not exists region_sigungu text,
  add column if not exists target_building_type text,
  add column if not exists subsidy_amount_krw bigint,
  add column if not exists subsidy_rate numeric,
  add column if not exists max_subsidy_krw bigint,
  add column if not exists stacking_allowed boolean not null default false,
  add column if not exists stacking_note text,
  add column if not exists eligibility_note text,
  add column if not exists source_title text,
  add column if not exists source_year integer,
  add column if not exists raw_payload jsonb;

do $$
declare
  status_constraint_name text;
begin
  for status_constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.subsidy_programs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.subsidy_programs drop constraint if exists %I', status_constraint_name);
  end loop;
end $$;

update public.subsidy_programs
set
  title = coalesce(title, program_name, source_title, '정책 후보 ' || id::text),
  program_name = coalesce(program_name, title, source_title, '정책 후보 ' || id::text),
  region = coalesce(region, region_sigungu, region_sido, '지역 확인 필요'),
  region_sido = coalesce(region_sido, region, '지역 확인 필요'),
  target = coalesce(target, target_building_type, '대상 확인 필요'),
  target_building_type = coalesce(target_building_type, target, '대상 확인 필요'),
  amount_text = coalesce(
    amount_text,
    case
      when max_subsidy_krw is not null then '최대 ' || max_subsidy_krw::text || '원'
      when subsidy_amount_krw is not null then subsidy_amount_krw::text || '원'
      when subsidy_rate is not null then subsidy_rate::text || '%'
      else '공고 확인 필요'
    end
  ),
  source_name = coalesce(source_name, source_title, '공고 확인 필요'),
  source_url = coalesce(source_url, ''),
  source_title = coalesce(source_title, source_name, title, program_name, '공고 확인 필요'),
  source_year = coalesce(source_year, extract(year from current_date)::integer),
  raw_payload = coalesce(raw_payload, jsonb_build_object('source', 'schema_compat')),
  eligibility_note = coalesce(eligibility_note, note, '실제 공고 확인 필요'),
  stacking_note = coalesce(stacking_note, note, '중복 지원 여부 확인 필요'),
  status = coalesce(status, '확인 필요'),
  note = coalesce(note, eligibility_note, stacking_note, '실제 공고 확인이 필요한 후보입니다.')
where title is null
  or program_name is null
  or region is null
  or region_sido is null
  or source_url is null
  or target is null
  or target_building_type is null
  or amount_text is null
  or source_name is null
  or source_title is null
  or source_year is null
  or raw_payload is null
  or eligibility_note is null
  or stacking_note is null
  or status is null
  or note is null;

update public.subsidy_programs
set
  title = '한국에너지공단 공동주택 보급사업 후보',
  program_name = '한국에너지공단 공동주택 보급사업 후보',
  region = '전국',
  region_sido = '전국',
  region_sigungu = '전국',
  target = '아파트 1개 동, 공동주택 공용부 전기 절감 검토 단지',
  target_building_type = '아파트 1개 동, 공동주택 공용부 전기 절감 검토 단지',
  support_type = '저탄소 모듈 설치 보조',
  amount_text = '1개 동 최대 30kW, kW당 466,000원 추정',
  source_name = '한국에너지공단',
  source_title = '한국에너지공단',
  source_url = '',
  stacking_allowed = false,
  stacking_note = '제도 간 중복 지원 여부는 실제 공고 확인 필요',
  eligibility_note = '아파트는 경기태양광지원사업 대상이 아니므로 한국에너지공단 공동주택 기준으로 표시합니다.',
  status = '확인 필요',
  note = '아파트는 경기태양광지원사업 대상이 아니므로 한국에너지공단 공동주택 기준으로 표시합니다. 실제 지원 대상, 예산, 접수 가능 여부는 해당 연도 공고 확인이 필요합니다.'
where title = '경기도 공동주택 태양광 지원 후보';

-- 6. Subsidy RAG source documents and searchable pgvector chunks.
-- These tables are written/read by the production backend with a service-role key.
create table if not exists public.subsidy_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source_type text not null,
  source_title text not null,
  source_url text,
  source_year integer,
  region_sido text,
  region_sigungu text,
  program_name text,
  document_version text,
  raw_metadata jsonb,
  is_active boolean not null default true,
  is_test boolean not null default false
);

create table if not exists public.subsidy_chunks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  document_id uuid references public.subsidy_documents(id) on delete cascade,
  chunk_index integer not null,
  chunk_text text not null,
  chunk_type text,
  region_sido text,
  region_sigungu text,
  program_name text,
  target_building_type text,
  subsidy_amount_krw bigint,
  subsidy_rate numeric,
  max_subsidy_krw bigint,
  self_payment_krw bigint,
  stacking_allowed boolean,
  eligibility_note text,
  source_title text,
  source_url text,
  source_year integer,
  embedding extensions.vector(1536),
  raw_payload jsonb,
  is_active boolean not null default true,
  is_test boolean not null default false
);

create index if not exists subsidy_documents_active_idx
  on public.subsidy_documents(is_active);

create index if not exists subsidy_chunks_document_id_idx
  on public.subsidy_chunks(document_id);

create index if not exists subsidy_chunks_region_idx
  on public.subsidy_chunks(region_sido, region_sigungu);

create index if not exists subsidy_chunks_active_idx
  on public.subsidy_chunks(is_active);

-- 6b. (이동됨) climate.gg API 응답 캐시 테이블은 supabase/reference_bundle_cache.sql 로 분리.
--      해당 캐시는 services/climate_proxy (참고 구현) 채택 시에만 필요.

-- 7. Public demo/review content.
create table if not exists public.install_reviews (
  id uuid primary key default gen_random_uuid(),
  apartment_name text,
  region text,
  content text not null,
  saving_text text,
  rating integer not null default 5 check (rating between 1 and 5),
  is_demo boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists apartment_solar_requests_user_id_idx
  on public.apartment_solar_requests(user_id);

create index if not exists solar_simulations_user_id_idx
  on public.solar_simulations(user_id);

create index if not exists solar_simulations_request_id_idx
  on public.solar_simulations(request_id);

create index if not exists notification_preferences_user_id_idx
  on public.notification_preferences(user_id);

-- Updated-at helper.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_apartment_solar_requests_updated_at on public.apartment_solar_requests;
create trigger set_apartment_solar_requests_updated_at
before update on public.apartment_solar_requests
for each row execute function public.set_updated_at();

drop trigger if exists set_notification_preferences_updated_at on public.notification_preferences;
create trigger set_notification_preferences_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

-- Create profile automatically when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    name,
    phone,
    birth_date,
    privacy_agreed,
    privacy_agreed_at,
    privacy_consent_version
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    nullif(new.raw_user_meta_data->>'phone', ''),
    nullif(new.raw_user_meta_data->>'birth_date', '')::date,
    coalesce((new.raw_user_meta_data->>'privacy_agreed')::boolean, false),
    nullif(new.raw_user_meta_data->>'privacy_agreed_at', '')::timestamptz,
    nullif(new.raw_user_meta_data->>'privacy_consent_version', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Row Level Security.
alter table public.profiles enable row level security;
alter table public.apartment_solar_requests enable row level security;
alter table public.solar_simulations enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.subsidy_programs enable row level security;
alter table public.subsidy_documents enable row level security;
alter table public.subsidy_chunks enable row level security;
alter table public.install_reviews enable row level security;

create or replace function public.match_subsidy_chunks (
  query_embedding extensions.vector(1536),
  match_count int default 5,
  filter_region_sido text default null,
  filter_region_sigungu text default null
)
returns table (
  id uuid,
  document_id uuid,
  chunk_text text,
  program_name text,
  region_sido text,
  region_sigungu text,
  subsidy_amount_krw bigint,
  subsidy_rate numeric,
  max_subsidy_krw bigint,
  self_payment_krw bigint,
  stacking_allowed boolean,
  source_title text,
  source_url text,
  source_year integer,
  similarity float
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    c.chunk_text,
    c.program_name,
    c.region_sido,
    c.region_sigungu,
    c.subsidy_amount_krw,
    c.subsidy_rate,
    c.max_subsidy_krw,
    c.self_payment_krw,
    c.stacking_allowed,
    c.source_title,
    c.source_url,
    c.source_year,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.subsidy_chunks c
  where c.is_active = true
    and c.embedding is not null
    and (filter_region_sido is null or c.region_sido = filter_region_sido)
    and (filter_region_sigungu is null or c.region_sigungu = filter_region_sigungu)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "requests_select_own" on public.apartment_solar_requests;
create policy "requests_select_own"
on public.apartment_solar_requests for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "requests_insert_own" on public.apartment_solar_requests;
create policy "requests_insert_own"
on public.apartment_solar_requests for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "requests_update_own" on public.apartment_solar_requests;
create policy "requests_update_own"
on public.apartment_solar_requests for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "simulations_select_own" on public.solar_simulations;
create policy "simulations_select_own"
on public.solar_simulations for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "simulations_insert_own" on public.solar_simulations;
create policy "simulations_insert_own"
on public.solar_simulations for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "notifications_select_own" on public.notification_preferences;
create policy "notifications_select_own"
on public.notification_preferences for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "notifications_insert_own" on public.notification_preferences;
create policy "notifications_insert_own"
on public.notification_preferences for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notification_preferences;
create policy "notifications_update_own"
on public.notification_preferences for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "subsidy_programs_public_read" on public.subsidy_programs;
create policy "subsidy_programs_public_read"
on public.subsidy_programs for select
to anon, authenticated
using (true);

drop policy if exists "install_reviews_public_read" on public.install_reviews;
create policy "install_reviews_public_read"
on public.install_reviews for select
to anon, authenticated
using (true);

-- Demo seed data. These rows are public candidates, not live subsidy guarantees.
insert into public.subsidy_programs
  (
    title,
    program_name,
    region,
    region_sido,
    region_sigungu,
    target,
    target_building_type,
    support_type,
    amount_text,
    source_name,
    source_title,
    source_url,
    source_year,
    raw_payload,
    stacking_allowed,
    stacking_note,
    eligibility_note,
    status,
    last_checked_at,
    note
  )
select
  seed.title,
  seed.title,
  seed.region,
  split_part(seed.region, '/', 1),
  seed.region,
  seed.target,
  seed.target,
  seed.support_type,
  seed.amount_text,
  seed.source_name,
  seed.source_name,
  coalesce(seed.source_url, ''),
  extract(year from current_date)::integer,
  jsonb_build_object('source', 'mvp_seed', 'title', seed.title, 'region', seed.region),
  false,
  '중복 지원 여부는 실제 공고 확인 필요',
  seed.note,
  seed.status,
  seed.last_checked_at,
  seed.note
from (
  values
  (
    '한국에너지공단 공동주택 보급사업 후보',
    '전국',
    '아파트 1개 동, 공동주택 공용부 전기 절감 검토 단지',
    '저탄소 모듈 설치 보조',
    '1개 동 최대 30kW, kW당 466,000원 추정',
    '한국에너지공단',
    null,
    '확인 필요',
    current_date,
    '아파트는 경기태양광지원사업 대상이 아니므로 한국에너지공단 공동주택 기준으로 표시합니다. 실제 지원 대상, 예산, 접수 가능 여부는 해당 연도 공고 확인이 필요합니다.'
  ),
  (
    '개인 단독 설치 시 단독주택 지원 검토',
    '전국',
    '아파트 거주 개인이 단독 설치를 희망하는 경우',
    '단독주택 기준 지원 가능성 검토',
    '단독주택 3kW 기준 공고 확인 필요',
    '경기도/시군 및 한국에너지공단 공고',
    null,
    '확인 필요',
    current_date,
    '공동주택 공용부 설치와 별개로 개인 단독 설치 희망 시 검토하는 후보입니다. 수혜가 보장되지 않으며 실제 공고 조건 확인이 필요합니다.'
  ),
  (
    '지자체 탄소중립 예산 연계 후보',
    '화성시/경기도',
    '도심 자가발전 확대와 공공가치가 있는 단지',
    'B2G 리포트, 정책지원 운영 대행 연계',
    '예산 편성 및 과제화 검토 필요',
    '지자체 정책 과제',
    null,
    '마감 임박',
    current_date,
    '정책 참여 확대와 예산 소진 개선 관점의 후보입니다. 실제 사업화는 지자체 협의가 필요합니다.'
  )
) as seed(title, region, target, support_type, amount_text, source_name, source_url, status, last_checked_at, note)
where not exists (
  select 1
  from public.subsidy_programs existing
  where existing.title = seed.title
    and existing.region = seed.region
);

insert into public.install_reviews (apartment_name, region, content, saving_text, rating, is_demo)
select seed.apartment_name, seed.region, seed.content, seed.saving_text, seed.rating, seed.is_demo
from (
  values
    (
      '햇빛마을 아파트',
      '경기 남부',
      '공용 전기요금 부담과 설치 가능성을 한 화면에서 비교할 수 있어 입주민 설명 자료로 쓰기 좋았습니다.',
      '예상 절감액 확인',
      5,
      true
    ),
    (
      '도심그린 공공주택',
      '경기권',
      '보조금 후보가 확정이 아니라 확인 필요 상태로 표시되어 의사결정 리스크를 설명하기 쉬웠습니다.',
      '정책 후보 확인',
      5,
      true
    ),
    (
      '새빛타운',
      '화성시',
      '세대수, 옥상 면적, 월 전기요금만으로 1차 검토를 빠르게 시작할 수 있었습니다.',
      '설치 검토 시작',
      4,
      true
    )
) as seed(apartment_name, region, content, saving_text, rating, is_demo)
where not exists (
  select 1
  from public.install_reviews existing
  where existing.apartment_name = seed.apartment_name
    and existing.region = seed.region
    and existing.content = seed.content
);
