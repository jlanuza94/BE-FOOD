-- =====================================================================
-- BE Food · Etapa 2 · Tipos nuevos
-- Va en su propio archivo: Postgres no deja usar un valor nuevo de un
-- tipo en la misma transacción en que se crea.
-- =====================================================================
alter type public.tipo_orden add value if not exists 'despacho';
