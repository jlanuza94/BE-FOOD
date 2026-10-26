import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { cordobas, fecha, fechaHora, num } from '../lib/formato'
import type { InventarioItem, LoteInventario } from '../lib/tipos'
import { Boton, Cargando, Entrada, Estado, Fila, Pantalla, Tarjeta, Vacio } from '../components/ui'
import { EtiquetaQR } from '../components/EtiquetaQR'
import { VerFoto } from '../components/Fotos'

export function Inventario() {
  const [vista, setVista] = useState<'productos' | 'lotes'>('productos')
  const [buscar, setBuscar] = useState('')
  const navegar = useNavigate()
  const productos = useDatos(async () => (await leer(supabase.from('inventario_items').select('*').order('nombre'))) as InventarioItem[])
  const lotes = useDatos(
    async () => (await leer(supabase.from('inventario_lotes').select('*').gt('existencia', 0)
      .order('fecha_caducidad', { ascending: true, nullsFirst: false }))) as LoteInventario[],
  )

  const texto = buscar.trim().toUpperCase()
  const lotesFiltrados = (lotes.datos ?? []).filter(
    (l) => !texto || l.codigo.includes(texto) || l.item.toUpperCase().includes(texto),
  )

  return (
    <Pantalla titulo="Inventario" accion={<Link to="/escanear" className="encabezado-accion" aria-label="Escanear QR">📷</Link>}>
      <div className="pestanas">
        <button className={vista === 'productos' ? 'activa' : ''} onClick={() => setVista('productos')}>Por producto</button>
        <button className={vista === 'lotes' ? 'activa' : ''} onClick={() => setVista('lotes')}>Por lote</button>
      </div>

      {vista === 'productos' && (
        <>
          <Cargando cargando={productos.cargando && !productos.datos} error={productos.error} />
          {productos.datos?.map((p) => (
            <Tarjeta key={p.id} titulo={p.nombre}>
              <Fila izquierda="Disponible para usar" derecha={<strong>{num(p.disponible)} {p.unidad}</strong>} />
              <Fila izquierda="Liberado" derecha={`${num(p.liberado)} ${p.unidad}`} />
              {Number(p.en_cuarentena) > 0 && <Fila izquierda="En cuarentena" derecha={`${num(p.en_cuarentena)} ${p.unidad}`} />}
              {Number(p.stock_minimo) > 0 && <Fila izquierda="Mínimo" derecha={`${num(p.stock_minimo)} ${p.unidad}`} />}
            </Tarjeta>
          ))}
        </>
      )}

      {vista === 'lotes' && (
        <>
          <form onSubmit={(e) => {
            e.preventDefault()
            const exacto = lotesFiltrados.find((l) => l.codigo === texto)
            if (exacto) navegar(`/lotes/${exacto.id}`)
          }}>
            <Entrada placeholder="Buscar por código de lote o producto" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          </form>
          <Cargando cargando={lotes.cargando && !lotes.datos} error={lotes.error} />
          {lotes.datos && lotesFiltrados.length === 0 && <Vacio>No hay lotes con existencia.</Vacio>}
          {lotesFiltrados.map((l) => (
            <Tarjeta key={l.id} a={`/lotes/${l.id}`} titulo={<>{l.codigo} <Estado valor={l.estado} /></>}>
              <div>{l.item} · {num(l.existencia)} {l.unidad}{Number(l.reservado) > 0 && ` (${num(l.reservado)} apartado)`}</div>
              <div className="texto-suave">
                {l.ubicacion ?? 'Sin ubicación'} · vence {fecha(l.fecha_caducidad)}
                {l.dias_para_vencer !== null && l.dias_para_vencer <= 30 && <strong className="texto-error"> · {l.dias_para_vencer} días</strong>}
              </div>
            </Tarjeta>
          ))}
        </>
      )}
    </Pantalla>
  )
}

interface Movimiento { id: number; fecha: string; tipo: string; cantidad: number; saldo_lote: number; referencia: string | null; nota: string | null; usuario: string }
interface Inspeccion { id: number; resultado: string; revision: Record<string, boolean>; observaciones: string | null; fotos: string[]; inspector_id: string; fecha: string }
interface EntregaCliente { orden_id: number; orden: string; venta_id: number; venta: string; cliente: string; sacos: number; recibida_en: string; recibido_por_nombre: string | null }
interface CostoLote { costo_unitario: number; costo_materia_prima: number | null; gasto_planta: number | null; costo_total: number | null }
interface Consumo { orden_produccion_id: number; op_numero: string; lote_pt_id: number | null; lote_pt: string | null; lote_mp_id: number; lote_mp: string; item: string; unidad: string; cantidad_recibida: number; recibido_por: string | null; recibida_en: string | null }

const TIPO_MOV: Record<string, string> = {
  recepcion_compra: 'Recepción de compra',
  salida_requisicion: 'Salida a Producción',
  salida_despacho: 'Despacho a cliente',
  entrada_produccion: 'Entrada de Producción',
  ajuste_conteo: 'Ajuste por conteo',
}

export function LoteDetalle() {
  const id = Number(useParams().id)
  const { personas, veCostos } = useSesion()
  const { datos, cargando, error } = useDatos(async () => {
    const lote = (await leer(supabase.from('inventario_lotes').select('*').eq('id', id).single())) as LoteInventario
    const extra = (await leer(supabase.from('lotes').select('foto_ticket_url, fotos').eq('id', id).single())) as { foto_ticket_url: string | null; fotos: string[] }
    const kardex = (await leer(supabase.from('kardex').select('*').eq('lote_id', id).order('fecha'))) as Movimiento[]
    const inspecciones = (await leer(supabase.from('inspecciones_calidad').select('*').eq('lote_id', id).order('fecha'))) as Inspeccion[]
    const campo = lote.orden_produccion_id ? 'lote_pt_id' : 'lote_mp_id'
    const consumos = (await leer(supabase.from('consumos_produccion').select('*').eq(campo, id))) as Consumo[]
    const clientes = lote.orden_produccion_id
      ? ((await leer(supabase.from('entregas_por_lote').select('*').eq('lote_id', id))) as EntregaCliente[])
      : []
    const costo = veCostos ? ((await rpc<CostoLote[]>('reporte_costo_lote', { p_lote_id: id }))[0] ?? null) : null
    return { lote, extra, kardex, inspecciones, consumos, clientes, costo }
  }, [id])

  if (!datos) return <Pantalla titulo="Lote" atras><Cargando cargando={cargando} error={error} /></Pantalla>
  const { lote, extra, kardex, inspecciones, consumos, clientes, costo } = datos
  const esPT = !!lote.orden_produccion_id

  return (
    <Pantalla titulo={lote.codigo} atras>
      <Tarjeta>
        <EtiquetaQR lote={lote} />
        <Boton variante="secundario" onClick={() => window.print()}>Imprimir etiqueta</Boton>
      </Tarjeta>

      <Tarjeta titulo="Existencia">
        <Fila izquierda="Hay" derecha={<strong>{num(lote.existencia)} {lote.unidad}</strong>} />
        <Fila izquierda="Apartado en órdenes" derecha={`${num(lote.reservado)} ${lote.unidad}`} />
        <Fila izquierda="Disponible" derecha={`${num(lote.disponible)} ${lote.unidad}`} />
        {esPT && <Fila izquierda="Producido en" derecha={<Link to={`/produccion/${lote.orden_produccion_id}`}>Ver orden</Link>} />}
      </Tarjeta>

      {(extra.foto_ticket_url || extra.fotos.length > 0) && (
        <Tarjeta titulo="Fotos de la recepción">
          <div className="fotos">
            {extra.foto_ticket_url && <VerFoto ruta={extra.foto_ticket_url} />}
            {extra.fotos.map((f) => <VerFoto key={f} ruta={f} />)}
          </div>
        </Tarjeta>
      )}

      <Tarjeta titulo="Calidad">
        {inspecciones.length === 0 && <div className="texto-suave">Todavía no se ha revisado.</div>}
        {inspecciones.map((i) => (
          <div key={i.id} className="asignacion">
            <div><Estado valor={i.resultado} /> · {personas.get(i.inspector_id)?.nombre} · {fechaHora(i.fecha)}</div>
            {Object.keys(i.revision).length > 0 && (
              <div className="texto-suave">
                {Object.entries(i.revision).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v ? 'sí' : 'no'}`).join(' · ')}
              </div>
            )}
            {i.observaciones && <div>{i.observaciones}</div>}
            {i.fotos.length > 0 && <div className="fotos">{i.fotos.map((f) => <VerFoto key={f} ruta={f} />)}</div>}
          </div>
        ))}
      </Tarjeta>

      <Tarjeta titulo={esPT ? 'Trazabilidad: materia prima usada' : 'Trazabilidad: dónde se usó'}>
        {consumos.length === 0 && <div className="texto-suave">{esPT ? 'Sin consumos registrados.' : 'Todavía no se ha usado en producción.'}</div>}
        {consumos.map((c) => (
          <div key={`${c.orden_produccion_id}-${c.lote_mp_id}`} className="asignacion">
            {esPT ? (
              <><Link to={`/lotes/${c.lote_mp_id}`}>{c.lote_mp}</Link> · {c.item} · {num(c.cantidad_recibida)} {c.unidad}</>
            ) : (
              <>{num(c.cantidad_recibida)} {c.unidad} en <Link to={`/produccion/${c.orden_produccion_id}`}>{c.op_numero}</Link>
                {c.lote_pt_id && <> → <Link to={`/lotes/${c.lote_pt_id}`}>{c.lote_pt}</Link></>}</>
            )}
            <div className="texto-suave">Recibió {c.recibido_por} · {fechaHora(c.recibida_en)}</div>
          </div>
        ))}
      </Tarjeta>

      {esPT && (
        <Tarjeta titulo="Trazabilidad: a qué clientes llegó">
          {clientes.length === 0 && <div className="texto-suave">Todavía no se ha entregado a ningún cliente.</div>}
          {clientes.map((c) => (
            <div key={c.orden_id} className="asignacion">
              <strong>{c.cliente}</strong> · {num(c.sacos)} sacos · <Link to={`/ventas/${c.venta_id}`}>{c.venta}</Link>
              <div className="texto-suave">Recibió {c.recibido_por_nombre} · {fechaHora(c.recibida_en)}</div>
            </div>
          ))}
        </Tarjeta>
      )}

      {costo && (
        <Tarjeta titulo="Costo">
          <Fila izquierda={esPT ? 'Costo por saco' : `Costo por ${lote.unidad}`} derecha={<strong>{cordobas(costo.costo_unitario)}</strong>} />
          {costo.costo_total !== null && (
            <>
              <Fila izquierda="Materia prima usada" derecha={cordobas(costo.costo_materia_prima)} />
              <Fila izquierda="Gastos de planta" derecha={cordobas(costo.gasto_planta)} />
              <Fila izquierda="Costo total del lote" derecha={cordobas(costo.costo_total)} />
            </>
          )}
        </Tarjeta>
      )}

      <Tarjeta titulo="Kárdex">
        {kardex.length === 0 && <div className="texto-suave">Sin movimientos.</div>}
        {kardex.map((m) => (
          <div key={m.id} className="asignacion">
            <Fila izquierda={TIPO_MOV[m.tipo] ?? m.tipo} derecha={<strong>{m.cantidad > 0 ? '+' : ''}{num(m.cantidad)}</strong>} />
            <Fila izquierda={<span className="texto-suave">{fechaHora(m.fecha)} · {m.usuario} · {m.referencia}</span>} derecha={`Saldo ${num(m.saldo_lote)}`} />
            {m.nota && <div className="texto-suave">{m.nota}</div>}
          </div>
        ))}
      </Tarjeta>
    </Pantalla>
  )
}
