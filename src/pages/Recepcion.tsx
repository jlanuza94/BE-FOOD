import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { num } from '../lib/formato'
import type { OrdenCompra, OrdenCompraLinea } from '../lib/tipos'
import { Boton, Campo, Cargando, Entrada, MensajeError, Nota, Pantalla, Selector, Tarjeta, Vacio } from '../components/ui'
import { TomarFoto } from '../components/Fotos'

export function Recepcion() {
  const { items, proveedores, ubicaciones } = useSesion()
  const navegar = useNavigate()
  const { datos, cargando, error } = useDatos(async () => {
    const ocs = (await leer(supabase.from('ordenes_compra').select('*').eq('estado', 'aprobada').order('id'))) as OrdenCompra[]
    const lineas = ocs.length
      ? ((await leer(supabase.from('ordenes_compra_lineas').select('*').in('orden_compra_id', ocs.map((o) => o.id)).order('id'))) as OrdenCompraLinea[])
      : []
    return { ocs, lineas: lineas.filter((l) => Number(l.cantidad_recibida) < Number(l.cantidad)) }
  })

  const [linea, setLinea] = useState<OrdenCompraLinea | null>(null)
  const [peso, setPeso] = useState('')
  const [ubicacion, setUbicacion] = useState('')
  const [loteProveedor, setLoteProveedor] = useState('')
  const [caducidad, setCaducidad] = useState('')
  const [ticket, setTicket] = useState<string[]>([])
  const [fotos, setFotos] = useState<string[]>([])
  const { ocupado, error: errorAccion, correr } = useAccion()

  async function guardar() {
    let loteId = 0
    const ok = await correr(async () => {
      loteId = await rpc<number>('recibir_materia_prima', {
        p_oc_linea_id: linea!.id,
        p_cantidad: Number(peso),
        p_ubicacion_id: ubicacion ? Number(ubicacion) : null,
        p_foto_ticket_url: ticket[0] ?? null,
        p_lote_proveedor: loteProveedor || null,
        p_fecha_caducidad: caducidad || null,
        p_fotos: fotos,
      })
    })
    if (ok) navegar(`/lotes/${loteId}`)
  }

  if (linea) {
    const it = items.get(linea.item_id)
    const oc = datos?.ocs.find((o) => o.id === linea.orden_compra_id)
    return (
      <Pantalla titulo="Recibir materia prima" atras>
        <Tarjeta titulo={it?.nombre}>
          <div className="texto-suave">
            {oc?.numero} · {proveedores.get(oc?.proveedor_id ?? 0)?.nombre} · pendiente {num(Number(linea.cantidad) - Number(linea.cantidad_recibida))} {it?.unidad}
          </div>
        </Tarjeta>
        <Campo etiqueta={`Peso en la báscula (${it?.unidad})`}>
          <Entrada type="number" inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} />
        </Campo>
        <TomarFoto carpeta="recepcion" etiqueta="Foto del ticket o pantalla de la báscula (obligatoria)"
          fotos={ticket} onCambio={(f) => setTicket(f.slice(-1))} />
        <Campo etiqueta="¿Dónde se guarda?">
          <Selector value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}>
            <option value="">Elija…</option>
            {[...ubicaciones.values()].filter((u) => u.activa).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Lote del proveedor (si trae)">
          <Entrada value={loteProveedor} onChange={(e) => setLoteProveedor(e.target.value)} />
        </Campo>
        <Campo etiqueta="Fecha de vencimiento" ayuda={it?.vida_util_dias ? `Si no la pone, se calcula: ${it.vida_util_dias} días desde hoy.` : undefined}>
          <Entrada type="date" value={caducidad} onChange={(e) => setCaducidad(e.target.value)} />
        </Campo>
        <TomarFoto carpeta="recepcion" etiqueta="Fotos de la carga" fotos={fotos} onCambio={setFotos} />
        <Nota>El lote queda EN CUARENTENA hasta que Calidad lo revise.</Nota>
        <MensajeError mensaje={errorAccion} />
        <Boton onClick={guardar} ocupado={ocupado}>Registrar y crear lote</Boton>
        <Boton variante="secundario" onClick={() => setLinea(null)}>Cancelar</Boton>
      </Pantalla>
    )
  }

  return (
    <Pantalla titulo="Recibir materia prima" atras>
      <Nota>Sin orden de compra aprobada no se recibe. Elija qué llegó:</Nota>
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.lineas.length === 0 && <Vacio>No hay compras aprobadas pendientes de recibir.</Vacio>}
      {datos?.lineas.map((l) => {
        const oc = datos.ocs.find((o) => o.id === l.orden_compra_id)!
        const it = items.get(l.item_id)
        return (
          <Tarjeta key={l.id} titulo={it?.nombre}>
            <div className="texto-suave">
              {oc.numero} · {proveedores.get(oc.proveedor_id)?.nombre} · faltan {num(Number(l.cantidad) - Number(l.cantidad_recibida))} de {num(l.cantidad)} {it?.unidad}
            </div>
            <Boton variante="secundario" onClick={() => setLinea(l)}>Recibir</Boton>
          </Tarjeta>
        )
      })}
    </Pantalla>
  )
}
