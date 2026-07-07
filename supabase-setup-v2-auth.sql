-- ═══════════════════════════════════════════════════════════════
-- PatrimônioIgreja — Setup v2: Supabase Auth real + políticas seguras
-- Rode no SQL Editor do projeto fyggsslndwsguavhduly
-- Pode rodar depois do supabase-setup.sql original, sem problema.
-- ═══════════════════════════════════════════════════════════════

-- 1) Tabela de perfis, vinculada ao sistema de autenticação do Supabase.
--    Não guarda mais senha nenhuma — a senha fica só dentro do Supabase Auth
--    (criptografada), o app nunca vê nem armazena a senha em texto puro.
create table if not exists "CaieirasPatrimonio_perfis" (
  id uuid primary key references auth.users(id) on delete cascade,
  login text unique not null,
  nome text,
  church text default '',
  is_master boolean not null default false,
  created_at timestamptz not null default now()
);

alter table "CaieirasPatrimonio_perfis" enable row level security;

drop policy if exists "perfis select" on "CaieirasPatrimonio_perfis";
create policy "perfis select" on "CaieirasPatrimonio_perfis"
  for select using (auth.role() = 'authenticated');

-- Não existe policy de insert/update/delete para perfis:
-- só a Edge Function (com a service_role key) pode alterar usuários.
-- Isso impede qualquer escrita direta via API mesmo com a anon key.

-- 2) Tabela principal de dados: leitura pública (necessária para a tela
--    de login carregar a lista de igrejas antes do usuário logar),
--    mas escrita só para quem estiver autenticado no app.
alter table "CaieirasPatrimonio_main" enable row level security;

drop policy if exists "acesso publico main" on "CaieirasPatrimonio_main";
drop policy if exists "main select" on "CaieirasPatrimonio_main";
drop policy if exists "main insert" on "CaieirasPatrimonio_main";
drop policy if exists "main update" on "CaieirasPatrimonio_main";

create policy "main select" on "CaieirasPatrimonio_main"
  for select using (true);

create policy "main insert" on "CaieirasPatrimonio_main"
  for insert with check (auth.role() = 'authenticated');

create policy "main update" on "CaieirasPatrimonio_main"
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 3) A tabela antiga de usuários em texto puro não é mais usada — pode remover.
drop table if exists "CaieirasPatrimonio_usuarios";

-- 4) Garante que a tabela principal está no Realtime (idempotente).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'CaieirasPatrimonio_main'
  ) then
    alter publication supabase_realtime add table "CaieirasPatrimonio_main";
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════
-- IMPORTANTE — Depois de rodar este SQL:
-- 1. No Supabase Dashboard vá em Authentication > Providers > Email
--    e DESATIVE "Confirm email" (o app usa e-mails fictícios internos,
--    ex: joao@caieiraspatrimonio.local, então a confirmação por e-mail
--    nunca vai chegar).
-- 2. Deploy da Edge Function "admin-users" (veja admin-users/index.ts)
--    é obrigatório para criar/editar/excluir usuários pelo app.
-- 3. O primeiro usuário master é criado automaticamente pelo próprio
--    app na primeira vez que alguém usar o formulário de "Novo Usuário"
--    (a Edge Function detecta que não existe nenhum perfil ainda e
--    cria esse primeiro usuário como master).
-- ═══════════════════════════════════════════════════════════════
