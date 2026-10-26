-- =====================================================================
-- BE Food · Inventario inicial y conteo general
--
-- Inventario inicial: al empezar a usar la app se carga lo que ya hay en
-- bodega, lote por lote, con su costo. Solo mientras Gerencia lo tenga
-- abierto; después todo entra por compras o por producción.
--
-- Conteo general: se cuenta toda la bodega (o una ubicación) de una vez.
-- Las diferencias quedan como ajustes pendientes que autoriza Gerencia,
-- igual que en el conteo cíclico.
-- =====================================================================

insert into public.configuracion (clave, valor, descripcion) values
  ('inventario_inicial_abierto', 1, 'Si es 1, Inventario puede cargar lo que ya había en bodega al empezar. Póngalo en 0 al terminar.');

alter table public.lotes add column es_inicial boolean not null default false;

alter table public.movimientos drop constraint movimientos_tipo_check;
alter table public.movimientos add constraint movimientos_tipo_check check (tipo in (
  'recepcion_compra', 'salida_requisicion', 'entrada_produccion', 'ajuste_conteo', 'salida_despacho', 'salida_repuestos',
  'inventario_inicial'));

-- ---------------------------------------------------------------------
-- Inventario inicial
-- ---------------------------------------------------------------------
create function public.cargar_inventario_inicial(
  p_item_id bigint,
  p_cantidad numeric,
  p_ubicacion_id bigint,
  p_costo_unitario numeric,
  p_fecha_caducidad date default null,
  p_lote_proveedor text default null,
  p_liberado boolean default true,
  p_foto_url text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  it public.items;
  v_codigo text;
  v_id bigint;
begin
  perform public._exigir_rol('inventario');
  if public._config('inventario_inicial_abierto') is distinct from 1 then
    perform public._fallar('La carga del inventario inicial ya se cerró. Lo que entra ahora va por compras o producción.');
  end if;
  select * into it from public.items where id = p_item_id and activo;
  if it.id is null then
    perform public._fallar('Elija el producto.');
  end if;
  if coalesce(p_cantidad, 0) <= 0 then
    perform public._fallar('Escriba la cantidad que hay.');
  end if;
  if p_ubicacion_id is null then
    perform public._fallar('Indique dónde está guardado.');
  end if;
  if p_costo_unitario is null or p_costo_unitario < 0 then
    perform public._fallar(format('Escriba cuánto costó cada %s, para que el costo por saco salga bien.', it.unidad));
  end if;

  v_codigo := public._codigo_lote(case it.tipo when 'producto_terminado' then 'PT' when 'repuesto' then 'RP' else 'MP' end, it.id);
  insert into public.lotes (codigo, item_id, lote_proveedor, fecha_caducidad, ubicacion_id, estado, cantidad_inicial,
                            fotos, es_inicial, creado_por)
  values (v_codigo, it.id, p_lote_proveedor,
          coalesce(p_fecha_caducidad, public.hoy() + it.vida_util_dias), p_ubicacion_id,
          case when p_liberado or it.tipo = 'repuesto' then 'liberado'::public.estado_lote else 'cuarentena'::public.estado_lote end,
          p_cantidad, case when coalesce(p_foto_url, '') = '' then '{}' else array[p_foto_url] end, true, auth.uid())
  returning id into v_id;
  insert into public.costos_lotes (lote_id, costo_unitario) values (v_id, p_costo_unitario);
  perform public._registrar_movimiento(v_id, 'inventario_inicial', p_cantidad, 'Inventario inicial');

  if not (p_liberado or it.tipo = 'repuesto') then
    perform public._aviso('lote_en_cuarentena',
      format('Inventario inicial: %s (%s %s), lote %s. Está en cuarentena esperando revisión de Calidad.',
             it.nombre, p_cantidad, it.unidad, v_codigo),
      '{calidad}', '/lotes/' || v_id);
  end if;
  return v_id;
end $$;

-- Gerencia cierra la carga y recibe el total para revisarlo
create function public.cerrar_inventario_inicial() returns void
language plpgsql security definer set search_path = public as $$
declare
  n integer;
  v numeric;
begin
  perform public._exigir_gerencia();
  update public.configuracion set valor = 0 where clave = 'inventario_inicial_abierto';
  select count(*), coalesce(sum(l.cantidad_inicial * c.costo_unitario), 0) into n, v
  from public.lotes l left join public.costos_lotes c on c.lote_id = l.id where l.es_inicial;
  perform public._aviso('inventario_inicial_cerrado',
    format('Se cerró la carga del inventario inicial: %s lotes por C$ %s.', n, trim_scale(round(v, 2))),
    '{gerencia,inventario}', '/inventario-inicial');
end $$;

create view public.inventario_inicial with (security_invoker = true) as
select l.id, l.codigo, l.item_id, i.nombre as item, i.tipo, i.unidad, u.nombre as ubicacion, l.estado,
       l.cantidad_inicial as cantidad, c.costo_unitario, round(l.cantidad_inicial * c.costo_unitario, 2) as valor,
       l.fecha_caducidad, l.creado_por, l.fecha_ingreso
from public.lotes l
join public.items i on i.id = l.item_id
left join public.ubicaciones u on u.id = l.ubicacion_id
left join public.costos_lotes c on c.lote_id = l.id
where l.es_inicial;

-- ---------------------------------------------------------------------
-- Conteo general
-- ---------------------------------------------------------------------
create sequence public.seq_cg;
create table public.conteos_generales (
  id bigint generated always as identity primary key,
  numero text not null unique,
  ubicacion_id bigint references public.ubicaciones (id),
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado', 'anulado')),
  nota text,
  abierto_por uuid not null references public.perfiles (id),
  abierto_en timestamptz not null default now(),
  cerrado_por uuid references public.perfiles (id),
  cerrado_en timestamptz,
  motivo_anulacion text
);
create unique index un_conteo_general_abierto on public.conteos_generales ((true)) where estado = 'abierto';

alter table public.conteos add column conteo_general_id bigint references public.conteos_generales (id);
create unique index conteos_general_lote on public.conteos (conteo_general_id, lote_id) where conteo_general_id is not null;

create function public.abrir_conteo_general(p_ubicacion_id bigint default null, p_nota text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  perform public._exigir_rol('inventario');
  if exists (select 1 from public.conteos_generales where estado = 'abierto') then
    perform public._fallar('Ya hay un conteo general abierto. Termínelo primero.');
  end if;
  insert into public.conteos_generales (numero, ubicacion_id, nota, abierto_por)
  values ('CG-' || lpad(nextval('public.seq_cg')::text, 4, '0'), p_ubicacion_id, p_nota, auth.uid())
  returning id into v_id;
  perform public._aviso('conteo_general',
    format('Empezó el conteo general%s. Cuente cada lote en la app.',
           coalesce(' de ' || (select nombre from public.ubicaciones where id = p_ubicacion_id), ' de toda la bodega')),
    '{inventario,bodeguero}', '/conteo-general/' || v_id);
  return v_id;
end $$;

-- Los lotes que entran en el conteo: los que tienen existencia (o ya se
-- contaron en este conteo), de la ubicación si se eligió una.
create function public.lotes_conteo_general(p_conteo_general_id bigint)
returns table (lote_id bigint, codigo text, item text, unidad text, ubicacion text, sistema numeric,
               conteo_id bigint, contado numeric, diferencia numeric, estado public.estado_conteo, motivo text)
language sql stable security definer set search_path = public as $$
  select l.id, l.codigo, i.nombre, i.unidad, u.nombre, coalesce(c.cantidad_sistema, public._existencia(l.id)),
         c.id, c.cantidad_contada, c.diferencia, c.estado, c.motivo
  from public.conteos_generales g
  join public.lotes l on g.ubicacion_id is null or l.ubicacion_id = g.ubicacion_id
  join public.items i on i.id = l.item_id
  left join public.ubicaciones u on u.id = l.ubicacion_id
  left join public.conteos c on c.conteo_general_id = g.id and c.lote_id = l.id
  where g.id = p_conteo_general_id and public.mi_rol() is not null
    and (c.id is not null or (g.estado = 'abierto' and public._existencia(l.id) > 0))
  order by u.nombre nulls last, i.nombre, l.codigo
$$;

-- Mismo conteo de siempre, pero amarrado al conteo general
create function public.contar_en_conteo_general(
  p_conteo_general_id bigint, p_lote_id bigint, p_cantidad numeric, p_motivo text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  g public.conteos_generales;
  c_id bigint;
begin
  perform public._exigir_rol('bodeguero', 'inventario');
  select * into g from public.conteos_generales where id = p_conteo_general_id;
  if g.estado is distinct from 'abierto' then
    perform public._fallar('Este conteo general ya no está abierto.');
  end if;
  if g.ubicacion_id is not null and (select ubicacion_id from public.lotes where id = p_lote_id) is distinct from g.ubicacion_id then
    perform public._fallar('Ese lote no está en la ubicación de este conteo.');
  end if;
  if exists (select 1 from public.conteos where conteo_general_id = g.id and lote_id = p_lote_id) then
    perform public._fallar('Ese lote ya se contó en este conteo general.');
  end if;
  c_id := public.registrar_conteo(p_lote_id, p_cantidad, p_motivo);
  update public.conteos set conteo_general_id = g.id where id = c_id;
  return c_id;
end $$;

create function public.cerrar_conteo_general(p_conteo_general_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  g public.conteos_generales;
  faltan integer;
  n integer;
  difs integer;
  valor numeric;
begin
  perform public._exigir_rol('inventario');
  select * into g from public.conteos_generales where id = p_conteo_general_id for update;
  if g.estado is distinct from 'abierto' then
    perform public._fallar('Este conteo general no está abierto.');
  end if;
  select count(*) filter (where conteo_id is null), count(*), count(*) filter (where diferencia <> 0)
    into faltan, n, difs
  from public.lotes_conteo_general(g.id);
  if faltan > 0 then
    perform public._fallar(format('Faltan %s lotes por contar. Si un lote ya no está, cuéntelo en 0 y explique.', faltan));
  end if;
  select coalesce(sum(c.diferencia * cl.costo_unitario), 0) into valor
  from public.conteos c left join public.costos_lotes cl on cl.lote_id = c.lote_id
  where c.conteo_general_id = g.id;
  update public.conteos_generales set estado = 'cerrado', cerrado_por = auth.uid(), cerrado_en = now() where id = g.id;
  perform public._aviso('conteo_general',
    format('Terminó el conteo general %s: %s lotes contados, %s con diferencia%s.', g.numero, n, difs,
           case when difs > 0 then format(' (C$ %s). Revise y autorice los ajustes', trim_scale(round(valor, 2))) else '' end),
    '{gerencia}', '/conteo-general/' || g.id);
end $$;

create function public.anular_conteo_general(p_conteo_general_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_rol('inventario');
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba por qué se anula.');
  end if;
  update public.conteos_generales set estado = 'anulado', motivo_anulacion = p_motivo, cerrado_por = auth.uid(), cerrado_en = now()
   where id = p_conteo_general_id and estado = 'abierto';
  if not found then
    perform public._fallar('Este conteo general no está abierto.');
  end if;
  -- Los ajustes que no se autorizaron quedan rechazados
  update public.conteos set estado = 'rechazado', revisado_por = auth.uid(), revisado_en = now()
   where conteo_general_id = p_conteo_general_id and estado = 'pendiente';
end $$;

-- Gerencia autoriza (o no) todas las diferencias de un conteo general
create function public.revisar_conteo_general(p_conteo_general_id bigint, p_aprobar boolean) returns integer
language plpgsql security definer set search_path = public as $$
declare
  c record;
  n integer := 0;
begin
  perform public._exigir_gerencia();
  if (select estado from public.conteos_generales where id = p_conteo_general_id) is distinct from 'cerrado' then
    perform public._fallar('Primero Inventario tiene que terminar el conteo.');
  end if;
  for c in select id from public.conteos where conteo_general_id = p_conteo_general_id and estado = 'pendiente' order by id loop
    perform public.revisar_conteo(c.id, p_aprobar);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Auditoría, permisos
-- ---------------------------------------------------------------------
create trigger auditar after insert or update on public.conteos_generales for each row execute function public._auditar();
create trigger prohibir_borrar before delete on public.conteos_generales for each row execute function public._prohibir_borrar();
alter table public.conteos_generales enable row level security;
create policy leer on public.conteos_generales for select to authenticated using (public.mi_rol() is not null);
