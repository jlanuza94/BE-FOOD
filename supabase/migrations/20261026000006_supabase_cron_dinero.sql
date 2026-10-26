-- =====================================================================
-- BE Food · Etapa 2 · Parte propia de Supabase
-- Avisos diarios de clientes atrasados y pagos por vencer.
-- =====================================================================

-- Todos los días a las 6:05 a.m. de Nicaragua (12:05 UTC).
select cron.schedule('revisar-alertas-dinero', '5 12 * * *', 'select public.revisar_alertas_dinero()');
