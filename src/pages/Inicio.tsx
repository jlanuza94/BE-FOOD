import { leer, supabase } from '../lib/supabase'
import { useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { hoyISO, num } from '../lib/formato'
import type { Cuenta, InventarioItem, NotaBitacora, Rol } from '../lib/tipos'
import { Link } from 'react-router-dom'
import { Cargando, Nota, Pantalla, Tarjeta } from '../components/ui'
import { Tablero } from '../components/Tablero'

interface Pendiente { texto: string; a: string; roles: Rol[]; contar: () => PromiseLike<{ count: number | null }> }

const contar = (tabla: string) => supabase.from(tabla).select('id', { count: 'exact', head: true })

const PENDIENTES: Pendiente[] = [
  { texto: 'Órdenes de materia prima por aprobar', a: '/ordenes', roles: ['inventario'],
    contar: () => contar('ordenes').eq('estado', 'pedida').eq('tipo', 'requisicion_mp') },
  { texto: 'Órdenes por entregar', a: '/ordenes', roles: ['bodeguero'],
    contar: () => contar('ordenes').eq('estado', 'aprobada').eq('tipo', 'requisicion_mp') },
  { texto: 'Materia prima por recibir en Producción', a: '/ordenes', roles: ['jefe_produccion'],
    contar: () => contar('ordenes').eq('estado', 'entregada').eq('tipo', 'requisicion_mp') },
  { texto: 'Sacos por entregar a bodega', a: '/ordenes', roles: ['jefe_produccion'],
    contar: () => contar('ordenes').eq('estado', 'aprobada').eq('tipo', 'entrega_pt') },
  { texto: 'Sacos por recibir en bodega', a: '/ordenes', roles: ['bodeguero', 'inventario'],
    contar: () => contar('ordenes').eq('estado', 'entregada').eq('tipo', 'entrega_pt') },
  { texto: 'Lotes en cuarentena por revisar', a: '/calidad', roles: ['calidad'],
    contar: () => contar('lotes').eq('estado', 'cuarentena') },
  { texto: 'Órdenes de producción por aprobar', a: '/produccion', roles: [],
    contar: () => contar('ordenes_produccion').eq('estado', 'pendiente') },
  { texto: 'Producción en curso', a: '/produccion', roles: ['jefe_produccion', 'operador'],
    contar: () => contar('ordenes_produccion').in('estado', ['aprobada', 'en_proceso']) },
  { texto: 'Órdenes de compra por aprobar', a: '/compras', roles: [],
    contar: () => contar('ordenes_compra').eq('estado', 'pendiente') },
  { texto: 'Compras por recibir', a: '/recepcion', roles: ['inventario', 'bodeguero'],
    contar: () => contar('ordenes_compra').eq('estado', 'aprobada') },
  { texto: 'Despachos a clientes por aprobar', a: '/ordenes', roles: ['bodeguero'],
    contar: () => contar('ordenes').eq('estado', 'pedida').eq('tipo', 'despacho') },
  { texto: 'Despachos por cargar', a: '/ordenes', roles: ['despacho'],
    contar: () => contar('ordenes').eq('estado', 'aprobada').eq('tipo', 'despacho') },
  { texto: 'Entregas al cliente por confirmar con firma', a: '/ordenes', roles: ['despacho'],
    contar: () => contar('ordenes').eq('estado', 'entregada').eq('tipo', 'despacho') },
  { texto: 'Pagos a proveedores por aprobar', a: '/pagos', roles: [],
    contar: () => contar('pagos_proveedor').eq('estado', 'solicitado') },
  { texto: 'Pagos aprobados por hacer', a: '/pagos', roles: ['administracion'],
    contar: () => contar('pagos_proveedor').eq('estado', 'aprobado') },
  { texto: 'Facturas de clientes vencidas', a: '/cobros', roles: ['administracion', 'vendedor'],
    contar: () => contar('cuentas_por_cobrar').gt('saldo', 0).gt('dias_atraso', 0) },
  { texto: 'Adelantos de salario por aprobar', a: '/empleados', roles: [],
    contar: () => contar('adelantos').eq('estado', 'solicitado') },
  { texto: 'Planillas por aprobar', a: '/planilla', roles: [],
    contar: () => contar('planillas').eq('estado', 'borrador') },
  { texto: 'Planillas aprobadas por pagar', a: '/planilla', roles: ['administracion'],
    contar: () => contar('planillas').eq('estado', 'aprobada') },
  { texto: 'Cajas sin cerrar hoy', a: '/dinero', roles: ['administracion'],
    contar: async () => {
      const cuentas = (await leer(supabase.from('saldos_cuentas').select('*').eq('activa', true).neq('tipo', 'banco'))) as Cuenta[]
      return { count: cuentas.filter((c) => (c.ultimo_cierre ?? '') < hoyISO()).length }
    } },
  { texto: 'Órdenes de trabajo abiertas', a: '/mantenimiento', roles: ['mantenimiento'],
    contar: () => contar('ordenes_trabajo').in('estado', ['abierta', 'en_proceso']) },
  { texto: 'Repuestos por aprobar', a: '/ordenes', roles: ['inventario'],
    contar: () => contar('ordenes').eq('estado', 'pedida').eq('tipo', 'repuestos') },
  { texto: 'Repuestos por entregar', a: '/ordenes', roles: ['bodeguero', 'inventario'],
    contar: () => contar('ordenes').eq('estado', 'aprobada').eq('tipo', 'repuestos') },
  { texto: 'Repuestos por recibir', a: '/ordenes', roles: ['mantenimiento'],
    contar: () => contar('ordenes').eq('estado', 'entregada').eq('tipo', 'repuestos') },
  { texto: 'Ajustes de inventario por autorizar', a: '/conteos', roles: [],
    contar: () => contar('conteos').eq('estado', 'pendiente') },
]

export function Inicio() {
  const { perfil, puede, personas } = useSesion()
  const esDueno = perfil?.rol === 'gerencia' || perfil?.rol === 'socio'
  const { datos, cargando, error } = useDatos(async () => {
    const mios = PENDIENTES.filter((p) => puede(...p.roles))
    const cuentas = await Promise.all(mios.map((p) => p.contar()))
    const bajos = (await leer(supabase.from('inventario_items').select('*').gt('stock_minimo', 0))) as InventarioItem[]
    const avisos = await supabase.from('avisos').select('id, leido_por').order('id', { ascending: false }).limit(100)
    const ayer = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const notas = (await leer(supabase.from('bitacora').select('*').eq('importante', true).gte('creado_en', ayer)
      .order('id', { ascending: false }).limit(5))) as NotaBitacora[]
    return {
      pendientes: mios.map((p, i) => ({ ...p, n: cuentas[i].count ?? 0 })).filter((p) => p.n > 0),
      bajos: bajos.filter((b) => Number(b.disponible) < Number(b.stock_minimo)),
      sinLeer: (avisos.data ?? []).filter((a) => !(a.leido_por as string[]).includes(perfil!.id)).length,
      notas,
    }
  }, [perfil?.id])

  return (
    <Pantalla titulo={`Hola, ${perfil?.nombre.split(' ')[0]}`}>
      <Link to="/escanear" className="boton boton-principal boton-escanear boton-enlace">📷 Escanear QR de un lote</Link>
      {esDueno && <Tablero />}
      <Cargando cargando={cargando && !datos} error={error} />
      {datos && (
        <>
          {datos.sinLeer > 0 && (
            <Tarjeta a="/avisos" titulo={`🔔 ${datos.sinLeer} aviso${datos.sinLeer === 1 ? '' : 's'} sin leer`} />
          )}
          {datos.notas.length > 0 && (
            <>
              <h2>Notas importantes del turno</h2>
              {datos.notas.map((n) => (
                <Tarjeta key={n.id} a="/bitacora" titulo={`⚠️ ${n.area}`}>
                  <div>{n.nota}</div>
                  <div className="texto-suave">{personas.get(n.autor)?.nombre}</div>
                </Tarjeta>
              ))}
            </>
          )}
          <h2>Lo que le toca</h2>
          {datos.pendientes.length === 0 && <Nota>No tiene nada pendiente. 👍</Nota>}
          {datos.pendientes.map((p) => (
            <Tarjeta key={p.texto} a={p.a}>
              <div className="pendiente">
                <span className="pendiente-n">{p.n}</span>
                <span>{p.texto}</span>
              </div>
            </Tarjeta>
          ))}
          {datos.bajos.length > 0 && (
            <>
              <h2>Se está acabando</h2>
              {datos.bajos.map((b) => (
                <Tarjeta key={b.id} a="/inventario" titulo={b.nombre}>
                  <div className="texto-suave">
                    Disponible {num(b.disponible)} {b.unidad} · mínimo {num(b.stock_minimo)}
                  </div>
                </Tarjeta>
              ))}
            </>
          )}
        </>
      )}
    </Pantalla>
  )
}
