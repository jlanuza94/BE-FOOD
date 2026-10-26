export type Rol =
  | 'gerencia' | 'jefe_produccion' | 'operador' | 'inventario' | 'bodeguero'
  | 'calidad' | 'despacho' | 'vendedor' | 'administracion' | 'mantenimiento' | 'socio'

export const ROLES: Record<Rol, string> = {
  gerencia: 'Gerencia / Dueños',
  jefe_produccion: 'Jefe de Producción',
  operador: 'Operador de planta',
  inventario: 'Encargado de Inventario',
  bodeguero: 'Bodeguero',
  calidad: 'Calidad',
  despacho: 'Despacho',
  vendedor: 'Vendedor',
  administracion: 'Administración / Caja',
  mantenimiento: 'Mantenimiento',
  socio: 'Socio / Inversionista',
}

export type EstadoLote = 'cuarentena' | 'liberado' | 'rechazado' | 'vencido'
export type EstadoOrden = 'pedida' | 'aprobada' | 'entregada' | 'recibida' | 'anulada'
export type TipoOrden = 'requisicion_mp' | 'entrega_pt' | 'despacho'
export type EstadoOP = 'pendiente' | 'aprobada' | 'en_proceso' | 'terminada' | 'anulada'
export type Etapa = 'molienda' | 'dosificacion' | 'mezcla' | 'peletizado' | 'envasado'
export type Turno = 'manana' | 'tarde' | 'noche'

export const ETAPAS: Etapa[] = ['molienda', 'dosificacion', 'mezcla', 'peletizado', 'envasado']
export const NOMBRE_ETAPA: Record<Etapa, string> = {
  molienda: 'Molienda', dosificacion: 'Dosificación', mezcla: 'Mezcla', peletizado: 'Peletizado', envasado: 'Envasado',
}
export const TURNOS: Record<Turno, string> = { manana: 'Mañana', tarde: 'Tarde', noche: 'Noche' }
export const TIPO_ORDEN: Record<TipoOrden, string> = {
  requisicion_mp: 'Materia prima a Producción',
  entrega_pt: 'Sacos a Bodega',
  despacho: 'Despacho a cliente',
}

export interface Perfil { id: string; nombre: string; rol: Rol; activo: boolean }
export interface Item {
  id: number; codigo: string; nombre: string; tipo: 'materia_prima' | 'producto_terminado' | 'empaque'
  unidad: 'lb' | 'saco'; stock_minimo: number; vida_util_dias: number | null; critico: boolean
  peso_saco_lb: number | null; activo: boolean; precio_venta: number | null
}
export interface Ubicacion { id: number; nombre: string; tipo: string; activa: boolean }
export interface Proveedor { id: number; nombre: string; contacto: string | null; telefono: string | null; activo: boolean }

export interface LoteInventario {
  id: number; codigo: string; estado: EstadoLote; item_id: number; item: string; item_codigo: string
  tipo: Item['tipo']; unidad: string; ubicacion_id: number | null; ubicacion: string | null
  proveedor_id: number | null; proveedor: string | null; lote_proveedor: string | null
  fecha_ingreso: string; fecha_caducidad: string | null; dias_para_vencer: number | null
  cantidad_inicial: number; orden_produccion_id: number | null
  existencia: number; reservado: number; disponible: number
}

export interface InventarioItem {
  id: number; codigo: string; nombre: string; tipo: Item['tipo']; unidad: string; stock_minimo: number
  existencia: number; liberado: number; en_cuarentena: number; disponible: number
}

export interface Orden {
  id: number; numero: string; tipo: TipoOrden; estado: EstadoOrden; orden_produccion_id: number | null
  venta_id: number | null; notas: string | null
  pedida_por: string; pedida_en: string
  aprobada_por: string | null; aprobada_en: string | null
  entregada_por: string | null; entregada_en: string | null
  recibida_por: string | null; recibida_en: string | null
  anulada_por: string | null; anulada_en: string | null; motivo_anulacion: string | null
}
export interface OrdenLinea { id: number; orden_id: number; item_id: number; cantidad_pedida: number; cantidad_aprobada: number | null }
export interface Asignacion {
  id: number; orden_linea_id: number; lote_id: number; cantidad_asignada: number
  cantidad_entregada: number | null; cantidad_recibida: number | null; motivo_diferencia: string | null
}

export interface OrdenProduccion {
  id: number; numero: string; formula_id: number; sacos_planificados: number; turno: Turno; estado: EstadoOP
  notas: string | null; creada_por: string; creada_en: string; aprobada_por: string | null; aprobada_en: string | null
  iniciada_en: string | null; terminada_en: string | null; sacos_producidos: number | null
  materia_prima_lb: number | null; merma_lb: number | null; merma_pct: number | null; lote_pt_id: number | null
}

export interface Formula {
  id: number; producto_id: number; version: number; activa: boolean; notas: string | null
  creada_por: string; creada_en: string
}
export interface FormulaLinea { id: number; formula_id: number; item_id: number; cantidad_por_saco: number }

export interface OrdenCompra {
  id: number; numero: string; proveedor_id: number; estado: 'pendiente' | 'aprobada' | 'recibida' | 'anulada'
  notas: string | null; creada_por: string; creada_en: string; aprobada_por: string | null; aprobada_en: string | null
}
export interface OrdenCompraLinea {
  id: number; orden_compra_id: number; item_id: number; cantidad: number; precio_unitario: number | null; cantidad_recibida: number
}

export interface Aviso {
  id: number; creado_en: string; tipo: string; mensaje: string; enlace: string | null; leido_por: string[]
}

/** Los roles que pueden ver costos, gastos y utilidad (el vendedor no). */
export const VEN_COSTOS: Rol[] = ['socio', 'administracion', 'inventario', 'jefe_produccion']

export interface Cliente {
  id: number; nombre: string; telefono: string | null; direccion: string | null
  dias_credito: number; limite_credito: number; activo: boolean
}
export interface VentaResumen {
  id: number; numero: string; cliente_id: number; cliente: string; condicion: 'contado' | 'credito'
  estado: 'abierta' | 'completa' | 'anulada'; creada_en: string; creada_por: string
  sacos: number; total: number; sacos_entregados: number; facturado: number
}
export interface VentaLinea { id: number; venta_id: number; item_id: number; sacos: number; precio_lista: number | null; precio_unitario: number }
export interface CuentaPorCobrar {
  id: number; numero: string; venta_id: number; cliente_id: number; cliente: string; fecha: string; vence: string
  condicion: string; total: number; abonado: number; saldo: number; dias_atraso: number
}
export interface CuentaPorPagar {
  id: number; numero: string; orden_compra_id: number; orden_compra: string; proveedor_id: number; proveedor: string
  fecha: string; vence: string; monto: number; pagado: number; en_tramite: number; saldo: number; dias_para_vencer: number
}
export interface PagoProveedor {
  id: number; factura_proveedor_id: number; monto: number; estado: 'solicitado' | 'aprobado' | 'pagado' | 'rechazado'
  solicitado_por: string; solicitado_en: string; aprobado_por: string | null; aprobado_en: string | null
  motivo_rechazo: string | null; forma: string | null; referencia: string | null; comprobante_url: string | null
  pagado_por: string | null; pagado_en: string | null
}
export interface Abono {
  id: number; factura_id: number; fecha: string; monto: number; forma: string; referencia: string | null
  foto_url: string | null; registrado_por: string
}
export interface Gasto {
  id: number; fecha: string; categoria: string; descripcion: string; monto: number; incluir_en_costo: boolean
  foto_url: string | null; registrado_por: string; anulado: boolean; motivo_anulacion: string | null
}

export const FORMAS_PAGO: Record<string, string> = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque', deposito: 'Depósito',
}
export const CATEGORIAS_GASTO: Record<string, string> = {
  luz: 'Luz', agua: 'Agua', salarios: 'Salarios', transporte: 'Transporte', combustible: 'Combustible',
  mantenimiento: 'Mantenimiento', alquiler: 'Alquiler', impuestos: 'Impuestos', administracion: 'Administración', otros: 'Otros',
}
