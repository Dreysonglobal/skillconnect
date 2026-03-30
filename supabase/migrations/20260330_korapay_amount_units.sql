-- Korapay Checkout Standard amount is passed as major currency units (e.g., NGN 300),
-- while we still want to store minor units (kobo) for internal consistency.

alter table if exists public.billing_payments
  add column if not exists amount_naira integer;

-- Best-effort backfill for existing rows (only if amount_naira is null)
update public.billing_payments
set amount_naira = case
  when amount_naira is not null then amount_naira
  when amount_kobo is null then null
  else (amount_kobo / 100)
end
where amount_naira is null;

