-- =====================================================================
-- BE Food · Etapa 1 · Reglas
-- Todas las acciones de la app. Cada función revisa el rol de quien la
-- llama y las reglas del documento ("Reglas que la aplicación no deja
-- romper"). Los mensajes de error son los que ve el usuario.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ayudantes
-- ---------------------------------------------------------------------
create function public.mi_rol() returns public.rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid() and activo
$$;

create function public._fallar(p_mensaje text) returns void
language plpgsql as $$
begin
  raise exception using message = p_mensaje, errcode = 'P0001';
end $$;

-- Gerencia puede hacer todo; los demás solo lo de su rol.
create function public._exigir_rol(variadic p_roles public.rol_usuario[]) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  r public.rol_usuario := public.mi_rol();
begin
  if r is null then
    perform public._fallar('Su usuario no está activo. Pida a Gerencia que lo active.');
  end if;
  if r = 'gerencia' or r = any (p_roles) then
    return;
  end if;
  perform public._fallar(format('Su rol (%s) no permite hacer esto.', r));
end $$;

create function public._exigir_gerencia() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public.mi_rol() is distinct from 'gerencia' then
    perform public._fallar('Solo Gerencia puede hacer esto.');
  end if;
end $$;

create function public._config(p_clave text) returns numeric
language sql stable security definer set search_path = public as $$
  select valor from public.configuracion where clave = p_clave
$$;

create function public._aviso(
  p_tipo text, p_mensaje text, p_roles public.rol_usuario[],
  p_enlace text default null, p_clave text default null
) returns void
language sql security definer set search_path = public as $$
  insert into public.avisos (tipo, mensaje, roles, enlace, clave_unica)
  values (p_tipo, p_mensaje, p_roles, p_enlace, p_clave)
  on conflict (clave_unica) do nothing
$$;

create function public.hoy() returns date
language sql stable as $$
  select (now() at time zone 'America/Managua')::date
$$;

-- MP-2026-1012-MAIZ-001: prefijo, año, mes y día, código del item, consecutivo del día.
create function public._codigo_lote(p_prefijo text, p_item_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
  base text;
  n integer;
begin
  select p_prefijo || '-' || to_char(public.hoy(), 'YYYY-MMDD') || '-' || codigo || '-'
    into base from public.items where id = p_item_id;
  perform pg_advisory_xact_lock(hashtext(base));
  select count(*) + 1 into n from public.lotes where codigo like base || '%';
  return base || lpad(n::text, 3, '0');
end $$;

create function public._existencia(p_lote_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cantidad), 0) from public.movimientos where lote_id = p_lote_id
$$;

-- Lo apartado por órdenes aprobadas que todavía no se han entregado.
create function public._reservado(p_lote_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(a.cantidad_asignada), 0)
  from public.ordenes_asignaciones a
  join public.ordenes_lineas ol on ol.id = a.orden_linea_id
  join public.ordenes o on o.id = ol.orden_id
  where a.lote_id = p_lote_id and o.estado = 'aprobada' and o.tipo = 'requisicion_mp'
$$;

create function public._usable(l public.lotes) returns boolean
language sql stable as $$
  select l.estado = 'liberado' and (l.fecha_caducidad is null or l.fecha_caducidad >= public.hoy())
$$;

-- Libras liberadas, sin vencer y sin apartar de un item.
create function public._disponible_item(p_item_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(public._existencia(l.id) - public._reservado(l.id)), 0)
  from public.lotes l
  where l.item_id = p_item_id and public._usable(l)
$$;

create function public._registrar_movimiento(
  p_lote_id bigint, p_tipo text, p_cantidad numeric, p_referencia text, p_nota text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.lotes;
begin
  select * into l from public.lotes where id = p_lote_id;
  if public._existencia(p_lote_id) + p_cantidad < 0 then
    perform public._fallar(format('El lote %s no tiene suficiente existencia.', l.codigo));
  end if;
  insert into public.movimientos (lote_id, item_id, tipo, cantidad, referencia, nota, usuario_id)
  values (p_lote_id, l.item_id, p_tipo, p_cantidad, p_referencia, p_nota, auth.uid());
end $$;

create function public._revisar_stock_minimo(p_item_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.items;
  disp numeric;
begin
  select * into i from public.items where id = p_item_id;
  if i.stock_minimo <= 0 then
    return;
  end if;
  disp := public._disponible_item(p_item_id);
  if disp < i.stock_minimo then
    perform public._aviso('stock_minimo',
      format('Se está acabando %s: quedan %s %s liberadas (mínimo %s). Hay que comprar.',
             i.nombre, trim_scale(round(disp, 2)), i.unidad, i.stock_minimo),
      '{inventario,gerencia}', '/inventario',
      format('stock:%s:%s', i.id, public.hoy()));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Usuarios: el primero que se registra es Gerencia; los demás esperan
-- a que Gerencia los active y les dé su rol.
-- ---------------------------------------------------------------------
create function public._nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  primero boolean := not exists (select 1 from public.perfiles);
begin
  insert into public.perfiles (id, nombre, rol, activo)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'nombre', ''), split_part(new.email, '@', 1)),
    (case when primero then 'gerencia' else 'operador' end)::public.rol_usuario,
    primero
  );
  if not primero then
    perform public._aviso('usuario_nuevo',
      format('%s se registró y espera que le asignen un rol.', coalesce(new.raw_user_meta_data ->> 'nombre', new.email)),
      '{gerencia}', '/usuarios');
  end if;
  return new;
end $$;

create trigger al_crear_usuario after insert on auth.users
  for each row execute function public._nuevo_usuario();

-- ---------------------------------------------------------------------
-- Compras
-- ---------------------------------------------------------------------
create function public.crear_orden_compra(p_proveedor_id bigint, p_lineas jsonb, p_notas text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  oc_id bigint;
begin
  perform public._exigir_rol('inventario');
  if jsonb_array_length(coalesce(p_lineas, '[]')) = 0 then
    perform public._fallar('La orden de compra necesita al menos un producto.');
  end if;
  insert into public.ordenes_compra (proveedor_id, notas, creada_por)
  values (p_proveedor_id, p_notas, auth.uid()) returning id into oc_id;
  insert into public.ordenes_compra_lineas (orden_compra_id, item_id, cantidad, precio_unitario)
  select oc_id, x.item_id, x.cantidad, x.precio_unitario
  from jsonb_to_recordset(p_lineas) as x(item_id bigint, cantidad numeric, precio_unitario numeric);
  perform public._aviso('oc_por_aprobar',
    format('Hay una orden de compra nueva por aprobar (%s).', (select numero from public.ordenes_compra where id = oc_id)),
    '{gerencia}', '/compras/' || oc_id);
  return oc_id;
end $$;

create function public.aprobar_orden_compra(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_gerencia();
  update public.ordenes_compra
     set estado = 'aprobada', aprobada_por = auth.uid(), aprobada_en = now()
   where id = p_id and estado = 'pendiente';
  if not found then
    perform public._fallar('La orden de compra no está pendiente de aprobación.');
  end if;
end $$;

create function public.anular_orden_compra(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_rol('inventario');
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba el motivo de la anulación.');
  end if;
  if exists (select 1 from public.ordenes_compra_lineas where orden_compra_id = p_id and cantidad_recibida > 0) then
    perform public._fallar('No se puede anular: ya se recibió mercadería de esta orden.');
  end if;
  update public.ordenes_compra set estado = 'anulada', motivo_anulacion = p_motivo
   where id = p_id and estado in ('pendiente', 'aprobada');
  if not found then
    perform public._fallar('Esta orden de compra ya no se puede anular.');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Recepción de materia prima: queda en cuarentena
-- ---------------------------------------------------------------------
create function public.recibir_materia_prima(
  p_oc_linea_id bigint,
  p_cantidad numeric,
  p_ubicacion_id bigint,
  p_foto_ticket_url text,
  p_lote_proveedor text default null,
  p_fecha_caducidad date default null,
  p_fotos text[] default '{}'
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  ln public.ordenes_compra_lineas;
  oc public.ordenes_compra;
  it public.items;
  lote_id bigint;
  codigo text;
begin
  perform public._exigir_rol('inventario', 'bodeguero');
  select * into ln from public.ordenes_compra_lineas where id = p_oc_linea_id for update;
  select * into oc from public.ordenes_compra where id = ln.orden_compra_id;
  if oc.id is null or oc.estado <> 'aprobada' then
    perform public._fallar('Sin orden de compra aprobada no se recibe.');
  end if;
  if coalesce(p_cantidad, 0) <= 0 then
    perform public._fallar('Escriba el peso de la báscula.');
  end if;
  if ln.cantidad_recibida + p_cantidad > ln.cantidad then
    perform public._fallar(format('La orden solo tiene pendiente %s y se están recibiendo %s.',
      ln.cantidad - ln.cantidad_recibida, p_cantidad));
  end if;
  if coalesce(p_foto_ticket_url, '') = '' then
    perform public._fallar('Falta la foto del ticket de la báscula.');
  end if;
  if p_ubicacion_id is null then
    perform public._fallar('Indique dónde se guarda el lote.');
  end if;

  select * into it from public.items where id = ln.item_id;
  codigo := public._codigo_lote('MP', it.id);
  insert into public.lotes (codigo, item_id, proveedor_id, lote_proveedor, orden_compra_linea_id,
                            fecha_caducidad, ubicacion_id, cantidad_inicial, foto_ticket_url, fotos, creado_por)
  values (codigo, it.id, oc.proveedor_id, p_lote_proveedor, ln.id,
          coalesce(p_fecha_caducidad, public.hoy() + it.vida_util_dias), p_ubicacion_id,
          p_cantidad, p_foto_ticket_url, coalesce(p_fotos, '{}'), auth.uid())
  returning id into lote_id;

  perform public._registrar_movimiento(lote_id, 'recepcion_compra', p_cantidad, oc.numero);

  update public.ordenes_compra_lineas set cantidad_recibida = cantidad_recibida + p_cantidad where id = ln.id;
  if not exists (select 1 from public.ordenes_compra_lineas
                 where orden_compra_id = oc.id and cantidad_recibida < cantidad) then
    update public.ordenes_compra set estado = 'recibida' where id = oc.id;
  end if;

  perform public._aviso('lote_en_cuarentena',
    format('Llegó %s (%s %s), lote %s. Está en cuarentena esperando revisión de Calidad.',
           it.nombre, p_cantidad, it.unidad, codigo),
    '{calidad}', '/lotes/' || lote_id);
  return lote_id;
end $$;

-- ---------------------------------------------------------------------
-- Calidad: liberar, rechazar o regresar a cuarentena
-- ---------------------------------------------------------------------
create function public.inspeccionar_lote(
  p_lote_id bigint,
  p_resultado public.estado_lote,
  p_revision jsonb default '{}',
  p_observaciones text default null,
  p_fotos text[] default '{}'
) returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.lotes;
  it public.items;
begin
  perform public._exigir_rol('calidad');
  select * into l from public.lotes where id = p_lote_id for update;
  select * into it from public.items where id = l.item_id;
  if l.id is null then
    perform public._fallar('No existe ese lote.');
  end if;
  if p_resultado not in ('liberado', 'rechazado', 'cuarentena') then
    perform public._fallar('El resultado debe ser liberado, rechazado o cuarentena.');
  end if;
  if l.estado = p_resultado then
    perform public._fallar(format('El lote ya está %s.', p_resultado));
  end if;
  if l.estado in ('rechazado', 'vencido') and public.mi_rol() <> 'gerencia' then
    perform public._fallar(format('El lote está %s. Solo Gerencia puede cambiarlo.', l.estado));
  end if;
  if p_resultado = 'liberado' and l.fecha_caducidad < public.hoy() then
    perform public._fallar('El lote ya venció y no se puede liberar.');
  end if;
  if p_resultado <> 'liberado' and coalesce(trim(p_observaciones), '') = '' then
    perform public._fallar('Escriba por qué no se libera el lote.');
  end if;

  insert into public.inspecciones_calidad (lote_id, resultado, revision, observaciones, fotos, inspector_id)
  values (l.id, p_resultado, coalesce(p_revision, '{}'), p_observaciones, coalesce(p_fotos, '{}'), auth.uid());
  update public.lotes set estado = p_resultado, estado_cambiado_en = now() where id = l.id;

  if p_resultado = 'rechazado' then
    perform public._aviso('lote_rechazado',
      format('Lote %s (%s) RECHAZADO por Calidad: %s. No se puede usar; sepárelo.', l.codigo, it.nombre, p_observaciones),
      '{gerencia,inventario,bodeguero,jefe_produccion,calidad}', '/lotes/' || l.id);
  elsif p_resultado = 'liberado' and l.orden_produccion_id is not null then
    perform public._aviso('pt_liberado',
      format('Calidad liberó el lote %s. Ya se puede envasar.', l.codigo),
      '{jefe_produccion,operador}', '/produccion/' || l.orden_produccion_id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Fórmulas: nunca se editan, se crea una versión nueva
-- ---------------------------------------------------------------------
create function public.crear_formula(p_producto_id bigint, p_lineas jsonb, p_notas text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  f_id bigint;
  ver integer;
begin
  perform public._exigir_gerencia();
  if not exists (select 1 from public.items where id = p_producto_id and tipo = 'producto_terminado') then
    perform public._fallar('La fórmula debe ser de un producto terminado.');
  end if;
  if jsonb_array_length(coalesce(p_lineas, '[]')) = 0 then
    perform public._fallar('La fórmula necesita ingredientes.');
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lineas) as x(item_id bigint, cantidad_por_saco numeric)
             join public.items i on i.id = x.item_id where i.tipo = 'producto_terminado') then
    perform public._fallar('Un producto terminado no puede ser ingrediente.');
  end if;

  select coalesce(max(version), 0) + 1 into ver from public.formulas where producto_id = p_producto_id;
  update public.formulas set activa = false where producto_id = p_producto_id and activa;
  insert into public.formulas (producto_id, version, notas, creada_por)
  values (p_producto_id, ver, p_notas, auth.uid()) returning id into f_id;
  insert into public.formulas_lineas (formula_id, item_id, cantidad_por_saco)
  select f_id, x.item_id, x.cantidad_por_saco
  from jsonb_to_recordset(p_lineas) as x(item_id bigint, cantidad_por_saco numeric);
  return f_id;
end $$;

-- ---------------------------------------------------------------------
-- Órdenes entre áreas: pedida → aprobada → entregada → recibida
-- ---------------------------------------------------------------------

-- Lo que ya se pidió para una orden de producción y no se anuló.
create function public._comprometido(p_op_id bigint, p_item_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case o.estado
      when 'pedida' then ol.cantidad_pedida
      when 'aprobada' then ol.cantidad_aprobada
      else (select coalesce(sum(a.cantidad_entregada), 0) from public.ordenes_asignaciones a where a.orden_linea_id = ol.id)
    end), 0)
  from public.ordenes o
  join public.ordenes_lineas ol on ol.orden_id = o.id
  where o.orden_produccion_id = p_op_id and o.tipo = 'requisicion_mp'
    and o.estado <> 'anulada' and ol.item_id = p_item_id
$$;

create function public._crear_requisicion(p_op_id bigint, p_lineas jsonb, p_pedida_por uuid, p_notas text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  o_id bigint;
  x record;
  req record;
begin
  if jsonb_array_length(coalesce(p_lineas, '[]')) = 0 then
    perform public._fallar('La orden necesita al menos un producto.');
  end if;
  for x in select * from jsonb_to_recordset(p_lineas) as t(item_id bigint, cantidad numeric) loop
    if coalesce(x.cantidad, 0) <= 0 then
      perform public._fallar('Las cantidades pedidas deben ser mayores que cero.');
    end if;
    select r.*, i.nombre, i.unidad into req
      from public.op_requerimientos r join public.items i on i.id = r.item_id
     where r.orden_produccion_id = p_op_id and r.item_id = x.item_id;
    if req.id is null then
      perform public._fallar('Ese ingrediente no está en la fórmula. Pida permiso a Gerencia.');
    end if;
    if public._comprometido(p_op_id, x.item_id) + x.cantidad > req.cantidad_formula + req.cantidad_extra then
      perform public._fallar(format(
        'Se pide más %s de lo que dice la fórmula (máximo %s %s, ya pedido %s). Necesita permiso de Gerencia.',
        req.nombre, req.cantidad_formula + req.cantidad_extra, req.unidad, public._comprometido(p_op_id, x.item_id)));
    end if;
  end loop;

  insert into public.ordenes (numero, tipo, orden_produccion_id, notas, pedida_por)
  values ('RM-' || lpad(nextval('public.seq_rm')::text, 4, '0'), 'requisicion_mp', p_op_id, p_notas, p_pedida_por)
  returning id into o_id;
  insert into public.ordenes_lineas (orden_id, item_id, cantidad_pedida)
  select o_id, t.item_id, t.cantidad from jsonb_to_recordset(p_lineas) as t(item_id bigint, cantidad numeric);

  perform public._aviso('orden_por_aprobar',
    format('Producción pidió materia prima (%s). Revise y apruebe las cantidades.',
           (select numero from public.ordenes where id = o_id)),
    '{inventario}', '/ordenes/' || o_id);
  return o_id;
end $$;

create function public.crear_requisicion(p_op_id bigint, p_lineas jsonb, p_notas text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_rol('jefe_produccion');
  if not exists (select 1 from public.ordenes_produccion where id = p_op_id and estado in ('aprobada', 'en_proceso')) then
    perform public._fallar('La orden de producción debe estar aprobada.');
  end if;
  return public._crear_requisicion(p_op_id, p_lineas, auth.uid(), p_notas);
end $$;

-- Inventario aprueba cantidades. La app aparta los lotes con FEFO/FIFO:
-- primero el que vence antes y, si vencen igual, el que entró primero.
create function public.aprobar_orden(p_orden_id bigint, p_lineas jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.ordenes;
  ln record;
  aprobada numeric;
  falta numeric;
  lt record;
  tomar numeric;
  total numeric := 0;
begin
  select * into o from public.ordenes where id = p_orden_id for update;
  if o.tipo = 'requisicion_mp' then
    perform public._exigir_rol('inventario');
  else
    perform public._exigir_rol('bodeguero');
  end if;
  if o.estado <> 'pedida' then
    perform public._fallar('Esta orden ya no está esperando aprobación.');
  end if;

  for ln in select ol.*, i.nombre, i.unidad from public.ordenes_lineas ol
            join public.items i on i.id = ol.item_id where ol.orden_id = o.id order by ol.id loop
    select (x ->> 'cantidad_aprobada')::numeric into aprobada
      from jsonb_array_elements(p_lineas) x where (x ->> 'linea_id')::bigint = ln.id;
    if aprobada is null then
      perform public._fallar(format('Falta la cantidad aprobada de %s.', ln.nombre));
    end if;
    if aprobada < 0 or aprobada > ln.cantidad_pedida then
      perform public._fallar(format('La cantidad aprobada de %s debe estar entre 0 y %s.', ln.nombre, ln.cantidad_pedida));
    end if;
    update public.ordenes_lineas set cantidad_aprobada = aprobada where id = ln.id;
    total := total + aprobada;

    -- Apartar por lote
    perform 1 from public.lotes where item_id = ln.item_id for update;
    falta := aprobada;
    for lt in select l.id, l.codigo, public._existencia(l.id) - public._reservado(l.id) as disponible
              from public.lotes l
              where l.item_id = ln.item_id and public._usable(l)
              order by l.fecha_caducidad nulls last, l.fecha_ingreso, l.id loop
      exit when falta <= 0;
      continue when lt.disponible <= 0;
      tomar := least(lt.disponible, falta);
      insert into public.ordenes_asignaciones (orden_linea_id, lote_id, cantidad_asignada)
      values (ln.id, lt.id, tomar);
      falta := falta - tomar;
    end loop;
    if falta > 0 then
      perform public._fallar(format('Solo hay %s %s de %s liberadas y disponibles. Apruebe menos.',
        trim_scale(aprobada - falta), ln.unidad, ln.nombre));
    end if;
  end loop;

  if total = 0 then
    perform public._fallar('No se aprobó nada. Si no se va a entregar, anule la orden con su motivo.');
  end if;
  update public.ordenes set estado = 'aprobada', aprobada_por = auth.uid(), aprobada_en = now(), actualizada_en = now()
   where id = o.id;
  perform public._aviso('orden_por_entregar',
    format('La orden %s está aprobada. Entregue lo indicado en cada lote.', o.numero),
    '{bodeguero}', '/ordenes/' || o.id);
end $$;

create function public.entregar_orden(p_orden_id bigint, p_entregas jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.ordenes;
  a record;
  cant numeric;
  items_tocados bigint[] := '{}';
  it bigint;
begin
  select * into o from public.ordenes where id = p_orden_id for update;
  if o.tipo = 'requisicion_mp' then
    perform public._exigir_rol('bodeguero', 'inventario');
  else
    perform public._exigir_rol('jefe_produccion');
  end if;
  if o.estado <> 'aprobada' then
    perform public._fallar('Sin orden aprobada no sale nada.');
  end if;

  for a in select oa.*, l.codigo, l.item_id, ol.item_id as linea_item
           from public.ordenes_asignaciones oa
           join public.ordenes_lineas ol on ol.id = oa.orden_linea_id
           join public.lotes l on l.id = oa.lote_id
           where ol.orden_id = o.id order by oa.id loop
    select (x ->> 'cantidad')::numeric into cant
      from jsonb_array_elements(p_entregas) x where (x ->> 'asignacion_id')::bigint = a.id;
    if cant is null then
      perform public._fallar(format('Falta lo entregado del lote %s.', a.codigo));
    end if;
    if cant < 0 then
      perform public._fallar('Las cantidades no pueden ser negativas.');
    end if;
    if cant > a.cantidad_asignada then
      perform public._fallar(format('No se puede entregar más de lo aprobado: lote %s, aprobado %s, escribió %s.',
        a.codigo, a.cantidad_asignada, cant));
    end if;
    if cant > 0 and not (select public._usable(l) from public.lotes l where l.id = a.lote_id) then
      perform public._fallar(format('El lote %s no está liberado o ya venció. No se puede entregar.', a.codigo));
    end if;
    update public.ordenes_asignaciones set cantidad_entregada = cant where id = a.id;
    if o.tipo = 'requisicion_mp' and cant > 0 then
      perform public._registrar_movimiento(a.lote_id, 'salida_requisicion', -cant, o.numero);
      items_tocados := items_tocados || a.item_id;
    end if;
  end loop;

  update public.ordenes set estado = 'entregada', entregada_por = auth.uid(), entregada_en = now(), actualizada_en = now()
   where id = o.id;
  foreach it in array items_tocados loop
    perform public._revisar_stock_minimo(it);
  end loop;
  perform public._aviso('orden_por_recibir',
    format('La orden %s fue entregada. Cuente y confirme lo que recibió.', o.numero),
    case when o.tipo = 'requisicion_mp' then '{jefe_produccion}'::public.rol_usuario[] else '{bodeguero}'::public.rol_usuario[] end,
    '/ordenes/' || o.id);
end $$;

create function public.recibir_orden(p_orden_id bigint, p_recepciones jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.ordenes;
  a record;
  cant numeric;
  motivo text;
  diferencias text[] := '{}';
begin
  select * into o from public.ordenes where id = p_orden_id for update;
  if o.tipo = 'requisicion_mp' then
    perform public._exigir_rol('jefe_produccion');
  else
    perform public._exigir_rol('bodeguero', 'inventario');
  end if;
  if o.estado <> 'entregada' then
    perform public._fallar('Esta orden no está esperando que la reciban.');
  end if;

  for a in select oa.*, l.codigo, i.unidad
           from public.ordenes_asignaciones oa
           join public.ordenes_lineas ol on ol.id = oa.orden_linea_id
           join public.lotes l on l.id = oa.lote_id
           join public.items i on i.id = l.item_id
           where ol.orden_id = o.id order by oa.id loop
    select (x ->> 'cantidad')::numeric, nullif(trim(x ->> 'motivo'), '') into cant, motivo
      from jsonb_array_elements(p_recepciones) x where (x ->> 'asignacion_id')::bigint = a.id;
    if cant is null then
      perform public._fallar(format('Falta lo recibido del lote %s.', a.codigo));
    end if;
    if cant < 0 then
      perform public._fallar('Las cantidades no pueden ser negativas.');
    end if;
    if cant > a.cantidad_entregada then
      perform public._fallar(format('No puede recibir más de lo entregado: lote %s, entregado %s.', a.codigo, a.cantidad_entregada));
    end if;
    if cant <> a.cantidad_entregada then
      if motivo is null then
        perform public._fallar(format('Lote %s: recibió %s y le entregaron %s. Escriba el motivo de la diferencia.',
          a.codigo, cant, a.cantidad_entregada));
      end if;
      diferencias := diferencias || format('%s: entregado %s, recibido %s %s (%s)',
        a.codigo, a.cantidad_entregada, cant, a.unidad, motivo);
    end if;
    update public.ordenes_asignaciones set cantidad_recibida = cant, motivo_diferencia = motivo where id = a.id;
    if o.tipo = 'entrega_pt' and cant > 0 then
      perform public._registrar_movimiento(a.lote_id, 'entrada_produccion', cant, o.numero);
    end if;
  end loop;

  update public.ordenes set estado = 'recibida', recibida_por = auth.uid(), recibida_en = now(), actualizada_en = now()
   where id = o.id;
  if array_length(diferencias, 1) > 0 then
    perform public._aviso('diferencia_entrega',
      format('Diferencia en la orden %s, recibida por %s. %s',
             o.numero, (select nombre from public.perfiles where id = auth.uid()), array_to_string(diferencias, '; ')),
      '{gerencia}', '/ordenes/' || o.id);
  end if;
end $$;

create function public.anular_orden(p_orden_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.ordenes;
begin
  select * into o from public.ordenes where id = p_orden_id for update;
  if o.pedida_por <> auth.uid() then
    perform public._exigir_rol(case when o.tipo = 'requisicion_mp' then 'inventario'::public.rol_usuario else 'bodeguero'::public.rol_usuario end);
  else
    perform public._exigir_rol(public.mi_rol());
  end if;
  if o.estado not in ('pedida', 'aprobada') then
    perform public._fallar('Solo se puede anular una orden que todavía no se ha entregado.');
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba el motivo de la anulación.');
  end if;
  update public.ordenes
     set estado = 'anulada', anulada_por = auth.uid(), anulada_en = now(), motivo_anulacion = p_motivo, actualizada_en = now()
   where id = o.id;
end $$;

-- ---------------------------------------------------------------------
-- Producción
-- ---------------------------------------------------------------------
create function public.crear_orden_produccion(
  p_formula_id bigint, p_sacos integer, p_turno public.turno, p_notas text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  op_id bigint;
begin
  perform public._exigir_rol('jefe_produccion');
  if not exists (select 1 from public.formulas where id = p_formula_id and activa) then
    perform public._fallar('Use la versión activa de la fórmula.');
  end if;
  if coalesce(p_sacos, 0) <= 0 then
    perform public._fallar('Indique cuántos sacos se van a producir.');
  end if;
  insert into public.ordenes_produccion (formula_id, sacos_planificados, turno, notas, creada_por)
  values (p_formula_id, p_sacos, p_turno, p_notas, auth.uid()) returning id into op_id;
  insert into public.op_requerimientos (orden_produccion_id, item_id, cantidad_formula)
  select op_id, fl.item_id, fl.cantidad_por_saco * p_sacos
  from public.formulas_lineas fl where fl.formula_id = p_formula_id;
  perform public._aviso('op_por_aprobar',
    format('Producción quiere fabricar %s sacos (%s). Falta su aprobación.',
           p_sacos, (select numero from public.ordenes_produccion where id = op_id)),
    '{gerencia}', '/produccion/' || op_id);
  return op_id;
end $$;

-- Gerencia de planta aprueba. Si no hay materia prima liberada suficiente,
-- no se puede. Al aprobar se crea sola la orden de materia prima.
create function public.aprobar_orden_produccion(p_op_id bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  op public.ordenes_produccion;
  r record;
  faltantes text[] := '{}';
  lineas jsonb;
begin
  perform public._exigir_gerencia();
  select * into op from public.ordenes_produccion where id = p_op_id for update;
  if op.estado <> 'pendiente' then
    perform public._fallar('Esta orden de producción no está pendiente.');
  end if;
  for r in select req.item_id, req.cantidad_formula, i.nombre, i.unidad, public._disponible_item(req.item_id) as disp
           from public.op_requerimientos req join public.items i on i.id = req.item_id
           where req.orden_produccion_id = op.id and i.critico loop
    if r.disp < r.cantidad_formula then
      faltantes := faltantes || format('%s: faltan %s %s', r.nombre, trim_scale(round(r.cantidad_formula - r.disp, 2)), r.unidad);
    end if;
  end loop;
  if array_length(faltantes, 1) > 0 then
    perform public._fallar('No hay materia prima liberada suficiente. ' || array_to_string(faltantes, '; '));
  end if;

  update public.ordenes_produccion set estado = 'aprobada', aprobada_por = auth.uid(), aprobada_en = now()
   where id = op.id;
  select jsonb_agg(jsonb_build_object('item_id', item_id, 'cantidad', cantidad_formula) order by id) into lineas
    from public.op_requerimientos where orden_produccion_id = op.id;
  return public._crear_requisicion(op.id, lineas, op.creada_por, 'Creada al aprobar ' || op.numero);
end $$;

-- Permiso especial de Gerencia para pedir más, o para sustituir un
-- ingrediente (se autoriza el nuevo con su motivo).
create function public.autorizar_extra(p_op_id bigint, p_item_id bigint, p_cantidad numeric, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_gerencia();
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba el motivo del permiso.');
  end if;
  if coalesce(p_cantidad, 0) <= 0 then
    perform public._fallar('La cantidad debe ser mayor que cero.');
  end if;
  if not exists (select 1 from public.ordenes_produccion where id = p_op_id and estado in ('aprobada', 'en_proceso')) then
    perform public._fallar('La orden de producción debe estar aprobada o en proceso.');
  end if;
  insert into public.op_requerimientos (orden_produccion_id, item_id, cantidad_extra, motivo_extra, autorizado_por)
  values (p_op_id, p_item_id, p_cantidad, p_motivo, auth.uid())
  on conflict (orden_produccion_id, item_id) do update
    set cantidad_extra = op_requerimientos.cantidad_extra + excluded.cantidad_extra,
        motivo_extra = concat_ws(' / ', op_requerimientos.motivo_extra, excluded.motivo_extra),
        autorizado_por = excluded.autorizado_por;
end $$;

-- Se puede anular mientras no haya salido materia prima para ella.
create function public.anular_orden_produccion(p_op_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  op public.ordenes_produccion;
begin
  select * into op from public.ordenes_produccion where id = p_op_id for update;
  if op.creada_por <> auth.uid() then
    perform public._exigir_gerencia();
  else
    perform public._exigir_rol('jefe_produccion');
  end if;
  if op.estado not in ('pendiente', 'aprobada') then
    perform public._fallar('Solo se puede anular una orden de producción que no ha arrancado.');
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba el motivo de la anulación.');
  end if;
  if exists (select 1 from public.ordenes where orden_produccion_id = op.id and tipo = 'requisicion_mp'
             and estado in ('entregada', 'recibida')) then
    perform public._fallar('Ya se entregó materia prima para esta orden. Hable con Gerencia para devolverla.');
  end if;
  update public.ordenes
     set estado = 'anulada', anulada_por = auth.uid(), anulada_en = now(),
         motivo_anulacion = 'Se anuló ' || op.numero || ': ' || p_motivo, actualizada_en = now()
   where orden_produccion_id = op.id and estado in ('pedida', 'aprobada');
  update public.ordenes_produccion set estado = 'anulada', motivo_anulacion = p_motivo where id = op.id;
end $$;

create function public.registrar_checklist(
  p_op_id bigint, p_limpieza boolean, p_formula_correcta boolean, p_ingredientes_completos boolean,
  p_observaciones text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_rol('jefe_produccion', 'operador');
  if not (coalesce(p_limpieza, false) and coalesce(p_formula_correcta, false) and coalesce(p_ingredientes_completos, false)) then
    perform public._fallar('Todo debe estar revisado y marcado antes de arrancar.');
  end if;
  if not exists (select 1 from public.ordenes_produccion where id = p_op_id and estado = 'aprobada') then
    perform public._fallar('La orden de producción debe estar aprobada y sin arrancar.');
  end if;
  if exists (select 1 from public.op_checklist where orden_produccion_id = p_op_id) then
    perform public._fallar('La lista de revisión ya se registró.');
  end if;
  insert into public.op_checklist (orden_produccion_id, limpieza, formula_correcta, ingredientes_completos, observaciones, registrado_por)
  values (p_op_id, true, true, true, p_observaciones, auth.uid());
end $$;

create function public.iniciar_etapa(
  p_op_id bigint, p_etapa public.etapa_produccion, p_turno public.turno, p_observaciones text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  op public.ordenes_produccion;
  anterior public.etapa_produccion;
  r record;
  faltantes text[] := '{}';
  tol numeric := public._config('tolerancia_ingredientes_pct');
  e_id bigint;
begin
  perform public._exigir_rol('jefe_produccion', 'operador');
  select * into op from public.ordenes_produccion where id = p_op_id for update;
  if op.estado not in ('aprobada', 'en_proceso') then
    perform public._fallar('La orden de producción no está aprobada.');
  end if;
  if exists (select 1 from public.op_etapas where orden_produccion_id = op.id and etapa = p_etapa) then
    perform public._fallar('Esa etapa ya se inició.');
  end if;

  -- Las etapas van en orden y la anterior debe estar terminada.
  select max(e) into anterior from unnest(enum_range(null::public.etapa_produccion)) e where e < p_etapa;
  if anterior is not null and not exists (
      select 1 from public.op_etapas where orden_produccion_id = op.id and etapa = anterior and fin is not null) then
    perform public._fallar(format('Primero termine la etapa de %s.', anterior));
  end if;

  if p_etapa in ('molienda', 'mezcla')
     and not exists (select 1 from public.op_checklist where orden_produccion_id = op.id) then
    perform public._fallar('No se puede arrancar ni mezclar sin validar la limpieza y la lista de revisión.');
  end if;

  if p_etapa in ('molienda', 'dosificacion') then
    if exists (select 1 from public.ordenes where orden_produccion_id = op.id
               and tipo = 'requisicion_mp' and estado in ('pedida', 'aprobada', 'entregada')) then
      perform public._fallar('Hay órdenes de materia prima sin recibir. Confírmelas antes de producir.');
    end if;
    for r in select i.nombre, i.unidad, req.cantidad_formula + req.cantidad_extra as requerido,
                    coalesce((select sum(a.cantidad_recibida) from public.ordenes o
                              join public.ordenes_lineas ol on ol.orden_id = o.id
                              join public.ordenes_asignaciones a on a.orden_linea_id = ol.id
                              where o.orden_produccion_id = op.id and o.estado = 'recibida' and ol.item_id = req.item_id), 0) as recibido
             from public.op_requerimientos req join public.items i on i.id = req.item_id
             where req.orden_produccion_id = op.id and i.critico and req.cantidad_formula > 0 loop
      if r.recibido < r.requerido * (1 - tol / 100) then
        faltantes := faltantes || format('%s: recibido %s de %s %s', r.nombre, r.recibido, r.requerido, r.unidad);
      end if;
    end loop;
    if array_length(faltantes, 1) > 0 then
      perform public._fallar('Falta un ingrediente crítico. ' || array_to_string(faltantes, '; '));
    end if;
  end if;

  if p_etapa = 'envasado' and not exists (
      select 1 from public.lotes where id = op.lote_pt_id and estado = 'liberado') then
    perform public._fallar('No se puede envasar: Calidad no ha liberado el producto.');
  end if;

  insert into public.op_etapas (orden_produccion_id, etapa, operador_id, turno, observaciones)
  values (op.id, p_etapa, auth.uid(), p_turno, p_observaciones) returning id into e_id;
  if p_etapa = 'molienda' then
    update public.ordenes_produccion set estado = 'en_proceso', iniciada_en = now() where id = op.id;
  end if;
  return e_id;
end $$;

create function public.finalizar_etapa(p_etapa_id bigint, p_observaciones text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  e public.op_etapas;
  op public.ordenes_produccion;
  f public.formulas;
  it public.items;
  lote_id bigint;
  codigo text;
begin
  perform public._exigir_rol('jefe_produccion', 'operador');
  select * into e from public.op_etapas where id = p_etapa_id for update;
  if e.id is null or e.fin is not null then
    perform public._fallar('Esa etapa no está en curso.');
  end if;
  update public.op_etapas
     set fin = now(), observaciones = concat_ws(' / ', observaciones, nullif(trim(p_observaciones), ''))
   where id = e.id;

  -- Al terminar de peletizar nace el lote de producto terminado, en
  -- cuarentena hasta que Calidad revise la muestra.
  if e.etapa = 'peletizado' then
    select * into op from public.ordenes_produccion where id = e.orden_produccion_id for update;
    select * into f from public.formulas where id = op.formula_id;
    select * into it from public.items where id = f.producto_id;
    codigo := public._codigo_lote('PT', it.id);
    insert into public.lotes (codigo, item_id, orden_produccion_id, fecha_caducidad, creado_por)
    values (codigo, it.id, op.id, public.hoy() + it.vida_util_dias, auth.uid())
    returning id into lote_id;
    update public.ordenes_produccion set lote_pt_id = lote_id where id = op.id;
    perform public._aviso('pt_en_cuarentena',
      format('Tome muestra del lote %s (%s) y revísela. Sin liberación no se puede envasar.', codigo, it.nombre),
      '{calidad}', '/lotes/' || lote_id);
  end if;
end $$;

-- Cierre: rendimiento real, merma, y orden de entrega a la bodega de sacos.
create function public.cerrar_orden_produccion(p_op_id bigint, p_sacos_producidos integer, p_ubicacion_id bigint)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  op public.ordenes_produccion;
  prod public.items;
  mp_lb numeric;
  merma numeric;
  pct numeric;
  o_id bigint;
  ol_id bigint;
begin
  perform public._exigir_rol('jefe_produccion');
  select * into op from public.ordenes_produccion where id = p_op_id for update;
  if op.estado <> 'en_proceso' then
    perform public._fallar('La orden de producción no está en proceso.');
  end if;
  if not exists (select 1 from public.op_etapas where orden_produccion_id = op.id and etapa = 'envasado' and fin is not null) then
    perform public._fallar('Termine el envasado antes de cerrar.');
  end if;
  if p_sacos_producidos is null or p_sacos_producidos < 0 then
    perform public._fallar('Indique cuántos sacos salieron.');
  end if;
  if p_ubicacion_id is null then
    perform public._fallar('Indique en qué parte de la bodega quedan los sacos.');
  end if;

  select i.* into prod from public.formulas f join public.items i on i.id = f.producto_id where f.id = op.formula_id;
  select coalesce(sum(a.cantidad_recibida), 0) into mp_lb
    from public.ordenes o
    join public.ordenes_lineas ol on ol.orden_id = o.id
    join public.ordenes_asignaciones a on a.orden_linea_id = ol.id
    join public.items i on i.id = ol.item_id
   where o.orden_produccion_id = op.id and o.tipo = 'requisicion_mp' and o.estado = 'recibida' and i.unidad = 'lb';
  merma := mp_lb - p_sacos_producidos * prod.peso_saco_lb;
  pct := case when mp_lb > 0 then round(merma / mp_lb * 100, 2) else 0 end;

  update public.ordenes_produccion
     set estado = 'terminada', terminada_en = now(), sacos_producidos = p_sacos_producidos,
         materia_prima_lb = mp_lb, merma_lb = merma, merma_pct = pct
   where id = op.id;
  update public.lotes set cantidad_inicial = p_sacos_producidos, ubicacion_id = p_ubicacion_id where id = op.lote_pt_id;

  if pct > public._config('merma_max_pct') then
    perform public._aviso('merma_alta',
      format('Merma alta en %s: %s%% (%s lb). Lo permitido es %s%%.', op.numero, pct, round(merma, 2), public._config('merma_max_pct')),
      '{jefe_produccion,gerencia}', '/produccion/' || op.id);
  end if;

  if p_sacos_producidos = 0 then
    return null;
  end if;
  -- Producción entrega los sacos a la bodega con la misma regla de cuatro cantidades.
  insert into public.ordenes (numero, tipo, estado, orden_produccion_id, pedida_por, aprobada_por, aprobada_en)
  values ('EP-' || lpad(nextval('public.seq_ep')::text, 4, '0'), 'entrega_pt', 'aprobada', op.id,
          auth.uid(), auth.uid(), now())
  returning id into o_id;
  insert into public.ordenes_lineas (orden_id, item_id, cantidad_pedida, cantidad_aprobada)
  values (o_id, prod.id, p_sacos_producidos, p_sacos_producidos) returning id into ol_id;
  insert into public.ordenes_asignaciones (orden_linea_id, lote_id, cantidad_asignada)
  values (ol_id, op.lote_pt_id, p_sacos_producidos);
  return o_id;
end $$;

-- ---------------------------------------------------------------------
-- Conteo cíclico
-- ---------------------------------------------------------------------
create function public.lotes_para_contar_hoy()
returns table (lote_id bigint, codigo text, item text, unidad text, ubicacion text, ultimo_conteo timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.codigo, i.nombre, i.unidad, u.nombre,
         (select max(c.contado_en) from public.conteos c where c.lote_id = l.id)
  from public.lotes l
  join public.items i on i.id = l.item_id
  left join public.ubicaciones u on u.id = l.ubicacion_id
  where public.mi_rol() is not null and public._existencia(l.id) > 0
    and not exists (select 1 from public.conteos c where c.lote_id = l.id and c.contado_en::date = public.hoy())
  order by 6 nulls first, l.fecha_ingreso
  limit (select public._config('conteo_diario_lotes')::integer)
$$;

create function public.registrar_conteo(p_lote_id bigint, p_cantidad numeric, p_motivo text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  sistema numeric;
  l public.lotes;
  c_id bigint;
begin
  perform public._exigir_rol('bodeguero', 'inventario');
  select * into l from public.lotes where id = p_lote_id for update;
  if p_cantidad is null or p_cantidad < 0 then
    perform public._fallar('Escriba lo que contó.');
  end if;
  sistema := public._existencia(l.id);
  if p_cantidad <> sistema and coalesce(trim(p_motivo), '') = '' then
    perform public._fallar(format('El sistema dice %s y usted contó %s. Escriba la explicación.', sistema, p_cantidad));
  end if;
  insert into public.conteos (lote_id, cantidad_sistema, cantidad_contada, motivo, estado, contado_por)
  values (l.id, sistema, p_cantidad, p_motivo,
          case when p_cantidad = sistema then 'cuadrado'::public.estado_conteo else 'pendiente'::public.estado_conteo end,
          auth.uid())
  returning id into c_id;
  if p_cantidad <> sistema then
    perform public._aviso('diferencia_inventario',
      format('Diferencia de inventario en el lote %s: el sistema dice %s y %s contó %s. Motivo: %s',
             l.codigo, sistema, (select nombre from public.perfiles where id = auth.uid()), p_cantidad, p_motivo),
      '{gerencia}', '/conteos');
  end if;
  return c_id;
end $$;

-- Solo Gerencia autoriza el ajuste del inventario.
create function public.revisar_conteo(p_conteo_id bigint, p_aprobar boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.conteos;
begin
  perform public._exigir_gerencia();
  select * into c from public.conteos where id = p_conteo_id for update;
  if c.estado <> 'pendiente' then
    perform public._fallar('Este conteo no tiene un ajuste pendiente.');
  end if;
  if p_aprobar then
    perform public._registrar_movimiento(c.lote_id, 'ajuste_conteo', c.diferencia, 'Conteo #' || c.id, c.motivo);
  end if;
  update public.conteos
     set estado = case when p_aprobar then 'ajustado'::public.estado_conteo else 'rechazado'::public.estado_conteo end,
         revisado_por = auth.uid(), revisado_en = now()
   where id = c.id;
end $$;

-- ---------------------------------------------------------------------
-- Avisos
-- ---------------------------------------------------------------------
create function public.marcar_aviso_leido(p_aviso_id bigint) returns void
language sql security definer set search_path = public as $$
  update public.avisos set leido_por = array_append(leido_por, auth.uid())
  where id = p_aviso_id and not (auth.uid() = any (leido_por))
$$;

-- Se corre una vez al día (pg_cron). Ver README.
create function public.revisar_alertas() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  -- Lotes vencidos
  for r in select l.id, l.codigo, i.nombre from public.lotes l join public.items i on i.id = l.item_id
           where l.fecha_caducidad < public.hoy() and l.estado in ('liberado', 'cuarentena')
             and public._existencia(l.id) > 0 loop
    update public.lotes set estado = 'vencido', estado_cambiado_en = now() where id = r.id;
    perform public._aviso('lote_vencido', format('El lote %s (%s) se venció. No se puede usar.', r.codigo, r.nombre),
      '{gerencia,inventario,calidad}', '/lotes/' || r.id, 'vencido:' || r.id);
  end loop;

  -- Caducidad próxima: 30, 15 y 7 días antes
  for r in select l.id, l.codigo, i.nombre, l.fecha_caducidad - public.hoy() as dias
           from public.lotes l join public.items i on i.id = l.item_id
           where l.estado in ('liberado', 'cuarentena') and l.fecha_caducidad - public.hoy() in (30, 15, 7)
             and public._existencia(l.id) > 0 loop
    perform public._aviso('caducidad_proxima', format('El lote %s (%s) vence en %s días. Úselo primero.', r.codigo, r.nombre, r.dias),
      '{gerencia,inventario}', '/lotes/' || r.id, format('caduca:%s:%s', r.id, r.dias));
  end loop;

  -- Cuarentena vencida: nadie lo ha revisado
  for r in select l.id, l.codigo, i.nombre from public.lotes l join public.items i on i.id = l.item_id
           where l.estado = 'cuarentena'
             and l.estado_cambiado_en < now() - make_interval(days => public._config('cuarentena_max_dias')::integer) loop
    perform public._aviso('cuarentena_vencida', format('El lote %s (%s) lleva días en cuarentena sin revisar.', r.codigo, r.nombre),
      '{calidad,gerencia}', '/lotes/' || r.id, format('cuarentena:%s:%s', r.id, public.hoy()));
  end loop;

  -- Stock mínimo
  for r in select id from public.items where activo and stock_minimo > 0 loop
    perform public._revisar_stock_minimo(r.id);
  end loop;

  -- Órdenes detenidas
  for r in select o.id, o.numero, o.estado from public.ordenes o
           where o.estado in ('pedida', 'aprobada', 'entregada')
             and o.actualizada_en < now() - make_interval(hours => public._config('orden_detenida_horas')::integer) loop
    perform public._aviso('orden_detenida', format('La orden %s lleva mucho tiempo en estado %s.', r.numero, r.estado),
      '{gerencia}', '/ordenes/' || r.id, format('detenida:%s:%s', r.id, r.estado));
  end loop;

  -- Proveedores con muchos rechazos (últimos 90 días)
  for r in select p.id, p.nombre, count(*) filter (where l.estado = 'rechazado') as rech, count(*) as total
           from public.proveedores p join public.lotes l on l.proveedor_id = p.id
           where l.fecha_ingreso > now() - interval '90 days'
           group by p.id, p.nombre
           having count(*) filter (where l.estado = 'rechazado') >= 3
              and count(*) filter (where l.estado = 'rechazado') * 100.0 / count(*) >= 30 loop
    perform public._aviso('proveedor_rechazos',
      format('El proveedor %s tuvo %s lotes rechazados de %s en 90 días. Evalúe cambiarlo.', r.nombre, r.rech, r.total),
      '{gerencia,inventario}', '/proveedores', format('prov:%s:%s', r.id, to_char(public.hoy(), 'YYYY-MM')));
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Vistas para la app
-- ---------------------------------------------------------------------
create view public.inventario_lotes with (security_invoker = true) as
select l.id, l.codigo, l.estado, l.item_id, i.nombre as item, i.codigo as item_codigo, i.tipo, i.unidad,
       l.ubicacion_id, u.nombre as ubicacion, l.proveedor_id, p.nombre as proveedor, l.lote_proveedor,
       l.fecha_ingreso, l.fecha_caducidad, l.fecha_caducidad - public.hoy() as dias_para_vencer,
       l.cantidad_inicial, l.orden_produccion_id,
       coalesce(m.existencia, 0) as existencia,
       coalesce(r.reservado, 0) as reservado,
       coalesce(m.existencia, 0) - coalesce(r.reservado, 0) as disponible
from public.lotes l
join public.items i on i.id = l.item_id
left join public.ubicaciones u on u.id = l.ubicacion_id
left join public.proveedores p on p.id = l.proveedor_id
left join (select lote_id, sum(cantidad) as existencia from public.movimientos group by lote_id) m on m.lote_id = l.id
left join (select a.lote_id, sum(a.cantidad_asignada) as reservado
           from public.ordenes_asignaciones a
           join public.ordenes_lineas ol on ol.id = a.orden_linea_id
           join public.ordenes o on o.id = ol.orden_id
           where o.estado = 'aprobada' and o.tipo = 'requisicion_mp'
           group by a.lote_id) r on r.lote_id = l.id;

create view public.inventario_items with (security_invoker = true) as
select i.id, i.codigo, i.nombre, i.tipo, i.unidad, i.stock_minimo,
       coalesce(sum(il.existencia), 0) as existencia,
       coalesce(sum(il.existencia) filter (where il.estado = 'liberado'), 0) as liberado,
       coalesce(sum(il.existencia) filter (where il.estado = 'cuarentena'), 0) as en_cuarentena,
       coalesce(sum(il.disponible) filter (where il.estado = 'liberado' and (il.dias_para_vencer is null or il.dias_para_vencer >= 0)), 0) as disponible
from public.items i
left join public.inventario_lotes il on il.item_id = i.id
where i.activo
group by i.id;

create view public.kardex with (security_invoker = true) as
select m.id, m.fecha, m.lote_id, l.codigo as lote, m.item_id, i.nombre as item, i.unidad, m.tipo, m.cantidad,
       sum(m.cantidad) over (partition by m.lote_id order by m.fecha, m.id) as saldo_lote,
       sum(m.cantidad) over (partition by m.item_id order by m.fecha, m.id) as saldo_item,
       m.referencia, m.nota, p.nombre as usuario
from public.movimientos m
join public.lotes l on l.id = m.lote_id
join public.items i on i.id = m.item_id
join public.perfiles p on p.id = m.usuario_id;

-- Trazabilidad: qué lotes de materia prima entraron a cada orden de
-- producción. Sirve hacia atrás (lote PT → MP) y hacia adelante (MP → PT).
create view public.consumos_produccion with (security_invoker = true) as
select op.id as orden_produccion_id, op.numero as op_numero, op.lote_pt_id, pt.codigo as lote_pt,
       a.lote_id as lote_mp_id, mp.codigo as lote_mp, i.nombre as item, i.unidad,
       a.cantidad_entregada, a.cantidad_recibida, o.numero as orden, o.entregada_en, o.recibida_en,
       pe.nombre as entregado_por, pr.nombre as recibido_por
from public.ordenes o
join public.ordenes_produccion op on op.id = o.orden_produccion_id
join public.ordenes_lineas ol on ol.orden_id = o.id
join public.ordenes_asignaciones a on a.orden_linea_id = ol.id
join public.lotes mp on mp.id = a.lote_id
join public.items i on i.id = mp.item_id
left join public.lotes pt on pt.id = op.lote_pt_id
left join public.perfiles pe on pe.id = o.entregada_por
left join public.perfiles pr on pr.id = o.recibida_por
where o.tipo = 'requisicion_mp' and o.estado = 'recibida';

create view public.merma_por_turno with (security_invoker = true) as
select turno, count(*) as lotes, sum(materia_prima_lb) as materia_prima_lb, sum(merma_lb) as merma_lb,
       round(sum(merma_lb) / nullif(sum(materia_prima_lb), 0) * 100, 2) as merma_pct
from public.ordenes_produccion where estado = 'terminada'
group by turno;

create view public.merma_por_operador with (security_invoker = true) as
select p.id as operador_id, p.nombre as operador, count(distinct op.id) as lotes,
       sum(op.merma_lb) as merma_lb,
       round(sum(op.merma_lb) / nullif(sum(op.materia_prima_lb), 0) * 100, 2) as merma_pct
from public.ordenes_produccion op
join (select distinct orden_produccion_id, operador_id from public.op_etapas) e on e.orden_produccion_id = op.id
join public.perfiles p on p.id = e.operador_id
where op.estado = 'terminada'
group by p.id, p.nombre;

-- ---------------------------------------------------------------------
-- Nada se borra, el kárdex y la auditoría no se cambian
-- ---------------------------------------------------------------------
create function public._prohibir_borrar() returns trigger
language plpgsql as $$
begin
  raise exception using message = 'Nada se borra. Anule el registro con su motivo.', errcode = 'P0001';
end $$;

create function public._prohibir_cambiar() returns trigger
language plpgsql as $$
begin
  raise exception using message = 'Este historial no se puede cambiar.', errcode = 'P0001';
end $$;

create function public._auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fila jsonb := to_jsonb(coalesce(new, old));
  origen text;
begin
  begin
    origen := current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for';
  exception when others then
    origen := null;
  end;
  insert into public.auditoria (usuario_id, tabla, registro_id, accion, antes, despues, origen)
  values (auth.uid(), tg_table_name,
          coalesce(fila ->> 'id', fila ->> 'clave', fila ->> 'orden_produccion_id'),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          origen);
  return coalesce(new, old);
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'perfiles', 'configuracion', 'ubicaciones', 'proveedores', 'items', 'ordenes_compra', 'ordenes_compra_lineas',
    'formulas', 'formulas_lineas', 'ordenes_produccion', 'op_requerimientos', 'op_checklist', 'op_etapas',
    'lotes', 'inspecciones_calidad', 'movimientos', 'ordenes', 'ordenes_lineas', 'ordenes_asignaciones', 'conteos'
  ] loop
    execute format('create trigger auditar after insert or update on public.%I for each row execute function public._auditar()', t);
    execute format('create trigger prohibir_borrar before delete on public.%I for each row execute function public._prohibir_borrar()', t);
  end loop;
end $$;

create trigger prohibir_borrar before delete on public.avisos for each row execute function public._prohibir_borrar();
create trigger prohibir_cambiar before update or delete on public.auditoria for each row execute function public._prohibir_cambiar();
create trigger prohibir_cambiar before update on public.movimientos for each row execute function public._prohibir_cambiar();
create trigger prohibir_cambiar before update on public.inspecciones_calidad for each row execute function public._prohibir_cambiar();
create trigger prohibir_cambiar before update on public.formulas_lineas for each row execute function public._prohibir_cambiar();

-- ---------------------------------------------------------------------
-- Permisos (RLS): todos los usuarios activos leen; solo Gerencia
-- edita catálogos; lo demás se cambia solo con las funciones de arriba.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'perfiles', 'configuracion', 'ubicaciones', 'proveedores', 'items', 'ordenes_compra', 'ordenes_compra_lineas',
    'formulas', 'formulas_lineas', 'ordenes_produccion', 'op_requerimientos', 'op_checklist', 'op_etapas',
    'lotes', 'inspecciones_calidad', 'movimientos', 'ordenes', 'ordenes_lineas', 'ordenes_asignaciones', 'conteos',
    'avisos', 'auditoria'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  foreach t in array array[
    'configuracion', 'ubicaciones', 'proveedores', 'items', 'ordenes_compra',
    'formulas', 'formulas_lineas', 'ordenes_produccion', 'op_requerimientos', 'op_checklist', 'op_etapas',
    'lotes', 'inspecciones_calidad', 'movimientos', 'ordenes', 'ordenes_lineas', 'ordenes_asignaciones', 'conteos'
  ] loop
    execute format('create policy leer on public.%I for select to authenticated using (public.mi_rol() is not null)', t);
  end loop;

  foreach t in array array['ubicaciones', 'proveedores', 'items'] loop
    execute format('create policy gerencia_crea on public.%I for insert to authenticated with check (public.mi_rol() = ''gerencia'')', t);
    execute format('create policy gerencia_edita on public.%I for update to authenticated using (public.mi_rol() = ''gerencia'')', t);
  end loop;
end $$;

-- Los precios de compra no los ven vendedores ni operadores.
create policy leer on public.ordenes_compra_lineas for select to authenticated
  using (public.mi_rol() not in ('vendedor', 'operador'));

create policy leer on public.perfiles for select to authenticated
  using (id = auth.uid() or public.mi_rol() is not null);
create policy gerencia_edita on public.perfiles for update to authenticated
  using (public.mi_rol() = 'gerencia');

create policy gerencia_edita on public.configuracion for update to authenticated
  using (public.mi_rol() = 'gerencia');

create policy leer on public.avisos for select to authenticated
  using (public.mi_rol() = 'gerencia' or public.mi_rol() = any (roles));

create policy leer on public.auditoria for select to authenticated
  using (public.mi_rol() in ('gerencia', 'socio'));

-- Las funciones internas no se pueden llamar desde la app.
do $$
declare
  f record;
begin
  for f in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like '\_%' or p.proname = 'revisar_alertas') loop
    execute format('revoke execute on function %s from public', f.firma);
    begin
      execute format('revoke execute on function %s from anon, authenticated', f.firma);
    exception when undefined_object then
      null;
    end;
  end loop;
end $$;
