-- =====================================================================
-- BE Food · Etapa 1 · Esquema
-- Inventario por lote, calidad y cuarentena, FIFO/FEFO, órdenes con
-- aprobación de cantidades, fórmulas versionadas, producción, kárdex,
-- avisos y auditoría.
--
-- Regla de diseño: las tablas solo se leen desde la app. Todo lo que
-- cambia datos pasa por funciones (rpc) que revisan el rol y las reglas,
-- así nadie se las puede saltar. Nada se borra.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.rol_usuario as enum (
  'gerencia', 'jefe_produccion', 'operador', 'inventario', 'bodeguero',
  'calidad', 'despacho', 'vendedor', 'administracion', 'mantenimiento', 'socio'
);
create type public.tipo_item as enum ('materia_prima', 'producto_terminado', 'empaque');
create type public.estado_lote as enum ('cuarentena', 'liberado', 'rechazado', 'vencido');
create type public.tipo_orden as enum ('requisicion_mp', 'entrega_pt');
create type public.estado_orden as enum ('pedida', 'aprobada', 'entregada', 'recibida', 'anulada');
create type public.estado_oc as enum ('pendiente', 'aprobada', 'recibida', 'anulada');
create type public.estado_op as enum ('pendiente', 'aprobada', 'en_proceso', 'terminada', 'anulada');
create type public.etapa_produccion as enum ('molienda', 'dosificacion', 'mezcla', 'peletizado', 'envasado');
create type public.turno as enum ('manana', 'tarde', 'noche');
create type public.estado_conteo as enum ('cuadrado', 'pendiente', 'ajustado', 'rechazado');

-- ---------------------------------------------------------------------
-- Usuarios y configuración
-- ---------------------------------------------------------------------
create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null,
  rol public.rol_usuario not null default 'operador',
  activo boolean not null default false,
  creado_en timestamptz not null default now()
);

create table public.configuracion (
  clave text primary key,
  valor numeric not null,
  descripcion text not null
);

insert into public.configuracion (clave, valor, descripcion) values
  ('merma_max_pct', 1, 'Merma permitida por lote de producción (%). Si se pasa, avisa a Producción y Gerencia.'),
  ('tolerancia_ingredientes_pct', 2, 'Cuánto menos de lo que pide la fórmula se acepta recibir antes de bloquear la producción (%).'),
  ('cuarentena_max_dias', 3, 'Días que un lote puede estar en cuarentena antes de avisar a Calidad y Gerencia.'),
  ('conteo_diario_lotes', 5, 'Cuántos lotes se cuentan cada día en el conteo cíclico.'),
  ('orden_detenida_horas', 24, 'Horas sin moverse para avisar que una orden está detenida.');

-- ---------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------
create table public.ubicaciones (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  tipo text not null default 'bodega',
  activa boolean not null default true
);

create table public.proveedores (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  contacto text,
  telefono text,
  activo boolean not null default true
);

create table public.items (
  id bigint generated always as identity primary key,
  codigo text not null unique check (codigo ~ '^[A-Z0-9]{2,12}$'),
  nombre text not null,
  tipo public.tipo_item not null,
  unidad text not null check (unidad in ('lb', 'saco')),
  stock_minimo numeric not null default 0 check (stock_minimo >= 0),
  vida_util_dias integer check (vida_util_dias > 0),
  critico boolean not null default true,
  peso_saco_lb numeric check (peso_saco_lb > 0),
  activo boolean not null default true,
  check (tipo <> 'producto_terminado' or (unidad = 'saco' and peso_saco_lb is not null))
);

-- ---------------------------------------------------------------------
-- Compras (solo lo necesario para recibir materia prima con orden)
-- ---------------------------------------------------------------------
create sequence public.seq_oc;
create table public.ordenes_compra (
  id bigint generated always as identity primary key,
  numero text not null unique default 'OC-' || lpad(nextval('public.seq_oc')::text, 4, '0'),
  proveedor_id bigint not null references public.proveedores (id),
  estado public.estado_oc not null default 'pendiente',
  notas text,
  creada_por uuid not null references public.perfiles (id),
  creada_en timestamptz not null default now(),
  aprobada_por uuid references public.perfiles (id),
  aprobada_en timestamptz,
  motivo_anulacion text
);

create table public.ordenes_compra_lineas (
  id bigint generated always as identity primary key,
  orden_compra_id bigint not null references public.ordenes_compra (id),
  item_id bigint not null references public.items (id),
  cantidad numeric not null check (cantidad > 0),
  precio_unitario numeric check (precio_unitario >= 0),
  cantidad_recibida numeric not null default 0
);

-- ---------------------------------------------------------------------
-- Fórmulas versionadas
-- ---------------------------------------------------------------------
create table public.formulas (
  id bigint generated always as identity primary key,
  producto_id bigint not null references public.items (id),
  version integer not null,
  activa boolean not null default true,
  notas text,
  creada_por uuid not null references public.perfiles (id),
  creada_en timestamptz not null default now(),
  unique (producto_id, version)
);
create unique index formulas_una_activa on public.formulas (producto_id) where activa;

create table public.formulas_lineas (
  id bigint generated always as identity primary key,
  formula_id bigint not null references public.formulas (id),
  item_id bigint not null references public.items (id),
  cantidad_por_saco numeric not null check (cantidad_por_saco > 0),
  unique (formula_id, item_id)
);

-- ---------------------------------------------------------------------
-- Producción
-- ---------------------------------------------------------------------
create sequence public.seq_op;
create table public.ordenes_produccion (
  id bigint generated always as identity primary key,
  numero text not null unique default 'OP-' || lpad(nextval('public.seq_op')::text, 4, '0'),
  formula_id bigint not null references public.formulas (id),
  sacos_planificados integer not null check (sacos_planificados > 0),
  turno public.turno not null,
  estado public.estado_op not null default 'pendiente',
  notas text,
  creada_por uuid not null references public.perfiles (id),
  creada_en timestamptz not null default now(),
  aprobada_por uuid references public.perfiles (id),
  aprobada_en timestamptz,
  iniciada_en timestamptz,
  terminada_en timestamptz,
  sacos_producidos integer,
  materia_prima_lb numeric,
  merma_lb numeric,
  merma_pct numeric,
  lote_pt_id bigint,
  motivo_anulacion text
);

-- Explosión de materiales: lo que la fórmula dice que hace falta,
-- más lo que Gerencia autorice de extra.
create table public.op_requerimientos (
  id bigint generated always as identity primary key,
  orden_produccion_id bigint not null references public.ordenes_produccion (id),
  item_id bigint not null references public.items (id),
  cantidad_formula numeric not null default 0,
  cantidad_extra numeric not null default 0,
  motivo_extra text,
  autorizado_por uuid references public.perfiles (id),
  unique (orden_produccion_id, item_id)
);

create table public.op_checklist (
  orden_produccion_id bigint primary key references public.ordenes_produccion (id),
  limpieza boolean not null,
  formula_correcta boolean not null,
  ingredientes_completos boolean not null,
  observaciones text,
  registrado_por uuid not null references public.perfiles (id),
  registrado_en timestamptz not null default now(),
  check (limpieza and formula_correcta and ingredientes_completos)
);

create table public.op_etapas (
  id bigint generated always as identity primary key,
  orden_produccion_id bigint not null references public.ordenes_produccion (id),
  etapa public.etapa_produccion not null,
  operador_id uuid not null references public.perfiles (id),
  turno public.turno not null,
  inicio timestamptz not null default now(),
  fin timestamptz,
  observaciones text,
  unique (orden_produccion_id, etapa)
);

-- ---------------------------------------------------------------------
-- Lotes, calidad y kárdex
-- ---------------------------------------------------------------------
create table public.lotes (
  id bigint generated always as identity primary key,
  codigo text not null unique,
  item_id bigint not null references public.items (id),
  proveedor_id bigint references public.proveedores (id),
  lote_proveedor text,
  orden_compra_linea_id bigint references public.ordenes_compra_lineas (id),
  orden_produccion_id bigint references public.ordenes_produccion (id),
  fecha_ingreso timestamptz not null default now(),
  fecha_caducidad date,
  ubicacion_id bigint references public.ubicaciones (id),
  estado public.estado_lote not null default 'cuarentena',
  estado_cambiado_en timestamptz not null default now(),
  cantidad_inicial numeric not null default 0,
  foto_ticket_url text,
  fotos text[] not null default '{}',
  creado_por uuid not null references public.perfiles (id)
);
create index lotes_item_estado on public.lotes (item_id, estado);

alter table public.ordenes_produccion
  add constraint ordenes_produccion_lote_pt_fk foreign key (lote_pt_id) references public.lotes (id);

create table public.inspecciones_calidad (
  id bigint generated always as identity primary key,
  lote_id bigint not null references public.lotes (id),
  resultado public.estado_lote not null check (resultado in ('liberado', 'rechazado', 'cuarentena')),
  revision jsonb not null default '{}',
  observaciones text,
  fotos text[] not null default '{}',
  inspector_id uuid not null references public.perfiles (id),
  fecha timestamptz not null default now()
);

-- El kárdex: cada entrada y salida de cada lote. Solo lo escriben las
-- funciones de este archivo; nadie lo toca a mano.
create table public.movimientos (
  id bigint generated always as identity primary key,
  fecha timestamptz not null default now(),
  lote_id bigint not null references public.lotes (id),
  item_id bigint not null references public.items (id),
  tipo text not null check (tipo in (
    'recepcion_compra', 'salida_requisicion', 'entrada_produccion', 'ajuste_conteo'
  )),
  cantidad numeric not null check (cantidad <> 0),
  referencia text,
  nota text,
  usuario_id uuid not null references public.perfiles (id)
);
create index movimientos_lote on public.movimientos (lote_id);
create index movimientos_item on public.movimientos (item_id, fecha);

-- ---------------------------------------------------------------------
-- Órdenes entre áreas con cuatro cantidades
-- ---------------------------------------------------------------------
create sequence public.seq_rm;
create sequence public.seq_ep;
create table public.ordenes (
  id bigint generated always as identity primary key,
  numero text not null unique,
  tipo public.tipo_orden not null,
  estado public.estado_orden not null default 'pedida',
  orden_produccion_id bigint references public.ordenes_produccion (id),
  notas text,
  pedida_por uuid not null references public.perfiles (id),
  pedida_en timestamptz not null default now(),
  aprobada_por uuid references public.perfiles (id),
  aprobada_en timestamptz,
  entregada_por uuid references public.perfiles (id),
  entregada_en timestamptz,
  recibida_por uuid references public.perfiles (id),
  recibida_en timestamptz,
  anulada_por uuid references public.perfiles (id),
  anulada_en timestamptz,
  motivo_anulacion text,
  actualizada_en timestamptz not null default now()
);

create table public.ordenes_lineas (
  id bigint generated always as identity primary key,
  orden_id bigint not null references public.ordenes (id),
  item_id bigint not null references public.items (id),
  cantidad_pedida numeric not null check (cantidad_pedida > 0),
  cantidad_aprobada numeric check (cantidad_aprobada >= 0),
  unique (orden_id, item_id)
);

-- De qué lote sale cada cantidad aprobada (FIFO/FEFO). Aquí se guardan
-- la cantidad entregada y la recibida de cada lote.
create table public.ordenes_asignaciones (
  id bigint generated always as identity primary key,
  orden_linea_id bigint not null references public.ordenes_lineas (id),
  lote_id bigint not null references public.lotes (id),
  cantidad_asignada numeric not null check (cantidad_asignada > 0),
  cantidad_entregada numeric check (cantidad_entregada >= 0),
  cantidad_recibida numeric check (cantidad_recibida >= 0),
  motivo_diferencia text,
  check (cantidad_entregada is null or cantidad_entregada <= cantidad_asignada),
  check (cantidad_recibida is null or cantidad_recibida <= cantidad_entregada)
);
create index ordenes_asignaciones_lote on public.ordenes_asignaciones (lote_id);

-- ---------------------------------------------------------------------
-- Conteo cíclico
-- ---------------------------------------------------------------------
create table public.conteos (
  id bigint generated always as identity primary key,
  lote_id bigint not null references public.lotes (id),
  cantidad_sistema numeric not null,
  cantidad_contada numeric not null check (cantidad_contada >= 0),
  diferencia numeric generated always as (cantidad_contada - cantidad_sistema) stored,
  motivo text,
  estado public.estado_conteo not null,
  contado_por uuid not null references public.perfiles (id),
  contado_en timestamptz not null default now(),
  revisado_por uuid references public.perfiles (id),
  revisado_en timestamptz
);

-- ---------------------------------------------------------------------
-- Avisos y auditoría
-- ---------------------------------------------------------------------
create table public.avisos (
  id bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  tipo text not null,
  mensaje text not null,
  roles public.rol_usuario[] not null default '{gerencia}',
  enlace text,
  clave_unica text unique,
  leido_por uuid[] not null default '{}'
);

create table public.auditoria (
  id bigint generated always as identity primary key,
  fecha timestamptz not null default now(),
  usuario_id uuid,
  tabla text not null,
  registro_id text,
  accion text not null,
  antes jsonb,
  despues jsonb,
  origen text
);
create index auditoria_tabla_registro on public.auditoria (tabla, registro_id);
