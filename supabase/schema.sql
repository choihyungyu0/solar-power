-- Supabase schema for the apartment solar MVP.
-- Run this in the Supabase SQL editor after creating a new Supabase project.
-- This schema is designed for a React + TypeScript frontend using Supabase Auth.

create extension if not exists pgcrypto;

-- 1. User profile linked to Supabase Auth users.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  phone text,
  user_type text not null default 'resident',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Apartment/public-housing solar installation request.
create table if not exists public.apartment_solar_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  apartment_name text not null,
  address text not null,
  household_count integer,
  roof_area_m2 numeric,
  monthly_electric_bill_krw integer,
  shade_score integer,
  average_daily_sun_hours numeric,
  contact_method text,
  status text not null default 'submitted',
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Saved solar simulation result.
create table if not exists public.solar_simulations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.apartment_solar_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  suitability_score integer,
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

-- 4. Notification preference. Real Kakao/SMS sending is not part of the MVP.
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid references public.apartment_solar_requests(id) on delete cascade,
  method text not null check (method in ('kakao', 'sms', 'email')),
  destination text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. Public subsidy/policy program list.
create table if not exists public.subsidy_programs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  region text,
  target text,
  support_type text,
  amount_text text,
  source_name text,
  source_url text,
  status text not null default 'checking_required',
  last_checked_at date,
  created_at timestamptz not null default now()
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
  insert into public.profiles (id, email)
  values (new.id, new.email)
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

-- Profiles: each user can read/update only their own row.
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

-- Requests: each user owns their own requests.
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

-- Simulations: each user owns their own simulation rows.
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

-- Notification preferences: each user owns their own notification rows.
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

-- Public read-only tables.
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

-- Demo seed data. Replace or update before final submission.
insert into public.subsidy_programs (title, region, target, support_type, amount_text, source_name, source_url, status, last_checked_at)
values
  ('경기도 주택태양광 지원사업 확인 필요', '경기도', '주택/공동주택', '보조금', '공고 기준 확인 필요', '경기도/경기환경에너지진흥원', null, 'checking_required', current_date),
  ('한국에너지공단 주택지원사업 확인 필요', '전국', '주택', '보조금', '공고 기준 확인 필요', '한국에너지공단 신재생에너지센터', null, 'checking_required', current_date)
on conflict do nothing;

insert into public.install_reviews (apartment_name, region, content, saving_text, rating, is_demo)
values
  ('햇빛마을 데모아파트', '경기 성남시', '공용 전기요금 절감 가능성을 한눈에 볼 수 있어 입주민 회의 자료로 쓰기 좋았습니다.', '데모 절감액', 5, true),
  ('도심그린 데모단지', '경기 수원시', '보조금과 자부담 예상치를 같이 보여줘서 의사결정이 쉬웠습니다.', '데모 보조금', 5, true)
on conflict do nothing;
