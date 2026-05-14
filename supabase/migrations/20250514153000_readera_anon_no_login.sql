-- ReadEra: nuvem sem login (sem sessão Supabase Auth).
-- Usa apenas a chave "anon" no browser. ATENÇÃO: qualquer um com a URL do site + anon key
-- pode listar/alterar PDFs deste bucket neste projeto — aceitável só para uso pessoal/demo.

-- ---------------------------------------------------------------------------
-- documents: user_id opcional (sem auth.uid())
-- ---------------------------------------------------------------------------
alter table public.documents drop constraint if exists documents_user_id_fkey;
alter table public.documents alter column user_id drop not null;
alter table public.documents alter column user_id drop default;

drop policy if exists "documents_select_own" on public.documents;
drop policy if exists "documents_insert_own" on public.documents;
drop policy if exists "documents_update_own" on public.documents;
drop policy if exists "documents_delete_own" on public.documents;

drop policy if exists "documents_anon_select" on public.documents;
create policy "documents_anon_select"
  on public.documents for select to anon using (true);

drop policy if exists "documents_anon_insert" on public.documents;
create policy "documents_anon_insert"
  on public.documents for insert to anon with check (true);

drop policy if exists "documents_anon_update" on public.documents;
create policy "documents_anon_update"
  on public.documents for update to anon using (true) with check (true);

drop policy if exists "documents_anon_delete" on public.documents;
create policy "documents_anon_delete"
  on public.documents for delete to anon using (true);

-- authenticated antigo (se alguém ainda tiver sessão) mantém acesso total à tabela
drop policy if exists "documents_auth_select" on public.documents;
create policy "documents_auth_select"
  on public.documents for select to authenticated using (true);
drop policy if exists "documents_auth_insert" on public.documents;
create policy "documents_auth_insert"
  on public.documents for insert to authenticated with check (true);
drop policy if exists "documents_auth_update" on public.documents;
create policy "documents_auth_update"
  on public.documents for update to authenticated using (true) with check (true);
drop policy if exists "documents_auth_delete" on public.documents;
create policy "documents_auth_delete"
  on public.documents for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- user_preferences: sem uso sem login (RLS sem política para anon = inacessível)
-- ---------------------------------------------------------------------------
drop policy if exists "user_preferences_all_own" on public.user_preferences;

drop policy if exists "user_preferences_auth" on public.user_preferences;
create policy "user_preferences_auth"
  on public.user_preferences for all to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Storage pdfs: anon pode ler/escrever qualquer objeto neste bucket
-- ---------------------------------------------------------------------------
drop policy if exists "pdfs_select_own" on storage.objects;
drop policy if exists "pdfs_insert_own" on storage.objects;
drop policy if exists "pdfs_update_own" on storage.objects;
drop policy if exists "pdfs_delete_own" on storage.objects;

drop policy if exists "pdfs_anon_select" on storage.objects;
create policy "pdfs_anon_select"
  on storage.objects for select to anon using (bucket_id = 'pdfs');

drop policy if exists "pdfs_anon_insert" on storage.objects;
create policy "pdfs_anon_insert"
  on storage.objects for insert to anon with check (bucket_id = 'pdfs');

drop policy if exists "pdfs_anon_update" on storage.objects;
create policy "pdfs_anon_update"
  on storage.objects for update to anon using (bucket_id = 'pdfs') with check (bucket_id = 'pdfs');

drop policy if exists "pdfs_anon_delete" on storage.objects;
create policy "pdfs_anon_delete"
  on storage.objects for delete to anon using (bucket_id = 'pdfs');

drop policy if exists "pdfs_auth_all" on storage.objects;
create policy "pdfs_auth_all"
  on storage.objects for all to authenticated using (bucket_id = 'pdfs') with check (bucket_id = 'pdfs');
