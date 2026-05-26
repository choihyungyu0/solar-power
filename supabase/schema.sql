-- Supabase schema for the apartment/public-housing solar adoption MVP.
-- Run this in the Supabase SQL editor after creating a Supabase project.
-- Frontend keys must be VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY only.

create extension if not exists pgcrypto;

-- 1. User profile linked to Supabase Auth users.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  phone text,
  user_type text not null default 'resident'
    check (user_type in ('resident', 'manager', 'owner', 'public_officer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

-- 6. Public demo/review content.
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
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''))
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
alter table public.install_reviews enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = auth.uid());

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
  (title, region, target, support_type, amount_text, source_name, source_url, status, last_checked_at, note)
values
  (
    '경기도 공동주택 태양광 지원 후보',
    '경기도',
    '공동주택, 공공임대, 관리주체 검토 단지',
    '설치비 일부 보조 또는 정책사업 연계',
    '연도별 공고 확인 필요',
    '경기도/지자체 공고',
    null,
    '확인 필요',
    current_date,
    '데모 데이터입니다. 실제 지원 대상, 예산, 접수 가능 여부는 해당 연도 공고 확인이 필요합니다.'
  ),
  (
    '한국에너지공단 주택·건물 지원사업 후보',
    '전국',
    '주택, 건물, 공동 이용부 전기 절감 검토 대상',
    '보조금 또는 정책자금',
    '사업 공고 및 예산 기준 확인 필요',
    '한국에너지공단',
    'https://www.knrec.or.kr/',
    '접수중',
    current_date,
    'MVP 후보 데이터입니다. 수혜가 보장되지 않으며 실제 공고 조건 확인이 필요합니다.'
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
on conflict (title, region) do update
set
  target = excluded.target,
  support_type = excluded.support_type,
  amount_text = excluded.amount_text,
  source_name = excluded.source_name,
  source_url = excluded.source_url,
  status = excluded.status,
  last_checked_at = excluded.last_checked_at,
  note = excluded.note;

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
