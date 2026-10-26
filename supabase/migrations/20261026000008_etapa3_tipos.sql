-- =====================================================================
-- BE Food · Etapa 3 · Tipos nuevos
-- Va en su propio archivo: Postgres no deja usar un valor nuevo de un
-- tipo en la misma transacción en que se crea.
-- =====================================================================
alter type public.tipo_item add value if not exists 'repuesto';
alter type public.tipo_orden add value if not exists 'repuestos';
