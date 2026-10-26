-- =====================================================================
-- BE Food · Etapa 3
-- Caja y bancos (cierre diario, conciliación y flujo de caja), personal
-- y planilla (asistencia, INSS, IR, adelantos, vacaciones y aguinaldo),
-- y mantenimiento de máquinas y vehículos (fallas, órdenes de trabajo,
-- repuestos con orden de cuatro cantidades, combustible y kilometraje).
-- Mismas reglas de siempre: todo pasa por funciones que revisan el rol,
-- nada se borra y todo queda en la auditoría.
-- =====================================================================

-- Quién ve el dinero, la planilla y los salarios
create function public.ve_dinero() returns boolean
language sql stable security definer set search_path = public as $$
  select public.mi_rol() in ('gerencia', 'administracion', 'socio')
$$;

insert into public.configuracion (clave, valor, descripcion) values
  ('inss_laboral_pct', 7, 'INSS que se le rebaja al empleado (%). Revisar con el contador.'),
  ('inss_patronal_pct', 21.5, 'INSS que paga la empresa (%). 21.5 si son menos de 50 empleados. Revisar con el contador.'),
  ('inatec_pct', 2, 'Aporte al INATEC que paga la empresa (%).'),
  ('horas_jornada', 8, 'Horas de una jornada normal. Lo que pase de aquí en un día es hora extra.'),
  ('factor_hora_extra', 2, 'Cuánto se paga la hora extra comparada con la normal (2 = doble).'),
  ('vacaciones_dias_por_mes', 2.5, 'Días de vacaciones que gana un empleado por cada mes trabajado.');

-- Tabla del IR salarial (anual). Se proyecta el salario del período a un
-- año, se calcula el impuesto y se divide entre los períodos del año.
create table public.tramos_ir (
  desde numeric primary key,
  hasta numeric,
  impuesto_base numeric not null,
  porcentaje numeric not null
);
insert into public.tramos_ir values
  (0, 100000, 0, 0),
  (100000, 200000, 0, 15),
  (200000, 350000, 15000, 20),
  (350000, 500000, 45000, 25),
  (500000, null, 82500, 30);

-- ---------------------------------------------------------------------
-- Caja y bancos
-- ---------------------------------------------------------------------
create table public.cuentas_dinero (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  tipo text not null check (tipo in ('caja_general', 'caja_chica', 'banco')),
  banco text,
  numero text,
  saldo_inicial numeric not null default 0,
  activa boolean not null default true
);
insert into public.cuentas_dinero (nombre, tipo) values
  ('Caja general', 'caja_general'), ('Caja chica', 'caja_chica'), ('Banco principal', 'banco');

create table public.movimientos_dinero (
  id bigint generated always as identity primary key,
  cuenta_id bigint not null references public.cuentas_dinero (id),
  fecha timestamptz not null default now(),
  tipo text not null check (tipo in ('entrada', 'salida')),
  monto numeric not null check (monto > 0),
  categoria text not null check (categoria in (
    'cobro', 'pago_proveedor', 'gasto', 'planilla', 'adelanto', 'transferencia', 'aporte', 'retiro',
    'prestamo', 'pago_impuestos', 'diferencia_caja', 'anulacion', 'otro')),
  motivo text not null,
  referencia text,
  foto_url text,
  origen text,
  origen_id bigint,
  conciliado_en timestamptz,
  conciliado_por uuid references public.perfiles (id),
  registrado_por uuid not null references public.perfiles (id)
);
create index on public.movimientos_dinero (cuenta_id, fecha);

create table public.cierres_caja (
  id bigint generated always as identity primary key,
  cuenta_id bigint not null references public.cuentas_dinero (id),
  fecha date not null default public.hoy(),
  saldo_app numeric not null,
  contado numeric not null,
  diferencia numeric not null,
  motivo text,
  cerrado_por uuid not null references public.perfiles (id),
  cerrado_en timestamptz not null default now(),
  unique (cuenta_id, fecha)
);

create view public.saldos_cuentas with (security_invoker = true) as
select c.id, c.nombre, c.tipo, c.banco, c.numero, c.activa, c.saldo_inicial,
       c.saldo_inicial + coalesce(sum(case when m.tipo = 'entrada' then m.monto else -m.monto end), 0) as saldo,
       coalesce(sum(m.monto) filter (where c.tipo = 'banco' and m.conciliado_en is null), 0) > 0 as hay_sin_conciliar,
       (select max(fecha) from public.cierres_caja k where k.cuenta_id = c.id) as ultimo_cierre
from public.cuentas_dinero c
left join public.movimientos_dinero m on m.cuenta_id = c.id
group by c.id;

create function public._saldo_cuenta(p_cuenta_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select c.saldo_inicial + coalesce((select sum(case when tipo = 'entrada' then monto else -monto end)
                                     from public.movimientos_dinero where cuenta_id = c.id), 0)
  from public.cuentas_dinero c where c.id = p_cuenta_id
$$;

-- Efectivo va a la caja general; transferencia, cheque o depósito al primer banco.
create function public._cuenta_por_forma(p_forma text, p_cuenta_id bigint) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  c_id bigint;
begin
  if p_cuenta_id is not null then
    select id into c_id from public.cuentas_dinero where id = p_cuenta_id and activa;
    if c_id is null then
      perform public._fallar('Esa cuenta de dinero no existe o está cerrada.');
    end if;
    return c_id;
  end if;
  select id into c_id from public.cuentas_dinero
   where activa and tipo = case when coalesce(p_forma, 'efectivo') = 'efectivo' then 'caja_general' else 'banco' end
   order by id limit 1;
  if c_id is null then
    perform public._fallar('No hay una cuenta activa para esa forma de pago. Gerencia la crea en Caja y bancos.');
  end if;
  return c_id;
end $$;

create function public._mover_dinero(
  p_cuenta_id bigint, p_tipo text, p_monto numeric, p_categoria text, p_motivo text,
  p_referencia text default null, p_foto_url text default null, p_origen text default null, p_origen_id bigint default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  m_id bigint;
begin
  insert into public.movimientos_dinero (cuenta_id, tipo, monto, categoria, motivo, referencia, foto_url, origen, origen_id, registrado_por)
  values (p_cuenta_id, p_tipo, round(p_monto, 2), p_categoria, p_motivo, nullif(trim(p_referencia), ''), nullif(p_foto_url, ''),
          p_origen, p_origen_id, auth.uid())
  returning id into m_id;
  return m_id;
end $$;

create function public.guardar_cuenta_dinero(
  p_id bigint, p_nombre text, p_tipo text, p_banco text default null, p_numero text default null,
  p_saldo_inicial numeric default 0, p_activa boolean default true
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  c_id bigint;
begin
  perform public._exigir_gerencia();
  if coalesce(trim(p_nombre), '') = '' then
    perform public._fallar('Escriba el nombre de la cuenta.');
  end if;
  if p_id is null then
    insert into public.cuentas_dinero (nombre, tipo, banco, numero, saldo_inicial, activa)
    values (trim(p_nombre), p_tipo, p_banco, p_numero, coalesce(p_saldo_inicial, 0), coalesce(p_activa, true))
    returning id into c_id;
  else
    update public.cuentas_dinero
       set nombre = trim(p_nombre), tipo = p_tipo, banco = p_banco, numero = p_numero,
           saldo_inicial = coalesce(p_saldo_inicial, 0), activa = coalesce(p_activa, true)
     where id = p_id returning id into c_id;
  end if;
  return c_id;
end $$;

-- Entradas y salidas sueltas (caja chica, aportes, retiros, pago de INSS…)
create function public.registrar_movimiento_dinero(
  p_cuenta_id bigint, p_tipo text, p_monto numeric, p_categoria text, p_motivo text,
  p_referencia text default null, p_foto_url text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_rol('administracion');
  perform public._cuenta_por_forma(null, p_cuenta_id);
  if coalesce(p_monto, 0) <= 0 then
    perform public._fallar('Escriba el monto.');
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba el motivo.');
  end if;
  if p_categoria in ('cobro', 'pago_proveedor', 'gasto', 'planilla', 'adelanto', 'transferencia', 'diferencia_caja', 'anulacion') then
    perform public._fallar('Eso se registra en su pantalla (cobros, pagos, gastos, planilla o transferencia), no aquí.');
  end if;
  if p_tipo = 'salida' and coalesce(p_foto_url, '') = '' then
    perform public._fallar('Falta la foto del recibo.');
  end if;
  return public._mover_dinero(p_cuenta_id, p_tipo, p_monto, p_categoria, trim(p_motivo), p_referencia, p_foto_url);
end $$;

-- Pasar dinero de una cuenta a otra (depositar la caja en el banco, llenar la caja chica…)
create function public.transferir_dinero(
  p_origen_id bigint, p_destino_id bigint, p_monto numeric, p_referencia text default null, p_foto_url text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.cuentas_dinero;
  d public.cuentas_dinero;
begin
  perform public._exigir_rol('administracion');
  select * into o from public.cuentas_dinero where id = p_origen_id and activa;
  select * into d from public.cuentas_dinero where id = p_destino_id and activa;
  if o.id is null or d.id is null or o.id = d.id then
    perform public._fallar('Elija dos cuentas distintas.');
  end if;
  if coalesce(p_monto, 0) <= 0 then
    perform public._fallar('Escriba el monto.');
  end if;
  if o.tipo <> 'banco' and public._saldo_cuenta(o.id) < p_monto then
    perform public._fallar(format('En %s solo hay C$ %s.', o.nombre, trim_scale(round(public._saldo_cuenta(o.id), 2))));
  end if;
  if (o.tipo = 'banco' or d.tipo = 'banco') and coalesce(trim(p_referencia), '') = '' and coalesce(p_foto_url, '') = '' then
    perform public._fallar('Para el banco ponga el número de la boleta o una foto.');
  end if;
  perform public._mover_dinero(o.id, 'salida', p_monto, 'transferencia', 'Pasa a ' || d.nombre, p_referencia, p_foto_url);
  perform public._mover_dinero(d.id, 'entrada', p_monto, 'transferencia', 'Viene de ' || o.nombre, p_referencia, p_foto_url);
end $$;

-- Cierre del día: se cuenta el efectivo. Si no cuadra, motivo y aviso a Gerencia;
-- la diferencia queda anotada para que la caja siga lo que de verdad hay.
create function public.cerrar_caja(p_cuenta_id bigint, p_contado numeric, p_motivo text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  c public.cuentas_dinero;
  saldo numeric;
  dif numeric;
  k_id bigint;
begin
  perform public._exigir_rol('administracion');
  select * into c from public.cuentas_dinero where id = p_cuenta_id and activa;
  if c.id is null or c.tipo = 'banco' then
    perform public._fallar('El cierre es para las cajas de efectivo.');
  end if;
  if p_contado is null or p_contado < 0 then
    perform public._fallar('Escriba cuánto efectivo contó.');
  end if;
  if exists (select 1 from public.cierres_caja where cuenta_id = c.id and fecha = public.hoy()) then
    perform public._fallar('Esta caja ya se cerró hoy.');
  end if;
  saldo := round(public._saldo_cuenta(c.id), 2);
  dif := round(p_contado - saldo, 2);
  if dif <> 0 and coalesce(trim(p_motivo), '') = '' then
    perform public._fallar(format('La caja no cuadra: la app dice C$ %s y contó C$ %s. Escriba el motivo.',
      trim_scale(saldo), trim_scale(round(p_contado, 2))));
  end if;
  insert into public.cierres_caja (cuenta_id, saldo_app, contado, diferencia, motivo, cerrado_por)
  values (c.id, saldo, p_contado, dif, nullif(trim(p_motivo), ''), auth.uid())
  returning id into k_id;
  if dif <> 0 then
    perform public._mover_dinero(c.id, case when dif > 0 then 'entrada' else 'salida' end, abs(dif), 'diferencia_caja',
      'Diferencia en el cierre: ' || trim(p_motivo), null, null, 'cierre', k_id);
    perform public._aviso('caja_no_cuadra',
      format('%s no cuadró hoy: %s C$ %s. Motivo: %s (%s).', c.nombre, case when dif > 0 then 'sobran' else 'faltan' end,
             trim_scale(abs(dif)), trim(p_motivo), (select nombre from public.perfiles where id = auth.uid())),
      '{gerencia}', '/dinero/' || c.id);
  end if;
  return k_id;
end $$;

-- Conciliación: marcar lo que ya aparece en el estado de cuenta del banco
create function public.conciliar_movimientos(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  perform public._exigir_rol('administracion');
  update public.movimientos_dinero m set conciliado_en = now(), conciliado_por = auth.uid()
   from public.cuentas_dinero c
   where c.id = m.cuenta_id and c.tipo = 'banco' and m.id = any (p_ids) and m.conciliado_en is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Cobros, pagos y gastos ahora mueven el dinero de su cuenta
drop function public.registrar_abono(bigint, numeric, text, text, text);
create function public.registrar_abono(
  p_factura_id bigint, p_monto numeric, p_forma text, p_referencia text default null, p_foto_url text default null,
  p_cuenta_id bigint default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  f public.facturas;
  saldo numeric;
  a_id bigint;
  cuenta bigint;
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
  cuenta := public._cuenta_por_forma(p_forma, p_cuenta_id);
  insert into public.abonos (factura_id, monto, forma, referencia, foto_url, registrado_por)
  values (f.id, p_monto, p_forma, p_referencia, p_foto_url, auth.uid()) returning id into a_id;
  perform public._mover_dinero(cuenta, 'entrada', p_monto, 'cobro',
    format('Abono a la factura %s de %s', f.numero, (select nombre from public.clientes where id = f.cliente_id)),
    p_referencia, p_foto_url, 'abono', a_id);
  return a_id;
end $$;

drop function public.registrar_pago_hecho(bigint, text, text, text);
create function public.registrar_pago_hecho(
  p_pago_id bigint, p_forma text, p_referencia text, p_comprobante_url text, p_cuenta_id bigint default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.pagos_proveedor;
  cuenta bigint;
begin
  perform public._exigir_rol('administracion');
  if coalesce(p_comprobante_url, '') = '' then
    perform public._fallar('Falta la foto del comprobante.');
  end if;
  select * into p from public.pagos_proveedor where id = p_pago_id and estado = 'aprobado' for update;
  if p.id is null then
    perform public._fallar('Sin aprobación de Gerencia no se paga.');
  end if;
  cuenta := public._cuenta_por_forma(p_forma, p_cuenta_id);
  update public.pagos_proveedor
     set estado = 'pagado', forma = p_forma, referencia = p_referencia, comprobante_url = p_comprobante_url,
         pagado_por = auth.uid(), pagado_en = now()
   where id = p.id;
  perform public._mover_dinero(cuenta, 'salida', p.monto, 'pago_proveedor',
    (select format('Pago a %s, factura %s', pr.nombre, fp.numero)
       from public.facturas_proveedor fp join public.proveedores pr on pr.id = fp.proveedor_id
      where fp.id = p.factura_proveedor_id),
    p_referencia, p_comprobante_url, 'pago_proveedor', p.id);
end $$;

alter table public.gastos
  add column cuenta_id bigint references public.cuentas_dinero (id),
  add column orden_trabajo_id bigint,
  add column origen text;

drop function public.registrar_gasto(date, text, text, numeric, boolean, text);
create function public.registrar_gasto(
  p_fecha date, p_categoria text, p_descripcion text, p_monto numeric,
  p_incluir_en_costo boolean default true, p_foto_url text default null,
  p_cuenta_id bigint default null, p_orden_trabajo_id bigint default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  g_id bigint;
  cuenta bigint;
begin
  perform public._exigir_rol('administracion');
  if coalesce(trim(p_descripcion), '') = '' then
    perform public._fallar('Escriba en qué se gastó.');
  end if;
  if coalesce(p_monto, 0) <= 0 then
    perform public._fallar('Escriba el monto.');
  end if;
  if p_orden_trabajo_id is not null and not exists (select 1 from public.ordenes_trabajo where id = p_orden_trabajo_id) then
    perform public._fallar('No existe esa orden de trabajo.');
  end if;
  cuenta := public._cuenta_por_forma('efectivo', p_cuenta_id);
  insert into public.gastos (fecha, categoria, descripcion, monto, incluir_en_costo, foto_url, registrado_por, cuenta_id, orden_trabajo_id)
  values (coalesce(p_fecha, public.hoy()), p_categoria, trim(p_descripcion), p_monto, coalesce(p_incluir_en_costo, true),
          p_foto_url, auth.uid(), cuenta, p_orden_trabajo_id)
  returning id into g_id;
  perform public._mover_dinero(cuenta, 'salida', p_monto, 'gasto', 'Gasto: ' || trim(p_descripcion), null, p_foto_url, 'gasto', g_id);
  return g_id;
end $$;

create or replace function public.anular_gasto(p_gasto_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  g public.gastos;
begin
  perform public._exigir_gerencia();
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba el motivo.');
  end if;
  select * into g from public.gastos where id = p_gasto_id and not anulado for update;
  if g.id is null then
    perform public._fallar('Ese gasto ya está anulado.');
  end if;
  if g.origen is not null then
    perform public._fallar('Este gasto sale de la planilla o de un viaje. Anúlelo desde allí.');
  end if;
  update public.gastos set anulado = true, motivo_anulacion = p_motivo where id = g.id;
  if g.cuenta_id is not null then
    perform public._mover_dinero(g.cuenta_id, 'entrada', g.monto, 'anulacion', 'Gasto anulado: ' || p_motivo, null, null, 'gasto', g.id);
  end if;
end $$;

-- Flujo de caja: lo que entró y salió las últimas semanas y lo que se
-- espera en las próximas según lo que hay por cobrar, por pagar y la planilla.
create function public._flujo_de_caja(p_semanas integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  lunes date := public.hoy() - (extract(isodow from public.hoy())::int - 1);
  v_saldo numeric;
  planilla_semana numeric;
  pasadas jsonb;
  proximas jsonb;
begin
  v_saldo := coalesce((select sum(public._saldo_cuenta(id)) from public.cuentas_dinero where activa), 0);
  planilla_semana := coalesce((select sum(salario_mensual) from public.empleados where activo), 0) * 12 / 52;

  select coalesce(jsonb_agg(x order by x.semana), '[]') into pasadas from (
    select s.semana,
           coalesce(sum(m.monto) filter (where m.tipo = 'entrada' and m.categoria not in ('transferencia')), 0) as entradas,
           coalesce(sum(m.monto) filter (where m.tipo = 'salida' and m.categoria not in ('transferencia')), 0) as salidas
    from generate_series(lunes - 28, lunes, interval '7 days') s(semana)
    left join public.movimientos_dinero m
      on (m.fecha at time zone 'America/Managua')::date between s.semana::date and s.semana::date + 6
    group by s.semana) x;

  with semanas as (
    select g::date as semana, row_number() over (order by g) as n
    from generate_series(lunes, lunes + 7 * (greatest(p_semanas, 1) - 1), interval '7 days') g
  ), cobros as (
    select greatest(lunes, vence - (extract(isodow from vence)::int - 1)) as semana, sum(saldo) as monto
    from public.cuentas_por_cobrar where saldo > 0 group by 1
  ), pagos as (
    select greatest(lunes, vence - (extract(isodow from vence)::int - 1)) as semana, sum(saldo) as monto
    from public.cuentas_por_pagar where saldo > 0 group by 1
  ), filas as (
    select s.semana, coalesce(c.monto, 0) as por_cobrar, coalesce(p.monto, 0) as por_pagar, round(planilla_semana, 2) as planilla
    from semanas s left join cobros c on c.semana = s.semana left join pagos p on p.semana = s.semana
  ), acumulado as (
    select f.*, sum(f.por_cobrar - f.por_pagar - f.planilla) over (order by f.semana) as neto from filas f
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'semana', f.semana, 'por_cobrar', f.por_cobrar, 'por_pagar', f.por_pagar, 'planilla', f.planilla,
           'saldo_esperado', round(v_saldo + f.neto, 2))
         order by f.semana), '[]')
    into proximas from acumulado f;

  return jsonb_build_object('saldo_actual', round(v_saldo, 2), 'pasadas', pasadas, 'proximas', proximas);
end $$;

create function public.flujo_de_caja(p_semanas integer default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ve_dinero() then
    perform public._fallar('Su rol no permite ver el dinero.');
  end if;
  return public._flujo_de_caja(p_semanas);
end $$;

-- ---------------------------------------------------------------------
-- Personal y planilla
-- ---------------------------------------------------------------------
create table public.empleados (
  id bigint generated always as identity primary key,
  nombre text not null,
  cedula text unique,
  numero_inss text,
  puesto text not null,
  area text not null check (area in ('planta', 'administracion', 'ventas', 'transporte')),
  salario_mensual numeric not null check (salario_mensual > 0),
  fecha_ingreso date not null,
  marca_asistencia boolean not null default true,
  perfil_id uuid references public.perfiles (id),
  telefono text,
  activo boolean not null default true,
  fecha_salida date
);

-- Lista sin salarios, para marcar asistencia desde cualquier celular de la planta
create view public.empleados_lista as
select id, nombre, puesto, area, marca_asistencia from public.empleados
where activo and public.mi_rol() is not null;

create table public.asistencia (
  id bigint generated always as identity primary key,
  empleado_id bigint not null references public.empleados (id),
  fecha date not null default public.hoy(),
  entrada timestamptz not null,
  salida timestamptz,
  foto_entrada text not null,
  foto_salida text,
  horas numeric,
  horas_extra numeric not null default 0,
  nota text,
  registrado_por uuid not null references public.perfiles (id),
  unique (empleado_id, fecha)
);

create view public.asistencia_hoy as
select a.id, a.empleado_id, e.nombre, e.puesto, a.entrada, a.salida, a.horas, a.horas_extra
from public.asistencia a join public.empleados e on e.id = a.empleado_id
where a.fecha = public.hoy() and public.mi_rol() is not null;

create function public._horas_extra(p_horas numeric) returns numeric
language sql stable security definer set search_path = public as $$
  -- Se cuentan por media hora completa
  select greatest(floor((p_horas - public._config('horas_jornada')) * 2) / 2, 0)
$$;

-- Primera marca del día es la entrada; la segunda, la salida. Siempre con foto.
create function public.marcar_asistencia(p_empleado_id bigint, p_foto_url text) returns text
language plpgsql security definer set search_path = public as $$
declare
  e public.empleados;
  a public.asistencia;
  h numeric;
begin
  perform public._exigir_activo();
  select * into e from public.empleados where id = p_empleado_id and activo;
  if e.id is null then
    perform public._fallar('Ese empleado no está activo.');
  end if;
  if coalesce(p_foto_url, '') = '' then
    perform public._fallar('Falta la foto de quien marca.');
  end if;
  select * into a from public.asistencia where empleado_id = e.id and fecha = public.hoy() for update;
  if a.id is null then
    insert into public.asistencia (empleado_id, entrada, foto_entrada, registrado_por)
    values (e.id, now(), p_foto_url, auth.uid());
    return format('Entrada de %s marcada a las %s.', e.nombre, to_char(now() at time zone 'America/Managua', 'HH12:MI am'));
  end if;
  if a.salida is not null then
    perform public._fallar(format('%s ya marcó entrada y salida hoy. Si hay un error, Administración lo corrige.', e.nombre));
  end if;
  h := round(extract(epoch from now() - a.entrada) / 3600, 2);
  update public.asistencia set salida = now(), foto_salida = p_foto_url, horas = h, horas_extra = public._horas_extra(h)
   where id = a.id;
  return format('Salida de %s marcada. Trabajó %s horas%s.', e.nombre, trim_scale(h),
    case when public._horas_extra(h) > 0 then format(', %s extra', trim_scale(public._horas_extra(h))) else '' end);
end $$;

-- Administración corrige o completa una marca (olvidos), con motivo
create function public.corregir_asistencia(
  p_empleado_id bigint, p_fecha date, p_entrada timestamptz, p_salida timestamptz, p_motivo text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  h numeric;
begin
  perform public._exigir_rol('administracion');
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba el motivo de la corrección.');
  end if;
  if p_salida is not null and p_salida <= p_entrada then
    perform public._fallar('La salida tiene que ser después de la entrada.');
  end if;
  h := case when p_salida is null then null else round(extract(epoch from p_salida - p_entrada) / 3600, 2) end;
  insert into public.asistencia (empleado_id, fecha, entrada, salida, foto_entrada, horas, horas_extra, nota, registrado_por)
  values (p_empleado_id, p_fecha, p_entrada, p_salida, 'corregido', h, coalesce(public._horas_extra(h), 0), 'Corregido: ' || trim(p_motivo), auth.uid())
  on conflict (empleado_id, fecha) do update
    set entrada = excluded.entrada, salida = excluded.salida, horas = excluded.horas, horas_extra = excluded.horas_extra,
        nota = excluded.nota;
end $$;

create function public.guardar_empleado(
  p_id bigint, p_nombre text, p_puesto text, p_area text, p_salario_mensual numeric, p_fecha_ingreso date,
  p_cedula text default null, p_numero_inss text default null, p_telefono text default null,
  p_marca_asistencia boolean default true, p_activo boolean default true, p_fecha_salida date default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  e_id bigint;
begin
  perform public._exigir_rol('administracion');
  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_puesto), '') = '' then
    perform public._fallar('Escriba el nombre y el puesto.');
  end if;
  if coalesce(p_salario_mensual, 0) <= 0 then
    perform public._fallar('Escriba el salario mensual.');
  end if;
  if p_fecha_ingreso is null then
    perform public._fallar('Escriba la fecha de ingreso.');
  end if;
  if p_id is not null and public.mi_rol() <> 'gerencia'
     and (select salario_mensual from public.empleados where id = p_id) <> p_salario_mensual then
    perform public._fallar('Solo Gerencia cambia salarios.');
  end if;
  if p_id is null then
    insert into public.empleados (nombre, puesto, area, salario_mensual, fecha_ingreso, cedula, numero_inss, telefono, marca_asistencia)
    values (trim(p_nombre), trim(p_puesto), p_area, p_salario_mensual, p_fecha_ingreso, nullif(trim(p_cedula), ''),
            nullif(trim(p_numero_inss), ''), nullif(trim(p_telefono), ''), coalesce(p_marca_asistencia, true))
    returning id into e_id;
  else
    update public.empleados
       set nombre = trim(p_nombre), puesto = trim(p_puesto), area = p_area, salario_mensual = p_salario_mensual,
           fecha_ingreso = p_fecha_ingreso, cedula = nullif(trim(p_cedula), ''), numero_inss = nullif(trim(p_numero_inss), ''),
           telefono = nullif(trim(p_telefono), ''), marca_asistencia = coalesce(p_marca_asistencia, true),
           activo = coalesce(p_activo, true), fecha_salida = case when coalesce(p_activo, true) then null else coalesce(p_fecha_salida, public.hoy()) end
     where id = p_id returning id into e_id;
  end if;
  return e_id;
end $$;

-- Vacaciones tomadas
create table public.vacaciones (
  id bigint generated always as identity primary key,
  empleado_id bigint not null references public.empleados (id),
  desde date not null,
  hasta date not null check (hasta >= desde),
  dias numeric not null,
  nota text,
  registrado_por uuid not null references public.perfiles (id),
  registrado_en timestamptz not null default now()
);

-- Días hábiles (lunes a sábado) entre dos fechas
create function public._dias_habiles(p_desde date, p_hasta date) returns integer
language sql immutable as $$
  select count(*)::int from generate_series(p_desde, p_hasta, interval '1 day') d where extract(isodow from d) <> 7
$$;

create view public.prestaciones with (security_invoker = true) as
select e.id, e.nombre, e.puesto, e.salario_mensual, e.fecha_ingreso,
       round((public.hoy() - e.fecha_ingreso) / 30.0, 1) as meses_trabajados,
       round((public.hoy() - e.fecha_ingreso) / 30.0 * public._config('vacaciones_dias_por_mes'), 1) as vacaciones_ganadas,
       coalesce((select sum(dias) from public.vacaciones v where v.empleado_id = e.id), 0) as vacaciones_tomadas,
       round((public.hoy() - e.fecha_ingreso) / 30.0 * public._config('vacaciones_dias_por_mes'), 1)
         - coalesce((select sum(dias) from public.vacaciones v where v.empleado_id = e.id), 0) as vacaciones_saldo,
       -- Aguinaldo: un mes de salario por año, contado desde el 1 de diciembre
       round(e.salario_mensual * (public.hoy() - greatest(e.fecha_ingreso,
         make_date(extract(year from public.hoy())::int - case when extract(month from public.hoy()) = 12 then 0 else 1 end, 12, 1))
       ) / 365.0, 2) as aguinaldo_acumulado
from public.empleados e
where e.activo;

create function public.registrar_vacaciones(p_empleado_id bigint, p_desde date, p_hasta date, p_nota text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  dias integer;
  saldo numeric;
  v_id bigint;
begin
  perform public._exigir_rol('administracion');
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    perform public._fallar('Revise las fechas.');
  end if;
  dias := public._dias_habiles(p_desde, p_hasta);
  select vacaciones_saldo into saldo from public.prestaciones where id = p_empleado_id;
  if saldo is null then
    perform public._fallar('Ese empleado no está activo.');
  end if;
  if dias > saldo then
    perform public._fallar(format('Solo tiene %s días de vacaciones ganados y pide %s.', trim_scale(saldo), dias));
  end if;
  insert into public.vacaciones (empleado_id, desde, hasta, dias, nota, registrado_por)
  values (p_empleado_id, p_desde, p_hasta, dias, p_nota, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Adelantos y préstamos: se piden, Gerencia aprueba, se entregan y se
-- descuentan solos en las planillas.
create table public.adelantos (
  id bigint generated always as identity primary key,
  empleado_id bigint not null references public.empleados (id),
  monto numeric not null check (monto > 0),
  cuotas integer not null default 1 check (cuotas between 1 and 24),
  motivo text not null,
  estado text not null default 'solicitado' check (estado in ('solicitado', 'aprobado', 'entregado', 'rechazado')),
  solicitado_por uuid not null references public.perfiles (id),
  solicitado_en timestamptz not null default now(),
  aprobado_por uuid references public.perfiles (id),
  aprobado_en timestamptz,
  motivo_rechazo text,
  entregado_por uuid references public.perfiles (id),
  entregado_en timestamptz,
  comprobante_url text
);

create function public.solicitar_adelanto(p_empleado_id bigint, p_monto numeric, p_cuotas integer, p_motivo text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  a_id bigint;
  e public.empleados;
begin
  perform public._exigir_rol('administracion');
  select * into e from public.empleados where id = p_empleado_id and activo;
  if e.id is null then
    perform public._fallar('Ese empleado no está activo.');
  end if;
  if coalesce(p_monto, 0) <= 0 then
    perform public._fallar('Escriba el monto.');
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba el motivo.');
  end if;
  insert into public.adelantos (empleado_id, monto, cuotas, motivo, solicitado_por)
  values (e.id, p_monto, coalesce(p_cuotas, 1), trim(p_motivo), auth.uid()) returning id into a_id;
  perform public._aviso('adelanto_por_aprobar',
    format('%s pide un adelanto de C$ %s en %s cuota(s): %s.', e.nombre, trim_scale(p_monto), coalesce(p_cuotas, 1), trim(p_motivo)),
    '{gerencia}', '/empleados/' || e.id);
  return a_id;
end $$;

create function public.aprobar_adelanto(p_adelanto_id bigint, p_aprobar boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_gerencia();
  if not p_aprobar and coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba por qué no se aprueba.');
  end if;
  update public.adelantos
     set estado = case when p_aprobar then 'aprobado' else 'rechazado' end,
         aprobado_por = auth.uid(), aprobado_en = now(), motivo_rechazo = case when p_aprobar then null else p_motivo end
   where id = p_adelanto_id and estado = 'solicitado';
  if not found then
    perform public._fallar('Ese adelanto ya no está esperando aprobación.');
  end if;
end $$;

create function public.entregar_adelanto(p_adelanto_id bigint, p_cuenta_id bigint, p_comprobante_url text) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.adelantos;
begin
  perform public._exigir_rol('administracion');
  select * into a from public.adelantos where id = p_adelanto_id for update;
  if a.estado is distinct from 'aprobado' then
    perform public._fallar('Sin aprobación de Gerencia no se entrega.');
  end if;
  if coalesce(p_comprobante_url, '') = '' then
    perform public._fallar('Falta la foto del recibo firmado por el empleado.');
  end if;
  update public.adelantos set estado = 'entregado', entregado_por = auth.uid(), entregado_en = now(), comprobante_url = p_comprobante_url
   where id = a.id;
  perform public._mover_dinero(public._cuenta_por_forma('efectivo', p_cuenta_id), 'salida', a.monto, 'adelanto',
    'Adelanto a ' || (select nombre from public.empleados where id = a.empleado_id), null, p_comprobante_url, 'adelanto', a.id);
end $$;

-- Planilla
create table public.planillas (
  id bigint generated always as identity primary key,
  numero text not null unique,
  desde date not null,
  hasta date not null check (hasta >= desde),
  estado text not null default 'borrador' check (estado in ('borrador', 'aprobada', 'pagada', 'anulada')),
  creada_por uuid not null references public.perfiles (id),
  creada_en timestamptz not null default now(),
  aprobada_por uuid references public.perfiles (id),
  aprobada_en timestamptz,
  pagada_por uuid references public.perfiles (id),
  pagada_en timestamptz,
  cuenta_id bigint references public.cuentas_dinero (id),
  referencia text,
  comprobante_url text,
  motivo_anulacion text
);
create sequence public.seq_pl;

create table public.planillas_lineas (
  id bigint generated always as identity primary key,
  planilla_id bigint not null references public.planillas (id),
  empleado_id bigint not null references public.empleados (id),
  salario_mensual numeric not null,
  dias_periodo numeric not null,
  dias_falta numeric not null default 0,
  dias_vacaciones numeric not null default 0,
  horas_extra numeric not null default 0,
  salario numeric not null default 0,
  pago_horas_extra numeric not null default 0,
  otros_ingresos numeric not null default 0,
  bruto numeric not null default 0,
  inss_laboral numeric not null default 0,
  ir numeric not null default 0,
  adelantos numeric not null default 0,
  otras_deducciones numeric not null default 0,
  neto numeric not null default 0,
  inss_patronal numeric not null default 0,
  inatec numeric not null default 0,
  nota text,
  unique (planilla_id, empleado_id)
);

-- De qué adelanto sale cada descuento
create table public.descuentos_adelanto (
  id bigint generated always as identity primary key,
  planilla_linea_id bigint not null references public.planillas_lineas (id),
  adelanto_id bigint not null references public.adelantos (id),
  monto numeric not null check (monto > 0)
);

create view public.adelantos_saldo with (security_invoker = true) as
select a.*, e.nombre as empleado,
       a.monto - coalesce((select sum(d.monto) from public.descuentos_adelanto d
                            join public.planillas_lineas pl on pl.id = d.planilla_linea_id
                            join public.planillas p on p.id = pl.planilla_id
                           where d.adelanto_id = a.id and p.estado <> 'anulada'), 0) as saldo
from public.adelantos a join public.empleados e on e.id = a.empleado_id;

create function public._ir_periodo(p_renta numeric, p_dias numeric) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  periodos numeric := 360 / greatest(p_dias, 1);
  anual numeric := p_renta * periodos;
  t public.tramos_ir;
begin
  select * into t from public.tramos_ir where anual > desde and (hasta is null or anual <= hasta) order by desde desc limit 1;
  if t.desde is null then
    return 0;
  end if;
  return round((t.impuesto_base + (anual - t.desde) * t.porcentaje / 100) / periodos, 2);
end $$;

-- Recalcula una línea con sus días, horas extra y ajustes
create function public._calcular_linea(p_linea_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.planillas_lineas;
  p public.planillas;
  diario numeric;
  v_bruto numeric;
  v_inss numeric;
  v_ir numeric;
  disponible numeric;
  a record;
  cuota numeric;
  total_adelantos numeric := 0;
begin
  select * into l from public.planillas_lineas where id = p_linea_id;
  select * into p from public.planillas where id = l.planilla_id;
  diario := l.salario_mensual / 30;
  v_bruto := round(diario * greatest(l.dias_periodo - l.dias_falta, 0), 2)
           + round(l.horas_extra * diario / public._config('horas_jornada') * public._config('factor_hora_extra'), 2)
           + l.otros_ingresos;
  v_inss := round(v_bruto * public._config('inss_laboral_pct') / 100, 2);
  v_ir := public._ir_periodo(v_bruto - v_inss, l.dias_periodo);

  -- Los adelantos se rebajan en cuotas, sin dejar el pago en negativo
  delete from public.descuentos_adelanto where planilla_linea_id = l.id;
  disponible := v_bruto - v_inss - v_ir - l.otras_deducciones;
  for a in select * from public.adelantos_saldo
           where empleado_id = l.empleado_id and estado = 'entregado' and saldo > 0
           order by entregado_en loop
    cuota := least(round(a.monto / a.cuotas, 2), a.saldo, greatest(disponible, 0));
    exit when cuota <= 0;
    insert into public.descuentos_adelanto (planilla_linea_id, adelanto_id, monto) values (l.id, a.id, cuota);
    disponible := disponible - cuota;
    total_adelantos := total_adelantos + cuota;
  end loop;

  update public.planillas_lineas
     set salario = round(diario * greatest(dias_periodo - dias_falta, 0), 2),
         pago_horas_extra = round(horas_extra * diario / public._config('horas_jornada') * public._config('factor_hora_extra'), 2),
         bruto = v_bruto, inss_laboral = v_inss, ir = v_ir, adelantos = total_adelantos,
         neto = v_bruto - v_inss - v_ir - total_adelantos - otras_deducciones,
         inss_patronal = round(v_bruto * public._config('inss_patronal_pct') / 100, 2),
         inatec = round(v_bruto * public._config('inatec_pct') / 100, 2)
   where id = l.id;
end $$;

-- Arma la planilla del período con lo que dice la asistencia. Queda en
-- borrador para revisarla antes de mandarla a aprobar.
create function public.calcular_planilla(p_desde date, p_hasta date) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  p_id bigint;
  e public.empleados;
  n integer;
  dias numeric;
  inicio date;
  faltas numeric;
  vac numeric;
  extra numeric;
  l_id bigint;
begin
  perform public._exigir_rol('administracion');
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    perform public._fallar('Revise las fechas del período.');
  end if;
  if exists (select 1 from public.planillas where estado <> 'anulada' and desde <= p_hasta and hasta >= p_desde) then
    perform public._fallar('Ya hay una planilla que cubre esas fechas.');
  end if;
  n := p_hasta - p_desde + 1;
  insert into public.planillas (numero, desde, hasta, creada_por)
  values ('PL-' || lpad(nextval('public.seq_pl')::text, 4, '0'), p_desde, p_hasta, auth.uid())
  returning id into p_id;

  for e in select * from public.empleados where activo and fecha_ingreso <= p_hasta order by nombre loop
    -- Quincena = 15 días y mes = 30, como se paga en Nicaragua
    dias := case when n between 13 and 16 then 15 when n >= 28 then 30 else n end;
    inicio := greatest(p_desde, e.fecha_ingreso);
    dias := greatest(dias - (inicio - p_desde), 0);
    vac := coalesce((select sum(public._dias_habiles(greatest(v.desde, inicio), least(v.hasta, p_hasta)))
                     from public.vacaciones v where v.empleado_id = e.id and v.desde <= p_hasta and v.hasta >= inicio), 0);
    faltas := 0;
    if e.marca_asistencia then
      -- Días hábiles sin marca y sin vacaciones (solo hasta hoy)
      select count(*) into faltas
        from generate_series(inicio, least(p_hasta, public.hoy()), interval '1 day') d
       where extract(isodow from d) <> 7
         and not exists (select 1 from public.asistencia a where a.empleado_id = e.id and a.fecha = d::date)
         and not exists (select 1 from public.vacaciones v where v.empleado_id = e.id and d::date between v.desde and v.hasta);
    end if;
    extra := coalesce((select sum(horas_extra) from public.asistencia
                       where empleado_id = e.id and fecha between p_desde and p_hasta), 0);
    insert into public.planillas_lineas (planilla_id, empleado_id, salario_mensual, dias_periodo, dias_falta, dias_vacaciones, horas_extra)
    values (p_id, e.id, e.salario_mensual, dias, least(faltas, dias), vac, extra)
    returning id into l_id;
    perform public._calcular_linea(l_id);
  end loop;
  return p_id;
end $$;

create function public.ajustar_linea_planilla(
  p_linea_id bigint, p_dias_falta numeric, p_horas_extra numeric, p_otros_ingresos numeric, p_otras_deducciones numeric,
  p_nota text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.planillas_lineas;
begin
  perform public._exigir_rol('administracion');
  select * into l from public.planillas_lineas where id = p_linea_id;
  if (select estado from public.planillas where id = l.planilla_id) is distinct from 'borrador' then
    perform public._fallar('Solo se cambia una planilla en borrador.');
  end if;
  if p_dias_falta < 0 or p_dias_falta > l.dias_periodo or p_horas_extra < 0 or p_otros_ingresos < 0 or p_otras_deducciones < 0 then
    perform public._fallar('Revise los números: no pueden ser negativos ni más faltas que días.');
  end if;
  if (p_dias_falta <> l.dias_falta or p_horas_extra <> l.horas_extra or p_otros_ingresos <> l.otros_ingresos
      or p_otras_deducciones <> l.otras_deducciones) and coalesce(trim(p_nota), '') = '' then
    perform public._fallar('Escriba el motivo del cambio.');
  end if;
  update public.planillas_lineas
     set dias_falta = p_dias_falta, horas_extra = p_horas_extra, otros_ingresos = p_otros_ingresos,
         otras_deducciones = p_otras_deducciones, nota = nullif(trim(p_nota), '')
   where id = l.id;
  perform public._calcular_linea(l.id);
end $$;

create function public.enviar_planilla(p_planilla_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.planillas;
begin
  perform public._exigir_rol('administracion');
  select * into p from public.planillas where id = p_planilla_id;
  if p.estado is distinct from 'borrador' then
    perform public._fallar('Esta planilla no está en borrador.');
  end if;
  perform public._aviso('planilla_por_aprobar',
    format('La planilla %s (del %s al %s) está lista. Neto a pagar C$ %s. Falta su aprobación.', p.numero,
           to_char(p.desde, 'DD/MM'), to_char(p.hasta, 'DD/MM'),
           trim_scale((select sum(neto) from public.planillas_lineas where planilla_id = p.id))),
    '{gerencia}', '/planilla/' || p.id, 'planilla:' || p.id);
end $$;

create function public.aprobar_planilla(p_planilla_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_gerencia();
  update public.planillas set estado = 'aprobada', aprobada_por = auth.uid(), aprobada_en = now()
   where id = p_planilla_id and estado = 'borrador';
  if not found then
    perform public._fallar('Esta planilla no está esperando aprobación.');
  end if;
end $$;

-- Se paga lo neto desde la cuenta elegida. El costo completo (salario,
-- INSS patronal e INATEC) queda como gasto: el de planta entra al costo del saco.
create function public.pagar_planilla(
  p_planilla_id bigint, p_cuenta_id bigint, p_referencia text default null, p_comprobante_url text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.planillas;
  neto numeric;
  r record;
begin
  perform public._exigir_rol('administracion');
  select * into p from public.planillas where id = p_planilla_id for update;
  if p.estado is distinct from 'aprobada' then
    perform public._fallar('Sin aprobación de Gerencia no se paga la planilla.');
  end if;
  if coalesce(p_comprobante_url, '') = '' and coalesce(trim(p_referencia), '') = '' then
    perform public._fallar('Ponga la foto de la planilla firmada o el número de la transferencia.');
  end if;
  select sum(l.neto) into neto from public.planillas_lineas l where l.planilla_id = p.id;
  update public.planillas
     set estado = 'pagada', pagada_por = auth.uid(), pagada_en = now(), cuenta_id = public._cuenta_por_forma('efectivo', p_cuenta_id),
         referencia = p_referencia, comprobante_url = p_comprobante_url
   where id = p.id;
  perform public._mover_dinero(public._cuenta_por_forma('efectivo', p_cuenta_id), 'salida', neto, 'planilla',
    format('Planilla %s (del %s al %s)', p.numero, to_char(p.desde, 'DD/MM'), to_char(p.hasta, 'DD/MM')),
    p_referencia, p_comprobante_url, 'planilla', p.id);
  for r in select e.area = 'planta' as de_planta, sum(l.bruto + l.inss_patronal + l.inatec) as costo
           from public.planillas_lineas l join public.empleados e on e.id = l.empleado_id
           where l.planilla_id = p.id group by 1 loop
    continue when coalesce(r.costo, 0) <= 0;
    insert into public.gastos (fecha, categoria, descripcion, monto, incluir_en_costo, registrado_por, origen)
    values (p.hasta, 'salarios',
            format('Planilla %s, %s (salarios, INSS patronal e INATEC)', p.numero, case when r.de_planta then 'personal de planta' else 'resto del personal' end),
            round(r.costo, 2), r.de_planta, auth.uid(), 'planilla:' || p.id);
  end loop;
end $$;

create function public.anular_planilla(p_planilla_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_gerencia();
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba el motivo.');
  end if;
  update public.planillas set estado = 'anulada', motivo_anulacion = p_motivo
   where id = p_planilla_id and estado in ('borrador', 'aprobada');
  if not found then
    perform public._fallar('Una planilla pagada no se anula.');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Mantenimiento de máquinas y vehículos
-- ---------------------------------------------------------------------
alter table public.items drop constraint items_unidad_check;
alter table public.items add constraint items_unidad_check check (unidad in ('lb', 'saco', 'unidad'));

create table public.equipos (
  id bigint generated always as identity primary key,
  codigo text not null unique,
  nombre text not null,
  tipo text not null check (tipo in ('maquina', 'vehiculo')),
  placa text,
  cada_dias integer check (cada_dias > 0),
  cada_sacos integer check (cada_sacos > 0),
  cada_km integer check (cada_km > 0),
  km_actual numeric not null default 0,
  ultimo_mantenimiento timestamptz not null default now(),
  ultimo_mantenimiento_km numeric not null default 0,
  activo boolean not null default true
);

create table public.ordenes_trabajo (
  id bigint generated always as identity primary key,
  numero text not null unique,
  equipo_id bigint not null references public.equipos (id),
  tipo text not null check (tipo in ('preventivo', 'correctivo')),
  descripcion text not null,
  foto_url text,
  equipo_parado boolean not null default false,
  estado text not null default 'abierta' check (estado in ('abierta', 'en_proceso', 'terminada', 'anulada')),
  reportada_por uuid references public.perfiles (id),
  reportada_en timestamptz not null default now(),
  iniciada_por uuid references public.perfiles (id),
  iniciada_en timestamptz,
  trabajo_realizado text,
  foto_trabajo_url text,
  terminada_por uuid references public.perfiles (id),
  terminada_en timestamptz,
  motivo_anulacion text
);
create sequence public.seq_ot;
alter table public.gastos add constraint gastos_orden_trabajo_fk foreign key (orden_trabajo_id) references public.ordenes_trabajo (id);

alter table public.ordenes add column orden_trabajo_id bigint references public.ordenes_trabajo (id);
create sequence public.seq_re;

alter table public.movimientos drop constraint movimientos_tipo_check;
alter table public.movimientos add constraint movimientos_tipo_check check (tipo in (
  'recepcion_compra', 'salida_requisicion', 'entrada_produccion', 'ajuste_conteo', 'salida_despacho', 'salida_repuestos'));

create function public.guardar_equipo(
  p_id bigint, p_codigo text, p_nombre text, p_tipo text, p_placa text default null,
  p_cada_dias integer default null, p_cada_sacos integer default null, p_cada_km integer default null,
  p_km_actual numeric default 0, p_activo boolean default true
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  e_id bigint;
begin
  perform public._exigir_rol('mantenimiento');
  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_codigo), '') = '' then
    perform public._fallar('Escriba el código y el nombre del equipo.');
  end if;
  if p_id is null then
    insert into public.equipos (codigo, nombre, tipo, placa, cada_dias, cada_sacos, cada_km, km_actual, ultimo_mantenimiento_km)
    values (upper(trim(p_codigo)), trim(p_nombre), p_tipo, nullif(trim(p_placa), ''), p_cada_dias, p_cada_sacos, p_cada_km,
            coalesce(p_km_actual, 0), coalesce(p_km_actual, 0))
    returning id into e_id;
  else
    update public.equipos
       set codigo = upper(trim(p_codigo)), nombre = trim(p_nombre), tipo = p_tipo, placa = nullif(trim(p_placa), ''),
           cada_dias = p_cada_dias, cada_sacos = p_cada_sacos, cada_km = p_cada_km, activo = coalesce(p_activo, true)
     where id = p_id returning id into e_id;
  end if;
  return e_id;
end $$;

create function public._sacos_desde(p_desde timestamptz) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(sacos_producidos), 0) from public.ordenes_produccion
  where estado = 'terminada' and terminada_en > p_desde
$$;

-- Qué toca revisar: por días, por sacos producidos o por kilómetros
create view public.estado_equipos with (security_invoker = true) as
select e.*,
       (public.hoy() - (e.ultimo_mantenimiento at time zone 'America/Managua')::date) as dias_desde,
       public._sacos_desde(e.ultimo_mantenimiento) as sacos_desde,
       e.km_actual - e.ultimo_mantenimiento_km as km_desde,
       (e.cada_dias is not null and public.hoy() - (e.ultimo_mantenimiento at time zone 'America/Managua')::date >= e.cada_dias)
       or (e.cada_sacos is not null and public._sacos_desde(e.ultimo_mantenimiento) >= e.cada_sacos)
       or (e.cada_km is not null and e.km_actual - e.ultimo_mantenimiento_km >= e.cada_km) as toca_mantenimiento,
       exists (select 1 from public.ordenes_trabajo o where o.equipo_id = e.id and o.estado in ('abierta', 'en_proceso') and o.equipo_parado) as parado,
       (select count(*) from public.ordenes_trabajo o where o.equipo_id = e.id and o.estado in ('abierta', 'en_proceso')) as ordenes_abiertas
from public.equipos e;

-- Cualquiera reporta una falla desde el celular, con foto
create function public.reportar_falla(p_equipo_id bigint, p_descripcion text, p_foto_url text, p_equipo_parado boolean default false)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  e public.equipos;
  ot_id bigint;
  numero text;
begin
  perform public._exigir_activo();
  select * into e from public.equipos where id = p_equipo_id and activo;
  if e.id is null then
    perform public._fallar('Elija la máquina o el vehículo.');
  end if;
  if coalesce(trim(p_descripcion), '') = '' then
    perform public._fallar('Describa la falla.');
  end if;
  if coalesce(p_foto_url, '') = '' then
    perform public._fallar('Falta la foto de la falla.');
  end if;
  numero := 'OT-' || lpad(nextval('public.seq_ot')::text, 4, '0');
  insert into public.ordenes_trabajo (numero, equipo_id, tipo, descripcion, foto_url, equipo_parado, reportada_por)
  values (numero, e.id, 'correctivo', trim(p_descripcion), p_foto_url, coalesce(p_equipo_parado, false), auth.uid())
  returning id into ot_id;
  perform public._aviso('falla',
    format('%s%s: %s (%s, %s).', case when p_equipo_parado then 'PARADA ' else 'Falla en ' end, e.nombre, trim(p_descripcion),
           numero, (select nombre from public.perfiles where id = auth.uid())),
    case when p_equipo_parado then '{mantenimiento,gerencia,jefe_produccion}' else '{mantenimiento,gerencia}' end::public.rol_usuario[],
    '/mantenimiento/' || ot_id);
  return ot_id;
end $$;

create function public.iniciar_trabajo(p_ot_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_rol('mantenimiento');
  update public.ordenes_trabajo set estado = 'en_proceso', iniciada_por = auth.uid(), iniciada_en = now()
   where id = p_ot_id and estado = 'abierta';
  if not found then
    perform public._fallar('Esta orden de trabajo no está abierta.');
  end if;
end $$;

-- Repuestos: salen de bodega con la orden de cuatro cantidades
create function public.pedir_repuestos(p_ot_id bigint, p_lineas jsonb, p_notas text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  ot public.ordenes_trabajo;
  o_id bigint;
  x record;
begin
  perform public._exigir_rol('mantenimiento');
  select * into ot from public.ordenes_trabajo where id = p_ot_id;
  if ot.estado not in ('abierta', 'en_proceso') then
    perform public._fallar('La orden de trabajo debe estar abierta.');
  end if;
  if jsonb_array_length(coalesce(p_lineas, '[]')) = 0 then
    perform public._fallar('Agregue al menos un repuesto.');
  end if;
  for x in select * from jsonb_to_recordset(p_lineas) as t(item_id bigint, cantidad numeric) loop
    if coalesce(x.cantidad, 0) <= 0 then
      perform public._fallar('Las cantidades pedidas deben ser mayores que cero.');
    end if;
    if (select tipo from public.items where id = x.item_id) is distinct from 'repuesto' then
      perform public._fallar('Por aquí solo se piden repuestos.');
    end if;
  end loop;
  insert into public.ordenes (numero, tipo, orden_trabajo_id, notas, pedida_por)
  values ('RE-' || lpad(nextval('public.seq_re')::text, 4, '0'), 'repuestos', ot.id,
          coalesce(nullif(trim(p_notas), ''), 'Para ' || ot.numero), auth.uid())
  returning id into o_id;
  insert into public.ordenes_lineas (orden_id, item_id, cantidad_pedida)
  select o_id, t.item_id, t.cantidad from jsonb_to_recordset(p_lineas) as t(item_id bigint, cantidad numeric);
  perform public._aviso('orden_por_aprobar',
    format('Mantenimiento pidió repuestos (%s) para %s. Revise y apruebe las cantidades.',
           (select numero from public.ordenes where id = o_id), ot.numero),
    '{inventario}', '/ordenes/' || o_id);
  return o_id;
end $$;

create function public.terminar_trabajo(p_ot_id bigint, p_trabajo text, p_foto_url text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  ot public.ordenes_trabajo;
begin
  perform public._exigir_rol('mantenimiento');
  select * into ot from public.ordenes_trabajo where id = p_ot_id for update;
  if ot.estado not in ('abierta', 'en_proceso') then
    perform public._fallar('Esta orden de trabajo ya está cerrada.');
  end if;
  if coalesce(trim(p_trabajo), '') = '' then
    perform public._fallar('Escriba qué trabajo se hizo.');
  end if;
  if exists (select 1 from public.ordenes where orden_trabajo_id = ot.id and estado in ('pedida', 'aprobada', 'entregada')) then
    perform public._fallar('Hay repuestos pedidos sin recibir. Recíbalos o anule la orden de repuestos.');
  end if;
  update public.ordenes_trabajo
     set estado = 'terminada', trabajo_realizado = trim(p_trabajo), foto_trabajo_url = nullif(p_foto_url, ''),
         terminada_por = auth.uid(), terminada_en = now(), iniciada_en = coalesce(iniciada_en, now()),
         iniciada_por = coalesce(iniciada_por, auth.uid())
   where id = ot.id;
  -- El contador del preventivo vuelve a cero
  update public.equipos set ultimo_mantenimiento = now(), ultimo_mantenimiento_km = km_actual where id = ot.equipo_id;
  if ot.equipo_parado then
    perform public._aviso('equipo_listo',
      format('%s ya está funcionando (%s).', (select nombre from public.equipos where id = ot.equipo_id), ot.numero),
      '{gerencia,jefe_produccion}', '/mantenimiento/' || ot.id);
  end if;
end $$;

create function public.anular_orden_trabajo(p_ot_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_rol('mantenimiento');
  if coalesce(trim(p_motivo), '') = '' then
    perform public._fallar('Escriba el motivo.');
  end if;
  if exists (select 1 from public.ordenes where orden_trabajo_id = p_ot_id and estado in ('aprobada', 'entregada')) then
    perform public._fallar('Tiene repuestos en camino. Primero recíbalos o anule esa orden.');
  end if;
  update public.ordenes_trabajo set estado = 'anulada', motivo_anulacion = p_motivo
   where id = p_ot_id and estado in ('abierta', 'en_proceso');
  if not found then
    perform public._fallar('Esta orden de trabajo ya está cerrada.');
  end if;
end $$;

-- Costo por orden de trabajo: repuestos al costo de su lote más los gastos ligados
create view public.costos_ordenes_trabajo with (security_invoker = true) as
select ot.id, ot.numero, ot.equipo_id, ot.tipo, ot.estado, ot.descripcion, ot.reportada_en, ot.terminada_en,
       case when ot.equipo_parado then round(extract(epoch from coalesce(ot.terminada_en, now()) - ot.reportada_en) / 3600, 1) else 0 end as horas_parado,
       coalesce((select sum(a.cantidad_recibida * cl.costo_unitario)
                 from public.ordenes o join public.ordenes_lineas ol on ol.orden_id = o.id
                 join public.ordenes_asignaciones a on a.orden_linea_id = ol.id
                 left join public.costos_lotes cl on cl.lote_id = a.lote_id
                 where o.orden_trabajo_id = ot.id and o.estado = 'recibida'), 0) as costo_repuestos,
       coalesce((select sum(g.monto) from public.gastos g where g.orden_trabajo_id = ot.id and not g.anulado), 0) as costo_servicios
from public.ordenes_trabajo ot;

create view public.historial_equipos with (security_invoker = true) as
select e.id, e.codigo, e.nombre, e.tipo,
       count(c.id) filter (where c.estado <> 'anulada') as trabajos,
       count(c.id) filter (where c.tipo = 'correctivo' and c.estado <> 'anulada') as fallas,
       coalesce(sum(c.horas_parado), 0) as horas_parado,
       coalesce(sum(c.costo_repuestos), 0) as costo_repuestos,
       coalesce(sum(c.costo_servicios), 0) as costo_servicios,
       coalesce(sum(c.costo_repuestos + c.costo_servicios), 0) as costo_total
from public.equipos e left join public.costos_ordenes_trabajo c on c.equipo_id = e.id
group by e.id;

-- Vehículos: cada viaje con su kilometraje y combustible
create table public.viajes (
  id bigint generated always as identity primary key,
  equipo_id bigint not null references public.equipos (id),
  fecha date not null default public.hoy(),
  km_inicio numeric not null,
  km_fin numeric not null,
  litros numeric not null default 0 check (litros >= 0),
  monto_combustible numeric not null default 0 check (monto_combustible >= 0),
  orden_id bigint references public.ordenes (id),
  destino text,
  foto_recibo text,
  gasto_id bigint references public.gastos (id),
  registrado_por uuid not null references public.perfiles (id),
  registrado_en timestamptz not null default now(),
  check (km_fin >= km_inicio)
);

create function public.registrar_viaje(
  p_equipo_id bigint, p_km_inicio numeric, p_km_fin numeric, p_litros numeric default 0, p_monto_combustible numeric default 0,
  p_foto_recibo text default null, p_orden_id bigint default null, p_destino text default null, p_cuenta_id bigint default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  e public.equipos;
  v_id bigint;
  g_id bigint;
  cuenta bigint;
begin
  perform public._exigir_rol('despacho', 'administracion');
  select * into e from public.equipos where id = p_equipo_id and tipo = 'vehiculo' and activo for update;
  if e.id is null then
    perform public._fallar('Elija el vehículo.');
  end if;
  if p_km_inicio is null or p_km_fin is null or p_km_fin < p_km_inicio then
    perform public._fallar('Revise el kilometraje: el final no puede ser menor que el inicial.');
  end if;
  if p_km_inicio < e.km_actual then
    perform public._fallar(format('El vehículo ya marcaba %s km. El kilometraje no puede bajar.', trim_scale(e.km_actual)));
  end if;
  if p_orden_id is not null and not exists (select 1 from public.ordenes where id = p_orden_id and tipo = 'despacho') then
    perform public._fallar('Ese despacho no existe.');
  end if;
  if coalesce(p_monto_combustible, 0) > 0 and coalesce(p_foto_recibo, '') = '' then
    perform public._fallar('Falta la foto del recibo del combustible.');
  end if;
  if coalesce(p_monto_combustible, 0) > 0 then
    cuenta := coalesce(p_cuenta_id, (select id from public.cuentas_dinero where activa and tipo = 'caja_chica' order by id limit 1));
    cuenta := public._cuenta_por_forma('efectivo', cuenta);
    insert into public.gastos (categoria, descripcion, monto, incluir_en_costo, foto_url, registrado_por, cuenta_id, origen)
    values ('combustible', format('Combustible %s (%s litros)', e.nombre, trim_scale(coalesce(p_litros, 0))), p_monto_combustible,
            false, p_foto_recibo, auth.uid(), cuenta, 'viaje')
    returning id into g_id;
    perform public._mover_dinero(cuenta, 'salida', p_monto_combustible, 'gasto', 'Combustible ' || e.nombre, null, p_foto_recibo, 'gasto', g_id);
  end if;
  insert into public.viajes (equipo_id, km_inicio, km_fin, litros, monto_combustible, orden_id, destino, foto_recibo, gasto_id, registrado_por)
  values (e.id, p_km_inicio, p_km_fin, coalesce(p_litros, 0), coalesce(p_monto_combustible, 0), p_orden_id, nullif(trim(p_destino), ''),
          nullif(p_foto_recibo, ''), g_id, auth.uid())
  returning id into v_id;
  update public.equipos set km_actual = p_km_fin where id = e.id;
  return v_id;
end $$;

-- Gasto de transporte por entrega
create view public.costo_entregas with (security_invoker = true) as
select v.id, v.fecha, e.nombre as vehiculo, v.km_fin - v.km_inicio as km, v.litros, v.monto_combustible, v.destino,
       o.numero as despacho, c.nombre as cliente,
       coalesce((select sum(a.cantidad_recibida) from public.ordenes_lineas ol join public.ordenes_asignaciones a on a.orden_linea_id = ol.id
                 where ol.orden_id = o.id), 0) as sacos,
       round(v.monto_combustible / nullif((select sum(a.cantidad_recibida) from public.ordenes_lineas ol
                 join public.ordenes_asignaciones a on a.orden_linea_id = ol.id where ol.orden_id = o.id), 0), 2) as costo_por_saco
from public.viajes v
join public.equipos e on e.id = v.equipo_id
left join public.ordenes o on o.id = v.orden_id
left join public.ventas ve on ve.id = o.venta_id
left join public.clientes c on c.id = ve.cliente_id;

-- Se corre una vez al día (pg_cron): crea las órdenes de mantenimiento
-- preventivo que tocan y avisa si va a faltar efectivo.
create function public.revisar_alertas_etapa3() returns void
language plpgsql security definer set search_path = public as $$
declare
  e record;
  ot_id bigint;
  numero text;
  f jsonb;
  s jsonb;
begin
  for e in select * from public.estado_equipos where activo and toca_mantenimiento loop
    continue when exists (select 1 from public.ordenes_trabajo where equipo_id = e.id and tipo = 'preventivo' and estado in ('abierta', 'en_proceso'));
    numero := 'OT-' || lpad(nextval('public.seq_ot')::text, 4, '0');
    insert into public.ordenes_trabajo (numero, equipo_id, tipo, descripcion)
    values (numero, e.id, 'preventivo',
            'Mantenimiento preventivo: ' || concat_ws(', ',
              case when e.cada_dias is not null and e.dias_desde >= e.cada_dias then format('%s días desde el último', e.dias_desde) end,
              case when e.cada_sacos is not null and e.sacos_desde >= e.cada_sacos then format('%s sacos producidos', trim_scale(e.sacos_desde)) end,
              case when e.cada_km is not null and e.km_desde >= e.cada_km then format('%s km recorridos', trim_scale(e.km_desde)) end))
    returning id into ot_id;
    perform public._aviso('toca_mantenimiento', format('Toca mantenimiento a %s (%s).', e.nombre, numero),
      '{mantenimiento,gerencia}', '/mantenimiento/' || ot_id);
  end loop;

  -- ¿Va a faltar efectivo en las próximas semanas?
  f := public._flujo_de_caja(6);
  for s in select * from jsonb_array_elements(f -> 'proximas') loop
    if (s ->> 'saldo_esperado')::numeric < 0 then
      perform public._aviso('falta_efectivo',
        format('Ojo: la semana del %s va a faltar efectivo (C$ %s) según lo que hay por cobrar, por pagar y la planilla.',
               to_char((s ->> 'semana')::date, 'DD/MM'), trim_scale(abs((s ->> 'saldo_esperado')::numeric))),
        '{gerencia,administracion}', '/flujo', 'efectivo:' || (s ->> 'semana'));
      exit;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Las órdenes de cuatro cantidades ahora también llevan repuestos:
-- Mantenimiento pide, Inventario aprueba (FEFO/FIFO), Bodega entrega
-- (sale del kárdex) y Mantenimiento recibe.
-- ---------------------------------------------------------------------
create or replace function public._reservado(p_lote_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(a.cantidad_asignada), 0)
  from public.ordenes_asignaciones a
  join public.ordenes_lineas ol on ol.id = a.orden_linea_id
  join public.ordenes o on o.id = ol.orden_id
  where a.lote_id = p_lote_id and o.estado = 'aprobada' and o.tipo in ('requisicion_mp', 'despacho', 'repuestos')
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
           where o.estado = 'aprobada' and o.tipo in ('requisicion_mp', 'despacho', 'repuestos')
           group by a.lote_id) r on r.lote_id = l.id;

create or replace function public.aprobar_orden(p_orden_id bigint, p_lineas jsonb) returns void
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
  if o.tipo in ('requisicion_mp', 'repuestos') then
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
      perform public._fallar(format('Solo hay %s %s de %s liberado y disponible. Apruebe menos.',
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
    case when o.tipo = 'despacho' then '{despacho}' else '{bodeguero}' end::public.rol_usuario[], '/ordenes/' || o.id);
end $$;

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
  if o.tipo in ('requisicion_mp', 'repuestos') then
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
    if o.tipo in ('requisicion_mp', 'despacho', 'repuestos') and cant > 0 then
      perform public._registrar_movimiento(a.lote_id,
        case o.tipo when 'despacho' then 'salida_despacho' when 'repuestos' then 'salida_repuestos' else 'salida_requisicion' end,
        -cant, o.numero);
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
                when 'repuestos' then '{mantenimiento}'::public.rol_usuario[]
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
  elsif o.tipo = 'repuestos' then
    perform public._exigir_rol('mantenimiento');
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

create or replace function public.anular_orden(p_orden_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.ordenes;
begin
  select * into o from public.ordenes where id = p_orden_id for update;
  if o.pedida_por <> auth.uid() then
    perform public._exigir_rol(case when o.tipo in ('requisicion_mp', 'repuestos') then 'inventario'::public.rol_usuario
                                    else 'bodeguero'::public.rol_usuario end);
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

-- Los repuestos que llegan con orden de compra no pasan por Calidad: se
-- guardan liberados con código RP-.
create or replace function public._liberar_repuesto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select tipo from public.items where id = new.item_id) = 'repuesto' and new.estado = 'cuarentena' then
    new.estado := 'liberado';
    new.codigo := 'RP' || substr(new.codigo, 3);
  end if;
  return new;
end $$;
create trigger liberar_repuesto before insert on public.lotes for each row execute function public._liberar_repuesto();

-- El aviso de "llegó, está en cuarentena" no aplica a repuestos
create or replace function public._quitar_aviso_repuesto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'lote_en_cuarentena' and new.enlace like '/lotes/%'
     and (select l.estado from public.lotes l where l.id = substr(new.enlace, 8)::bigint) = 'liberado' then
    return null;
  end if;
  return new;
end $$;
create trigger quitar_aviso_repuesto before insert on public.avisos for each row execute function public._quitar_aviso_repuesto();

-- El resumen del día suma el dinero en caja y bancos
create or replace function public.resumen_del_dia(p_fecha date default public.hoy()) returns jsonb
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
    'dinero', case when public.ve_dinero()
                   then (select round(sum(public._saldo_cuenta(id)), 2) from public.cuentas_dinero where activa) end,
    'equipos_parados', (select count(*) from public.estado_equipos where activo and parado),
    'por_aprobar', (select count(*) from public.ordenes_produccion where estado = 'pendiente')
                 + (select count(*) from public.ordenes_compra where estado = 'pendiente')
                 + (select count(*) from public.pagos_proveedor where estado = 'solicitado')
                 + (select count(*) from public.conteos where estado = 'pendiente')
                 + (select count(*) from public.adelantos where estado = 'solicitado')
                 + (select count(*) from public.planillas where estado = 'borrador'),
    'stock_bajo', (select count(*) from public.inventario_items where stock_minimo > 0 and disponible < stock_minimo)
  );
end $$;

-- ---------------------------------------------------------------------
-- Auditoría, nada se borra y permisos
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'cuentas_dinero', 'movimientos_dinero', 'cierres_caja', 'tramos_ir', 'empleados', 'asistencia', 'vacaciones', 'adelantos',
    'planillas', 'planillas_lineas', 'equipos', 'ordenes_trabajo', 'viajes'
  ] loop
    execute format('create trigger auditar after insert or update on public.%I for each row execute function public._auditar()', t);
    execute format('create trigger prohibir_borrar before delete on public.%I for each row execute function public._prohibir_borrar()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
  -- Los descuentos de adelantos se recalculan mientras la planilla está en borrador
  execute 'create trigger auditar after insert or update or delete on public.descuentos_adelanto for each row execute function public._auditar()';
  execute 'alter table public.descuentos_adelanto enable row level security';

  -- Dinero y personal: Gerencia, Administración y Socios
  foreach t in array array[
    'cuentas_dinero', 'movimientos_dinero', 'cierres_caja', 'tramos_ir', 'empleados', 'asistencia', 'vacaciones', 'adelantos',
    'planillas', 'planillas_lineas', 'descuentos_adelanto'
  ] loop
    execute format('create policy leer on public.%I for select to authenticated using (public.ve_dinero())', t);
  end loop;

  -- Mantenimiento: todos los usuarios activos
  foreach t in array array['equipos', 'ordenes_trabajo', 'viajes'] loop
    execute format('create policy leer on public.%I for select to authenticated using (public.mi_rol() is not null)', t);
  end loop;
end $$;

create trigger prohibir_cambiar before update on public.cierres_caja for each row execute function public._prohibir_cambiar();
create trigger prohibir_cambiar before update on public.viajes for each row execute function public._prohibir_cambiar();

-- Gerencia cambia la tabla del IR desde Catálogos
create policy gerencia_edita on public.tramos_ir for update to authenticated using (public.mi_rol() = 'gerencia');

grant select on public.empleados_lista, public.asistencia_hoy to authenticated;

do $$
declare
  f record;
begin
  for f in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like '\_%' or p.proname = 'revisar_alertas_etapa3') loop
    execute format('revoke execute on function %s from public', f.firma);
    begin
      execute format('revoke execute on function %s from anon, authenticated', f.firma);
    exception when undefined_object then
      null;
    end;
  end loop;
end $$;

-- Las vistas que se leen con los permisos de quien consulta usan estas dos
grant execute on function public._config(text), public._sacos_desde(timestamptz) to authenticated;
