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
export type TipoOrden = 'requisicion_mp' | 'entrega_pt' | 'despacho' | 'repuestos'
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
  repuestos: 'Repuestos a Mantenimiento',
}

export interface Perfil { id: string; nombre: string; rol: Rol; activo: boolean }
export interface Item {
  id: number; codigo: string; nombre: string; tipo: 'materia_prima' | 'producto_terminado' | 'empaque' | 'repuesto'
  unidad: 'lb' | 'saco' | 'unidad'; stock_minimo: number; vida_util_dias: number | null; critico: boolean
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
  venta_id: number | null; orden_trabajo_id: number | null; notas: string | null
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

export type EntidadComentario = 'orden' | 'orden_produccion' | 'venta' | 'orden_compra'

export interface Comentario {
  id: number; entidad: EntidadComentario; entidad_id: number; texto: string; autor: string; creado_en: string
}

export interface NotaBitacora {
  id: number; fecha: string; turno: Turno; area: string; nota: string; importante: boolean
  foto_url: string | null; autor: string; creado_en: string
}

export interface ResumenDia {
  fecha: string; sacos_producidos: number; merma_pct: number | null; ventas: number; sacos_vendidos: number
  utilidad: number; cobrado: number; gastos: number; por_cobrar: number; por_cobrar_vencido: number
  por_pagar: number; sacos_en_bodega: number; por_aprobar: number; stock_bajo: number
  dinero: number | null; equipos_parados: number
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

// ---------------------------------------------------------------------
// Etapa 3: dinero, personal y mantenimiento
// ---------------------------------------------------------------------
/** Los roles que ven el dinero, la planilla y los salarios. */
export const VEN_DINERO: Rol[] = ['administracion', 'socio']

export type TipoCuenta = 'caja_general' | 'caja_chica' | 'banco'
export const TIPOS_CUENTA: Record<TipoCuenta, string> = { caja_general: 'Caja general', caja_chica: 'Caja chica', banco: 'Banco' }

export interface Cuenta {
  id: number; nombre: string; tipo: TipoCuenta; banco: string | null; numero: string | null; activa: boolean
  saldo_inicial: number; saldo: number; hay_sin_conciliar: boolean; ultimo_cierre: string | null
}

export interface MovimientoDinero {
  id: number; cuenta_id: number; fecha: string; tipo: 'entrada' | 'salida'; monto: number; categoria: string; motivo: string
  referencia: string | null; foto_url: string | null; origen: string | null; origen_id: number | null
  conciliado_en: string | null; registrado_por: string
}

export const CATEGORIAS_DINERO: Record<string, string> = {
  cobro: 'Cobro a cliente', pago_proveedor: 'Pago a proveedor', gasto: 'Gasto', planilla: 'Planilla', adelanto: 'Adelanto',
  transferencia: 'Transferencia', aporte: 'Aporte de socios', retiro: 'Retiro de socios', prestamo: 'Préstamo',
  pago_impuestos: 'Pago de INSS o impuestos', diferencia_caja: 'Diferencia en cierre', anulacion: 'Anulación', otro: 'Otro',
}
/** Las que se anotan a mano; las demás salen de su propia pantalla. */
export const CATEGORIAS_MANUALES = ['aporte', 'retiro', 'prestamo', 'pago_impuestos', 'otro']

export interface Cierre {
  id: number; cuenta_id: number; fecha: string; saldo_app: number; contado: number; diferencia: number
  motivo: string | null; cerrado_por: string
}

export interface SemanaFlujo { semana: string; por_cobrar: number; por_pagar: number; planilla: number; saldo_esperado: number }
export interface Flujo {
  saldo_actual: number
  pasadas: { semana: string; entradas: number; salidas: number }[]
  proximas: SemanaFlujo[]
}

export type AreaEmpleado = 'planta' | 'administracion' | 'ventas' | 'transporte'
export const AREAS_EMPLEADO: Record<AreaEmpleado, string> = {
  planta: 'Planta (entra al costo del saco)', administracion: 'Administración', ventas: 'Ventas', transporte: 'Transporte',
}

export interface Empleado {
  id: number; nombre: string; cedula: string | null; numero_inss: string | null; puesto: string; area: AreaEmpleado
  salario_mensual: number; fecha_ingreso: string; marca_asistencia: boolean; telefono: string | null
  activo: boolean; fecha_salida: string | null
}
export interface EmpleadoLista { id: number; nombre: string; puesto: string; area: AreaEmpleado; marca_asistencia: boolean }

export interface Prestaciones {
  id: number; nombre: string; meses_trabajados: number; vacaciones_ganadas: number; vacaciones_tomadas: number
  vacaciones_saldo: number; aguinaldo_acumulado: number
}

export interface Asistencia {
  id: number; empleado_id: number; fecha: string; entrada: string; salida: string | null; foto_entrada: string
  foto_salida: string | null; horas: number | null; horas_extra: number; nota: string | null
}
export interface AsistenciaHoy {
  id: number; empleado_id: number; nombre: string; puesto: string; entrada: string; salida: string | null
  horas: number | null; horas_extra: number
}

export interface Adelanto {
  id: number; empleado_id: number; empleado: string; monto: number; cuotas: number; motivo: string
  estado: 'solicitado' | 'aprobado' | 'entregado' | 'rechazado'; solicitado_en: string; motivo_rechazo: string | null
  entregado_en: string | null; comprobante_url: string | null; saldo: number
}

export interface Planilla {
  id: number; numero: string; desde: string; hasta: string; estado: 'borrador' | 'aprobada' | 'pagada' | 'anulada'
  creada_por: string; aprobada_por: string | null; aprobada_en: string | null; pagada_por: string | null; pagada_en: string | null
  cuenta_id: number | null; referencia: string | null; comprobante_url: string | null; motivo_anulacion: string | null
}
export interface LineaPlanilla {
  id: number; planilla_id: number; empleado_id: number; salario_mensual: number; dias_periodo: number; dias_falta: number
  dias_vacaciones: number; horas_extra: number; salario: number; pago_horas_extra: number; otros_ingresos: number
  bruto: number; inss_laboral: number; ir: number; adelantos: number; otras_deducciones: number; neto: number
  inss_patronal: number; inatec: number; nota: string | null
}

export interface EstadoEquipo {
  id: number; codigo: string; nombre: string; tipo: 'maquina' | 'vehiculo'; placa: string | null
  cada_dias: number | null; cada_sacos: number | null; cada_km: number | null; km_actual: number
  ultimo_mantenimiento: string; ultimo_mantenimiento_km: number; activo: boolean
  dias_desde: number; sacos_desde: number; km_desde: number; toca_mantenimiento: boolean; parado: boolean; ordenes_abiertas: number
}
export interface HistorialEquipo {
  id: number; trabajos: number; fallas: number; horas_parado: number; costo_repuestos: number; costo_servicios: number; costo_total: number
}

export interface OrdenTrabajo {
  id: number; numero: string; equipo_id: number; tipo: 'preventivo' | 'correctivo'; descripcion: string; foto_url: string | null
  equipo_parado: boolean; estado: 'abierta' | 'en_proceso' | 'terminada' | 'anulada'; reportada_por: string | null
  reportada_en: string; iniciada_por: string | null; iniciada_en: string | null; trabajo_realizado: string | null
  foto_trabajo_url: string | null; terminada_por: string | null; terminada_en: string | null; motivo_anulacion: string | null
}
export interface CostoOrdenTrabajo {
  id: number; numero: string; equipo_id: number; tipo: 'preventivo' | 'correctivo'; estado: string; descripcion: string
  reportada_en: string; terminada_en: string | null; horas_parado: number; costo_repuestos: number; costo_servicios: number
}

export interface CostoEntrega {
  id: number; fecha: string; vehiculo: string; km: number; litros: number; monto_combustible: number; destino: string | null
  despacho: string | null; cliente: string | null; sacos: number; costo_por_saco: number | null
}
