-- SolarMate AI Profit Report Agent - Supabase table/RLS verification
-- Run in Supabase SQL Editor. Do not expose result rows publicly.

select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profit_reports', 'subsidy_programs', 'loan_scenarios')
order by tablename;

select
  id,
  created_at,
  analysis_result_id,
  report_type,
  report_status,
  report_json->'fourMetrics' as four_metrics,
  report_json->'netInvestment' as net_investment
from public.profit_reports
order by created_at desc
limit 5;

select
  id,
  created_at,
  analysis_result_id,
  loan_years,
  loan_coverage_ratio,
  estimated_loan_limit_krw,
  annual_revenue_basis_krw,
  monthly_payment_estimate_krw
from public.loan_scenarios
order by created_at desc
limit 5;
