-- Pruebas de las reglas de la Etapa 1. Recorre el pedido completo del
-- documento (sección 4) y revisa que cada regla bloquee lo que debe.
-- Se corre con: npm run test:db
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;
\o /dev/null

create schema pruebas;
grant usage on schema pruebas to authenticated;

create function pruebas.como(p_email text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = p_email), false)
$$;

create function pruebas.error(p_sql text, p_fragmento text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_fragmento in sqlerrm) = 0 then
      raise exception 'Se esperaba un error con "%" y salió: %', p_fragmento, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Se esperaba el error "%" y no hubo error en: %', p_fragmento, p_sql;
end $$;

create function pruebas.igual(p_obtenido anyelement, p_esperado anyelement, p_que text) returns void language plpgsql as $$
begin
  if p_obtenido is distinct from p_esperado then
    raise exception '%: se esperaba % y salió %', p_que, p_esperado, p_obtenido;
  end if;
end $$;
grant execute on all functions in schema pruebas to authenticated;

-- ---------------------------------------------------------------------
-- Usuarios: el primero es Gerencia; los demás esperan activación
-- ---------------------------------------------------------------------
insert into auth.users (email, raw_user_meta_data) values ('gerente@befood.ni', '{"nombre":"Gerente"}');
insert into auth.users (email, raw_user_meta_data) values
  ('jefe@befood.ni', '{"nombre":"Jefe Producción"}'),
  ('inventario@befood.ni', '{"nombre":"Encargado Inventario"}'),
  ('bodega@befood.ni', '{"nombre":"Bodeguero"}'),
  ('calidad@befood.ni', '{"nombre":"Calidad"}'),
  ('operador@befood.ni', '{"nombre":"Operador"}'),
  ('vendedor@befood.ni', '{"nombre":"Vendedor"}'),
  ('nuevo@befood.ni', '{"nombre":"Nuevo"}');

select pruebas.igual((select rol::text || activo from public.perfiles p join auth.users u on u.id = p.id where email = 'gerente@befood.ni'),
                     'gerenciatrue', 'El primer usuario es Gerencia activo');
select pruebas.igual((select activo from public.perfiles p join auth.users u on u.id = p.id where email = 'jefe@befood.ni'),
                     false, 'Los demás entran inactivos');

set role authenticated;
select pruebas.como('nuevo@befood.ni');
select pruebas.error($$select public.crear_orden_compra(1, '[]')$$, 'no está activo');
select pruebas.igual((select count(*) from public.items), 0::bigint, 'Un usuario inactivo no ve datos');

select pruebas.como('gerente@befood.ni');
update public.perfiles p set activo = true, rol = v.rol::public.rol_usuario
  from (values ('jefe@befood.ni', 'jefe_produccion'), ('inventario@befood.ni', 'inventario'),
               ('bodega@befood.ni', 'bodeguero'), ('calidad@befood.ni', 'calidad'),
               ('operador@befood.ni', 'operador'), ('vendedor@befood.ni', 'vendedor')) v(email, rol)
  join auth.users u on u.email = v.email
 where p.id = u.id;

-- ---------------------------------------------------------------------
-- Catálogos (solo Gerencia)
-- ---------------------------------------------------------------------
insert into public.ubicaciones (nombre, tipo) values ('Silo 1', 'silo'), ('Bodega A', 'bodega'), ('Bodega de sacos', 'bodega');
insert into public.proveedores (nombre) values ('Granos del Norte');
insert into public.items (codigo, nombre, tipo, unidad, stock_minimo, vida_util_dias) values
  ('MAIZ', 'Maíz amarillo', 'materia_prima', 'lb', 1000, 180),
  ('SOYA', 'Harina de soya', 'materia_prima', 'lb', 1000, 180),
  ('PREM', 'Premezcla', 'materia_prima', 'lb', 0, 120),
  ('SACO', 'Saco vacío', 'empaque', 'saco', 0, null);
insert into public.items (codigo, nombre, tipo, unidad, vida_util_dias, peso_saco_lb) values
  ('ENGORDE', 'Alimento de engorde', 'producto_terminado', 'saco', 90, 100);

select pruebas.como('inventario@befood.ni');
select pruebas.error($$insert into public.items (codigo, nombre, tipo, unidad) values ('X1', 'X', 'materia_prima', 'lb')$$,
                     'row-level security');

-- ---------------------------------------------------------------------
-- Fórmula versionada
-- ---------------------------------------------------------------------
select pruebas.error($$select public.crear_formula(5, '[{"item_id":1,"cantidad_por_saco":60}]')$$, 'Solo Gerencia');
select pruebas.como('gerente@befood.ni');
select public.crear_formula(5, '[{"item_id":1,"cantidad_por_saco":55},{"item_id":2,"cantidad_por_saco":30},{"item_id":3,"cantidad_por_saco":15},{"item_id":4,"cantidad_por_saco":1}]', 'v1');
select public.crear_formula(5, '[{"item_id":1,"cantidad_por_saco":60},{"item_id":2,"cantidad_por_saco":25},{"item_id":3,"cantidad_por_saco":15},{"item_id":4,"cantidad_por_saco":1}]', 'v2');
select pruebas.igual((select version from public.formulas where activa), 2, 'La versión nueva queda activa');
update public.formulas_lineas set cantidad_por_saco = 1;
select pruebas.igual((select sum(cantidad_por_saco) from public.formulas_lineas where formula_id = 2), 101::numeric, 'Nadie edita una fórmula a mano');

-- ---------------------------------------------------------------------
-- Compra y recepción con cuarentena
-- ---------------------------------------------------------------------
select pruebas.como('inventario@befood.ni');
select public.crear_orden_compra(1, '[{"item_id":1,"cantidad":3000,"precio_unitario":8},{"item_id":2,"cantidad":1000,"precio_unitario":14},{"item_id":3,"cantidad":600,"precio_unitario":20},{"item_id":4,"cantidad":100,"precio_unitario":15}]');

select pruebas.como('bodega@befood.ni');
select pruebas.error($$select public.recibir_materia_prima(1, 1500, 1, 'ticket.jpg')$$, 'Sin orden de compra aprobada');
select pruebas.error($$select public.aprobar_orden_compra(1)$$, 'Solo Gerencia');
select pruebas.como('gerente@befood.ni');
select public.aprobar_orden_compra(1);

select pruebas.como('bodega@befood.ni');
select pruebas.error($$select public.recibir_materia_prima(1, 1500, 1, null)$$, 'foto del ticket');
select pruebas.error($$select public.recibir_materia_prima(1, 3500, 1, 'ticket.jpg')$$, 'solo tiene pendiente');
-- Dos lotes de maíz: el segundo vence antes, así que FEFO debe usarlo primero.
select public.recibir_materia_prima(1, 1500, 1, 'ticket1.jpg', 'PROV-A', (current_date + 170));
select public.recibir_materia_prima(1, 1500, 1, 'ticket2.jpg', 'PROV-B', (current_date + 60));
select public.recibir_materia_prima(2, 1000, 2, 'ticket3.jpg');
select public.recibir_materia_prima(3, 600, 2, 'ticket4.jpg');
select public.recibir_materia_prima(4, 100, 2, 'ticket5.jpg');

select pruebas.igual((select codigo from public.lotes where id = 1),
                     'MP-' || to_char(public.hoy(), 'YYYY-MMDD') || '-MAIZ-001', 'Código de lote');
select pruebas.igual((select codigo from public.lotes where id = 2),
                     'MP-' || to_char(public.hoy(), 'YYYY-MMDD') || '-MAIZ-002', 'Consecutivo del día');
select pruebas.igual((select estado::text from public.lotes where id = 1), 'cuarentena', 'Todo entra en cuarentena');
select pruebas.igual((select estado::text from public.ordenes_compra where id = 1), 'recibida', 'OC completa');
select pruebas.igual((select existencia from public.inventario_items where codigo = 'MAIZ'), 3000::numeric, 'Kárdex de recepción');
select pruebas.igual((select disponible from public.inventario_items where codigo = 'MAIZ'), 0::numeric, 'En cuarentena no está disponible');

-- ---------------------------------------------------------------------
-- Producción no se aprueba sin materia prima liberada
-- ---------------------------------------------------------------------
select pruebas.como('jefe@befood.ni');
select public.crear_orden_produccion(2, 10, 'manana');
select pruebas.igual((select cantidad_formula from public.op_requerimientos where item_id = 1), 600::numeric, 'Explosión de materiales');
select pruebas.como('gerente@befood.ni');
select pruebas.error($$select public.aprobar_orden_produccion(1)$$, 'No hay materia prima liberada suficiente');

-- ---------------------------------------------------------------------
-- Calidad
-- ---------------------------------------------------------------------
select pruebas.como('bodega@befood.ni');
select pruebas.error($$select public.inspeccionar_lote(1, 'liberado')$$, 'no permite');
select pruebas.como('calidad@befood.ni');
select pruebas.error($$select public.inspeccionar_lote(1, 'rechazado')$$, 'Escriba por qué');
select public.inspeccionar_lote(id, 'liberado', '{"color":true,"olor":true,"moho":false,"plagas":false,"seco":true}')
  from public.lotes order by id;

-- ---------------------------------------------------------------------
-- Orden de producción y orden de materia prima con cuatro cantidades
-- ---------------------------------------------------------------------
select pruebas.como('gerente@befood.ni');
select public.aprobar_orden_produccion(1);
select pruebas.igual((select numero from public.ordenes where id = 1), 'RM-0001', 'Requisición creada al aprobar');
select pruebas.igual((select cantidad_pedida from public.ordenes_lineas where orden_id = 1 and item_id = 1), 600::numeric, 'Maíz pedido');

select pruebas.como('jefe@befood.ni');
select pruebas.error($$select public.crear_requisicion(1, '[{"item_id":1,"cantidad":10}]')$$, 'más Maíz amarillo de lo que dice la fórmula');
select pruebas.error($$select public.crear_requisicion(1, '[{"item_id":5,"cantidad":10}]')$$, 'no está en la fórmula');

select pruebas.como('bodega@befood.ni');
select pruebas.error($$select public.entregar_orden(1, '[]')$$, 'Sin orden aprobada no sale nada');

select pruebas.como('inventario@befood.ni');
select pruebas.error($$select public.aprobar_orden(1, '[{"linea_id":1,"cantidad_aprobada":700}]')$$, 'debe estar entre 0 y 600');
select public.aprobar_orden(1, (select jsonb_agg(jsonb_build_object('linea_id', id, 'cantidad_aprobada', cantidad_pedida)) from public.ordenes_lineas where orden_id = 1));
select pruebas.igual((select string_agg(lote_id::text, ',') from public.ordenes_asignaciones a join public.ordenes_lineas l on l.id = a.orden_linea_id where l.item_id = 1),
                     '2', 'FEFO: se aparta el lote que vence antes');
select pruebas.igual((select reservado from public.inventario_lotes where id = 2), 600::numeric, 'Reserva por lote');
select pruebas.igual((select disponible from public.inventario_items where codigo = 'MAIZ'), 2400::numeric, 'Disponible descuenta lo apartado');

select pruebas.como('bodega@befood.ni');
select pruebas.error($$select public.entregar_orden(1, (select jsonb_agg(jsonb_build_object('asignacion_id', a.id, 'cantidad', a.cantidad_asignada + 50)) from public.ordenes_asignaciones a join public.ordenes_lineas l on l.id = a.orden_linea_id where l.orden_id = 1))$$,
                     'No se puede entregar más de lo aprobado');
select public.entregar_orden(1, (select jsonb_agg(jsonb_build_object('asignacion_id', a.id, 'cantidad', a.cantidad_asignada)) from public.ordenes_asignaciones a join public.ordenes_lineas l on l.id = a.orden_linea_id where l.orden_id = 1));
select pruebas.igual((select existencia from public.inventario_lotes where id = 2), 900::numeric, 'El kárdex baja al entregar');
select pruebas.como('gerente@befood.ni');
select pruebas.igual((select count(*) from public.avisos where tipo = 'stock_minimo'), 1::bigint, 'Aviso de soya bajo el mínimo');
select pruebas.igual((select count(*) from public.avisos where tipo = 'stock_minimo' and mensaje like 'Se está acabando Harina de soya%'), 1::bigint, 'El aviso es de la soya');

-- Producción no puede arrancar sin lista de revisión ni con la orden sin recibir
select pruebas.como('operador@befood.ni');
select pruebas.error($$select public.iniciar_etapa(1, 'molienda', 'manana')$$, 'sin validar la limpieza');
select public.registrar_checklist(1, true, true, true);
select pruebas.error($$select public.iniciar_etapa(1, 'molienda', 'manana')$$, 'sin recibir');

select pruebas.como('jefe@befood.ni');
select pruebas.error($$select public.recibir_orden(1, (select jsonb_agg(jsonb_build_object('asignacion_id', a.id, 'cantidad', case when l.item_id = 1 then 598 else a.cantidad_entregada end)) from public.ordenes_asignaciones a join public.ordenes_lineas l on l.id = a.orden_linea_id where l.orden_id = 1))$$,
                     'Escriba el motivo');
select public.recibir_orden(1, (select jsonb_agg(jsonb_build_object('asignacion_id', a.id, 'cantidad', case when l.item_id = 1 then 598 else a.cantidad_entregada end, 'motivo', case when l.item_id = 1 then 'Saco roto en el traslado' end)) from public.ordenes_asignaciones a join public.ordenes_lineas l on l.id = a.orden_linea_id where l.orden_id = 1));
select pruebas.igual((select count(*) from public.avisos where tipo = 'diferencia_entrega'), 0::bigint, 'Producción no ve los avisos de Gerencia');
select pruebas.como('gerente@befood.ni');
select pruebas.igual((select count(*) from public.avisos where tipo = 'diferencia_entrega'), 1::bigint, 'Gerencia recibe aviso de la diferencia');

-- Etapas en orden, con bloqueos
select pruebas.como('operador@befood.ni');
select pruebas.error($$select public.iniciar_etapa(1, 'dosificacion', 'manana')$$, 'Primero termine la etapa de molienda');
select public.finalizar_etapa(public.iniciar_etapa(1, 'molienda', 'manana'));
select pruebas.igual((select estado::text from public.ordenes_produccion where id = 1), 'en_proceso', 'OP en proceso');
select public.finalizar_etapa(public.iniciar_etapa(1, 'dosificacion', 'manana'));
select public.finalizar_etapa(public.iniciar_etapa(1, 'mezcla', 'manana'));
select public.finalizar_etapa(public.iniciar_etapa(1, 'peletizado', 'manana'));
select pruebas.igual((select estado::text from public.lotes where id = (select lote_pt_id from public.ordenes_produccion where id = 1)),
                     'cuarentena', 'El lote PT nace en cuarentena');
select pruebas.error($$select public.iniciar_etapa(1, 'envasado', 'manana')$$, 'Calidad no ha liberado');

select pruebas.como('calidad@befood.ni');
select public.inspeccionar_lote((select lote_pt_id from public.ordenes_produccion where id = 1), 'liberado', '{"pellet_parejo":true}');

select pruebas.como('operador@befood.ni');
select public.finalizar_etapa(public.iniciar_etapa(1, 'envasado', 'manana'));

-- Cierre con merma alta: 998 lb de materia prima, 9 sacos de 100 lb
select pruebas.como('jefe@befood.ni');
select public.cerrar_orden_produccion(1, 9, 3);
select pruebas.igual((select merma_lb from public.ordenes_produccion where id = 1), 98::numeric, 'Merma en libras');
select pruebas.igual((select merma_pct from public.ordenes_produccion where id = 1), 9.82, 'Merma en porcentaje');
select pruebas.igual((select count(*) from public.avisos where tipo = 'merma_alta'), 1::bigint, 'Aviso de merma alta');

-- Entrega a bodega de sacos con cuatro cantidades
select public.entregar_orden(2, (select jsonb_agg(jsonb_build_object('asignacion_id', a.id, 'cantidad', 9)) from public.ordenes_asignaciones a join public.ordenes_lineas l on l.id = a.orden_linea_id where l.orden_id = 2));
select pruebas.como('bodega@befood.ni');
select public.recibir_orden(2, (select jsonb_agg(jsonb_build_object('asignacion_id', a.id, 'cantidad', 9)) from public.ordenes_asignaciones a join public.ordenes_lineas l on l.id = a.orden_linea_id where l.orden_id = 2));
select pruebas.igual((select existencia from public.inventario_items where codigo = 'ENGORDE'), 9::numeric, 'Sacos en bodega');

-- Trazabilidad hacia atrás
select pruebas.igual((select count(*) from public.consumos_produccion where orden_produccion_id = 1), 4::bigint, 'Lotes de MP en el lote PT');

-- ---------------------------------------------------------------------
-- Conteo cíclico con ajuste autorizado por Gerencia
-- ---------------------------------------------------------------------
select pruebas.como('bodega@befood.ni');
select pruebas.error($$select public.registrar_conteo(1, 1490)$$, 'Escriba la explicación');
select public.registrar_conteo(1, 1490, 'Derrame en el silo');
select public.registrar_conteo(3, 750);
select pruebas.igual((select estado::text from public.conteos where lote_id = 3), 'cuadrado', 'Conteo que cuadra');
select pruebas.error($$select public.revisar_conteo(1, true)$$, 'Solo Gerencia');
select pruebas.como('gerente@befood.ni');
select public.revisar_conteo(1, true);
select pruebas.igual((select existencia from public.inventario_lotes where id = 1), 1490::numeric, 'Ajuste aplicado al kárdex');

-- ---------------------------------------------------------------------
-- Nada se borra, nada se toca a mano
-- ---------------------------------------------------------------------
delete from public.ordenes where id = 1;
select pruebas.igual((select count(*) from public.ordenes where id = 1), 1::bigint, 'Desde la app no se borra nada');
select pruebas.error($$insert into public.movimientos (lote_id, item_id, tipo, cantidad, usuario_id) values (1, 1, 'ajuste_conteo', 5, auth.uid())$$,
                     'row-level security');
select pruebas.error($$select public._registrar_movimiento(1, 'ajuste_conteo', 5, 'x')$$, 'permission denied');
select pruebas.igual((select count(*) from public.auditoria where tabla = 'ordenes') > 0, true, 'La auditoría guarda los cambios');

select pruebas.como('vendedor@befood.ni');
select pruebas.igual((select count(*) from public.ordenes_compra_lineas), 0::bigint, 'El vendedor no ve precios de compra');

-- Anulación
select pruebas.como('jefe@befood.ni');
select public.crear_orden_produccion(2, 5, 'tarde');
select pruebas.como('gerente@befood.ni');
select public.aprobar_orden_produccion(2);
select pruebas.como('jefe@befood.ni');
select pruebas.error($$select public.anular_orden(3, '')$$, 'motivo');
select public.anular_orden(3, 'Se cambió el plan');
select pruebas.igual((select estado::text from public.ordenes where id = 3), 'anulada', 'Orden anulada queda en el historial');
select pruebas.error($$select public.anular_orden_produccion(1, 'x')$$, 'no ha arrancado');
select public.anular_orden_produccion(2, 'Se cambió el plan');
select pruebas.igual((select estado::text from public.ordenes_produccion where id = 2), 'anulada', 'Orden de producción anulada');

reset role;
select public.revisar_alertas();
select pruebas.error($$update public.movimientos set cantidad = 1 where id = 1$$, 'no se puede cambiar');
select pruebas.error($$delete from public.auditoria where id = 1$$, 'no se puede cambiar');
-- Ni siquiera el dueño de la base de datos puede borrar
select pruebas.error($$delete from public.ordenes where id = 1$$, 'Nada se borra');

\echo 'Todas las pruebas de la Etapa 1 pasaron.'
