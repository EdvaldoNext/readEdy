-- Soft-delete na biblioteca: apagar esconde o PDF (deleted_at)
-- em vez de depender só do localStorage da TV/browser.
-- A conta admin deixa de ver documentos de outros usuários / órfãos
-- na biblioteca pessoal (o painel admin não usa esta tabela).

alter table public.documents
  add column if not exists deleted_at timestamptz;

create index if not exists documents_user_active_updated_idx
  on public.documents (user_id, updated_at desc)
  where deleted_at is null;

create index if not exists documents_user_deleted_idx
  on public.documents (user_id, deleted_at desc)
  where deleted_at is not null;

drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own"
  on public.documents for select to authenticated
  using (user_id = (select auth.uid()));
