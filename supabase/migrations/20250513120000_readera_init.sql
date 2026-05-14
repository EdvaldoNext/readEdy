-- ReadEra Web: schema inicial
-- Execute no Supabase: SQL Editor > New query > colar > Run.
-- Pré-requisito: Authentication > Providers > Anonymous sign-ins = ON

-- ---------------------------------------------------------------------------
-- Tabela de documentos (metadados; o arquivo PDF fica no Storage)
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  storage_path text not null,
  bytes bigint,
  num_pages integer,
  last_page integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_user_updated_idx
  on public.documents (user_id, updated_at desc);

create or replace function public.readera_touch_updated_at ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.readera_touch_updated_at ();

alter table public.documents enable row level security;

drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own"
  on public.documents for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own"
  on public.documents for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "documents_update_own" on public.documents;
create policy "documents_update_own"
  on public.documents for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_delete_own"
  on public.documents for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Preferências por usuário (tema, TTS) — opcional para sync entre dispositivos
-- ---------------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text default 'light',
  tts_rate real default 1,
  continuous_read boolean default true,
  voice_key text,
  updated_at timestamptz not null default now()
);

drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.readera_touch_updated_at ();

alter table public.user_preferences enable row level security;

drop policy if exists "user_preferences_all_own" on public.user_preferences;
create policy "user_preferences_all_own"
  on public.user_preferences for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage: bucket privado para PDFs (caminho: {user_id}/{document_id}.pdf)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pdfs',
  'pdfs',
  false,
  52428800,
  array['application/pdf']::text[]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pdfs_select_own" on storage.objects;
create policy "pdfs_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'pdfs'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "pdfs_insert_own" on storage.objects;
create policy "pdfs_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pdfs'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "pdfs_update_own" on storage.objects;
create policy "pdfs_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'pdfs'
    and (storage.foldername (name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'pdfs'
    and (storage.foldername (name))[1] = auth.uid()::text
  );

drop policy if exists "pdfs_delete_own" on storage.objects;
create policy "pdfs_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'pdfs'
    and (storage.foldername (name))[1] = auth.uid()::text
  );
