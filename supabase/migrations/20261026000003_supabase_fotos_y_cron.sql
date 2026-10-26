-- =====================================================================
-- BE Food · Etapa 1 · Partes propias de Supabase
-- Fotos de prueba (tickets de báscula, cargas, revisiones) y la revisión
-- diaria de avisos. Las fotos no se pueden borrar ni reemplazar.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', false)
on conflict (id) do nothing;

create policy "fotos: subir usuarios activos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos' and public.mi_rol() is not null);

create policy "fotos: ver usuarios activos" on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos' and public.mi_rol() is not null);

-- Todos los días a las 6:00 a.m. de Nicaragua (12:00 UTC).
create extension if not exists pg_cron;
select cron.schedule('revisar-alertas', '0 12 * * *', 'select public.revisar_alertas()');
