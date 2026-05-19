-- Solar Power MVP initial Supabase schema
-- 이 파일은 Supabase SQL Editor 또는 Supabase CLI migration으로 실행할 수 있습니다.
-- 프론트엔드에는 절대 service_role key를 넣지 마세요.

create extension if not exists pgcrypto;

-- 1. 사용자 프로필
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  phone text,
  user_type text not null default 'resident' check (user_type in ('resident', 'manager', 'owner', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 2. 우리 아파트 태양광 설치 신청
create table if not exists public.apartment_solar_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  apartment_name text not null,
  address text not null,
  household_count integer check (household_count is null or household_count > 0),
  roof_area_m2 numeric check (roof_area_m2 is null or roof_area_m2 >= 0),
  monthly_electric_bill integer check (monthly_electric_bill is null or monthly_electric_bill >= 0),
  contact_method text default 'web' check (contact_method in ('kakao', 'sms', 'email', 'web')),
  notes text,
  status text not null default 'submitted' check (status in ('draft', 'submitted', 'reviewing', 'reported', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists apartment_solar_requests_user_id_idx
  on public.apartment_solar_requests(user_id);

alter table public.apartment_solar_requests enable row level security;

drop policy if exists "solar_requests_select_own" on public.apartment_solar_requests;
create policy "solar_requests_select_own"
  on public.apartment_solar_requests for select
  using (auth.uid() = user_id);

drop policy if exists "solar_requests_insert_own" on public.apartment_solar_requests;
create policy "solar_requests_insert_own"
  on public.apartment_solar_requests for insert
  with check (auth.uid() = user_id);

drop policy if exists "solar_requests_update_own" on public.apartment_solar_requests;
create policy "solar_requests_update_own"
  on public.apartment_solar_requests for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. 태양광 시뮬레이션 결과
create table if not exists public.solar_simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  request_id uuid references public.apartment_solar_requests(id) on delete cascade,
  recommended_capacity_kw numeric,
  panel_count integer,
  expected_monthly_generation_kwh numeric,
  expected_yearly_generation_kwh numeric,
  expected_yearly_saving integer,
  estimated_install_cost integer,
  estimated_subsidy integer,
  estimated_self_payment integer,
  payback_years numeric,
  suitability_score integer check (suitability_score is null or (suitability_score >= 0 and suitability_score <= 100)),
  calculation_note text default 'MVP 예상 산식 기준 결과입니다. 실제 설치 가능 여부와 금액은 현장 조사 및 해당 연도 공고 기준으로 달라질 수 있습니다.',
  created_at timestamptz not null default now()
);

create index if not exists solar_simulations_user_id_idx
  on public.solar_simulations(user_id);

create index if not exists solar_simulations_request_id_idx
  on public.solar_simulations(request_id);

alter table public.solar_simulations enable row level security;

drop policy if exists "solar_simulations_select_own" on public.solar_simulations;
create policy "solar_simulations_select_own"
  on public.solar_simulations for select
  using (auth.uid() = user_id);

drop policy if exists "solar_simulations_insert_own" on public.solar_simulations;
create policy "solar_simulations_insert_own"
  on public.solar_simulations for insert
  with check (auth.uid() = user_id);

-- 4. 정책자금/보조금 후보
create table if not exists public.subsidy_programs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  region text,
  target text,
  support_type text,
  amount_text text,
  apply_url text,
  status text not null default 'open' check (status in ('open', 'scheduled', 'closed', 'unknown')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subsidy_programs enable row level security;

drop policy if exists "subsidy_programs_public_read" on public.subsidy_programs;
create policy "subsidy_programs_public_read"
  on public.subsidy_programs for select
  using (true);

-- 5. 가입후기/도입후기
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  apartment_name text,
  region text,
  content text not null,
  saving_text text,
  rating integer not null default 5 check (rating >= 1 and rating <= 5),
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.reviews enable row level security;

drop policy if exists "reviews_public_read" on public.reviews;
create policy "reviews_public_read"
  on public.reviews for select
  using (is_public = true or auth.uid() = user_id);

drop policy if exists "reviews_insert_authenticated" on public.reviews;
create policy "reviews_insert_authenticated"
  on public.reviews for insert
  with check (auth.uid() = user_id);

-- 6. 알림 신청
create table if not exists public.notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  request_id uuid references public.apartment_solar_requests(id) on delete cascade,
  channel text not null check (channel in ('kakao', 'sms', 'email', 'web')),
  destination text,
  consent boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.notification_subscriptions enable row level security;

drop policy if exists "notification_subscriptions_select_own" on public.notification_subscriptions;
create policy "notification_subscriptions_select_own"
  on public.notification_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "notification_subscriptions_insert_own" on public.notification_subscriptions;
create policy "notification_subscriptions_insert_own"
  on public.notification_subscriptions for insert
  with check (auth.uid() = user_id);

-- 7. 신규 회원 가입 시 profiles 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 8. 데모용 정책 데이터
insert into public.subsidy_programs (title, region, target, support_type, amount_text, apply_url, status, note)
values
  (
    '경기도 주택태양광 지원 후보',
    '경기도',
    '공동주택/주택 태양광 설치 희망자',
    '설치비 일부 지원',
    '연도별 공고 기준 확인 필요',
    'https://ggre100home.or.kr/',
    'unknown',
    'MVP 데모 데이터입니다. 실제 신청 가능 여부와 금액은 해당 연도 공고 기준으로 확인해야 합니다.'
  ),
  (
    '한국에너지공단 주택지원사업 후보',
    '전국',
    '신재생에너지 설비 설치 주택',
    '정부 보조금',
    '연도별 공고 기준 확인 필요',
    'https://www.knrec.or.kr/',
    'unknown',
    'MVP 데모 데이터입니다. 실제 지원 조건은 한국에너지공단 공고 기준으로 확인해야 합니다.'
  )
on conflict do nothing;

-- 9. 데모용 후기 데이터
insert into public.reviews (apartment_name, region, content, saving_text, rating, is_public)
values
  (
    '샘플 그린아파트',
    '경기도',
    '공용 전기료 부담을 줄일 수 있는지 먼저 예상 리포트를 받아볼 수 있어서 좋았습니다.',
    '예상 절감액 확인',
    5,
    true
  ),
  (
    '샘플 햇빛마을',
    '경기도',
    '보조금 후보와 신청 준비사항을 한 화면에서 볼 수 있어 입주민 설명회 자료로 활용하기 좋았습니다.',
    '정책자금 후보 확인',
    5,
    true
  )
on conflict do nothing;
