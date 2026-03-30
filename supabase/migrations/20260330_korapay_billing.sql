-- Korapay billing/paywall for SkillConnect
-- - One-time activation fee (NGN 300)
-- - Monthly renewal fee (NGN 300)

-- Add billing fields to profiles (safe to run multiple times)
alter table if exists public.profiles
  add column if not exists activation_paid_at timestamptz,
  add column if not exists subscription_paid_until timestamptz,
  add column if not exists is_public boolean not null default false;

-- Prevent clients from self-activating or extending subscription by locking billing columns
-- (only the `service_role` used by Edge Functions should be able to modify these fields).
create or replace function public.profiles_protect_billing_fields()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    new.activation_paid_at := old.activation_paid_at;
    new.subscription_paid_until := old.subscription_paid_until;
    new.is_public := old.is_public;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_billing_fields on public.profiles;
create trigger trg_profiles_protect_billing_fields
before update on public.profiles
for each row execute function public.profiles_protect_billing_fields();

-- Payments ledger (server-owned)
create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('activation', 'subscription')),
  amount_kobo integer not null check (amount_kobo > 0),
  currency text not null default 'NGN',
  merchant_reference text not null unique,
  korapay_reference text,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'canceled')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  raw_payload jsonb
);

create index if not exists billing_payments_user_id_idx on public.billing_payments(user_id);
create index if not exists billing_payments_status_idx on public.billing_payments(status);

-- RLS
alter table if exists public.billing_payments enable row level security;

do $$
begin
  -- Users can read their own payments (optional, useful for UI)
  begin
    create policy "billing_payments_read_own"
      on public.billing_payments
      for select
      to authenticated
      using (user_id = auth.uid());
  exception
    when duplicate_object then null;
  end;

  -- Profiles: public can only read listed (paid) profiles
  begin
    create policy "profiles_public_read_listed"
      on public.profiles
      for select
      to anon, authenticated
      using (
        is_public = true
        and activation_paid_at is not null
        and subscription_paid_until is not null
        and subscription_paid_until > now()
      );
  exception
    when duplicate_object then null;
  end;

  -- Profiles: owner can read their own record (even if not public)
  begin
    create policy "profiles_read_own"
      on public.profiles
      for select
      to authenticated
      using (id = auth.uid());
  exception
    when duplicate_object then null;
  end;

  -- Profiles: owner can insert their own record
  begin
    create policy "profiles_insert_own"
      on public.profiles
      for insert
      to authenticated
      with check (id = auth.uid());
  exception
    when duplicate_object then null;
  end;

  -- Profiles: owner can update their own record (but not billing fields)
  begin
    create policy "profiles_update_own"
      on public.profiles
      for update
      to authenticated
      using (id = auth.uid())
      with check (id = auth.uid());
  exception
    when duplicate_object then null;
  end;
end $$;
