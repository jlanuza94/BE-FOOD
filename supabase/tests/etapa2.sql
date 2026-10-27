-- Pruebas de la Etapa 2: ventas, despacho con firma, factura, cobros,
-- pagos a proveedores, gastos, costo por saco y utilidad.
-- Sigue con los datos que dejó etapa1.sql (9 sacos de engorde en bodega).
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;
\o /dev/null

reset role;
insert into auth.users (email, raw_user_meta_data) values
  ('admin@befood.ni', '{"nombre":"Administración"}'), ('despacho@befood.ni', '{"nombre":"Despacho"}');
update public.perfiles p set activo = true, rol = v.rol::public.rol_usuario
  from (values ('admin@befood.ni', 'administracion'), ('despacho@befood.ni', 'despacho')) v(email, rol)
  join auth.users u on u.email = v.email
 where p.id = u.id;

set role authenticated;
select pruebas.como('gerente@befood.ni');
update public.items set precio_venta = 1450 where codigo = 'ENGORDE';

-- ---------------------------------------------------------------------
-- Costo real del lote producido en la Etapa 1
-- ---------------------------------------------------------------------
-- 598 lb maíz × 8 + 250 soya × 14 + 150 premezcla × 20 + 10 sacos × 15 = 11,434 entre 9 sacos
select pruebas.igual((select costo_total from public.reporte_costo_lote((select lote_pt_id from public.ordenes_produccion where id = 1))),
                     11434::numeric, 'Costo real del lote');
select pruebas.igual((select costo_unitario from public.reporte_costo_lote((select lote_pt_id from public.ordenes_produccion where id = 1))),
                     1270.44, 'Costo por saco del lote, con la merma');

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
select pruebas.como('vendedor@befood.ni');
select pruebas.error($$select public.guardar_cliente(null, 'Granja El Porvenir', null, null, 30, 20000)$$, 'Gerencia o Administración');
select public.guardar_cliente(null, 'Granja El Porvenir', '8888-1111', 'Km 20 carretera norte');
select pruebas.error($$select public.crear_venta(1, 'credito', '[{"item_id":5,"sacos":12}]')$$, 'no tiene crédito');
select pruebas.como('admin@befood.ni');
select public.guardar_cliente(1, 'Granja El Porvenir', '8888-1111', 'Km 20 carretera norte', 30, 20000);
select pruebas.como('vendedor@befood.ni');
select pruebas.error($$select public.guardar_cliente(1, 'Granja El Porvenir', null, null, 60, 20000)$$, 'Gerencia o Administración');

-- ---------------------------------------------------------------------
-- Venta: hay 9 sacos, se venden 12
-- ---------------------------------------------------------------------
select pruebas.error($$select public.crear_venta(1, 'credito', '[{"item_id":5,"sacos":12,"precio_unitario":1400}]')$$, 'Solo Gerencia puede cambiar precios');
select pruebas.error($$select public.crear_venta(1, 'credito', '[{"item_id":5,"sacos":14}]')$$, 'límite');
select public.crear_venta(1, 'credito', '[{"item_id":5,"sacos":12}]', 'Pedido semanal');
select pruebas.igual((select numero from public.ventas where id = 1), 'OV-0001', 'Número de venta');
select pruebas.igual((select cantidad_pedida from public.ordenes_lineas ol join public.ordenes o on o.id = ol.orden_id where o.venta_id = 1),
                     12::numeric, 'Despacho por los 12 sacos');
select pruebas.como('gerente@befood.ni');
select pruebas.igual((select count(*) from public.avisos where tipo = 'faltan_sacos'), 1::bigint, 'Aviso a Producción: faltan 3 sacos');

-- Bodega aprueba lo que hay (FEFO), Despacho carga
select pruebas.como('bodega@befood.ni');
select pruebas.error($$select public.aprobar_orden((select id from public.ordenes where venta_id = 1), (select jsonb_agg(jsonb_build_object('linea_id', ol.id, 'cantidad_aprobada', 12)) from public.ordenes_lineas ol join public.ordenes o on o.id = ol.orden_id where o.venta_id = 1))$$,
                     'Solo hay 9');
select public.aprobar_orden((select id from public.ordenes where venta_id = 1), (select jsonb_agg(jsonb_build_object('linea_id', ol.id, 'cantidad_aprobada', 9)) from public.ordenes_lineas ol join public.ordenes o on o.id = ol.orden_id where o.venta_id = 1));
select pruebas.igual((select disponible from public.inventario_items where codigo = 'ENGORDE'), 0::numeric, 'Los sacos quedan apartados');

select pruebas.como('despacho@befood.ni');
select public.entregar_orden((select id from public.ordenes where venta_id = 1), (select jsonb_agg(jsonb_build_object('asignacion_id', a.id, 'cantidad', 9)) from public.ordenes_asignaciones a join public.ordenes_lineas ol on ol.id = a.orden_linea_id join public.ordenes o on o.id = ol.orden_id where o.venta_id = 1));
select pruebas.igual((select existencia from public.inventario_items where codigo = 'ENGORDE'), 0::numeric, 'Los sacos salen del kárdex al cargar');

-- El cliente firma: se hace la factura
select pruebas.error($$select public.recibir_orden((select id from public.ordenes where venta_id = 1), '[]')$$, 'firma');
select pruebas.error($$select public.confirmar_entrega_cliente((select id from public.ordenes where venta_id = 1), '[]', 'Don Julio', '')$$, 'Falta la firma');
select public.confirmar_entrega_cliente((select id from public.ordenes where venta_id = 1),
  (select jsonb_agg(jsonb_build_object('asignacion_id', a.id, 'cantidad', 9)) from public.ordenes_asignaciones a join public.ordenes_lineas ol on ol.id = a.orden_linea_id join public.ordenes o on o.id = ol.orden_id where o.venta_id = 1),
  'Don Julio', 'firmas/1.png');
reset role;
select pruebas.igual((select total from public.facturas where venta_id = 1), 13050::numeric, 'Factura por lo recibido');
select pruebas.igual((select vence from public.facturas where venta_id = 1), public.hoy() + 30, 'Vence según el crédito');
set role authenticated;
select pruebas.igual((select estado from public.ventas where id = 1), 'abierta', 'Quedan 3 sacos pendientes');
select pruebas.igual((select cliente from public.entregas_por_lote where lote_id = (select lote_pt_id from public.ordenes_produccion where id = 1)),
                     'Granja El Porvenir', 'Trazabilidad hasta el cliente');

-- Lo pendiente: nuevo despacho, y luego se cierra la venta
select pruebas.como('vendedor@befood.ni');
select public.crear_despacho(1);
select pruebas.error($$select public.crear_despacho(1)$$, 'Ya hay un despacho en camino');
select pruebas.error($$select public.cerrar_venta(1, 'El cliente ya no quiere')$$, 'despacho en camino');
select public.anular_orden((select max(id) from public.ordenes where venta_id = 1), 'El cliente ya no quiere los 3');
select public.cerrar_venta(1, 'El cliente ya no quiere los 3');
select pruebas.igual((select estado from public.ventas where id = 1), 'completa', 'Venta cerrada');

-- ---------------------------------------------------------------------
-- Cobros
-- ---------------------------------------------------------------------
select pruebas.error($$select public.registrar_abono(1, 100, 'efectivo')$$, 'no permite');
select pruebas.como('admin@befood.ni');
select pruebas.error($$select public.registrar_abono(1, 20000, 'efectivo')$$, 'solo debe');
select pruebas.error($$select public.registrar_abono(1, 5000, 'transferencia')$$, 'número o una foto');
select public.registrar_abono(1, 5000, 'transferencia', 'BAC-123');
select pruebas.igual((select saldo from public.cuentas_por_cobrar where id = 1), 8050::numeric, 'Saldo del cliente');
update public.abonos set monto = 1;
select pruebas.igual((select sum(monto) from public.abonos), 5000::numeric, 'Un abono no se cambia a mano');

-- ---------------------------------------------------------------------
-- Gastos y quién ve costos
-- ---------------------------------------------------------------------
select public.registrar_gasto(public.hoy(), 'luz', 'Factura de luz', 1000);
select public.registrar_gasto(public.hoy(), 'administracion', 'Papelería', 500, false);
select pruebas.como('vendedor@befood.ni');
select pruebas.igual((select count(*) from public.gastos), 0::bigint, 'El vendedor no ve gastos');
select pruebas.igual((select count(*) from public.costos_lotes), 0::bigint, 'El vendedor no ve costos');
select pruebas.error($$select public.reporte_utilidad(public.hoy(), public.hoy())$$, 'no permite ver costos');

-- ---------------------------------------------------------------------
-- Costo por saco de la fórmula y utilidad del día
-- ---------------------------------------------------------------------
select pruebas.como('gerente@befood.ni');
-- 60×8 + 25×14 + 15×20 + 1×15 = 1,145; gastos de planta 1,000 entre 9 sacos = 111.11
select pruebas.igual((select costo_materia_prima from public.reporte_costo_formulas()), 1145::numeric, 'Costo de materia prima por saco');
select pruebas.igual((select gasto_planta from public.reporte_costo_formulas()), 111.11, 'Gastos de planta por saco');
select pruebas.igual((select ganancia from public.reporte_costo_formulas()), 193.89, 'Ganancia por saco');

select pruebas.igual((public.reporte_utilidad(public.hoy(), public.hoy()) ->> 'ventas')::numeric, 13050::numeric, 'Ventas');
select pruebas.igual((public.reporte_utilidad(public.hoy(), public.hoy()) ->> 'costo_ventas')::numeric, 11433.96, 'Costo de lo vendido');
select pruebas.igual((public.reporte_utilidad(public.hoy(), public.hoy()) ->> 'utilidad')::numeric, 1116.04, 'Utilidad: ganancia menos gastos fuera del costo');
select pruebas.igual((public.reporte_utilidad(public.hoy(), public.hoy()) ->> 'cobrado')::numeric, 5000::numeric, 'Lo cobrado aparte de lo vendido');

-- ---------------------------------------------------------------------
-- Sube el maíz: avisa cuánto baja la ganancia
-- ---------------------------------------------------------------------
select pruebas.como('inventario@befood.ni');
select public.crear_orden_compra(1, '[{"item_id":1,"cantidad":1000,"precio_unitario":9}]');
select pruebas.como('gerente@befood.ni');
select public.aprobar_orden_compra((select max(id) from public.ordenes_compra));
select pruebas.como('bodega@befood.ni');
select public.recibir_materia_prima((select max(id) from public.ordenes_compra_lineas), 1000, 1, 'ticket6.jpg');
select pruebas.como('gerente@befood.ni');
select pruebas.igual((select count(*) from public.avisos where tipo = 'subio_costo' and mensaje like '%Alimento de engorde cuesta C$ 60 más por saco%'),
                     1::bigint, 'Aviso de subida del maíz con su efecto por saco');

-- ---------------------------------------------------------------------
-- Pagos a proveedores
-- ---------------------------------------------------------------------
select pruebas.como('inventario@befood.ni');
select public.registrar_factura_proveedor(1, 'A-5531', public.hoy(), 15, 51500);
select pruebas.como('admin@befood.ni');
select pruebas.error($$select public.solicitar_pago(1, 60000)$$, 'Solo quedan');
select public.solicitar_pago(1, 20000);
select pruebas.error($$select public.registrar_pago_hecho(1, 'transferencia', 'X', 'comp.jpg')$$, 'Sin aprobación de Gerencia');
select pruebas.error($$select public.aprobar_pago(1, true)$$, 'Solo Gerencia');
select pruebas.como('gerente@befood.ni');
select public.aprobar_pago(1, true);
select pruebas.como('admin@befood.ni');
select pruebas.error($$select public.registrar_pago_hecho(1, 'transferencia', 'X', '')$$, 'comprobante');
select public.registrar_pago_hecho(1, 'transferencia', 'BAC-777', 'comprobantes/1.jpg');
select pruebas.igual((select saldo from public.cuentas_por_pagar where id = 1), 31500::numeric, 'Saldo con el proveedor');

reset role;
select public.revisar_alertas_dinero();

\echo 'Todas las pruebas de la Etapa 2 pasaron.'
