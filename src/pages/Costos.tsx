import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc } from '../lib/supabase'
import { useDatos } from '../lib/usar'
import { cordobas, num } from '../lib/formato'
import { Cargando, Fila, Nota, Pantalla, Tarjeta, Vacio } from '../components/ui'

interface CostoFormula {
  formula_id: number; producto_id: number; producto: string; version: number; costo_materia_prima: number
  gasto_planta: number; costo_total: number; precio_venta: number | null; ganancia: number | null; margen_pct: number | null
}
interface DetalleFormula { item: string; unidad: string; cantidad_por_saco: number; precio: number | null; costo: number }

export function Costos() {
  const { datos, cargando, error } = useDatos(() => rpc<CostoFormula[]>('reporte_costo_formulas'))
  return (
    <Pantalla titulo="Costo por saco" atras pdf="Costo por saco BE Food">
      <Nota>Se calcula con la fórmula, el precio promedio de compra de los últimos 90 días y los gastos de planta del último mes.</Nota>
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.length === 0 && <Vacio>Todavía no hay fórmulas.</Vacio>}
      {datos?.map((c) => <CostoDeFormula key={c.formula_id} c={c} />)}
    </Pantalla>
  )
}

function CostoDeFormula({ c }: { c: CostoFormula }) {
  const [abierto, setAbierto] = useState(false)
  const detalle = useDatos(async () => (abierto ? rpc<DetalleFormula[]>('reporte_detalle_formula', { p_formula_id: c.formula_id }) : []), [abierto])
  const sinPrecio = detalle.datos?.some((d) => d.precio === null)
  return (
    <Tarjeta titulo={`${c.producto} · versión ${c.version}`}>
      <Fila izquierda="Materia prima" derecha={cordobas(c.costo_materia_prima)} />
      <Fila izquierda="Gastos de planta" derecha={cordobas(c.gasto_planta)} />
      <Fila izquierda={<strong>Costo de un saco</strong>} derecha={<strong>{cordobas(c.costo_total)}</strong>} />
      <Fila izquierda="Precio de venta" derecha={c.precio_venta === null ? <Link to="/ajustes">Ponerlo</Link> : cordobas(c.precio_venta)} />
      {c.ganancia !== null && (
        <Fila izquierda={<strong>Ganancia por saco</strong>}
          derecha={<strong className={Number(c.ganancia) < 0 ? 'texto-error' : 'texto-verde'}>{cordobas(c.ganancia)} · {num(c.margen_pct)} %</strong>} />
      )}
      <button className="enlace" onClick={() => setAbierto(!abierto)}>{abierto ? 'Ocultar detalle' : 'Ver ingrediente por ingrediente'}</button>
      {abierto && detalle.datos?.map((d) => (
        <Fila key={d.item} izquierda={`${d.item} · ${num(d.cantidad_por_saco)} ${d.unidad} × ${d.precio === null ? 'sin precio' : cordobas(d.precio)}`}
          derecha={cordobas(d.costo)} />
      ))}
      {sinPrecio && <div className="texto-error">Hay ingredientes sin precio de compra: el costo sale más bajo de lo real.</div>}
    </Tarjeta>
  )
}
