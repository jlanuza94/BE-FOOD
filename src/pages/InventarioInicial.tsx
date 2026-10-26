import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { cordobas, fecha, fechaHora, num } from '../lib/formato'
import { Boton, Campo, Cargando, Entrada, Estado, Fila, MensajeError, Nota, Pantalla, Selector, Tarjeta, Texto, Vacio } from '../components/ui'
import { TomarFoto } from '../components/Fotos'
import { ContarLote, type PorContar } from './Conteos'

interface LoteInicial {
  id: number; codigo: string; item_id: number; item: string; tipo: string; unidad: string; ubicacion: string | null
  estado: string; cantidad: number; costo_unitario: number | null; valor: number | null; fecha_caducidad: string | null
}

// ---------------------------------------------------------------------
// Inventario inicial: lo que ya había en bodega al empezar
// ---------------------------------------------------------------------
export function InventarioInicial() {
  const { puede, perfil, items, ubicaciones } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    abierto: ((await leer(supabase.from('configuracion').select('valor').eq('clave', 'inventario_inicial_abierto'))) as { valor: number }[])[0]?.valor === 1,
    lotes: (await leer(supabase.from('inventario_inicial').select('*').order('id', { ascending: false }))) as LoteInicial[],
  }))
  const vacio = { item: '', cantidad: '', ubicacion: '', costo: '', vence: '', loteProveedor: '', liberado: true }
  const [f, setF] = useState(vacio)
  const [fotos, setFotos] = useState<string[]>([])
  const [cerrar, setCerrar] = useState(false)
  const { ocupado, error: errorAccion, correr } = useAccion()
  const item = items.get(Number(f.item))
  const total = (datos?.lotes ?? []).reduce((s, l) => s + Number(l.valor ?? 0), 0)

  return (
    <Pantalla titulo="Inventario inicial" atras>
      <Cargando cargando={cargando && !datos} error={error} />
      {datos && !datos.abierto && <Nota>La carga ya se cerró. Lo que entra ahora va por compras o por producción.</Nota>}
      {datos?.abierto && puede('inventario') && (
        <Tarjeta titulo="Agregar lo que hay en bodega">
          <Nota>Un renglón por lote: cada saco o montón que tenga su propia fecha. Al terminar, Gerencia cierra la carga.</Nota>
          <Campo etiqueta="Producto">
            <Selector value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })}>
              <option value="">Elija…</option>
              {[...items.values()].filter((i) => i.activo).map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta={`Cantidad${item ? ` (${item.unidad})` : ''}`}>
            <Entrada type="number" inputMode="decimal" value={f.cantidad} onChange={(e) => setF({ ...f, cantidad: e.target.value })} />
          </Campo>
          <Campo etiqueta="Dónde está">
            <Selector value={f.ubicacion} onChange={(e) => setF({ ...f, ubicacion: e.target.value })}>
              <option value="">Elija…</option>
              {[...ubicaciones.values()].map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta={`Costo por ${item?.unidad ?? 'unidad'} (C$)`} ayuda="Lo que se pagó la última vez. Sirve para el costo por saco y la utilidad.">
            <Entrada type="number" inputMode="decimal" value={f.costo} onChange={(e) => setF({ ...f, costo: e.target.value })} />
          </Campo>
          <Campo etiqueta="Vence (opcional)" ayuda={item?.vida_util_dias ? `Si la deja vacía: hoy más ${item.vida_util_dias} días.` : undefined}>
            <Entrada type="date" value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} />
          </Campo>
          {item && item.tipo !== 'producto_terminado' && item.tipo !== 'repuesto' && (
            <>
              <Campo etiqueta="Lote del proveedor (opcional)"><Entrada value={f.loteProveedor} onChange={(e) => setF({ ...f, loteProveedor: e.target.value })} /></Campo>
              <label className="casilla">
                <input type="checkbox" checked={f.liberado} onChange={(e) => setF({ ...f, liberado: e.target.checked })} />
                Ya se está usando (si no, pasa a Calidad)
              </label>
            </>
          )}
          <TomarFoto carpeta="inventario-inicial" etiqueta="Foto (opcional)" fotos={fotos} onCambio={(x) => setFotos(x.slice(-1))} />
          <MensajeError mensaje={errorAccion} />
          <Boton ocupado={ocupado} onClick={() => correr(() => rpc('cargar_inventario_inicial', {
            p_item_id: Number(f.item) || null, p_cantidad: Number(f.cantidad), p_ubicacion_id: Number(f.ubicacion) || null,
            p_costo_unitario: f.costo === '' ? null : Number(f.costo), p_fecha_caducidad: f.vence || null,
            p_lote_proveedor: f.loteProveedor || null, p_liberado: f.liberado, p_foto_url: fotos[0] ?? null,
          })).then((ok) => { if (ok) { setF({ ...vacio, ubicacion: f.ubicacion }); setFotos([]); recargar() } })}>Agregar lote</Boton>
        </Tarjeta>
      )}

      {datos && (
        <>
          <div className="cifras">
            <div className="cifra"><div className="texto-suave">Lotes cargados</div><div className="cifra-valor">{datos.lotes.length}</div></div>
            <div className="cifra"><div className="texto-suave">Valor</div><div className="cifra-valor">{cordobas(total)}</div></div>
          </div>
          {datos.lotes.length === 0 && <Vacio>Todavía no se ha cargado nada.</Vacio>}
          {datos.lotes.map((l) => (
            <Tarjeta key={l.id} titulo={<><Link to={`/lotes/${l.id}`}>{l.codigo}</Link> <Estado valor={l.estado} /></>}>
              <Fila izquierda={l.item} derecha={`${num(l.cantidad)} ${l.unidad}`} />
              <div className="texto-suave">
                {l.ubicacion ?? 'Sin ubicación'}{l.costo_unitario !== null ? ` · ${cordobas(l.costo_unitario)} c/u · ${cordobas(l.valor)}` : ''}
                {l.fecha_caducidad ? ` · vence ${fecha(l.fecha_caducidad)}` : ''}
              </div>
            </Tarjeta>
          ))}
          {datos.abierto && perfil?.rol === 'gerencia' && datos.lotes.length > 0 && (cerrar ? (
            <Tarjeta titulo="¿Terminar la carga?">
              <div>Revise que esté todo. Después de cerrar ya no se puede agregar; lo que falte se corrige con un conteo. Si hace falta, se vuelve a abrir en Catálogos.</div>
              <Boton ocupado={ocupado} onClick={() => correr(() => rpc('cerrar_inventario_inicial')).then((ok) => { if (ok) recargar() })}>
                Sí, cerrar con {cordobas(total)}
              </Boton>
              <Boton variante="secundario" onClick={() => setCerrar(false)}>Todavía no</Boton>
            </Tarjeta>
          ) : <Boton variante="secundario" onClick={() => setCerrar(true)}>Terminar la carga</Boton>)}
        </>
      )}
    </Pantalla>
  )
}

// ---------------------------------------------------------------------
// Conteo general
// ---------------------------------------------------------------------
interface ConteoGeneral {
  id: number; numero: string; ubicacion_id: number | null; estado: string; nota: string | null
  abierto_por: string; abierto_en: string; cerrado_por: string | null; cerrado_en: string | null; motivo_anulacion: string | null
}
interface LoteConteo extends PorContar {
  sistema: number; conteo_id: number | null; contado: number | null; diferencia: number | null; estado: string | null; motivo: string | null
}

export function ConteosGenerales() {
  const { puede, ubicaciones } = useSesion()
  const navegar = useNavigate()
  const { datos, cargando, error } = useDatos(async () =>
    (await leer(supabase.from('conteos_generales').select('*').order('id', { ascending: false }).limit(30))) as ConteoGeneral[])
  const [ubicacion, setUbicacion] = useState('')
  const [nota, setNota] = useState('')
  const { ocupado, error: errorAccion, correr } = useAccion()
  const hayAbierto = datos?.some((c) => c.estado === 'abierto')
  return (
    <Pantalla titulo="Conteo general" atras>
      <Cargando cargando={cargando && !datos} error={error} />
      {datos && !hayAbierto && puede('inventario') && (
        <Tarjeta titulo="Empezar un conteo general">
          <Campo etiqueta="¿Qué se cuenta?">
            <Selector value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}>
              <option value="">Toda la bodega</option>
              {[...ubicaciones.values()].map((u) => <option key={u.id} value={u.id}>Solo {u.nombre}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Nota (opcional)"><Entrada value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. Cierre de octubre" /></Campo>
          <MensajeError mensaje={errorAccion} />
          <Boton ocupado={ocupado} onClick={() => correr(async () => {
            const id = await rpc<number>('abrir_conteo_general', { p_ubicacion_id: Number(ubicacion) || null, p_nota: nota || null })
            navegar(`/conteo-general/${id}`)
          })}>Empezar y avisar a Bodega</Boton>
        </Tarjeta>
      )}
      {datos?.length === 0 && <Vacio>No se ha hecho ningún conteo general.</Vacio>}
      {datos?.map((c) => (
        <Tarjeta key={c.id} a={`/conteo-general/${c.id}`} titulo={<>{c.numero} <Estado valor={c.estado} /></>}>
          <div>{c.ubicacion_id ? ubicaciones.get(c.ubicacion_id)?.nombre : 'Toda la bodega'}{c.nota ? ` · ${c.nota}` : ''}</div>
          <div className="texto-suave">{fechaHora(c.abierto_en)}</div>
        </Tarjeta>
      ))}
    </Pantalla>
  )
}

export function ConteoGeneralDetalle() {
  const id = Number(useParams().id)
  const { puede, perfil, personas, ubicaciones } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    g: (await leer(supabase.from('conteos_generales').select('*').eq('id', id).single())) as ConteoGeneral,
    lotes: ((await rpc<LoteConteo[]>('lotes_conteo_general', { p_conteo_general_id: id })) ?? []),
  }), [id])
  const [motivo, setMotivo] = useState('')
  const { ocupado, error: errorAccion, correr } = useAccion()
  if (!datos) return <Pantalla titulo="Conteo general" atras><Cargando cargando={cargando} error={error} /></Pantalla>
  const { g, lotes } = datos
  const abierto = g.estado === 'abierto'
  const porContar = lotes.filter((l) => l.conteo_id === null)
  const contados = lotes.filter((l) => l.conteo_id !== null)
  const conDiferencia = contados.filter((l) => Number(l.diferencia) !== 0)
  const pendientes = conDiferencia.filter((l) => l.estado === 'pendiente')
  const veDiferencias = puede('inventario') || !abierto
  const accion = (f: () => Promise<unknown>) => correr(f).then((ok) => { if (ok) recargar() })

  return (
    <Pantalla titulo={g.numero} atras>
      <Tarjeta titulo={<>{g.ubicacion_id ? ubicaciones.get(g.ubicacion_id)?.nombre : 'Toda la bodega'} <Estado valor={g.estado} /></>}>
        {g.nota && <div>{g.nota}</div>}
        <div className="texto-suave">Empezó {personas.get(g.abierto_por)?.nombre} · {fechaHora(g.abierto_en)}</div>
        {g.cerrado_en && <div className="texto-suave">{g.estado === 'anulado' ? 'Anuló' : 'Terminó'} {personas.get(g.cerrado_por ?? '')?.nombre} · {fechaHora(g.cerrado_en)}</div>}
        {g.motivo_anulacion && <div className="texto-error">Anulado: {g.motivo_anulacion}</div>}
      </Tarjeta>
      <div className="cifras">
        <div className="cifra"><div className="texto-suave">Contados</div><div className="cifra-valor">{contados.length} de {lotes.length}</div></div>
        {veDiferencias && <div className="cifra"><div className="texto-suave">Con diferencia</div><div className={`cifra-valor ${conDiferencia.length ? 'texto-error' : ''}`}>{conDiferencia.length}</div></div>}
      </div>
      <MensajeError mensaje={errorAccion} />

      {abierto && puede('bodeguero', 'inventario') && (
        <>
          <h2>Por contar</h2>
          <Nota>Cuente sin mirar el sistema. Si un lote ya no está, cuéntelo en 0 y explique.</Nota>
          {porContar.length === 0 && <Vacio>Ya se contó todo.</Vacio>}
          {porContar.map((l) => <ContarLote key={l.lote_id} lote={l} conteoGeneralId={id} alGuardar={recargar} />)}
        </>
      )}

      {abierto && puede('inventario') && (
        <Tarjeta titulo="Terminar">
          <Boton ocupado={ocupado} disabled={porContar.length > 0} onClick={() => accion(() => rpc('cerrar_conteo_general', { p_conteo_general_id: id }))}>
            {porContar.length > 0 ? `Faltan ${porContar.length} lotes` : 'Terminar y mandar a Gerencia'}
          </Boton>
          <Campo etiqueta="Si se empezó por error, ¿por qué?"><Texto value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
          <Boton variante="secundario" ocupado={ocupado} onClick={() => accion(() => rpc('anular_conteo_general', { p_conteo_general_id: id, p_motivo: motivo }))}>Anular conteo</Boton>
        </Tarjeta>
      )}

      {g.estado === 'cerrado' && perfil?.rol === 'gerencia' && pendientes.length > 0 && (
        <Tarjeta titulo={`${pendientes.length} ajuste${pendientes.length === 1 ? '' : 's'} por autorizar`}>
          <div className="texto-suave">Revise las diferencias abajo. También puede decidir uno por uno en Conteo cíclico.</div>
          <Boton ocupado={ocupado} onClick={() => accion(() => rpc('revisar_conteo_general', { p_conteo_general_id: id, p_aprobar: true }))}>Autorizar todos los ajustes</Boton>
          <Boton variante="secundario" ocupado={ocupado} onClick={() => accion(() => rpc('revisar_conteo_general', { p_conteo_general_id: id, p_aprobar: false }))}>No ajustar ninguno</Boton>
        </Tarjeta>
      )}

      {contados.length > 0 && <h2>Contados</h2>}
      {[...conDiferencia, ...contados.filter((l) => Number(l.diferencia) === 0)].map((l) => (
        <Tarjeta key={l.lote_id} titulo={<><Link to={`/lotes/${l.lote_id}`}>{l.codigo}</Link> {l.estado && <Estado valor={l.estado} />}</>}>
          <div className="texto-suave">{l.item} · {l.ubicacion ?? 'Sin ubicación'}</div>
          {veDiferencias
            ? <Fila izquierda="Sistema / contado" derecha={`${num(l.sistema)} / ${num(l.contado)} ${l.unidad}`} />
            : <Fila izquierda="Contado" derecha={`${num(l.contado)} ${l.unidad}`} />}
          {veDiferencias && Number(l.diferencia) !== 0 && <Fila izquierda="Diferencia" derecha={<strong className="texto-error">{num(l.diferencia)}</strong>} />}
          {l.motivo && <div>{l.motivo}</div>}
        </Tarjeta>
      ))}
    </Pantalla>
  )
}
