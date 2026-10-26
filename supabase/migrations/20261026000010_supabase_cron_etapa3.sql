-- Revisión diaria de la Etapa 3: mantenimiento preventivo y efectivo de las próximas semanas.
select cron.schedule('revisar-alertas-etapa3', '10 12 * * *', 'select public.revisar_alertas_etapa3()');
