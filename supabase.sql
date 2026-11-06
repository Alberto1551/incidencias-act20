-- Ejecutar en Supabase > SQL Editor
-- Antes: Authentication > Sign In / Providers > activar "Allow anonymous sign-ins"

-- 1) Bucket PRIVADO con límite de tamaño y tipos permitidos (validación del lado del servidor)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incidencias', 'incidencias', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) Políticas de Storage: cada usuario solo puede subir y leer dentro de SU carpeta (<uid>/archivo)
create policy "incidencias: subir en carpeta propia"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'incidencias'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "incidencias: leer archivos propios"
on storage.objects for select to authenticated
using (
  bucket_id = 'incidencias'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- 3) Tabla que relaciona la incidencia con su imagen (se guarda la RUTA, no la imagen)
create table if not exists public.incidencias (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo      text not null check (char_length(titulo) between 3 and 100),
  descripcion text,
  imagen_path text not null,
  created_at  timestamptz not null default now()
);

alter table public.incidencias enable row level security;

create policy "incidencias: ver las propias"
on public.incidencias for select to authenticated
using (user_id = (select auth.uid()));

create policy "incidencias: crear propias"
on public.incidencias for insert to authenticated
with check (user_id = (select auth.uid()));
