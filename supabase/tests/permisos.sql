-- Pruebas de los permisos por grupo.
-- Sigue con los datos de las pruebas anteriores.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;
\o /dev/null

set role authenticated;

-- El operador no ve clientes, ventas, facturas, la receta ni precios
select pruebas.como('operador@befood.ni');
select pruebas.igual((select count(*) from public.clientes), 0::bigint, 'Operador no ve clientes');
select pruebas.igual((select count(*) from public.ventas_resumen), 0::bigint, 'Operador no ve ventas');
select pruebas.igual((select count(*) from public.facturas), 0::bigint, 'Operador no ve facturas');
select pruebas.igual((select count(*) from public.formulas_lineas), 0::bigint, 'Operador no ve la receta');
select pruebas.igual((select count(*) from public.ordenes where tipo = 'despacho'), 0::bigint, 'Operador no ve despachos');
select pruebas.igual((select count(*) from public.precios_venta()), 0::bigint, 'Operador no ve precios');
select pruebas.error($$select precio_venta from public.items$$, 'permission denied');
-- Pero sí ve los productos, las fórmulas por nombre y lo que lleva su orden
select pruebas.igual((select count(*) > 0 from public.items), true, 'Operador ve los productos');
select pruebas.igual((select count(*) > 0 from public.formulas), true, 'Operador ve qué fórmula se hace');
select pruebas.igual((select count(*) > 0 from public.op_requerimientos), true, 'Operador ve lo que lleva cada orden');

-- Calidad ve la receta pero no clientes
select pruebas.como('calidad@befood.ni');
select pruebas.igual((select count(*) > 0 from public.formulas_lineas), true, 'Calidad ve la receta');
select pruebas.igual((select count(*) from public.clientes), 0::bigint, 'Calidad no ve clientes');

-- Bodega ve a quién se despacha, pero no facturas ni cobros
select pruebas.como('bodega@befood.ni');
select pruebas.igual((select count(*) > 0 from public.clientes), true, 'Bodega ve clientes para despachar');
select pruebas.igual((select count(*) > 0 from public.ordenes where tipo = 'despacho'), true, 'Bodega ve despachos');
select pruebas.igual((select count(*) from public.facturas), 0::bigint, 'Bodega no ve facturas');
select pruebas.igual((select count(*) from public.abonos), 0::bigint, 'Bodega no ve cobros');
select pruebas.igual((select count(*) from public.precios_venta()), 0::bigint, 'Bodega no ve precios');

-- El vendedor ve clientes, facturas y precios
select pruebas.como('vendedor@befood.ni');
select pruebas.igual((select count(*) > 0 from public.facturas), true, 'Vendedor ve facturas');
select pruebas.igual((select count(*) > 0 from public.precios_venta()), true, 'Vendedor ve precios');
select pruebas.igual((select count(*) from public.formulas_lineas), 0::bigint, 'Vendedor no ve la receta');

-- Gerencia ve todo
select pruebas.como('gerente@befood.ni');
select pruebas.igual((select count(*) > 0 from public.formulas_lineas), true, 'Gerencia ve la receta');
select pruebas.igual((select count(*) > 0 from public.precios_venta()), true, 'Gerencia ve precios');
select pruebas.igual((select count(*) > 0 from public.facturas), true, 'Gerencia ve facturas');

reset role;
\o
\echo 'Todas las pruebas de permisos por grupo pasaron.'
