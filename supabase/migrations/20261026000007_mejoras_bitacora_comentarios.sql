-- Mejoras: comentarios dentro de cada orden, bitácora de turno y
-- resumen del día para el dueño.

-- ---------------------------------------------------------------------
-- Avisos para personas, no solo para roles
-- ---------------------------------------------------------------------
-- Un comentario le avisa a quienes tocaron la orden. Los avisos de
-- siempre (para roles) se ven igual que antes.
alter table public.avisos add column para uuid[] not null default '{}';

drop policy leer on public.avisos;
create policy leer on public.avisos for select to authenticated
  using (
    auth.uid() = any (para)
    or public.mi_rol() = any (roles)
    or (public.mi_rol() = 'gerencia' and cardinality(para) = 0)
  );

-- Para avisos que manda una persona: no le llega a ella misma.
create function public._aviso_de(
  p_tipo text, p_mensaje text, p_roles public.rol_usuario[], p_para uuid[], p_enlace text
) returns void
language sql security definer set search_path = public as $$
  insert into public.avisos (tipo, mensaje, roles, para, enlace, leido_por)
  values (p_tipo, p_mensaje, p_roles,
          coalesce((select array_agg(distinct x) from unnest(p_para) x where x is not null and x <> auth.uid()), '{}'),
          p_enlace, array[auth.uid()])
$$;

create function public._exigir_activo() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public.mi_rol() is null then
    perform public._fallar('Su usuario no está activo. Pida a Gerencia que lo active.');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Comentarios dentro de una orden
-- ---------------------------------------------------------------------
create table public.comentarios (
  id bigint generated always as identity primary key,
  entidad text not null check (entidad in ('orden', 'orden_produccion', 'venta', 'orden_compra')),
  entidad_id bigint not null,
  texto text not null check (length(trim(texto)) > 0),
  autor uuid not null references public.perfiles (id),
  creado_en timestamptz not null default now()
);
create index on public.comentarios (entidad, entidad_id);

create function public.comentar(p_entidad text, p_entidad_id bigint, p_texto text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  numero text;
  roles public.rol_usuario[];
  para uuid[];
  enlace text;
  c_id bigint;
begin
  perform public._exigir_activo();
  if coalesce(trim(p_texto), '') = '' then
    perform public._fallar('Escriba el comentario.');
  end if;

  if p_entidad = 'orden' then
    select o.numero,
           case o.tipo
             when 'requisicion_mp' then '{inventario,bodeguero,jefe_produccion}'
             when 'entrega_pt' then '{jefe_produccion,bodeguero,inventario}'
             else '{bodeguero,despacho,vendedor}'
           end::public.rol_usuario[],
           array[o.pedida_por, o.aprobada_por, o.entregada_por, o.recibida_por],
           '/ordenes/' || o.id
      into numero, roles, para, enlace
      from public.ordenes o where o.id = p_entidad_id;
  elsif p_entidad = 'orden_produccion' then
    select op.numero, '{jefe_produccion,inventario}'::public.rol_usuario[], array[op.creada_por, op.aprobada_por],
           '/produccion/' || op.id
      into numero, roles, para, enlace
      from public.ordenes_produccion op where op.id = p_entidad_id;
  elsif p_entidad = 'venta' then
    select v.numero, '{vendedor,administracion,despacho}'::public.rol_usuario[], array[v.creada_por], '/ventas/' || v.id
      into numero, roles, para, enlace
      from public.ventas v where v.id = p_entidad_id;
  elsif p_entidad = 'orden_compra' then
    select oc.numero, '{inventario,bodeguero}'::public.rol_usuario[], array[oc.creada_por, oc.aprobada_por],
           '/compras/' || oc.id
      into numero, roles, para, enlace
      from public.ordenes_compra oc where oc.id = p_entidad_id;
  end if;
  if numero is null then
    perform public._fallar('No se encontró esa orden.');
  end if;

  insert into public.comentarios (entidad, entidad_id, texto, autor)
  values (p_entidad, p_entidad_id, trim(p_texto), auth.uid())
  returning id into c_id;

  -- Le llega a quienes tocaron la orden, a quienes ya comentaron y a las áreas que la mueven.
  para := para || array(select autor from public.comentarios where entidad = p_entidad and entidad_id = p_entidad_id);
  perform public._aviso_de('comentario',
    format('%s comentó en %s: %s', (select nombre from public.perfiles where id = auth.uid()), numero,
           case when length(trim(p_texto)) > 140 then left(trim(p_texto), 140) || '…' else trim(p_texto) end),
    roles, para, enlace);
  return c_id;
end $$;

-- ---------------------------------------------------------------------
-- Bitácora de turno: lo que el turno que sale le deja al que entra
-- ---------------------------------------------------------------------
create table public.bitacora (
  id bigint generated always as identity primary key,
  fecha date not null default public.hoy(),
  turno public.turno not null,
  area text not null,
  nota text not null check (length(trim(nota)) > 0),
  importante boolean not null default false,
  foto_url text,
  autor uuid not null references public.perfiles (id),
  creado_en timestamptz not null default now()
);
create index on public.bitacora (fecha desc);

create function public.escribir_bitacora(
  p_turno public.turno, p_area text, p_nota text, p_importante boolean default false, p_foto_url text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  b_id bigint;
begin
  perform public._exigir_activo();
  if coalesce(trim(p_nota), '') = '' then
    perform public._fallar('Escriba la nota para el siguiente turno.');
  end if;
  if coalesce(trim(p_area), '') = '' then
    perform public._fallar('Diga de qué área es la nota.');
  end if;
  insert into public.bitacora (turno, area, nota, importante, foto_url, autor)
  values (p_turno, trim(p_area), trim(p_nota), coalesce(p_importante, false), nullif(p_foto_url, ''), auth.uid())
  returning id into b_id;

  if coalesce(p_importante, false) then
    perform public._aviso_de('bitacora',
      format('Importante, %s (%s): %s', trim(p_area), (select nombre from public.perfiles where id = auth.uid()), trim(p_nota)),
      enum_range(null::public.rol_usuario), '{}', '/bitacora');
  end if;
  return b_id;
end $$;

-- ---------------------------------------------------------------------
-- Resumen del día para el dueño
-- ---------------------------------------------------------------------
create function public.resumen_del_dia(p_fecha date default public.hoy()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  u jsonb;
begin
  perform public._exigir_ver_costos();
  u := public.reporte_utilidad(p_fecha, p_fecha);
  return jsonb_build_object(
    'fecha', p_fecha,
    'sacos_producidos', coalesce((select sum(sacos_producidos) from public.ordenes_produccion
                                  where estado = 'terminada' and (terminada_en at time zone 'America/Managua')::date = p_fecha), 0),
    'merma_pct', (select round(100 * sum(merma_lb) / nullif(sum(materia_prima_lb), 0), 2) from public.ordenes_produccion
                  where estado = 'terminada' and (terminada_en at time zone 'America/Managua')::date = p_fecha),
    'ventas', u -> 'ventas',
    'sacos_vendidos', u -> 'sacos',
    'utilidad', u -> 'utilidad',
    'cobrado', u -> 'cobrado',
    'gastos', coalesce((select sum(monto) from public.gastos where not anulado and fecha = p_fecha), 0),
    'por_cobrar', u -> 'por_cobrar',
    'por_cobrar_vencido', coalesce((select sum(saldo) from public.cuentas_por_cobrar where saldo > 0 and dias_atraso > 0), 0),
    'por_pagar', coalesce((select sum(saldo) from public.cuentas_por_pagar where saldo > 0), 0),
    'sacos_en_bodega', coalesce((select sum(disponible) from public.inventario_items where tipo = 'producto_terminado'), 0),
    'por_aprobar', (select count(*) from public.ordenes_produccion where estado = 'pendiente')
                 + (select count(*) from public.ordenes_compra where estado = 'pendiente')
                 + (select count(*) from public.pagos_proveedor where estado = 'solicitado')
                 + (select count(*) from public.conteos where estado = 'pendiente'),
    'stock_bajo', (select count(*) from public.inventario_items where stock_minimo > 0 and disponible < stock_minimo)
  );
end $$;

-- ---------------------------------------------------------------------
-- Auditoría, nada se borra o cambia, y permisos
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['comentarios', 'bitacora'] loop
    execute format('create trigger auditar after insert or update on public.%I for each row execute function public._auditar()', t);
    execute format('create trigger prohibir_borrar before delete on public.%I for each row execute function public._prohibir_borrar()', t);
    execute format('create trigger prohibir_cambiar before update on public.%I for each row execute function public._prohibir_cambiar()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy leer on public.%I for select to authenticated using (public.mi_rol() is not null)', t);
  end loop;
end $$;

revoke execute on function public._aviso_de(text, text, public.rol_usuario[], uuid[], text) from public, anon, authenticated;
revoke execute on function public._exigir_activo() from public, anon, authenticated;
