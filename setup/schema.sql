-- Hangout hours: database schema and permissions.
-- Safe to run more than once (it never deletes data).
-- Run it in Supabase: Dashboard > SQL Editor > paste > Run. setup/provision.mjs runs it for you.

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables ----------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name    text not null unique constraint profiles_name_check check (name in ('Ross','Baz','Patrick'))
);

create table if not exists public.rota (
  date       date not null,
  person     text not null constraint rota_person_check check (person in ('Ross','Baz','Patrick')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (date, person)
);

create table if not exists public.shift_notes (
  person         text not null constraint shift_notes_person_check check (person in ('Ross','Baz','Patrick')),
  date           date not null,
  hours_override numeric null check (hours_override between 0 and 24),
  note           text not null default '' check (length(note) <= 500),
  primary key (person, date)
);

create table if not exists public.logs (
  id         uuid primary key default gen_random_uuid(),
  person     text not null constraint logs_person_check check (person in ('Ross','Baz','Patrick')),
  date       date not null,
  category   text not null check (category in ('setting','maintenance','website','board','admin','other')),
  hours      numeric null check (hours between 0 and 24),   -- null = "hours not known yet" (old imported entries)
  note       text not null default '' check (length(note) <= 500),
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id                uuid primary key default gen_random_uuid(),
  person            text not null constraint expenses_person_check check (person in ('Ross','Baz','Patrick')),
  date              date not null,
  amount_gbp        numeric(8,2) not null check (amount_gbp > 0),
  description       text not null check (length(description) between 1 and 300),
  status            text not null default 'unpaid' check (status in ('unpaid','reimbursed')),
  reimbursed_at     timestamptz null,
  reimbursed_method text null check (reimbursed_method in ('cash_drawer','bank','other')),
  created_at        timestamptz not null default now(),
  check ((status = 'unpaid' and reimbursed_at is null and reimbursed_method is null)
      or (status = 'reimbursed' and reimbursed_at is not null and reimbursed_method is not null))
);

-- ---------- who am I? (the profile name of the signed-in user, or null) ----------
create or replace function public.my_name() returns text
language sql stable security definer set search_path = public
as $$ select name from public.profiles where user_id = auth.uid() $$;
revoke all on function public.my_name() from public, anon;
grant execute on function public.my_name() to authenticated;

-- ---------- grants: nothing for anonymous visitors ----------
revoke all on all tables in schema public from anon, authenticated;
grant select                         on public.profiles    to authenticated;
grant select, insert, delete         on public.rota        to authenticated;
grant select, insert, update, delete on public.shift_notes to authenticated;
grant select, insert, update, delete on public.logs        to authenticated;
grant select, insert, update, delete on public.expenses    to authenticated;

-- ---------- row level security ----------
alter table public.profiles    enable row level security;
alter table public.rota        enable row level security;
alter table public.shift_notes enable row level security;
alter table public.logs        enable row level security;
alter table public.expenses    enable row level security;

-- Everyone with a profile can read everything.
drop policy if exists "staff read" on public.profiles;
create policy "staff read" on public.profiles    for select to authenticated using (public.my_name() is not null);
drop policy if exists "staff read" on public.rota;
create policy "staff read" on public.rota        for select to authenticated using (public.my_name() is not null);
drop policy if exists "staff read" on public.shift_notes;
create policy "staff read" on public.shift_notes for select to authenticated using (public.my_name() is not null);
drop policy if exists "staff read" on public.logs;
create policy "staff read" on public.logs        for select to authenticated using (public.my_name() is not null);
drop policy if exists "staff read" on public.expenses;
create policy "staff read" on public.expenses    for select to authenticated using (public.my_name() is not null);

-- Rota is shared planning: anyone can add or remove anyone.
drop policy if exists "staff add" on public.rota;
create policy "staff add" on public.rota for insert to authenticated
  with check (public.my_name() is not null and created_by is not distinct from auth.uid());
drop policy if exists "staff remove" on public.rota;
create policy "staff remove" on public.rota for delete to authenticated using (public.my_name() is not null);

-- Shift notes, logs and costs: only your own.
drop policy if exists "own insert" on public.shift_notes;
create policy "own insert" on public.shift_notes for insert to authenticated with check (person = public.my_name());
drop policy if exists "own update" on public.shift_notes;
create policy "own update" on public.shift_notes for update to authenticated using (person = public.my_name()) with check (person = public.my_name());
drop policy if exists "own delete" on public.shift_notes;
create policy "own delete" on public.shift_notes for delete to authenticated using (person = public.my_name());

drop policy if exists "own insert" on public.logs;
create policy "own insert" on public.logs for insert to authenticated with check (person = public.my_name());
drop policy if exists "own update" on public.logs;
create policy "own update" on public.logs for update to authenticated using (person = public.my_name()) with check (person = public.my_name());
drop policy if exists "own delete" on public.logs;
create policy "own delete" on public.logs for delete to authenticated using (person = public.my_name());

-- Costs: only the person who logged it can edit it or mark it reimbursed (and undo).
-- A new cost always starts unpaid; it can only be deleted while unpaid.
drop policy if exists "own insert" on public.expenses;
create policy "own insert" on public.expenses for insert to authenticated with check (person = public.my_name() and status = 'unpaid');
drop policy if exists "own update" on public.expenses;
create policy "own update" on public.expenses for update to authenticated using (person = public.my_name()) with check (person = public.my_name());
drop policy if exists "own delete" on public.expenses;
create policy "own delete" on public.expenses for delete to authenticated using (person = public.my_name() and status = 'unpaid');
