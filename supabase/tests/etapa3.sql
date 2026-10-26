-- Pruebas de la Etapa 3: caja y bancos, personal y planilla, mantenimiento.
-- Sigue con los datos de etapa1.sql, etapa2.sql y mejoras.sql.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;
\o /dev/null

reset role;
insert into auth.users (email, raw_user_meta_data) values ('mant@befood.ni', '{"nombre":"Mantenimiento"}');
update public.perfiles p set activo = true, rol = 'mantenimiento' from auth.users u where u.id = p.id and u.email = 'mant@befood.ni';
set role authenticated;

-- ---------------------------------------------------------------------
-- Caja y bancos
-- ---------------------------------------------------------------------
-- Lo de la Etapa 2 ya movió dinero: gastos por caja, abono y pago por el banco
select pruebas.como('admin@befood.ni');
select pruebas.igual((select saldo from public.saldos_cuentas where nombre = 'Caja general'), -1500::numeric, 'Los gastos salieron de la caja');
select pruebas.igual((select saldo from public.saldos_cuentas where nombre = 'Banco principal'), -15000::numeric, 'Abono entra y pago sale del banco');

select pruebas.error($$select public.registrar_movimiento_dinero(1, 'entrada', 100, 'cobro', 'x')$$, 'en su pantalla');
select pruebas.error($$select public.registrar_movimiento_dinero(1, 'salida', 100, 'otro', 'Café')$$, 'foto del recibo');
select public.registrar_movimiento_dinero(1, 'entrada', 50000, 'aporte', 'Aporte de los socios');
select public.registrar_movimiento_dinero(3, 'entrada', 40000, 'prestamo', 'Préstamo del banco', 'P-1');
select public.transferir_dinero(1, 2, 2000);
select pruebas.error($$select public.transferir_dinero(2, 1, 5000)$$, 'solo hay');
select pruebas.error($$select public.transferir_dinero(1, 3, 1000)$$, 'número de la boleta');
select pruebas.igual((select saldo from public.saldos_cuentas where nombre = 'Caja chica'), 2000::numeric, 'Caja chica con su fondo');

select pruebas.como('vendedor@befood.ni');
select pruebas.igual((select count(*) from public.movimientos_dinero), 0::bigint, 'El vendedor no ve el dinero');
select pruebas.error($$select public.registrar_movimiento_dinero(1, 'entrada', 1, 'otro', 'x')$$, 'no permite');
select pruebas.error($$select public.flujo_de_caja()$$, 'no permite ver el dinero');

-- Cierre de caja: la app dice 46,500 y hay 46,450
select pruebas.como('admin@befood.ni');
select pruebas.error($$select public.cerrar_caja(1, 46450)$$, 'no cuadra');
select pruebas.error($$select public.cerrar_caja(3, 1000, 'x')$$, 'cajas de efectivo');
select public.cerrar_caja(1, 46450, 'Se pagó un taxi sin recibo');
select pruebas.igual((select saldo from public.saldos_cuentas where nombre = 'Caja general'), 46450::numeric, 'La caja queda con lo contado');
select pruebas.error($$select public.cerrar_caja(1, 46450)$$, 'ya se cerró hoy');
select public.cerrar_caja(2, 2000);
select pruebas.como('gerente@befood.ni');
select pruebas.igual((select count(*) from public.avisos where tipo = 'caja_no_cuadra' and mensaje like '%faltan C$ 50%'), 1::bigint, 'Aviso de caja que no cuadra');

-- Conciliación con el estado de cuenta
select pruebas.como('admin@befood.ni');
select pruebas.igual(public.conciliar_movimientos(array(select id from public.movimientos_dinero where cuenta_id = 3)), 3, 'Movimientos del banco conciliados');
select pruebas.igual(public.conciliar_movimientos(array(select id from public.movimientos_dinero where cuenta_id = 1)), 0, 'La caja no se concilia');

-- ---------------------------------------------------------------------
-- Personal y planilla
-- ---------------------------------------------------------------------
select public.guardar_empleado(null, 'Pedro Operador', 'Operador de peletizadora', 'planta', 12000, public.hoy() - 40);
select public.guardar_empleado(null, 'Ana Contadora', 'Asistente contable', 'administracion', 15000, public.hoy() - 400,
  p_marca_asistencia => false);
select pruebas.error($$select public.guardar_empleado(1, 'Pedro Operador', 'Operador de peletizadora', 'planta', 20000, public.hoy() - 40)$$,
                     'Solo Gerencia cambia salarios');

select pruebas.como('vendedor@befood.ni');
select pruebas.igual((select count(*) from public.empleados), 0::bigint, 'El vendedor no ve salarios');
select pruebas.igual((select count(*) from public.empleados_lista), 2::bigint, 'Pero sí la lista para marcar');

-- Asistencia con foto: entrada y salida
select pruebas.como('operador@befood.ni');
select pruebas.error($$select public.marcar_asistencia(1, '')$$, 'Falta la foto');
select pruebas.igual(left(public.marcar_asistencia(1, 'asistencia/1.jpg'), 25), 'Entrada de Pedro Operador', 'Marca la entrada');
select pruebas.igual(left(public.marcar_asistencia(1, 'asistencia/2.jpg'), 24), 'Salida de Pedro Operador', 'Marca la salida');
select pruebas.error($$select public.marcar_asistencia(1, 'asistencia/3.jpg')$$, 'ya marcó entrada y salida');

select pruebas.como('admin@befood.ni');
select pruebas.error($$select public.corregir_asistencia(1, public.hoy() - 1, now() - interval '34 hours', now() - interval '24 hours', '')$$, 'motivo');
select public.corregir_asistencia(1, public.hoy() - 1, now() - interval '34 hours', now() - interval '24 hours', 'Olvidó marcar');
select pruebas.igual((select horas_extra from public.asistencia where fecha = public.hoy() - 1), 2::numeric, 'Diez horas: dos extra');

-- Adelanto: se pide, Gerencia aprueba, se entrega con recibo
select public.solicitar_adelanto(1, 2000, 2, 'Medicinas');
select pruebas.error($$select public.entregar_adelanto(1, 1, 'recibo.jpg')$$, 'Sin aprobación de Gerencia');
select pruebas.error($$select public.aprobar_adelanto(1, true)$$, 'Solo Gerencia');
select pruebas.como('gerente@befood.ni');
select public.aprobar_adelanto(1, true);
select pruebas.como('admin@befood.ni');
select pruebas.error($$select public.entregar_adelanto(1, 1, '')$$, 'recibo firmado');
select public.entregar_adelanto(1, 1, 'recibo.jpg');

-- Planilla de la quincena
select public.calcular_planilla(public.hoy() - 14, public.hoy());
select pruebas.error($$select public.calcular_planilla(public.hoy() - 3, public.hoy() + 5)$$, 'Ya hay una planilla');
select pruebas.igual((select dias_periodo from public.planillas_lineas where empleado_id = 1), 15::numeric, 'Quincena de 15 días');
select pruebas.igual((select dias_falta from public.planillas_lineas where empleado_id = 1),
                     (select count(*)::numeric from generate_series(public.hoy() - 14, public.hoy(), interval '1 day') d
                       where extract(isodow from d) <> 7 and d::date not in (public.hoy(), public.hoy() - 1)),
                     'Faltas: días hábiles sin marca');
select pruebas.igual((select dias_falta from public.planillas_lineas where empleado_id = 2), 0::numeric, 'Quien no marca no tiene faltas');
select pruebas.error($$select public.ajustar_linea_planilla((select id from public.planillas_lineas where empleado_id = 1), 0, 2, 0, 0)$$, 'motivo del cambio');
select public.ajustar_linea_planilla((select id from public.planillas_lineas where empleado_id = 1), 0, 2, 0, 0, 'Empezó a marcar ayer');
-- 12,000 / 30 × 15 = 6,000 + 2 horas extra dobles (100 c/u) = 6,200
select pruebas.igual((select bruto from public.planillas_lineas where empleado_id = 1), 6200::numeric, 'Bruto con horas extra');
select pruebas.igual((select inss_laboral from public.planillas_lineas where empleado_id = 1), 434::numeric, 'INSS laboral 7 %');
select pruebas.igual((select ir from public.planillas_lineas where empleado_id = 1), 239.90, 'IR de la quincena');
select pruebas.igual((select adelantos from public.planillas_lineas where empleado_id = 1), 1000::numeric, 'Primera cuota del adelanto');
select pruebas.igual((select neto from public.planillas_lineas where empleado_id = 1), 4526.10, 'Neto de Pedro');
select pruebas.igual((select neto from public.planillas_lineas where empleado_id = 2), 6553.75, 'Neto de Ana');

select pruebas.error($$select public.pagar_planilla(1, 1, 'x')$$, 'Sin aprobación');
select public.enviar_planilla(1);
select pruebas.como('gerente@befood.ni');
select public.aprobar_planilla(1);
select pruebas.como('admin@befood.ni');
select pruebas.error($$select public.ajustar_linea_planilla((select id from public.planillas_lineas where empleado_id = 1), 0, 0, 0, 0, 'x')$$, 'borrador');
select public.pagar_planilla(1, 1, null, 'planillas/1.jpg');
select pruebas.igual((select monto from public.movimientos_dinero where categoria = 'planilla'), 11079.85, 'Sale el neto de la caja');
select pruebas.igual((select monto from public.gastos where origen = 'planilla:1' and incluir_en_costo), 7657::numeric,
                     'La planilla de planta (con INSS patronal e INATEC) entra al costo del saco');
select pruebas.igual((select monto from public.gastos where origen = 'planilla:1' and not incluir_en_costo), 9262.50, 'La de oficina no');
select pruebas.igual((select saldo from public.adelantos_saldo where id = 1), 1000::numeric, 'Queda una cuota del adelanto');
select pruebas.error($$select public.anular_gasto((select id from public.gastos where origen = 'planilla:1' limit 1), 'x')$$, 'Solo Gerencia');

-- Vacaciones y aguinaldo
select pruebas.error($$select public.registrar_vacaciones(1, public.hoy() + 1, public.hoy() + 10)$$, 'Solo tiene');
select public.registrar_vacaciones(1, public.hoy() + 1, public.hoy() + 2);
select pruebas.igual((select vacaciones_tomadas > 0 and aguinaldo_acumulado > 0 from public.prestaciones where id = 1), true, 'Vacaciones y aguinaldo');

-- Flujo de caja
select pruebas.como('gerente@befood.ni');
select pruebas.igual(jsonb_array_length(public.flujo_de_caja(6) -> 'proximas'), 6, 'Seis semanas de flujo');
select pruebas.igual((public.flujo_de_caja(6) ->> 'saldo_actual')::numeric,
                     (select sum(saldo) from public.saldos_cuentas where activa), 'El flujo empieza con lo que hay');

-- ---------------------------------------------------------------------
-- Mantenimiento
-- ---------------------------------------------------------------------
select pruebas.como('operador@befood.ni');
select pruebas.error($$select public.guardar_equipo(null, 'PEL', 'Peletizadora', 'maquina')$$, 'no permite');
select pruebas.como('mant@befood.ni');
select public.guardar_equipo(null, 'pel', 'Peletizadora', 'maquina', p_cada_sacos => 5, p_cada_dias => 90);
select public.guardar_equipo(null, 'CAM1', 'Camión Hino', 'vehiculo', 'M 123-456', p_cada_km => 5000, p_km_actual => 10000);

-- Falla con foto: avisa a Mantenimiento y, si se paró, a Producción
select pruebas.como('operador@befood.ni');
select pruebas.error($$select public.reportar_falla(1, 'Hace ruido', '')$$, 'foto de la falla');
select public.reportar_falla(1, 'Se rompió la faja del motor', 'fallas/1.jpg', true);
select pruebas.como('jefe@befood.ni');
select pruebas.igual((select count(*) from public.avisos where tipo = 'falla' and mensaje like 'PARADA Peletizadora%'), 1::bigint, 'Producción sabe que se paró');
select pruebas.igual((select parado from public.estado_equipos where id = 1), true, 'La peletizadora está parada');

-- Repuesto: entra con orden de compra, sin cuarentena
select pruebas.como('gerente@befood.ni');
insert into public.items (codigo, nombre, tipo, unidad, stock_minimo) values ('FAJA', 'Faja B-52', 'repuesto', 'unidad', 1);
select pruebas.como('inventario@befood.ni');
select public.crear_orden_compra(1, (select format('[{"item_id":%s,"cantidad":4,"precio_unitario":350}]', id) from public.items where codigo = 'FAJA')::jsonb);
select pruebas.como('gerente@befood.ni');
select public.aprobar_orden_compra((select max(id) from public.ordenes_compra));
select pruebas.como('bodega@befood.ni');
select public.recibir_materia_prima((select max(id) from public.ordenes_compra_lineas), 4, 1, 'factura.jpg');
select pruebas.igual((select estado::text || left(codigo, 3) from public.lotes where item_id = (select id from public.items where codigo = 'FAJA')),
                     'liberadoRP-', 'El repuesto entra liberado con código RP');
select pruebas.como('gerente@befood.ni');
select pruebas.igual((select count(*) from public.avisos where tipo = 'lote_en_cuarentena' and mensaje like '%Faja%'), 0::bigint, 'Sin aviso de cuarentena');

-- Orden de repuestos: pedida, aprobada, entregada y recibida
select pruebas.como('mant@befood.ni');
select public.iniciar_trabajo(1);
select pruebas.error($$select public.pedir_repuestos(1, '[{"item_id":1,"cantidad":5}]')$$, 'solo se piden repuestos');
select public.pedir_repuestos(1, (select format('[{"item_id":%s,"cantidad":2}]', id) from public.items where codigo = 'FAJA')::jsonb);
select pruebas.error($$select public.aprobar_orden((select id from public.ordenes where tipo = 'repuestos'), '[]')$$, 'no permite');
select pruebas.como('inventario@befood.ni');
select public.aprobar_orden((select id from public.ordenes where tipo = 'repuestos'),
  (select jsonb_agg(jsonb_build_object('linea_id', ol.id, 'cantidad_aprobada', 2)) from public.ordenes_lineas ol join public.ordenes o on o.id = ol.orden_id where o.tipo = 'repuestos'));
select pruebas.como('bodega@befood.ni');
select public.entregar_orden((select id from public.ordenes where tipo = 'repuestos'),
  (select jsonb_agg(jsonb_build_object('asignacion_id', a.id, 'cantidad', 2)) from public.ordenes_asignaciones a join public.ordenes_lineas ol on ol.id = a.orden_linea_id join public.ordenes o on o.id = ol.orden_id where o.tipo = 'repuestos'));
select pruebas.igual((select existencia from public.inventario_items where codigo = 'FAJA'), 2::numeric, 'Los repuestos salen del kárdex');
select pruebas.como('mant@befood.ni');
select pruebas.error($$select public.terminar_trabajo(1, 'Se cambió la faja')$$, 'repuestos pedidos sin recibir');
select public.recibir_orden((select id from public.ordenes where tipo = 'repuestos'),
  (select jsonb_agg(jsonb_build_object('asignacion_id', a.id, 'cantidad', 2)) from public.ordenes_asignaciones a join public.ordenes_lineas ol on ol.id = a.orden_linea_id join public.ordenes o on o.id = ol.orden_id where o.tipo = 'repuestos'));
select public.terminar_trabajo(1, 'Se cambiaron las dos fajas', 'trabajos/1.jpg');
select pruebas.igual((select parado from public.estado_equipos where id = 1), false, 'La peletizadora vuelve a funcionar');

-- Un servicio de torno pagado como gasto de esa orden
select pruebas.como('admin@befood.ni');
select public.registrar_gasto(public.hoy(), 'mantenimiento', 'Torno para la polea', 500, true, 'torno.jpg', p_orden_trabajo_id => 1);
select pruebas.igual((select costo_total from public.historial_equipos where id = 1), 1200::numeric, 'Historial: repuestos 700 + torno 500');
select pruebas.igual((select fallas from public.historial_equipos where id = 1), 1::bigint, 'Una falla en el historial');

-- Preventivo por sacos producidos: la revisión diaria crea la orden una sola vez
reset role;
update public.equipos set ultimo_mantenimiento = now() - interval '1 day' where id = 1;
select public.revisar_alertas_etapa3();
select public.revisar_alertas_etapa3();
select pruebas.igual((select count(*) from public.ordenes_trabajo where equipo_id = 1 and tipo = 'preventivo'), 1::bigint, 'Una orden preventiva');
select pruebas.igual((select descripcion from public.ordenes_trabajo where equipo_id = 1 and tipo = 'preventivo'),
                     'Mantenimiento preventivo: 9 sacos producidos', 'Dice por qué toca');
set role authenticated;

-- Viajes del camión
select pruebas.como('despacho@befood.ni');
select pruebas.error($$select public.registrar_viaje(2, 9000, 9100)$$, 'no puede bajar');
select pruebas.error($$select public.registrar_viaje(2, 10000, 10120, 20, 1500)$$, 'foto del recibo');
select public.registrar_viaje(2, 10000, 10120, 20, 1500, 'combustible.jpg',
  (select id from public.ordenes where tipo = 'despacho' and estado = 'recibida' limit 1), 'Granja El Porvenir');
select pruebas.igual((select km_actual from public.equipos where id = 2), 10120::numeric, 'Sube el kilometraje');
select pruebas.igual((select costo_por_saco from public.costo_entregas), 166.67, 'Combustible por saco entregado');
select pruebas.como('admin@befood.ni');
select pruebas.igual((select saldo from public.saldos_cuentas where nombre = 'Caja chica'), 500::numeric, 'El combustible sale de la caja chica');

-- Cada vista se puede leer desde la app (con el rol authenticated, no como superusuario)
select pruebas.como('gerente@befood.ni');
set role authenticated;
do $$
declare
  v record;
begin
  for v in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'v' loop
    execute format('select count(*) from public.%I', v.relname);
  end loop;
end $$;
reset role;

\echo 'Todas las pruebas de la Etapa 3 pasaron.'
