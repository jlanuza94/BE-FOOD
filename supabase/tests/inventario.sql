-- Pruebas del inventario inicial y del conteo general.
-- Sigue con los datos de las pruebas anteriores.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;
\o /dev/null

set role authenticated;

-- ---------------------------------------------------------------------
-- Inventario inicial
-- ---------------------------------------------------------------------
select pruebas.como('bodega@befood.ni');
select pruebas.error($$select public.cargar_inventario_inicial((select id from public.items where codigo = 'MAIZ'), 100, 1, 8)$$, 'no permite');

select pruebas.como('inventario@befood.ni');
select pruebas.error($$select public.cargar_inventario_inicial((select id from public.items where codigo = 'MAIZ'), 0, 1, 8)$$, 'cantidad');
select pruebas.error($$select public.cargar_inventario_inicial((select id from public.items where codigo = 'MAIZ'), 100, null, 8)$$, 'dónde');
select pruebas.error($$select public.cargar_inventario_inicial((select id from public.items where codigo = 'MAIZ'), 100, 1, null)$$, 'costó');

-- Maíz que ya estaba en el silo, en uso
select public.cargar_inventario_inicial((select id from public.items where codigo = 'MAIZ'), 2000, 1, 8.5);
select pruebas.igual((select estado::text || ' ' || es_inicial || ' ' || left(codigo, 3) from public.lotes order by id desc limit 1),
                     'liberado true MP-', 'El maíz entra liberado y marcado como inicial');
select pruebas.igual((select costo_unitario from public.costos_lotes order by lote_id desc limit 1), 8.5, 'Guarda el costo');
select pruebas.igual((select tipo || ' ' || cantidad from public.movimientos order by id desc limit 1),
                     'inventario_inicial 2000', 'Queda en el kárdex');

-- Sacos de alimento que ya estaban en bodega
select public.cargar_inventario_inicial((select id from public.items where codigo = 'ENGORDE'), 40, 3, 900);
select pruebas.igual((select left(codigo, 3) from public.lotes order by id desc limit 1), 'PT-', 'El alimento entra como producto terminado');

-- Soya que Calidad tiene que revisar
select public.cargar_inventario_inicial((select id from public.items where codigo = 'SOYA'), 500, 2, 12, null, null, false);
select pruebas.igual((select estado::text from public.lotes order by id desc limit 1), 'cuarentena', 'Puede entrar en cuarentena');

select pruebas.igual((select count(*) from public.inventario_inicial), 3::bigint, 'Tres lotes iniciales');
select pruebas.igual((select sum(valor) from public.inventario_inicial), 59000.00, 'Valor del inventario inicial');

-- Gerencia cierra la carga
select pruebas.error($$select public.cerrar_inventario_inicial()$$, 'Gerencia');
select pruebas.como('gerente@befood.ni');
select public.cerrar_inventario_inicial();
select pruebas.igual((select mensaje like '%3 lotes por C$ 59000%' from public.avisos order by id desc limit 1), true, 'Aviso con el total');
select pruebas.como('inventario@befood.ni');
select pruebas.error($$select public.cargar_inventario_inicial((select id from public.items where codigo = 'MAIZ'), 100, 1, 8)$$, 'ya se cerró');

-- ---------------------------------------------------------------------
-- Conteo general del silo 1
-- ---------------------------------------------------------------------
select pruebas.como('bodega@befood.ni');
select pruebas.error($$select public.abrir_conteo_general(1)$$, 'no permite');
select pruebas.como('inventario@befood.ni');
select public.abrir_conteo_general(1, 'Fin de mes');
select pruebas.error($$select public.abrir_conteo_general()$$, 'Ya hay un conteo general abierto');

select pruebas.igual((select count(*) > 0 and count(*) = count(*) filter (where ubicacion = 'Silo 1')
                      from public.lotes_conteo_general(1)), true, 'Solo lotes del silo con existencia');
select pruebas.error($$select public.cerrar_conteo_general(1)$$, 'Faltan');

-- El bodeguero cuenta: el lote inicial cuadra, los demás se cuentan igual a lo que dice el sistema
select pruebas.como('bodega@befood.ni');
select public.contar_en_conteo_general(1, l.lote_id, l.sistema) from public.lotes_conteo_general(1) l where l.conteo_id is null;
select pruebas.error($$select public.contar_en_conteo_general(1, (select lote_id from public.lotes_conteo_general(1) limit 1), 5, 'x')$$,
                     'ya se contó');
select pruebas.error($$select public.contar_en_conteo_general(1, (select id from public.lotes where ubicacion_id = 3 limit 1), 5, 'x')$$,
                     'no está en la ubicación');
select pruebas.igual((select count(*) from public.lotes_conteo_general(1) where conteo_id is null), 0::bigint, 'Todo contado');

-- Uno con diferencia: se vuelve a abrir con otro conteo para probarlo
select pruebas.como('inventario@befood.ni');
select public.cerrar_conteo_general(1);
select pruebas.igual((select estado from public.conteos_generales where id = 1), 'cerrado', 'Conteo cerrado');
reset role;
select pruebas.igual((select mensaje like '%0 con diferencia.' from public.avisos order by id desc limit 1), true, 'Aviso sin diferencias');
set role authenticated;

select public.abrir_conteo_general(1);
select pruebas.como('bodega@befood.ni');
select pruebas.error($$select public.contar_en_conteo_general(2, (select id from public.lotes where codigo like 'MP-%-MAIZ-%' and es_inicial), 1950)$$,
                     'explicación');
select public.contar_en_conteo_general(2, (select id from public.lotes where codigo like 'MP-%-MAIZ-%' and es_inicial), 1950, 'Humedad');
select public.contar_en_conteo_general(2, l.lote_id, l.sistema) from public.lotes_conteo_general(2) l where l.conteo_id is null;
select pruebas.como('inventario@befood.ni');
select public.cerrar_conteo_general(2);
reset role;
select pruebas.igual((select mensaje like '%1 con diferencia (C$ -425)%' from public.avisos order by id desc limit 1), true,
                     'Aviso con el valor de la diferencia');
set role authenticated;

-- Gerencia autoriza todo de una vez
select pruebas.error($$select public.revisar_conteo_general(2, true)$$, 'Gerencia');
select pruebas.como('gerente@befood.ni');
select pruebas.igual(public.revisar_conteo_general(2, true), 1, 'Un ajuste autorizado');
reset role;
select pruebas.igual((select public._existencia(id) from public.lotes where codigo like 'MP-%-MAIZ-%' and es_inicial), 1950::numeric,
                     'El lote queda con lo contado');
set role authenticated;

-- Anular un conteo general
select pruebas.como('inventario@befood.ni');
select public.abrir_conteo_general();
select pruebas.error($$select public.anular_conteo_general(3, '')$$, 'por qué');
select public.anular_conteo_general(3, 'Se empezó por error');
select pruebas.igual((select estado from public.conteos_generales where id = 3), 'anulado', 'Conteo anulado');

reset role;
\o
\echo 'Todas las pruebas del inventario inicial y el conteo general pasaron.'
