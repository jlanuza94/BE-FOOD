-- Pruebas de las mejoras: comentarios en órdenes, bitácora de turno y
-- resumen del día. Sigue con los datos de etapa1.sql y etapa2.sql.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;
\o /dev/null

set role authenticated;

-- ---------------------------------------------------------------------
-- Comentarios: le avisan a quien tocó la orden y a sus áreas
-- ---------------------------------------------------------------------
select pruebas.como('bodega@befood.ni');
select pruebas.error($$select public.comentar('orden', 1, '   ')$$, 'Escriba el comentario');
select pruebas.error($$select public.comentar('orden', 999, 'Hola')$$, 'No se encontró');
select public.comentar('orden', 1, 'No hay suficiente maíz liberado, faltan 2 quintales');
select pruebas.igual((select count(*) from public.avisos where tipo = 'comentario' and not (auth.uid() = any (leido_por))), 0::bigint,
                     'A quien comenta no le llega su propio aviso como nuevo');

select pruebas.como('jefe@befood.ni');
select pruebas.igual((select mensaje from public.avisos where tipo = 'comentario'),
                     'Bodeguero comentó en ' || (select numero from public.ordenes where id = 1) || ': No hay suficiente maíz liberado, faltan 2 quintales',
                     'El jefe de producción recibe el comentario');
select public.comentar('orden', 1, 'Ok, uso el de mañana');

select pruebas.como('vendedor@befood.ni');
select pruebas.igual((select count(*) from public.avisos where tipo = 'comentario'), 0::bigint, 'Al vendedor no le llegan comentarios de bodega');
select pruebas.igual((select count(*) from public.comentarios where entidad = 'orden' and entidad_id = 1), 2::bigint, 'Todos pueden leer los comentarios');

select pruebas.como('nuevo@befood.ni');
select pruebas.error($$select public.comentar('orden', 1, 'Hola')$$, 'no está activo');

select pruebas.como('vendedor@befood.ni');
select public.comentar('venta', 1, 'El cliente pide que lleguen antes de las 10');
select pruebas.como('despacho@befood.ni');
select pruebas.igual((select count(*) from public.avisos where tipo = 'comentario' and enlace = '/ventas/1'), 1::bigint, 'Despacho ve el comentario de la venta');

reset role;
select pruebas.error($$update public.comentarios set texto = 'otro'$$, 'no se puede cambiar');
select pruebas.error($$delete from public.comentarios$$, 'Nada se borra');
set role authenticated;

-- ---------------------------------------------------------------------
-- Bitácora de turno
-- ---------------------------------------------------------------------
select pruebas.como('operador@befood.ni');
select pruebas.error($$select public.escribir_bitacora('manana', 'Mezcladora', '')$$, 'Escriba la nota');
select public.escribir_bitacora('manana', 'Peletizadora', 'Hace un ruido raro, ya reporté mantenimiento', true);
select public.escribir_bitacora('manana', 'Limpieza', 'Quedó limpia la tolva 2');
select pruebas.como('vendedor@befood.ni');
select pruebas.igual((select count(*) from public.bitacora), 2::bigint, 'Todos leen la bitácora');
select pruebas.igual((select count(*) from public.avisos where tipo = 'bitacora'), 1::bigint, 'Solo la nota importante avisa a todos');

-- ---------------------------------------------------------------------
-- Resumen del día para el dueño
-- ---------------------------------------------------------------------
select pruebas.error($$select public.resumen_del_dia()$$, 'no permite ver costos');
select pruebas.como('gerente@befood.ni');
select pruebas.igual((public.resumen_del_dia() ->> 'sacos_producidos')::numeric, 9::numeric, 'Sacos producidos hoy');
select pruebas.igual((public.resumen_del_dia() ->> 'ventas')::numeric, 13050::numeric, 'Ventas de hoy');
select pruebas.igual((public.resumen_del_dia() ->> 'cobrado')::numeric, 5000::numeric, 'Cobrado hoy');
select pruebas.igual((public.resumen_del_dia() ->> 'por_cobrar')::numeric, 8050::numeric, 'Por cobrar');
select pruebas.igual((public.resumen_del_dia() ->> 'por_pagar')::numeric, 31500::numeric, 'Por pagar');
select pruebas.igual((public.resumen_del_dia() ->> 'gastos')::numeric, 1500::numeric, 'Gastos de hoy');

\echo 'Todas las pruebas de las mejoras pasaron.'
