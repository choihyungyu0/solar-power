select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('subsidy_documents', 'subsidy_chunks')
order by tablename;

select
  routine_schema,
  routine_name,
  routine_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'match_subsidy_chunks';

select
  id,
  created_at,
  source_type,
  source_title,
  region_sido,
  region_sigungu,
  program_name,
  is_active
from public.subsidy_documents
order by created_at desc
limit 5;

select
  id,
  created_at,
  program_name,
  region_sido,
  region_sigungu,
  subsidy_amount_krw,
  max_subsidy_krw,
  self_payment_krw,
  stacking_allowed,
  source_title,
  source_year
from public.subsidy_chunks
order by created_at desc
limit 5;
