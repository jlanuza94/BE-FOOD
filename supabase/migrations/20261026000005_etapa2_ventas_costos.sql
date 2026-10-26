-- =====================================================================
-- BE Food · Etapa 2 · Ventas, despacho, cobros, pagos, gastos,
-- costo por saco y utilidad
--
-- Sigue la misma regla de la Etapa 1: las tablas solo se leen; todo
-- cambio pasa por funciones que revisan el rol. Los costos y la utilidad
-- solo los ve quien tiene permiso (el vendedor no).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Quién ve costos, gastos y cuentas por pagar
-- ---------------------------------------------------------------------
create function public.ve_costos() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('gerencia', 'socio', 'administracion', 'inventario', 'jefe_produccion'), false)
$$;

create function public._exigir_ver_costos() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ve_costos() then
    perform public._fallar('Su rol no permite ver costos ni utilidad.');
  end if;
end $$;

insert into public.configuracion (clave, valor, descripcion) values
  ('gasto_planta_por_saco', 0, 'Gastos de planta por saco (C$) mientras no haya un mes de gastos y producción anotados.'),
  ('dias_aviso_pago', 3, 'Días antes del vencimiento para avisar que hay que pagarle a un proveedor.');

-- ---------------------------------------------------------------------
-- Catálogos nuevos
-- ---------------------------------------------------------------------
alter table public.items add column precio_venta numeric check (precio_venta >= 0);

create table public.clientes (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  telefono text,
  direccion text,
  dias_credito integer not null default 0 check (dias_credito >= 0),
  limite_credito numeric not null default 0 check (limite_credito >= 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Costo de cada lote: materia prima al precio de su compra; producto
-- terminado con lo que de verdad costó (ingredientes de ese día + gastos
-- de planta), así la merma queda cobrada en el costo.
-- ---------------------------------------------------------------------
create table public.costos_lotes (
  lote_id bigint primary key references public.lotes (id),
  costo_unitario numeric not null,
  costo_materia_prima numeric,
  gasto_planta numeric,
  costo_total numeric,
  calculado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Gastos de la empresa
-- ---------------------------------------------------------------------
create table public.gastos (
  id bigint generated always as identity primary key,
  fecha date not null default (now() at time zone 'America/Managua')::date,
  categoria text not null check (categoria in (
    'luz', 'agua', 'salarios', 'transporte', 'combustible', 'mantenimiento', 'alquiler', 'impuestos', 'administracion', 'otros')),
  descripcion text not null,
  monto numeric not null check (monto > 0),
  incluir_en_costo boolean not null default true,
  foto_url text,
  registrado_por uuid not null references public.perfiles (id),
  registrado_en timestamptz not null default now(),
  anulado boolean not null default false,
  motivo_anulacion text
);

-- ---------------------------------------------------------------------
-- Ventas, despacho y facturas
-- ---------------------------------------------------------------------
create sequence public.seq_ov;
create table public.ventas (
  id bigint generated always as identity primary key,
  numero text not null unique default 'OV-' || lpad(nextval('public.seq_ov')::text, 4, '0'),
  cliente_id bigint not null references public.clientes (id),
  condicion text not null check (condicion in ('contado', 'credito')),
  estado text not null default 'abierta' check (estado in ('abierta', 'completa', 'anulada')),
  notas text,
  creada_por uuid not null references public.perfiles (id),
  creada_en timestamptz not null default now(),
  motivo_anulacion text
);

create table public.ventas_lineas (
  id bigint generated always as identity primary key,
  venta_id bigint not null references public.ventas (id),
  item_id bigint not null references public.items (id),
  sacos integer not null check (sacos > 0),
  precio_lista numeric,
  precio_unitario numeric not null check (precio_unitario >= 0),
  unique (venta_id, item_id)
);

alter table public.ordenes add column venta_id bigint references public.ventas (id);

-- Firma del cliente al recibir
create table public.entregas_cliente (
  orden_id bigint primary key references public.ordenes (id),
  recibido_por_nombre text not null,
  firma_url text not null,
  registrado_por uuid not null references public.perfiles (id),
  registrado_en timestamptz not null default now()
);

create sequence public.seq_factura;
create table public.facturas (
  id bigint generated always as identity primary key,
  numero text not null unique default 'F-' || lpad(nextval('public.seq_factura')::text, 5, '0'),
  venta_id bigint not null references public.ventas (id),
  orden_id bigint not null unique references public.ordenes (id),
  cliente_id bigint not null references public.clientes (id),
  fecha date not null default (now() at time zone 'America/Managua')::date,
  condicion text not null,
  vence date not null,
  total numeric not null,
  creada_por uuid not null references public.perfiles (id),
  creada_en timestamptz not null default now()
);

create table public.facturas_lineas (
  id bigint generated always as identity primary key,
  factura_id bigint not null references public.facturas (id),
  item_id bigint not null references public.items (id),
  lote_id bigint not null references public.lotes (id),
  sacos numeric not null,
  precio_unitario numeric not null,
  subtotal numeric not null
);

create table public.abonos (
  id bigint generated always as identity primary key,
  factura_id bigint not null references public.facturas (id),
  fecha timestamptz not null default now(),
  monto numeric not null check (monto > 0),
  forma text not null check (forma in ('efectivo', 'transferencia', 'cheque', 'deposito')),
  referencia text,
  foto_url text,
  registrado_por uuid not null references public.perfiles (id)
);

-- ---------------------------------------------------------------------
-- Cuentas por pagar a proveedores
-- ---------------------------------------------------------------------
create table public.facturas_proveedor (
  id bigint generated always as identity primary key,
  orden_compra_id bigint not null references public.ordenes_compra (id),
  proveedor_id bigint not null references public.proveedores (id),
  numero text not null,
  fecha date not null,
  vence date not null,
  monto numeric not null check (monto > 0),
  foto_url text,
  registrada_por uuid not null references public.perfiles (id),
  registrada_en timestamptz not null default now(),
  unique (proveedor_id, numero)
);

create table public.pagos_proveedor (
  id bigint generated always as identity primary key,
  factura_proveedor_id bigint not null references public.facturas_proveedor (id),
  monto numeric not null check (monto > 0),
  estado text not null default 'solicitado' check (estado in ('solicitado', 'aprobado', 'pagado', 'rechazado')),
  solicitado_por uuid not null references public.perfiles (id),
  solicitado_en timestamptz not null default now(),
  aprobado_por uuid references public.perfiles (id),
  aprobado_en timestamptz,
  motivo_rechazo text,
  forma text check (forma in ('efectivo', 'transferencia', 'cheque', 'deposito')),
  referencia text,
  comprobante_url text,
  pagado_por uuid references public.perfiles (id),
  pagado_en timestamptz
);

-- ---------------------------------------------------------------------
-- Precios y costos
-- ---------------------------------------------------------------------

-- Precio promedio de compra de los últimos 90 días (ponderado por lo
-- recibido). Si no hay compras recientes, el último precio conocido.
create function public._precio_promedio(p_item_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select sum(l.cantidad_recibida * l.precio_unitario) / nullif(sum(l.cantidad_recibida), 0)
       from public.ordenes_compra_lineas l join public.ordenes_compra oc on oc.id = l.orden_compra_id
      where l.item_id = p_item_id and l.precio_unitario is not null and l.cantidad_recibida > 0
        and oc.creada_en > now() - interval '90 days'),
    (select l.precio_unitario
       from public.ordenes_compra_lineas l join public.ordenes_compra oc on oc.id = l.orden_compra_id
      where l.item_id = p_item_id and l.precio_unitario is not null and l.cantidad_recibida > 0
      order by oc.creada_en desc limit 1))
$$;

-- Gastos de planta de los últimos 30 días entre los sacos producidos.
create function public._gasto_planta_por_saco() returns numeric
language sql stable security definer set search_path = public as $$
  with g as (
    select coalesce(sum(monto), 0) as gastos from public.gastos
     where incluir_en_costo and not anulado and fecha > public.hoy() - 30
  ), s as (
    select coalesce(sum(sacos_producidos), 0) as sacos from public.ordenes_produccion
     where estado = 'terminada' and terminada_en > now() - interval '30 days'
  )
  select case when g.gastos > 0 and s.sacos > 0 then round(g.gastos / s.sacos, 2)
              else public._config('gasto_planta_por_saco') end
  from g, s
$$;

-- Costo estimado de un saco según la fórmula y los precios de hoy.
create function public._costo_formula(p_formula_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select sum(fl.cantidad_por_saco * coalesce(public._precio_promedio(fl.item_id), 0))
  from public.formulas_lineas fl where fl.formula_id = p_formula_id
$$;

-- El lote de materia prima cuesta lo que se pagó en su compra. Si el
-- precio subió, avisa cuánto baja la ganancia por saco.
create function public._costear_lote_mp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  precio numeric;
  antes numeric;
  it public.items;
  f record;
  detalle text[] := '{}';
begin
  if new.orden_compra_linea_id is null then
    return new;
  end if;
  select precio_unitario into precio from public.ordenes_compra_lineas where id = new.orden_compra_linea_id;
  if precio is null then
    return new;
  end if;
  antes := public._precio_promedio(new.item_id);
  insert into public.costos_lotes (lote_id, costo_unitario) values (new.id, precio);

  if antes is not null and precio > antes then
    select * into it from public.items where id = new.item_id;
    for f in select fo.id, p.nombre, p.precio_venta, fl.cantidad_por_saco
             from public.formulas fo
             join public.formulas_lineas fl on fl.formula_id = fo.id and fl.item_id = new.item_id
             join public.items p on p.id = fo.producto_id
             where fo.activa loop
      detalle := detalle || format('%s cuesta C$ %s más por saco%s', f.nombre,
        trim_scale(round((precio - antes) * f.cantidad_por_saco, 2)),
        case when f.precio_venta is not null then format(' (ganancia por saco baja de C$ %s a C$ %s)',
          trim_scale(round(f.precio_venta - public._costo_formula(f.id) - public._gasto_planta_por_saco(), 2)),
          trim_scale(round(f.precio_venta - public._costo_formula(f.id) - public._gasto_planta_por_saco() - (precio - antes) * f.cantidad_por_saco, 2)))
        else '' end);
    end loop;
    perform public._aviso('subio_costo',
      format('Subió %s: de C$ %s a C$ %s por %s. %s', it.nombre, trim_scale(round(antes, 2)), trim_scale(round(precio, 2)), it.unidad,
             coalesce(nullif(array_to_string(detalle, '; '), ''), 'Revise los precios de venta.')),
      '{gerencia}', '/costos', format('subio:%s:%s', new.item_id, new.id));
  end if;
  return new;
end $$;

create trigger costear_lote_mp after insert on public.lotes
  for each row execute function public._costear_lote_mp();

insert into public.costos_lotes (lote_id, costo_unitario)
select l.id, ocl.precio_unitario from public.lotes l
join public.ordenes_compra_lineas ocl on ocl.id = l.orden_compra_linea_id
where ocl.precio_unitario is not null
on conflict do nothing;

-- Al cerrar una producción: costo real del lote con lo que se usó ese día.
create function public._costear_produccion() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  mp numeric;
  planta numeric;
begin
  if not (new.estado = 'terminada' and old.estado is distinct from 'terminada') or new.lote_pt_id is null then
    return new;
  end if;
  select coalesce(sum(a.cantidad_recibida * coalesce(c.costo_unitario, public._precio_promedio(l.item_id), 0)), 0) into mp
    from public.ordenes o
    join public.ordenes_lineas ol on ol.orden_id = o.id
    join public.ordenes_asignaciones a on a.orden_linea_id = ol.id
    join public.lotes l on l.id = a.lote_id
    left join public.costos_lotes c on c.lote_id = a.lote_id
   where o.orden_produccion_id = new.id and o.tipo = 'requisicion_mp' and o.estado = 'recibida';
  planta := public._gasto_planta_por_saco() * coalesce(new.sacos_producidos, 0);
  insert into public.costos_lotes (lote_id, costo_unitario, costo_materia_prima, gasto_planta, costo_total)
  values (new.lote_pt_id,
          case when coalesce(new.sacos_producidos, 0) > 0 then round((mp + planta) / new.sacos_producidos, 2) else 0 end,
          round(mp, 2), round(planta, 2), round(mp + planta, 2))
  on conflict (lote_id) do update set costo_unitario = excluded.costo_unitario, costo_materia_prima = excluded.costo_materia_prima,
    gasto_planta = excluded.gasto_planta, costo_total = excluded.costo_total, calculado_en = now();
  return new;
end $$;

create trigger costear_produccion after update on public.ordenes_produccion
  for each row execute function public._costear_produccion();

-- ---------------------------------------------------------------------
-- Órdenes de despacho: se agregan al mecanismo de cuatro cantidades.
-- Pedida (Ventas) → aprobada (Bodega aparta FEFO/FIFO) → entregada
-- (Despacho carga, sale del kárdex) → recibida (el cliente firma).
-- ---------------------------------------------------------------------
alter table public.movimientos drop constraint movimientos_tipo_check;
alter table public.movimientos add constraint movimientos_tipo_check check (tipo in (
  'recepcion_compra', 'salida_requisicion', 'entrada_produccion', 'ajuste_conteo', 'salida_despacho'));

create sequence public.seq_ds;

create or replace function public._reservado(p_lote_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(a.cantidad_asignada), 0)
  from public.ordenes_asignaciones a
  join public.ordenes_lineas ol on ol.id = a.orden_linea_id
  join public.ordenes o on o.id = ol.orden_id
  where a.lote_id = p_lote_id and o.estado = 'aprobada' and o.tipo in ('requisicion_mp', 'despacho')
$$;

create or replace view public.inventario_lotes with (security_invoker = true) as
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
           where o.estado = 'aprobada' and o.tipo in ('requisicion_mp', 'despacho')
           group by a.lote_id) r on r.lote_id = l.id;

create or replace function public.entregar_orden(p_orden_id bigint, p_entregas jsonb) returns void
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
  elsif o.tipo = 'despacho' then
    perform public._exigir_rol('despacho', 'bodeguero');
  else
    perform public._exigir_rol('jefe_produccion');
  end if;
  if o.estado <> 'aprobada' then
    perform public._fallar('Sin orden aprobada no sale nada.');
  end if;

  for a in select oa.*, l.codigo, l.item_id
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
    if o.tipo in ('requisicion_mp', 'despacho') and cant > 0 then
      perform public._registrar_movimiento(a.lote_id,
        case when o.tipo = 'despacho' then 'salida_despacho' else 'salida_requisicion' end, -cant, o.numero);
      items_tocados := items_tocados || a.item_id;
    end if;
  end loop;

  update public.ordenes set estado = 'entregada', entregada_por = auth.uid(), entregada_en = now(), actualizada_en = now()
   where id = o.id;
  foreach it in array items_tocados loop
    perform public._revisar_stock_minimo(it);
  end loop;
  perform public._aviso('orden_por_recibir',
    format(case when o.tipo = 'despacho' then 'La orden %s salió. Al entregar, el cliente firma lo que recibió.'
                else 'La orden %s fue entregada. Cuente y confirme lo que recibió.' end, o.numero),
    case o.tipo when 'requisicion_mp' then '{jefe_produccion}'::public.rol_usuario[]
                when 'despacho' then '{despacho}'::public.rol_usuario[]
                else '{bodeguero}'::public.rol_usuario[] end,
    '/ordenes/' || o.id);
end $$;

create or replace function public.recibir_orden(p_orden_id bigint, p_recepciones jsonb) returns void
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
  elsif o.tipo = 'despacho' then
    perform public._exigir_rol('despacho');
    if current_setting('befood.entrega_cliente', true) is distinct from 'si' then
      perform public._fallar('La entrega al cliente se confirma con su firma.');
    end if;
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

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create function public.guardar_cliente(
  p_id bigint, p_nombre text, p_telefono text default null, p_direccion text default null,
  p_dias_credito integer default 0, p_limite_credito numeric default 0, p_activo boolean default true
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  c_id bigint;
  actual public.clientes;
begin
  perform public._exigir_rol('vendedor', 'administracion');
  if coalesce(trim(p_nombre), '') = '' then
    perform public._fallar('Escriba el nombre del cliente.');
  end if;
  if p_id is null then
    -- El vendedor registra clientes de contado; el crédito lo da Gerencia o Administración.
    if public.mi_rol() = 'vendedor' and (coalesce(p_dias_credito, 0) > 0 or coalesce(p_limite_credito, 0) > 0) then
      perform public._fallar('El crédito del cliente lo asigna Gerencia o Administración.');
    end if;
    insert into public.clientes (nombre, telefono, direccion, dias_credito, limite_credito)
    values (trim(p_nombre), p_telefono, p_direccion, coalesce(p_dias_credito, 0), coalesce(p_limite_credito, 0))
    returning id into c_id;
    return c_id;
  end if;
  select * into actual from public.clientes where id = p_id for update;
  if public.mi_rol() = 'vendedor' and (coalesce(p_dias_credito, 0) <> actual.dias_credito
                                        or coalesce(p_limite_credito, 0) <> actual.limite_credito
                                        or p_activo is distinct from actual.activo) then
    perform public._fallar('El crédito del cliente lo asigna Gerencia o Administración.');
  end if;
  update public.clientes
     set nombre = trim(p_nombre), telefono = p_telefono, direccion = p_direccion,
         dias_credito = coalesce(p_dias_credito, 0), limite_credito = coalesce(p_limite_credito, 0), activo = p_activo
   where id = p_id;
  return p_id;
end $$;

-- ---------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------

-- Sacos de una venta que ya están en un despacho no anulado.
create function public._comprometido_venta(p_venta_id bigint, p_item_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case o.estado
      when 'pedida' then ol.cantidad_pedida
      when 'aprobada' then ol.cantidad_aprobada
      else (select coalesce(sum(a.cantidad_recibida), sum(a.cantidad_entregada), 0) from public.ordenes_asignaciones a where a.orden_linea_id = ol.id)
    end), 0)
  from public.ordenes o
  join public.ordenes_lineas ol on ol.orden_id = o.id
  where o.venta_id = p_venta_id and o.tipo = 'despacho' and o.estado <> 'anulada' and ol.item_id = p_item_id
$$;

create function public._saldo_cliente(p_cliente_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(f.total - coalesce((select sum(ab.monto) from public.abonos ab where ab.factura_id = f.id), 0)), 0)
  from public.facturas f where f.cliente_id = p_cliente_id
$$;

-- Crea la orden de despacho con lo que falta por entregar de la venta.
-- Si no hay sacos liberados suficientes, avisa a Producción.
create function public.crear_despacho(p_venta_id bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v public.ventas;
  ln record;
  pendiente numeric;
  disp numeric;
  o_id bigint;
  hay boolean := false;
begin
  perform public._exigir_rol('vendedor', 'administracion', 'despacho');
  select * into v from public.ventas where id = p_venta_id for update;
  if v.estado <> 'abierta' then
    perform public._fallar('La venta no está abierta.');
  end if;
  if exists (select 1 from public.ordenes where venta_id = v.id and tipo = 'despacho' and estado in ('pedida', 'aprobada', 'entregada')) then
    perform public._fallar('Ya hay un despacho en camino para esta venta. Termínelo primero.');
  end if;

  for ln in select vl.*, i.nombre from public.ventas_lineas vl join public.items i on i.id = vl.item_id
            where vl.venta_id = v.id order by vl.id loop
    pendiente := ln.sacos - public._comprometido_venta(v.id, ln.item_id);
    continue when pendiente <= 0;
    if not hay then
      insert into public.ordenes (numero, tipo, venta_id, notas, pedida_por)
      values ('DS-' || lpad(nextval('public.seq_ds')::text, 4, '0'), 'despacho', v.id,
              'Venta ' || v.numero || ' · ' || (select nombre from public.clientes where id = v.cliente_id), auth.uid())
      returning id into o_id;
      hay := true;
    end if;
    insert into public.ordenes_lineas (orden_id, item_id, cantidad_pedida) values (o_id, ln.item_id, pendiente);
    disp := public._disponible_item(ln.item_id);
    if disp < pendiente then
      perform public._aviso('faltan_sacos',
        format('Faltan %s sacos de %s para la venta %s (hay %s liberados). Hay que producirlos.',
               trim_scale(pendiente - greatest(disp, 0)), ln.nombre, v.numero, trim_scale(greatest(disp, 0))),
        '{jefe_produccion,gerencia}', '/ventas/' || v.id);
    end if;
  end loop;

  if not hay then
    perform public._fallar('No queda nada pendiente de despachar en esta venta.');
  end if;
  perform public._aviso('despacho_por_aprobar',
    format('Hay un despacho para %s (%s). Revise y apruebe los sacos.',
           (select nombre from public.clientes where id = v.cliente_id), (select numero from public.ordenes where id = o_id)),
    '{bodeguero}', '/ordenes/' || o_id);
  return o_id;
end $$;

create function public.crear_venta(p_cliente_id bigint, p_condicion text, p_lineas jsonb, p_notas text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  c public.clientes;
  v_id bigint;
  x record;
  it public.items;
  precio numeric;
  total numeric := 0;
begin
  perform public._exigir_rol('vendedor', 'administracion');
  select * into c from public.clientes where id = p_cliente_id;
  if c.id is null or not c.activo then
    perform public._fallar('Elija un cliente activo.');
  end if;
  if p_condicion not in ('contado', 'credito') then
    perform public._fallar('La venta es de contado o al crédito.');
  end if;
  if p_condicion = 'credito' and c.dias_credito = 0 then
    perform public._fallar('Este cliente no tiene crédito. Pida a Gerencia que se lo asigne.');
  end if;
  if jsonb_array_length(coalesce(p_lineas, '[]')) = 0 then
    perform public._fallar('La venta necesita al menos un producto.');
  end if;

  -- Primero se revisa todo, para no gastar números de venta en intentos que no pasan.
  for x in select * from jsonb_to_recordset(p_lineas) as t(item_id bigint, sacos integer, precio_unitario numeric) loop
    select * into it from public.items where id = x.item_id;
    if it.tipo is distinct from 'producto_terminado' then
      perform public._fallar('Solo se venden alimentos terminados.');
    end if;
    if coalesce(x.sacos, 0) <= 0 then
      perform public._fallar('Indique cuántos sacos.');
    end if;
    precio := coalesce(x.precio_unitario, it.precio_venta);
    if precio is null then
      perform public._fallar(format('%s no tiene precio de venta. Gerencia debe ponerlo en Catálogos.', it.nombre));
    end if;
    if precio is distinct from it.precio_venta and public.mi_rol() <> 'gerencia' then
      perform public._fallar('Solo Gerencia puede cambiar precios o dar descuentos.');
    end if;
    total := total + x.sacos * precio;
  end loop;

  if p_condicion = 'credito' and c.limite_credito > 0
     and public._saldo_cliente(c.id) + total > c.limite_credito and public.mi_rol() <> 'gerencia' then
    perform public._fallar(format('Con esta venta %s debería C$ %s y su límite es C$ %s. Necesita aprobación de Gerencia.',
      c.nombre, trim_scale(round(public._saldo_cliente(c.id) + total, 2)), trim_scale(c.limite_credito)));
  end if;

  insert into public.ventas (cliente_id, condicion, notas, creada_por)
  values (c.id, p_condicion, p_notas, auth.uid()) returning id into v_id;
  insert into public.ventas_lineas (venta_id, item_id, sacos, precio_lista, precio_unitario)
  select v_id, i.id, t.sacos, i.precio_venta, coalesce(t.precio_unitario, i.precio_venta)
  from jsonb_to_recordset(p_lineas) as t(item_id bigint, sacos integer, precio_unitario numeric)
  join public.items i on i.id = t.item_id;

  perform public.crear_despacho(v_id);
  return v_id;
end $$;

-- El cliente firma lo que recibió. Con eso se hace la factura.
create function public.confirmar_entrega_cliente(
  p_orden_id bigint, p_recepciones jsonb, p_recibido_por text, p_firma_url text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  o public.ordenes;
  v public.ventas;
  c public.clientes;
  f_id bigint;
  total numeric;
begin
  perform public._exigir_rol('despacho');
  select * into o from public.ordenes where id = p_orden_id for update;
  if o.tipo is distinct from 'despacho' then
    perform public._fallar('Esta orden no es un despacho a cliente.');
  end if;
  if coalesce(trim(p_recibido_por), '') = '' then
    perform public._fallar('Escriba el nombre de quien recibe.');
  end if;
  if coalesce(p_firma_url, '') = '' then
    perform public._fallar('Falta la firma del cliente.');
  end if;

  perform set_config('befood.entrega_cliente', 'si', true);
  perform public.recibir_orden(p_orden_id, p_recepciones);
  perform set_config('befood.entrega_cliente', 'no', true);

  insert into public.entregas_cliente (orden_id, recibido_por_nombre, firma_url, registrado_por)
  values (o.id, trim(p_recibido_por), p_firma_url, auth.uid());

  select * into v from public.ventas where id = o.venta_id;
  select * into c from public.clientes where id = v.cliente_id;
  select coalesce(sum(a.cantidad_recibida * vl.precio_unitario), 0) into total
    from public.ordenes_lineas ol
    join public.ordenes_asignaciones a on a.orden_linea_id = ol.id
    join public.ventas_lineas vl on vl.venta_id = v.id and vl.item_id = ol.item_id
   where ol.orden_id = o.id;

  if total > 0 then
    insert into public.facturas (venta_id, orden_id, cliente_id, condicion, vence, total, creada_por)
    values (v.id, o.id, c.id, v.condicion,
            public.hoy() + case when v.condicion = 'credito' then c.dias_credito else 0 end, total, auth.uid())
    returning id into f_id;
    insert into public.facturas_lineas (factura_id, item_id, lote_id, sacos, precio_unitario, subtotal)
    select f_id, ol.item_id, a.lote_id, a.cantidad_recibida, vl.precio_unitario, a.cantidad_recibida * vl.precio_unitario
      from public.ordenes_lineas ol
      join public.ordenes_asignaciones a on a.orden_linea_id = ol.id
      join public.ventas_lineas vl on vl.venta_id = v.id and vl.item_id = ol.item_id
     where ol.orden_id = o.id and a.cantidad_recibida > 0;
    perform public._aviso('factura_nueva',
      format('Factura %s a %s por C$ %s (%s).', (select numero from public.facturas where id = f_id), c.nombre,
             trim_scale(round(total, 2)), v.condicion),
      '{administracion}', '/cobros');
  end if;

  if not exists (select 1 from public.ventas_lineas vl
                 where vl.venta_id = v.id and vl.sacos > public._comprometido_venta(v.id, vl.item_id)) then
    update public.ventas set estado = 'completa' where id = v.id;
  end if;
  return f_id;
end $$;

create function public.anular_venta(p_venta_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v public.ventas;
begin
  select * into v from public.ventas where id = p_venta_id for update;
  if v.creada_por <> auth.uid() then
    perform public._exigir_gerencia();
  else
    perform public._exigir_rol('vendedor', 'administracion');
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba el motivo de la anulación.');
  end if;
  if exists (select 1 from public.ordenes where venta_id = v.id and estado in ('entregada', 'recibida')) then
    perform public._fallar('Ya salieron sacos de esta venta. No se puede anular.');
  end if;
  update public.ordenes
     set estado = 'anulada', anulada_por = auth.uid(), anulada_en = now(),
         motivo_anulacion = 'Se anuló ' || v.numero || ': ' || p_motivo, actualizada_en = now()
   where venta_id = v.id and estado in ('pedida', 'aprobada');
  update public.ventas set estado = 'anulada', motivo_anulacion = p_motivo where id = v.id;
end $$;

-- Cierra lo que quedó pendiente de una venta (por ejemplo, el cliente ya no lo quiere).
create function public.cerrar_venta(p_venta_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_rol('vendedor', 'administracion');
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba por qué se cierra con sacos pendientes.');
  end if;
  if exists (select 1 from public.ordenes where venta_id = p_venta_id and estado in ('pedida', 'aprobada', 'entregada')) then
    perform public._fallar('Hay un despacho en camino. Termínelo o anúlelo primero.');
  end if;
  update public.ventas set estado = 'completa', notas = concat_ws(' / ', notas, 'Cerrada: ' || p_motivo)
   where id = p_venta_id and estado = 'abierta';
  if not found then
    perform public._fallar('La venta no está abierta.');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Cobros
-- ---------------------------------------------------------------------
create function public.registrar_abono(
  p_factura_id bigint, p_monto numeric, p_forma text, p_referencia text default null, p_foto_url text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  f public.facturas;
  saldo numeric;
  a_id bigint;
begin
  perform public._exigir_rol('administracion');
  select * into f from public.facturas where id = p_factura_id for update;
  if f.id is null then
    perform public._fallar('No existe esa factura.');
  end if;
  saldo := f.total - coalesce((select sum(monto) from public.abonos where factura_id = f.id), 0);
  if coalesce(p_monto, 0) <= 0 then
    perform public._fallar('Escriba el monto.');
  end if;
  if p_monto > saldo then
    perform public._fallar(format('La factura solo debe C$ %s.', trim_scale(round(saldo, 2))));
  end if;
  if p_forma <> 'efectivo' and coalesce(trim(p_referencia), '') = '' and coalesce(p_foto_url, '') = '' then
    perform public._fallar('Para transferencia, cheque o depósito ponga el número o una foto.');
  end if;
  insert into public.abonos (factura_id, monto, forma, referencia, foto_url, registrado_por)
  values (f.id, p_monto, p_forma, p_referencia, p_foto_url, auth.uid()) returning id into a_id;
  return a_id;
end $$;

-- ---------------------------------------------------------------------
-- Pagos a proveedores: factura → pago aprobado por Gerencia → pago hecho
-- con comprobante.
-- ---------------------------------------------------------------------
create function public.registrar_factura_proveedor(
  p_orden_compra_id bigint, p_numero text, p_fecha date, p_dias_credito integer, p_monto numeric, p_foto_url text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  oc public.ordenes_compra;
  fp_id bigint;
begin
  perform public._exigir_rol('administracion', 'inventario');
  select * into oc from public.ordenes_compra where id = p_orden_compra_id;
  if oc.id is null or oc.estado not in ('aprobada', 'recibida') then
    perform public._fallar('La factura debe ser de una orden de compra aprobada.');
  end if;
  if coalesce(trim(p_numero), '') = '' then
    perform public._fallar('Escriba el número de la factura del proveedor.');
  end if;
  if coalesce(p_monto, 0) <= 0 then
    perform public._fallar('Escriba el monto de la factura.');
  end if;
  insert into public.facturas_proveedor (orden_compra_id, proveedor_id, numero, fecha, vence, monto, foto_url, registrada_por)
  values (oc.id, oc.proveedor_id, trim(p_numero), coalesce(p_fecha, public.hoy()),
          coalesce(p_fecha, public.hoy()) + coalesce(p_dias_credito, 0), p_monto, p_foto_url, auth.uid())
  returning id into fp_id;
  return fp_id;
end $$;

create function public._saldo_factura_proveedor(p_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select fp.monto - coalesce((select sum(monto) from public.pagos_proveedor where factura_proveedor_id = fp.id and estado = 'pagado'), 0)
  from public.facturas_proveedor fp where fp.id = p_id
$$;

create function public.solicitar_pago(p_factura_proveedor_id bigint, p_monto numeric) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  libre numeric;
  p_id bigint;
begin
  perform public._exigir_rol('administracion');
  perform 1 from public.facturas_proveedor where id = p_factura_proveedor_id for update;
  libre := public._saldo_factura_proveedor(p_factura_proveedor_id)
           - coalesce((select sum(monto) from public.pagos_proveedor
                       where factura_proveedor_id = p_factura_proveedor_id and estado in ('solicitado', 'aprobado')), 0);
  if coalesce(p_monto, 0) <= 0 then
    perform public._fallar('Escriba el monto a pagar.');
  end if;
  if p_monto > libre then
    perform public._fallar(format('Solo quedan C$ %s por pagar en esta factura.', trim_scale(round(libre, 2))));
  end if;
  insert into public.pagos_proveedor (factura_proveedor_id, monto, solicitado_por)
  values (p_factura_proveedor_id, p_monto, auth.uid()) returning id into p_id;
  perform public._aviso('pago_por_aprobar',
    format('Administración pide pagar C$ %s a %s. Falta su aprobación.', trim_scale(p_monto),
           (select pr.nombre from public.facturas_proveedor fp join public.proveedores pr on pr.id = fp.proveedor_id
             where fp.id = p_factura_proveedor_id)),
    '{gerencia}', '/pagos');
  return p_id;
end $$;

create function public.aprobar_pago(p_pago_id bigint, p_aprobar boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_gerencia();
  if not p_aprobar and coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba por qué no se aprueba.');
  end if;
  update public.pagos_proveedor
     set estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
         aprobado_por = auth.uid(), aprobado_en = now(), motivo_rechazo = p_motivo
   where id = p_pago_id and estado = 'solicitado';
  if not found then
    perform public._fallar('Este pago no está esperando aprobación.');
  end if;
end $$;

create function public.registrar_pago_hecho(p_pago_id bigint, p_forma text, p_referencia text, p_comprobante_url text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_rol('administracion');
  if coalesce(p_comprobante_url, '') = '' then
    perform public._fallar('Falta la foto del comprobante.');
  end if;
  update public.pagos_proveedor
     set estado = 'pagado', forma = p_forma, referencia = p_referencia, comprobante_url = p_comprobante_url,
         pagado_por = auth.uid(), pagado_en = now()
   where id = p_pago_id and estado = 'aprobado';
  if not found then
    perform public._fallar('Sin aprobación de Gerencia no se paga.');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Gastos
-- ---------------------------------------------------------------------
create function public.registrar_gasto(
  p_fecha date, p_categoria text, p_descripcion text, p_monto numeric,
  p_incluir_en_costo boolean default true, p_foto_url text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  g_id bigint;
begin
  perform public._exigir_rol('administracion');
  if coalesce(trim(p_descripcion), '') = '' then
    perform public._fallar('Escriba en qué se gastó.');
  end if;
  insert into public.gastos (fecha, categoria, descripcion, monto, incluir_en_costo, foto_url, registrado_por)
  values (coalesce(p_fecha, public.hoy()), p_categoria, trim(p_descripcion), p_monto, coalesce(p_incluir_en_costo, true), p_foto_url, auth.uid())
  returning id into g_id;
  return g_id;
end $$;

create function public.anular_gasto(p_gasto_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_gerencia();
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba el motivo.');
  end if;
  update public.gastos set anulado = true, motivo_anulacion = p_motivo where id = p_gasto_id and not anulado;
  if not found then
    perform public._fallar('Ese gasto ya está anulado.');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------
create view public.cuentas_por_cobrar with (security_invoker = true) as
select f.id, f.numero, f.venta_id, f.cliente_id, c.nombre as cliente, f.fecha, f.vence, f.condicion, f.total,
       coalesce(a.abonado, 0) as abonado, f.total - coalesce(a.abonado, 0) as saldo,
       greatest(public.hoy() - f.vence, 0) as dias_atraso
from public.facturas f
join public.clientes c on c.id = f.cliente_id
left join (select factura_id, sum(monto) as abonado from public.abonos group by factura_id) a on a.factura_id = f.id;

create view public.cuentas_por_pagar with (security_invoker = true) as
select fp.id, fp.numero, fp.orden_compra_id, oc.numero as orden_compra, fp.proveedor_id, p.nombre as proveedor,
       fp.fecha, fp.vence, fp.monto,
       coalesce(sum(pp.monto) filter (where pp.estado = 'pagado'), 0) as pagado,
       coalesce(sum(pp.monto) filter (where pp.estado in ('solicitado', 'aprobado')), 0) as en_tramite,
       fp.monto - coalesce(sum(pp.monto) filter (where pp.estado = 'pagado'), 0) as saldo,
       fp.vence - public.hoy() as dias_para_vencer
from public.facturas_proveedor fp
join public.proveedores p on p.id = fp.proveedor_id
join public.ordenes_compra oc on oc.id = fp.orden_compra_id
left join public.pagos_proveedor pp on pp.factura_proveedor_id = fp.id
group by fp.id, oc.numero, p.nombre;

create view public.ventas_resumen with (security_invoker = true) as
select v.id, v.numero, v.cliente_id, c.nombre as cliente, v.condicion, v.estado, v.creada_en, v.creada_por,
       (select sum(sacos) from public.ventas_lineas where venta_id = v.id) as sacos,
       (select sum(sacos * precio_unitario) from public.ventas_lineas where venta_id = v.id) as total,
       coalesce((select sum(a.cantidad_recibida) from public.ordenes o join public.ordenes_lineas ol on ol.orden_id = o.id
                 join public.ordenes_asignaciones a on a.orden_linea_id = ol.id
                 where o.venta_id = v.id and o.estado = 'recibida'), 0) as sacos_entregados,
       coalesce((select sum(total) from public.facturas where venta_id = v.id), 0) as facturado
from public.ventas v join public.clientes c on c.id = v.cliente_id;

-- ---------------------------------------------------------------------
-- Reportes de costo y utilidad (solo quien puede ver costos)
-- ---------------------------------------------------------------------
create function public.reporte_costo_formulas()
returns table (formula_id bigint, producto_id bigint, producto text, version integer, costo_materia_prima numeric,
               gasto_planta numeric, costo_total numeric, precio_venta numeric, ganancia numeric, margen_pct numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._exigir_ver_costos();
  return query
  select f.id, p.id, p.nombre, f.version,
         round(public._costo_formula(f.id), 2),
         public._gasto_planta_por_saco(),
         round(public._costo_formula(f.id) + public._gasto_planta_por_saco(), 2),
         p.precio_venta,
         round(p.precio_venta - public._costo_formula(f.id) - public._gasto_planta_por_saco(), 2),
         round((p.precio_venta - public._costo_formula(f.id) - public._gasto_planta_por_saco()) / nullif(p.precio_venta, 0) * 100, 1)
  from public.formulas f join public.items p on p.id = f.producto_id
  where f.activa
  order by p.nombre;
end $$;

create function public.reporte_detalle_formula(p_formula_id bigint)
returns table (item text, unidad text, cantidad_por_saco numeric, precio numeric, costo numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._exigir_ver_costos();
  return query
  select i.nombre, i.unidad, fl.cantidad_por_saco, round(public._precio_promedio(fl.item_id), 2),
         round(fl.cantidad_por_saco * coalesce(public._precio_promedio(fl.item_id), 0), 2)
  from public.formulas_lineas fl join public.items i on i.id = fl.item_id
  where fl.formula_id = p_formula_id
  order by fl.id;
end $$;

create function public.reporte_costo_lote(p_lote_id bigint)
returns table (costo_unitario numeric, costo_materia_prima numeric, gasto_planta numeric, costo_total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._exigir_ver_costos();
  return query select c.costo_unitario, c.costo_materia_prima, c.gasto_planta, c.costo_total
               from public.costos_lotes c where c.lote_id = p_lote_id;
end $$;

-- Utilidad de un período: lo vendido (facturado) menos lo que costó
-- hacer esos sacos (costo real de cada lote) menos los gastos que no
-- entran al costo del saco. Aparte, lo que de verdad se cobró.
create function public.reporte_utilidad(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
begin
  perform public._exigir_ver_costos();
  with lineas as (
    select fl.*, f.cliente_id, c.nombre as cliente, i.nombre as producto,
           fl.sacos * coalesce(cl.costo_unitario, 0) as costo,
           cl.costo_unitario is null as sin_costo
    from public.facturas f
    join public.facturas_lineas fl on fl.factura_id = f.id
    join public.clientes c on c.id = f.cliente_id
    join public.items i on i.id = fl.item_id
    left join public.costos_lotes cl on cl.lote_id = fl.lote_id
    where f.fecha between p_desde and p_hasta
  ), gastos as (
    select coalesce(sum(monto) filter (where not incluir_en_costo), 0) as fuera,
           coalesce(sum(monto) filter (where incluir_en_costo), 0) as planta
    from public.gastos where not anulado and fecha between p_desde and p_hasta
  )
  select jsonb_build_object(
    'ventas', coalesce((select sum(subtotal) from lineas), 0),
    'sacos', coalesce((select sum(sacos) from lineas), 0),
    'costo_ventas', round(coalesce((select sum(costo) from lineas), 0), 2),
    'ganancia_ventas', round(coalesce((select sum(subtotal - costo) from lineas), 0), 2),
    'gastos_fuera_del_costo', (select fuera from gastos),
    'gastos_de_planta', (select planta from gastos),
    'utilidad', round(coalesce((select sum(subtotal - costo) from lineas), 0) - (select fuera from gastos), 2),
    'cobrado', coalesce((select sum(monto) from public.abonos
                         where (fecha at time zone 'America/Managua')::date between p_desde and p_hasta), 0),
    'por_cobrar', coalesce((select sum(saldo) from public.cuentas_por_cobrar), 0),
    'lineas_sin_costo', (select count(*) from lineas where sin_costo),
    'por_producto', coalesce((select jsonb_agg(x order by x.ganancia desc) from (
        select producto, sum(sacos) as sacos, sum(subtotal) as ventas, round(sum(costo), 2) as costo,
               round(sum(subtotal - costo), 2) as ganancia,
               round(sum(subtotal - costo) / nullif(sum(sacos), 0), 2) as ganancia_por_saco
        from lineas group by producto) x), '[]'),
    'por_cliente', coalesce((select jsonb_agg(x order by x.ganancia desc) from (
        select cliente, sum(sacos) as sacos, sum(subtotal) as ventas, round(sum(costo), 2) as costo,
               round(sum(subtotal - costo), 2) as ganancia,
               round(sum(subtotal - costo) / nullif(sum(subtotal), 0) * 100, 1) as margen_pct
        from lineas group by cliente) x), '[]'),
    'gastos_por_categoria', coalesce((select jsonb_agg(x order by x.monto desc) from (
        select categoria, sum(monto) as monto from public.gastos
        where not anulado and fecha between p_desde and p_hasta group by categoria) x), '[]')
  ) into r;
  return r;
end $$;

-- Trazabilidad hacia adelante hasta el cliente.
create view public.entregas_por_lote with (security_invoker = true) as
select a.lote_id, o.id as orden_id, o.numero as orden, v.id as venta_id, v.numero as venta, c.nombre as cliente,
       a.cantidad_recibida as sacos, o.recibida_en, ec.recibido_por_nombre
from public.ordenes o
join public.ventas v on v.id = o.venta_id
join public.clientes c on c.id = v.cliente_id
join public.ordenes_lineas ol on ol.orden_id = o.id
join public.ordenes_asignaciones a on a.orden_linea_id = ol.id
left join public.entregas_cliente ec on ec.orden_id = o.id
where o.tipo = 'despacho' and o.estado = 'recibida';

-- ---------------------------------------------------------------------
-- Avisos diarios de dinero (se programan en la migración 006)
-- ---------------------------------------------------------------------
create function public.revisar_alertas_dinero() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in select * from public.cuentas_por_cobrar where saldo > 0 and dias_atraso > 0 loop
    perform public._aviso('cliente_atrasado',
      format('%s está atrasado %s días con la factura %s. Debe C$ %s.', r.cliente, r.dias_atraso, r.numero, trim_scale(round(r.saldo, 2))),
      '{administracion,gerencia,vendedor}', '/cobros', format('atraso:%s:%s', r.id, to_char(public.hoy(), 'IYYY-IW')));
  end loop;
  for r in select * from public.cuentas_por_pagar
           where saldo > 0 and dias_para_vencer between 0 and public._config('dias_aviso_pago') loop
    perform public._aviso('pago_por_vencer',
      format('Hay que pagarle C$ %s a %s (factura %s) a más tardar el %s.', trim_scale(round(r.saldo, 2)), r.proveedor, r.numero,
             to_char(r.vence, 'DD/MM')),
      '{administracion,gerencia}', '/pagos', format('pagar:%s', r.id));
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Auditoría, nada se borra y permisos
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'clientes', 'costos_lotes', 'gastos', 'ventas', 'ventas_lineas', 'entregas_cliente', 'facturas', 'facturas_lineas',
    'abonos', 'facturas_proveedor', 'pagos_proveedor'
  ] loop
    execute format('create trigger auditar after insert or update on public.%I for each row execute function public._auditar()', t);
    execute format('create trigger prohibir_borrar before delete on public.%I for each row execute function public._prohibir_borrar()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Lo que todos los usuarios activos pueden leer
  foreach t in array array['clientes', 'ventas', 'ventas_lineas', 'entregas_cliente', 'facturas', 'facturas_lineas', 'abonos'] loop
    execute format('create policy leer on public.%I for select to authenticated using (public.mi_rol() is not null)', t);
  end loop;

  -- Costos, gastos y cuentas por pagar: solo quien ve costos
  foreach t in array array['costos_lotes', 'gastos', 'facturas_proveedor', 'pagos_proveedor'] loop
    execute format('create policy leer on public.%I for select to authenticated using (public.ve_costos())', t);
  end loop;
end $$;

create trigger prohibir_cambiar before update on public.facturas for each row execute function public._prohibir_cambiar();
create trigger prohibir_cambiar before update on public.facturas_lineas for each row execute function public._prohibir_cambiar();
create trigger prohibir_cambiar before update on public.abonos for each row execute function public._prohibir_cambiar();

do $$
declare
  f record;
begin
  for f in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like '\_%' or p.proname in ('revisar_alertas', 'revisar_alertas_dinero')) loop
    execute format('revoke execute on function %s from public', f.firma);
    begin
      execute format('revoke execute on function %s from anon, authenticated', f.firma);
    exception when undefined_object then
      null;
    end;
  end loop;
end $$;
