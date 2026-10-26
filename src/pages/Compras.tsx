import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { fechaHora, num } from '../lib/formato'
import type { OrdenCompra, OrdenCompraLinea } from '../lib/tipos'
import { Boton, Campo, Cargando, MensajeError, Estado, Fila, Pantalla, Selector, Tarjeta, Texto, Vacio } from '../components/ui'
import { EditarLineas, type LineaEditable } from '../components/Lineas'

export function Compras() {
  const { proveedores, puede } = useSesion()
  const { datos, cargando, error } = useDatos(
    async () => (await leer(supabase.from('ordenes_compra').select('*').order('id', { ascending: false }).limit(100))) as OrdenCompra[],
  )
  return (
    <Pantalla titulo="Compras" atras>
      {puede('inventario') && <Tarjeta a="/compras/nueva" titulo="+ Nueva orden de compra" />}
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.length === 0 && <Vacio>No hay órdenes de compra.</Vacio>}
      {datos?.map((o) => (
        <Tarjeta key={o.id} a={`/compras/${o.id}`} titulo={<>{o.numero} <Estado valor={o.estado} /></>}>
          <div className="texto-suave">{proveedores.get(o.proveedor_id)?.nombre} · {fechaHora(o.creada_en)}</div>
        </Tarjeta>
      ))}
    </Pantalla>
  )
}

export function CompraNueva() {
  const { proveedores, items } = useSesion()
  const navegar = useNavigate()
  const [proveedor, setProveedor] = useState('')
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState<LineaEditable[]>([{ item_id: '', cantidad: '' }])
  const { ocupado, error, correr } = useAccion()
  const comprables = [...items.values()].filter((i) => i.activo && i.tipo !== 'producto_terminado')

  async function guardar() {
    let nuevo = 0
    const ok = await correr(async () => {
      if (!proveedor) throw new Error('Elija el proveedor.')
      const validas = lineas.filter((l) => l.item_id && Number(l.cantidad) > 0)
      if (!validas.length) throw new Error('Agregue al menos un producto con cantidad.')
      nuevo = await rpc<number>('crear_orden_compra', {
        p_proveedor_id: Number(proveedor),
        p_lineas: validas.map((l) => ({ item_id: Number(l.item_id), cantidad: Number(l.cantidad), precio_unitario: l.precio ? Number(l.precio) : null })),
        p_notas: notas || null,
      })
    })
    if (ok) navegar(`/compras/${nuevo}`, { replace: true })
  }

  return (
    <Pantalla titulo="Nueva orden de compra" atras>
      <Campo etiqueta="Proveedor">
        <Selector value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
          <option value="">Elija…</option>
          {[...proveedores.values()].filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Selector>
      </Campo>
      <EditarLineas lineas={lineas} onCambio={setLineas} opciones={comprables} conPrecio
        etiquetaCantidad={(it) => `Cantidad${it ? ` (${it.unidad})` : ''}`} />
      <Campo etiqueta="Notas">
        <Texto value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Campo>
      <MensajeError mensaje={error} />
      <Boton onClick={guardar} ocupado={ocupado}>Enviar a Gerencia para aprobar</Boton>
    </Pantalla>
  )
}

export function CompraDetalle() {
  const id = Number(useParams().id)
  const { proveedores, items, personas, puede, perfil } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    oc: (await leer(supabase.from('ordenes_compra').select('*').eq('id', id).single())) as OrdenCompra,
    lineas: (await leer(supabase.from('ordenes_compra_lineas').select('*').eq('orden_compra_id', id).order('id'))) as OrdenCompraLinea[],
  }), [id])
  const [motivo, setMotivo] = useState('')
  const [anulando, setAnulando] = useState(false)
  const { ocupado, error: errorAccion, correr } = useAccion()

  if (!datos) return <Pantalla titulo="Orden de compra" atras><Cargando cargando={cargando} error={error} /></Pantalla>
  const { oc, lineas } = datos
  const total = lineas.reduce((s, l) => s + Number(l.cantidad) * Number(l.precio_unitario ?? 0), 0)

  return (
    <Pantalla titulo={oc.numero} atras>
      <Tarjeta titulo={<>{proveedores.get(oc.proveedor_id)?.nombre} <Estado valor={oc.estado} /></>}>
        <div className="texto-suave">Pedida por {personas.get(oc.creada_por)?.nombre} · {fechaHora(oc.creada_en)}</div>
        {oc.aprobada_por && <div className="texto-suave">Aprobada por {personas.get(oc.aprobada_por)?.nombre} · {fechaHora(oc.aprobada_en)}</div>}
        {oc.notas && <div>{oc.notas}</div>}
      </Tarjeta>
      <Tarjeta titulo="Productos">
        {lineas.map((l) => {
          const it = items.get(l.item_id)
          return (
            <div key={l.id} className="asignacion">
              <Fila izquierda={it?.nombre} derecha={`${num(l.cantidad)} ${it?.unidad}`} />
              <Fila izquierda={<span className="texto-suave">Recibido {num(l.cantidad_recibida)}</span>}
                derecha={l.precio_unitario !== null ? `C$ ${num(l.precio_unitario)} c/u` : ''} />
            </div>
          )
        })}
        {total > 0 && <Fila izquierda={<strong>Total</strong>} derecha={<strong>C$ {num(total)}</strong>} />}
      </Tarjeta>
      <MensajeError mensaje={errorAccion} />
      {oc.estado === 'pendiente' && perfil?.rol === 'gerencia' && (
        <Boton ocupado={ocupado} onClick={() => correr(() => rpc('aprobar_orden_compra', { p_id: id })).then((ok) => { if (ok) recargar() })}>
          Aprobar compra
        </Boton>
      )}
      {(oc.estado === 'pendiente' || oc.estado === 'aprobada') && puede('inventario') && !anulando && (
        <Boton variante="secundario" onClick={() => setAnulando(true)}>Anular</Boton>
      )}
      {anulando && (
        <Tarjeta titulo="Anular orden de compra">
          <Campo etiqueta="Motivo">
            <Texto value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Campo>
          <Boton variante="peligro" ocupado={ocupado}
            onClick={() => correr(() => rpc('anular_orden_compra', { p_id: id, p_motivo: motivo })).then((ok) => { if (ok) recargar() })}>
            Anular
          </Boton>
        </Tarjeta>
      )}
    </Pantalla>
  )
}
