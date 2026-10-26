import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { fechaHora, num } from '../lib/formato'
import {
  ETAPAS, NOMBRE_ETAPA, TURNOS,
  type Asignacion, type Etapa, type Formula, type FormulaLinea, type Orden, type OrdenLinea, type OrdenProduccion, type Turno,
} from '../lib/tipos'
import { Boton, Campo, Cargando, Entrada, MensajeError, Estado, Fila, Nota, Pantalla, Selector, Tarjeta, Texto, Vacio } from '../components/ui'
import { Comentarios } from '../components/Comentarios'

export function Produccion() {
  const { items, puede } = useSesion()
  const { datos, cargando, error } = useDatos(async () => ({
    ops: (await leer(supabase.from('ordenes_produccion').select('*').order('id', { ascending: false }).limit(100))) as OrdenProduccion[],
    formulas: (await leer(supabase.from('formulas').select('*'))) as Formula[],
  }))
  return (
    <Pantalla titulo="Producción" atras>
      {puede('jefe_produccion') && <Tarjeta a="/produccion/nueva" titulo="+ Nueva orden de producción" />}
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.ops.length === 0 && <Vacio>No hay órdenes de producción.</Vacio>}
      {datos?.ops.map((op) => {
        const f = datos.formulas.find((x) => x.id === op.formula_id)
        return (
          <Tarjeta key={op.id} a={`/produccion/${op.id}`} titulo={<>{op.numero} <Estado valor={op.estado} /></>}>
            <div>{items.get(f?.producto_id ?? 0)?.nombre} · {op.sacos_producidos ?? op.sacos_planificados} sacos</div>
            <div className="texto-suave">Turno {TURNOS[op.turno]} · {fechaHora(op.creada_en)}</div>
          </Tarjeta>
        )
      })}
    </Pantalla>
  )
}

export function ProduccionNueva() {
  const { items } = useSesion()
  const navegar = useNavigate()
  const { datos } = useDatos(async () => ({
    formulas: (await leer(supabase.from('formulas').select('*').eq('activa', true))) as Formula[],
    lineas: (await leer(supabase.from('formulas_lineas').select('*'))) as FormulaLinea[],
  }))
  const [formula, setFormula] = useState('')
  const [sacos, setSacos] = useState('')
  const [turno, setTurno] = useState<Turno>('manana')
  const [notas, setNotas] = useState('')
  const { ocupado, error, correr } = useAccion()
  const lineas = (datos?.lineas ?? []).filter((l) => l.formula_id === Number(formula))

  async function guardar() {
    let nuevo = 0
    const ok = await correr(async () => {
      nuevo = await rpc<number>('crear_orden_produccion', {
        p_formula_id: Number(formula), p_sacos: Number(sacos), p_turno: turno, p_notas: notas || null,
      })
    })
    if (ok) navegar(`/produccion/${nuevo}`, { replace: true })
  }

  return (
    <Pantalla titulo="Nueva orden de producción" atras>
      <Campo etiqueta="Alimento">
        <Selector value={formula} onChange={(e) => setFormula(e.target.value)}>
          <option value="">Elija…</option>
          {datos?.formulas.map((f) => (
            <option key={f.id} value={f.id}>{items.get(f.producto_id)?.nombre} (versión {f.version})</option>
          ))}
        </Selector>
      </Campo>
      <Campo etiqueta="Sacos a producir">
        <Entrada type="number" inputMode="numeric" value={sacos} onChange={(e) => setSacos(e.target.value)} />
      </Campo>
      <Campo etiqueta="Turno">
        <Selector value={turno} onChange={(e) => setTurno(e.target.value as Turno)}>
          {Object.entries(TURNOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Selector>
      </Campo>
      {lineas.length > 0 && Number(sacos) > 0 && (
        <Tarjeta titulo="Materia prima que se va a necesitar">
          {lineas.map((l) => {
            const it = items.get(l.item_id)
            return <Fila key={l.id} izquierda={it?.nombre} derecha={`${num(Number(l.cantidad_por_saco) * Number(sacos))} ${it?.unidad}`} />
          })}
        </Tarjeta>
      )}
      <Campo etiqueta="Notas (por ejemplo, para qué pedido es)">
        <Texto value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Campo>
      <MensajeError mensaje={error} />
      <Boton onClick={guardar} ocupado={ocupado} disabled={!formula || !(Number(sacos) > 0)}>Enviar a Gerencia para aprobar</Boton>
    </Pantalla>
  )
}

interface Requerimiento { id: number; item_id: number; cantidad_formula: number; cantidad_extra: number; motivo_extra: string | null }
interface EtapaFila { id: number; etapa: Etapa; operador_id: string; turno: Turno; inicio: string; fin: string | null; observaciones: string | null }

export function ProduccionDetalle() {
  const id = Number(useParams().id)
  const { items, personas, ubicaciones, puede, perfil } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => {
    const op = (await leer(supabase.from('ordenes_produccion').select('*').eq('id', id).single())) as OrdenProduccion
    const formula = (await leer(supabase.from('formulas').select('*').eq('id', op.formula_id).single())) as Formula
    const reqs = (await leer(supabase.from('op_requerimientos').select('*').eq('orden_produccion_id', id).order('id'))) as Requerimiento[]
    const checklist = await leer(supabase.from('op_checklist').select('*').eq('orden_produccion_id', id).maybeSingle())
    const etapas = (await leer(supabase.from('op_etapas').select('*').eq('orden_produccion_id', id))) as EtapaFila[]
    const ordenes = (await leer(supabase.from('ordenes').select('*').eq('orden_produccion_id', id).order('id'))) as Orden[]
    const lineas = ordenes.length
      ? ((await leer(supabase.from('ordenes_lineas').select('*').in('orden_id', ordenes.map((o) => o.id)))) as OrdenLinea[])
      : []
    const asign = lineas.length
      ? ((await leer(supabase.from('ordenes_asignaciones').select('*').in('orden_linea_id', lineas.map((l) => l.id)))) as Asignacion[])
      : []
    const lotePT = op.lote_pt_id
      ? ((await leer(supabase.from('lotes').select('id, codigo, estado').eq('id', op.lote_pt_id).single())) as { id: number; codigo: string; estado: string })
      : null
    return { op, formula, reqs, checklist, etapas, ordenes, lineas, asign, lotePT }
  }, [id])

  const { ocupado, error: errorAccion, correr } = useAccion()
  const [turno, setTurno] = useState<Turno>('manana')
  const [obs, setObs] = useState('')
  const [revision, setRevision] = useState({ limpieza: false, formula_correcta: false, ingredientes_completos: false })
  const [pedido, setPedido] = useState<Record<number, string>>({})
  const [extra, setExtra] = useState({ item_id: '', cantidad: '', motivo: '' })
  const [cierre, setCierre] = useState({ sacos: '', ubicacion: '' })
  const [motivoAnular, setMotivoAnular] = useState('')
  const [abierto, setAbierto] = useState<'pedir' | 'extra' | 'anular' | null>(null)

  if (!datos) return <Pantalla titulo="Producción" atras><Cargando cargando={cargando} error={error} /></Pantalla>
  const { op, formula, reqs, checklist, etapas, ordenes, lineas, asign, lotePT } = datos
  const producto = items.get(formula.producto_id)

  const hacer = (f: () => Promise<unknown>) =>
    correr(f).then((ok) => {
      if (ok) {
        setObs('')
        setAbierto(null)
        setPedido({})
        recargar()
      }
    })

  // Lo pedido y lo recibido por ingrediente, sumando todas las órdenes de materia prima.
  const porItem = (itemId: number) => {
    const suyas = lineas.filter((l) => l.item_id === itemId && ordenes.find((o) => o.id === l.orden_id)?.estado !== 'anulada')
    const recibido = asign.filter((a) => suyas.some((l) => l.id === a.orden_linea_id)).reduce((s, a) => s + Number(a.cantidad_recibida ?? 0), 0)
    const pedidoTotal = suyas.reduce((s, l) => s + Number(l.cantidad_aprobada ?? l.cantidad_pedida), 0)
    return { recibido, pedido: pedidoTotal }
  }

  const activa = op.estado === 'aprobada' || op.estado === 'en_proceso'
  const enCurso = etapas.find((e) => !e.fin)
  const siguiente = ETAPAS.find((e) => !etapas.some((x) => x.etapa === e))
  const envasadoListo = etapas.some((e) => e.etapa === 'envasado' && e.fin)
  const operario = puede('jefe_produccion', 'operador')
  const esGerencia = perfil?.rol === 'gerencia'
  const rendimiento = op.sacos_producidos !== null ? (op.sacos_producidos / op.sacos_planificados) * 100 : null

  return (
    <Pantalla titulo={op.numero} atras>
      <Tarjeta titulo={<>{producto?.nombre} <Estado valor={op.estado} /></>}>
        <Fila izquierda="Fórmula" derecha={<Link to="/formulas">versión {formula.version}</Link>} />
        <Fila izquierda="Sacos planificados" derecha={op.sacos_planificados} />
        <Fila izquierda="Turno" derecha={TURNOS[op.turno]} />
        <div className="texto-suave">Pedida por {personas.get(op.creada_por)?.nombre} · {fechaHora(op.creada_en)}</div>
        {op.aprobada_por && <div className="texto-suave">Aprobada por {personas.get(op.aprobada_por)?.nombre} · {fechaHora(op.aprobada_en)}</div>}
        {op.notas && <div>{op.notas}</div>}
      </Tarjeta>

      <MensajeError mensaje={errorAccion} />

      {op.estado === 'pendiente' && esGerencia && (
        <Boton onClick={() => hacer(() => rpc('aprobar_orden_produccion', { p_op_id: id }))} ocupado={ocupado}>
          Aprobar producción
        </Boton>
      )}

      {op.estado === 'terminada' && (
        <Tarjeta titulo="Resultado">
          <Fila izquierda="Sacos que salieron" derecha={<strong>{op.sacos_producidos} de {op.sacos_planificados}</strong>} />
          <Fila izquierda="Rendimiento" derecha={`${num(rendimiento)} %`} />
          <Fila izquierda="Materia prima usada" derecha={`${num(op.materia_prima_lb)} lb`} />
          <Fila izquierda="Merma" derecha={<strong className={Number(op.merma_pct) > 1 ? 'texto-error' : ''}>{num(op.merma_lb)} lb · {num(op.merma_pct)} %</strong>} />
        </Tarjeta>
      )}

      {lotePT && (
        <Tarjeta a={`/lotes/${lotePT.id}`} titulo={<>Lote producido {lotePT.codigo} <Estado valor={lotePT.estado} /></>}>
          <div className="texto-suave">Ver trazabilidad y etiqueta</div>
        </Tarjeta>
      )}

      <Tarjeta titulo="Materia prima">
        <table className="tabla">
          <thead><tr><th>Ingrediente</th><th className="num">Fórmula</th><th className="num">Pedido</th><th className="num">Recibido</th></tr></thead>
          <tbody>
            {reqs.map((r) => {
              const it = items.get(r.item_id)
              const t = porItem(r.item_id)
              return (
                <tr key={r.id}>
                  <td>{it?.nombre}{Number(r.cantidad_extra) > 0 && <div className="texto-suave">+{num(r.cantidad_extra)} autorizado: {r.motivo_extra}</div>}</td>
                  <td className="num">{num(r.cantidad_formula)}</td>
                  <td className="num">{num(t.pedido)}</td>
                  <td className="num">{num(t.recibido)} {it?.unidad}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {ordenes.map((o) => (
          <Link key={o.id} to={`/ordenes/${o.id}`} className="enlace-fila">{o.numero} <Estado valor={o.estado} /></Link>
        ))}
      </Tarjeta>

      {activa && puede('jefe_produccion') && abierto !== 'pedir' && (
        <Boton variante="secundario" onClick={() => setAbierto('pedir')}>Pedir más materia prima</Boton>
      )}
      {abierto === 'pedir' && (
        <Tarjeta titulo="Pedir materia prima">
          <Nota>No se puede pedir más de lo que dice la fórmula sin permiso de Gerencia.</Nota>
          {reqs.map((r) => (
            <Campo key={r.id} etiqueta={`${items.get(r.item_id)?.nombre} (${items.get(r.item_id)?.unidad})`}>
              <Entrada type="number" inputMode="decimal" value={pedido[r.item_id] ?? ''}
                onChange={(e) => setPedido({ ...pedido, [r.item_id]: e.target.value })} />
            </Campo>
          ))}
          <Boton ocupado={ocupado} onClick={() => hacer(() => rpc('crear_requisicion', {
            p_op_id: id,
            p_lineas: Object.entries(pedido).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ item_id: Number(k), cantidad: Number(v) })),
          }))}>Enviar pedido a Inventario</Boton>
        </Tarjeta>
      )}

      {activa && esGerencia && abierto !== 'extra' && (
        <Boton variante="secundario" onClick={() => setAbierto('extra')}>Autorizar más o sustituir ingrediente</Boton>
      )}
      {abierto === 'extra' && (
        <Tarjeta titulo="Permiso especial de Gerencia">
          <Campo etiqueta="Ingrediente">
            <Selector value={extra.item_id} onChange={(e) => setExtra({ ...extra, item_id: e.target.value })}>
              <option value="">Elija…</option>
              {[...items.values()].filter((i) => i.activo && i.tipo !== 'producto_terminado').map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Cantidad extra">
            <Entrada type="number" inputMode="decimal" value={extra.cantidad} onChange={(e) => setExtra({ ...extra, cantidad: e.target.value })} />
          </Campo>
          <Campo etiqueta="Motivo (por ejemplo, sustituye maíz por sorgo)">
            <Texto value={extra.motivo} onChange={(e) => setExtra({ ...extra, motivo: e.target.value })} />
          </Campo>
          <Boton ocupado={ocupado} onClick={() => hacer(() => rpc('autorizar_extra', {
            p_op_id: id, p_item_id: Number(extra.item_id), p_cantidad: Number(extra.cantidad), p_motivo: extra.motivo,
          }))}>Autorizar</Boton>
        </Tarjeta>
      )}

      {op.estado !== 'pendiente' && op.estado !== 'anulada' && (
        <Tarjeta titulo="Lista de revisión antes de arrancar">
          {checklist ? (
            <div>✅ Limpieza, fórmula e ingredientes revisados por {personas.get((checklist as { registrado_por: string }).registrado_por)?.nombre}</div>
          ) : op.estado === 'aprobada' && operario ? (
            <>
              {([['limpieza', 'Limpieza hecha entre lotes'], ['formula_correcta', 'Fórmula correcta'], ['ingredientes_completos', 'Ingredientes completos']] as const).map(([k, t]) => (
                <label key={k} className="casilla">
                  <input type="checkbox" checked={revision[k]} onChange={(e) => setRevision({ ...revision, [k]: e.target.checked })} /> {t}
                </label>
              ))}
              <Boton ocupado={ocupado} onClick={() => hacer(() => rpc('registrar_checklist', {
                p_op_id: id, p_limpieza: revision.limpieza, p_formula_correcta: revision.formula_correcta,
                p_ingredientes_completos: revision.ingredientes_completos,
              }))}>Guardar revisión</Boton>
            </>
          ) : <div className="texto-suave">Pendiente</div>}
        </Tarjeta>
      )}

      {op.estado !== 'pendiente' && op.estado !== 'anulada' && (
        <Tarjeta titulo="Etapas">
          <ol className="pasos">
            {ETAPAS.map((e) => {
              const fila = etapas.find((x) => x.etapa === e)
              return (
                <li key={e} className={fila?.fin ? 'hecho' : fila ? 'en-curso' : ''}>
                  <strong>{NOMBRE_ETAPA[e]}</strong>
                  {fila && (
                    <div className="texto-suave">
                      {personas.get(fila.operador_id)?.nombre} · {TURNOS[fila.turno]} · {fechaHora(fila.inicio)} → {fila.fin ? fechaHora(fila.fin) : 'en curso'}
                      {fila.observaciones && <> · {fila.observaciones}</>}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
          {activa && operario && (enCurso || siguiente) && (
            <>
              {!enCurso && (
                <Campo etiqueta="Turno">
                  <Selector value={turno} onChange={(e) => setTurno(e.target.value as Turno)}>
                    {Object.entries(TURNOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Selector>
                </Campo>
              )}
              <Campo etiqueta="Observaciones">
                <Texto value={obs} onChange={(e) => setObs(e.target.value)} />
              </Campo>
              {enCurso ? (
                <Boton ocupado={ocupado} onClick={() => hacer(() => rpc('finalizar_etapa', { p_etapa_id: enCurso.id, p_observaciones: obs || null }))}>
                  Terminar {NOMBRE_ETAPA[enCurso.etapa]}
                </Boton>
              ) : (
                <Boton ocupado={ocupado} onClick={() => hacer(() => rpc('iniciar_etapa', { p_op_id: id, p_etapa: siguiente, p_turno: turno, p_observaciones: obs || null }))}>
                  Iniciar {NOMBRE_ETAPA[siguiente!]}
                </Boton>
              )}
            </>
          )}
        </Tarjeta>
      )}

      {op.estado === 'en_proceso' && envasadoListo && puede('jefe_produccion') && (
        <Tarjeta titulo="Cerrar producción">
          <Campo etiqueta="¿Cuántos sacos salieron?">
            <Entrada type="number" inputMode="numeric" value={cierre.sacos} onChange={(e) => setCierre({ ...cierre, sacos: e.target.value })} />
          </Campo>
          <Campo etiqueta="¿Dónde quedan los sacos?">
            <Selector value={cierre.ubicacion} onChange={(e) => setCierre({ ...cierre, ubicacion: e.target.value })}>
              <option value="">Elija…</option>
              {[...ubicaciones.values()].filter((u) => u.activa).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </Selector>
          </Campo>
          <Nota>La app calcula la merma y crea la orden para entregar los sacos a la bodega.</Nota>
          <Boton ocupado={ocupado} onClick={() => hacer(() => rpc('cerrar_orden_produccion', {
            p_op_id: id, p_sacos_producidos: Number(cierre.sacos), p_ubicacion_id: cierre.ubicacion ? Number(cierre.ubicacion) : null,
          }))}>Cerrar y entregar a bodega</Boton>
        </Tarjeta>
      )}

      {(op.estado === 'pendiente' || op.estado === 'aprobada') && (esGerencia || op.creada_por === perfil?.id) && abierto !== 'anular' && (
        <Boton variante="secundario" onClick={() => setAbierto('anular')}>Anular orden de producción</Boton>
      )}
      {abierto === 'anular' && (
        <Tarjeta titulo="Anular orden de producción">
          <Campo etiqueta="Motivo">
            <Texto value={motivoAnular} onChange={(e) => setMotivoAnular(e.target.value)} />
          </Campo>
          <Boton variante="peligro" ocupado={ocupado} onClick={() => hacer(() => rpc('anular_orden_produccion', { p_op_id: id, p_motivo: motivoAnular }))}>
            Anular
          </Boton>
        </Tarjeta>
      )}
      <Comentarios entidad="orden_produccion" id={id} />
    </Pantalla>
  )
}
