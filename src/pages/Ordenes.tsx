import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { fechaHora, num } from '../lib/formato'
import { TIPO_ORDEN, type Asignacion, type LoteInventario, type Orden, type OrdenLinea, type Rol } from '../lib/tipos'
import { Boton, Campo, Cargando, Entrada, MensajeError, Estado, Nota, Pantalla, Tarjeta, Texto, Vacio } from '../components/ui'

export function Ordenes() {
  const [filtro, setFiltro] = useState<'abiertas' | 'todas'>('abiertas')
  const { datos, cargando, error } = useDatos(async () => {
    let q = supabase.from('ordenes').select('*').order('id', { ascending: false }).limit(100)
    if (filtro === 'abiertas') q = q.in('estado', ['pedida', 'aprobada', 'entregada'])
    return (await leer(q)) as Orden[]
  }, [filtro])

  return (
    <Pantalla titulo="Órdenes">
      <div className="pestanas">
        <button className={filtro === 'abiertas' ? 'activa' : ''} onClick={() => setFiltro('abiertas')}>Abiertas</button>
        <button className={filtro === 'todas' ? 'activa' : ''} onClick={() => setFiltro('todas')}>Todas</button>
      </div>
      <Nota>Producción pide materia prima desde su orden de producción, en el menú Producción.</Nota>
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.length === 0 && <Vacio>No hay órdenes {filtro === 'abiertas' ? 'abiertas' : ''}.</Vacio>}
      {datos?.map((o) => (
        <Tarjeta key={o.id} a={`/ordenes/${o.id}`} titulo={<>{o.numero} <Estado valor={o.estado} /></>}>
          <div className="texto-suave">{TIPO_ORDEN[o.tipo]} · {fechaHora(o.pedida_en)}</div>
        </Tarjeta>
      ))}
    </Pantalla>
  )
}

interface Detalle {
  orden: Orden
  lineas: OrdenLinea[]
  asignaciones: Asignacion[]
  lotes: Map<number, LoteInventario>
  op: { id: number; numero: string } | null
}

// Quién hace cada paso según el tipo de orden (la base de datos lo vuelve a revisar).
const QUIEN: Record<Orden['tipo'], { aprueba: Rol[]; entrega: Rol[]; recibe: Rol[]; anula: Rol[] }> = {
  requisicion_mp: { aprueba: ['inventario'], entrega: ['bodeguero', 'inventario'], recibe: ['jefe_produccion'], anula: ['inventario'] },
  entrega_pt: { aprueba: ['bodeguero'], entrega: ['jefe_produccion'], recibe: ['bodeguero', 'inventario'], anula: ['bodeguero'] },
}

export function OrdenDetalle() {
  const id = Number(useParams().id)
  const { items, personas, puede, perfil } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async (): Promise<Detalle> => {
    const orden = (await leer(supabase.from('ordenes').select('*').eq('id', id).single())) as Orden
    const lineas = (await leer(supabase.from('ordenes_lineas').select('*').eq('orden_id', id).order('id'))) as OrdenLinea[]
    const asignaciones = lineas.length
      ? ((await leer(supabase.from('ordenes_asignaciones').select('*').in('orden_linea_id', lineas.map((l) => l.id)).order('id'))) as Asignacion[])
      : []
    const lotes = asignaciones.length
      ? ((await leer(supabase.from('inventario_lotes').select('*').in('id', asignaciones.map((a) => a.lote_id)))) as LoteInventario[])
      : []
    const op = orden.orden_produccion_id
      ? ((await leer(supabase.from('ordenes_produccion').select('id, numero').eq('id', orden.orden_produccion_id).single())) as { id: number; numero: string })
      : null
    return { orden, lineas, asignaciones, lotes: new Map(lotes.map((l) => [l.id, l])), op }
  }, [id])

  const [cantidades, setCantidades] = useState<Record<number, string>>({})
  const [motivos, setMotivos] = useState<Record<number, string>>({})
  const [motivoAnular, setMotivoAnular] = useState('')
  const [anulando, setAnulando] = useState(false)
  const { ocupado, error: errorAccion, correr } = useAccion()

  if (!datos) return <Pantalla titulo="Orden" atras><Cargando cargando={cargando} error={error} /></Pantalla>
  const { orden, lineas, asignaciones, lotes, op } = datos
  const quien = QUIEN[orden.tipo]
  const nombre = (uid: string | null) => (uid ? personas.get(uid)?.nombre ?? '—' : '—')
  const valor = (clave: number, porDefecto: number | null) => cantidades[clave] ?? String(porDefecto ?? '')

  const accion = (f: () => Promise<unknown>) =>
    correr(f).then((ok) => {
      if (ok) {
        setCantidades({})
        setMotivos({})
        recargar()
      }
    })

  const aprobar = () =>
    accion(() => rpc('aprobar_orden', {
      p_orden_id: id,
      p_lineas: lineas.map((l) => ({ linea_id: l.id, cantidad_aprobada: Number(valor(l.id, l.cantidad_pedida)) })),
    }))
  const entregar = () =>
    accion(() => rpc('entregar_orden', {
      p_orden_id: id,
      p_entregas: asignaciones.map((a) => ({ asignacion_id: a.id, cantidad: Number(valor(a.id, a.cantidad_asignada)) })),
    }))
  const recibir = () =>
    accion(() => rpc('recibir_orden', {
      p_orden_id: id,
      p_recepciones: asignaciones.map((a) => ({
        asignacion_id: a.id, cantidad: Number(valor(a.id, a.cantidad_entregada)), motivo: motivos[a.id] ?? null,
      })),
    }))
  const anular = () => accion(() => rpc('anular_orden', { p_orden_id: id, p_motivo: motivoAnular }))

  const paso = orden.estado
  const puedeAprobar = paso === 'pedida' && puede(...quien.aprueba)
  const puedeEntregar = paso === 'aprobada' && puede(...quien.entrega)
  const puedeRecibir = paso === 'entregada' && puede(...quien.recibe)
  const puedeAnular = (paso === 'pedida' || paso === 'aprobada') && (orden.pedida_por === perfil?.id || puede(...quien.anula))

  return (
    <Pantalla titulo={orden.numero} atras>
      <Tarjeta titulo={<>{TIPO_ORDEN[orden.tipo]} <Estado valor={orden.estado} /></>}>
        {op && <div>Producción: <Link to={`/produccion/${op.id}`}>{op.numero}</Link></div>}
        {orden.notas && <div className="texto-suave">{orden.notas}</div>}
        <ol className="pasos">
          <li className="hecho">Pedida · {nombre(orden.pedida_por)} · {fechaHora(orden.pedida_en)}</li>
          <li className={orden.aprobada_en ? 'hecho' : ''}>Aprobada · {nombre(orden.aprobada_por)} · {fechaHora(orden.aprobada_en)}</li>
          <li className={orden.entregada_en ? 'hecho' : ''}>Entregada · {nombre(orden.entregada_por)} · {fechaHora(orden.entregada_en)}</li>
          <li className={orden.recibida_en ? 'hecho' : ''}>Recibida · {nombre(orden.recibida_por)} · {fechaHora(orden.recibida_en)}</li>
        </ol>
        {orden.estado === 'anulada' && (
          <MensajeError mensaje={`Anulada por ${nombre(orden.anulada_por)} el ${fechaHora(orden.anulada_en)}: ${orden.motivo_anulacion}`} />
        )}
      </Tarjeta>

      {lineas.map((l) => {
        const it = items.get(l.item_id)
        const u = it?.unidad ?? ''
        const suyas = asignaciones.filter((a) => a.orden_linea_id === l.id)
        return (
          <Tarjeta key={l.id} titulo={it?.nombre}>
            <table className="tabla">
              <tbody>
                <tr><td>1. Pedida</td><td className="num">{num(l.cantidad_pedida)} {u}</td></tr>
                <tr>
                  <td>2. Aprobada</td>
                  <td className="num">
                    {puedeAprobar ? (
                      <Entrada type="number" inputMode="decimal" min={0} max={l.cantidad_pedida}
                        value={valor(l.id, l.cantidad_pedida)}
                        onChange={(e) => setCantidades({ ...cantidades, [l.id]: e.target.value })} />
                    ) : <>{num(l.cantidad_aprobada)} {u}</>}
                  </td>
                </tr>
              </tbody>
            </table>
            {suyas.map((a) => {
              const lote = lotes.get(a.lote_id)
              const recibido = Number(valor(a.id, a.cantidad_entregada))
              const hayDiferencia = puedeRecibir && recibido !== Number(a.cantidad_entregada)
              return (
                <div key={a.id} className="asignacion">
                  <div>
                    Lote <Link to={`/lotes/${a.lote_id}`}>{lote?.codigo}</Link>
                    {lote?.ubicacion && <> · {lote.ubicacion}</>}
                  </div>
                  <table className="tabla">
                    <tbody>
                      <tr><td>Aprobado de este lote</td><td className="num">{num(a.cantidad_asignada)} {u}</td></tr>
                      <tr>
                        <td>3. Entregada</td>
                        <td className="num">
                          {puedeEntregar ? (
                            <Entrada type="number" inputMode="decimal" min={0} max={a.cantidad_asignada}
                              value={valor(a.id, a.cantidad_asignada)}
                              onChange={(e) => setCantidades({ ...cantidades, [a.id]: e.target.value })} />
                          ) : <>{num(a.cantidad_entregada)} {u}</>}
                        </td>
                      </tr>
                      <tr>
                        <td>4. Recibida</td>
                        <td className="num">
                          {puedeRecibir ? (
                            <Entrada type="number" inputMode="decimal" min={0} max={a.cantidad_entregada ?? 0}
                              value={valor(a.id, a.cantidad_entregada)}
                              onChange={(e) => setCantidades({ ...cantidades, [a.id]: e.target.value })} />
                          ) : <>{num(a.cantidad_recibida)} {u}</>}
                        </td>
                      </tr>
                      {a.cantidad_recibida !== null && Number(a.cantidad_recibida) !== Number(a.cantidad_entregada) && (
                        <tr className="diferencia">
                          <td>Diferencia</td>
                          <td className="num">{num(Number(a.cantidad_entregada) - Number(a.cantidad_recibida))} {u} · {a.motivo_diferencia}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {hayDiferencia && (
                    <Campo etiqueta="Motivo de la diferencia (obligatorio)">
                      <Texto value={motivos[a.id] ?? ''} onChange={(e) => setMotivos({ ...motivos, [a.id]: e.target.value })} />
                    </Campo>
                  )}
                </div>
              )
            })}
          </Tarjeta>
        )
      })}

      <MensajeError mensaje={errorAccion} />
      {puedeAprobar && (
        <>
          <Nota>Al aprobar, la app aparta los lotes que vencen o entraron primero (FEFO/FIFO).</Nota>
          <Boton onClick={aprobar} ocupado={ocupado}>Aprobar cantidades</Boton>
        </>
      )}
      {puedeEntregar && <Boton onClick={entregar} ocupado={ocupado}>Confirmar lo entregado</Boton>}
      {puedeRecibir && <Boton onClick={recibir} ocupado={ocupado}>Confirmar lo recibido</Boton>}
      {puedeAnular && !anulando && <Boton variante="secundario" onClick={() => setAnulando(true)}>Anular orden</Boton>}
      {anulando && (
        <Tarjeta titulo="Anular orden">
          <Campo etiqueta="Motivo (queda en el historial)">
            <Texto value={motivoAnular} onChange={(e) => setMotivoAnular(e.target.value)} />
          </Campo>
          <Boton variante="peligro" onClick={anular} ocupado={ocupado}>Anular</Boton>
        </Tarjeta>
      )}
    </Pantalla>
  )
}
