-- ============================================================
-- Novatech ERP — schema Supabase
-- Rulează tot acest fișier în Supabase → SQL Editor → New query → Run
-- ============================================================

-- Tabelul care ține toate datele aplicației, ca un singur "document" JSON
-- (proiecte, angajați, clienți, facturi, active, cashflow etc.)
create table if not exists app_state (
  id int primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Activează Row Level Security (RLS) — obligatoriu pentru siguranță
alter table app_state enable row level security;

-- Doar utilizatorii autentificați (cu email+parolă) pot citi datele
create policy "Utilizatori autentificați pot citi"
  on app_state for select
  to authenticated
  using (true);

-- Doar utilizatorii autentificați pot actualiza datele
create policy "Utilizatori autentificați pot actualiza"
  on app_state for update
  to authenticated
  using (true);

-- Doar utilizatorii autentificați pot insera (necesar prima dată, la creare)
create policy "Utilizatori autentificați pot insera"
  on app_state for insert
  to authenticated
  with check (true);

-- Activează sincronizarea live (Realtime) pentru acest tabel
alter publication supabase_realtime add table app_state;
