-- =====================================================================
-- BE Food · Permisos por grupo
-- Cada grupo ve solo lo de su trabajo. Los operadores, Calidad y
-- Mantenimiento ya no ven clientes, ventas, precios ni la receta de
-- las fórmulas; Bodega y Despacho ven a quién se le entrega, pero no
-- las facturas ni los cobros. El dinero y los costos siguen igual.
-- Se cierra en la base de datos, no solo en las pantallas.
-- =====================================================================

-- Clientes y pedidos: quienes venden, despachan o llevan la plata
create function public.ve_clientes() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('gerencia', 'socio', 'administracion', 'vendedor', 'despacho', 'bodeguero'), false)
$$;

-- Facturas y cobros
create function public.ve_facturas() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('gerencia', 'socio', 'administracion', 'vendedor'), false)
$$;

-- La receta (cuánto lleva de cada cosa por saco)
create function public.ve_formulas() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('gerencia', 'socio', 'jefe_produccion', 'calidad', 'inventario'), false)
$$;

-- Precio de venta de los productos
create function public.ve_precios() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('gerencia', 'socio', 'administracion', 'vendedor', 'inventario', 'jefe_produccion'), false)
$$;

do $$
declare
  t text;
begin
  foreach t in array array['clientes', 'ventas', 'ventas_lineas', 'entregas_cliente'] loop
    execute format('alter policy leer on public.%I using (public.ve_clientes())', t);
  end loop;
  foreach t in array array['facturas', 'facturas_lineas', 'abonos'] loop
    execute format('alter policy leer on public.%I using (public.ve_facturas())', t);
  end loop;
end $$;

alter policy leer on public.formulas_lineas using (public.ve_formulas());

-- Las órdenes de despacho dicen a qué cliente van
alter policy leer on public.ordenes
  using (public.mi_rol() is not null and (tipo <> 'despacho' or public.ve_clientes() or public.mi_rol() = 'inventario'));

-- El precio de venta se esconde por columna: todos leen el producto,
-- el precio sale de precios_venta() solo para quien lo puede ver.
revoke select on public.items from anon, authenticated;
grant select (id, codigo, nombre, tipo, unidad, stock_minimo, vida_util_dias, critico, peso_saco_lb, activo)
  on public.items to authenticated;

create function public.precios_venta() returns table (item_id bigint, precio_venta numeric)
language sql stable security definer set search_path = public as $$
  select id, precio_venta from public.items where public.ve_precios() and precio_venta is not null
$$;
