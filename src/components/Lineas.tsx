import type { Item } from '../lib/tipos'
import { Boton, Entrada, Selector } from './ui'

export interface LineaEditable { item_id: string; cantidad: string; precio?: string }

/** Lista de productos con cantidad (y precio, si se pide) para órdenes y fórmulas. */
export function EditarLineas({ lineas, onCambio, opciones, etiquetaCantidad, conPrecio }: {
  lineas: LineaEditable[]
  onCambio: (l: LineaEditable[]) => void
  opciones: Item[]
  etiquetaCantidad: (it: Item | undefined) => string
  conPrecio?: boolean
}) {
  const cambiar = (i: number, cambio: Partial<LineaEditable>) =>
    onCambio(lineas.map((l, j) => (j === i ? { ...l, ...cambio } : l)))

  return (
    <div className="lineas">
      {lineas.map((l, i) => {
        const it = opciones.find((o) => String(o.id) === l.item_id)
        return (
          <div key={i} className="linea">
            <Selector value={l.item_id} onChange={(e) => cambiar(i, { item_id: e.target.value })}>
              <option value="">Producto…</option>
              {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </Selector>
            <div className="linea-numeros">
              <Entrada type="number" inputMode="decimal" placeholder={etiquetaCantidad(it)} aria-label={etiquetaCantidad(it)}
                value={l.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value })} />
              {conPrecio && (
                <Entrada type="number" inputMode="decimal" placeholder="Precio C$" aria-label="Precio por unidad"
                  value={l.precio ?? ''} onChange={(e) => cambiar(i, { precio: e.target.value })} />
              )}
              <button className="boton-quitar" onClick={() => onCambio(lineas.filter((_, j) => j !== i))} aria-label="Quitar">✕</button>
            </div>
          </div>
        )
      })}
      <Boton variante="secundario" onClick={() => onCambio([...lineas, { item_id: '', cantidad: '' }])}>+ Agregar producto</Boton>
    </div>
  )
}
