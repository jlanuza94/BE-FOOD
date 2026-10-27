import { useState } from 'react'
import { rpc } from '../lib/supabase'
import { useDatos } from '../lib/usar'
import { cordobas, num } from '../lib/formato'
import { CATEGORIAS_GASTO } from '../lib/tipos'
import { Cargando, Fila, Nota, Pantalla, Tarjeta } from '../components/ui'

interface Reporte {
  ventas: number; sacos: number; costo_ventas: number; ganancia_ventas: number; gastos_fuera_del_costo: number
  gastos_de_planta: number; utilidad: number; cobrado: number; por_cobrar: number; lineas_sin_costo: number
  por_producto: { producto: string; sacos: number; ventas: number; costo: number; ganancia: number; ganancia_por_saco: number }[]
  por_cliente: { cliente: string; sacos: number; ventas: number; costo: number; ganancia: number; margen_pct: number }[]
  gastos_por_categoria: { categoria: string; monto: number }[]
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
function periodo(p: 'hoy' | 'mes' | 'anterior' | 'anio'): [string, string] {
  const h = new Date()
  if (p === 'hoy') return [iso(h), iso(h)]
  if (p === 'mes') return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(h)]
  if (p === 'anterior') return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth(), 0))]
  return [iso(new Date(h.getFullYear(), 0, 1)), iso(h)]
}

export function Utilidad() {
  const [p, setP] = useState<'hoy' | 'mes' | 'anterior' | 'anio'>('mes')
  const [desde, hasta] = periodo(p)
  const { datos: r, cargando, error } = useDatos(() => rpc<Reporte>('reporte_utilidad', { p_desde: desde, p_hasta: hasta }), [desde, hasta])

  return (
    <Pantalla titulo="Utilidad" atras pdf="Utilidad BE Food">
      <div className="pestanas">
        {([['hoy', 'Hoy'], ['mes', 'Este mes'], ['anterior', 'Mes pasado'], ['anio', 'Este año']] as const).map(([k, t]) => (
          <button key={k} className={p === k ? 'activa' : ''} onClick={() => setP(k)}>{t}</button>
        ))}
      </div>
      <Cargando cargando={cargando && !r} error={error} />
      {r && (
        <>
          <div className="cifras">
            <div className="cifra cifra-grande">
              <div className="texto-suave">Utilidad</div>
              <div className="cifra-valor">{cordobas(r.utilidad)}</div>
            </div>
            <div className="cifra"><div className="texto-suave">Ventas</div><div className="cifra-valor">{cordobas(r.ventas)}</div></div>
            <div className="cifra"><div className="texto-suave">Sacos vendidos</div><div className="cifra-valor">{num(r.sacos)}</div></div>
            <div className="cifra"><div className="texto-suave">Cobrado</div><div className="cifra-valor">{cordobas(r.cobrado)}</div></div>
            <div className="cifra"><div className="texto-suave">Por cobrar (todo)</div><div className="cifra-valor">{cordobas(r.por_cobrar)}</div></div>
          </div>
          <Tarjeta titulo="Cómo sale la utilidad">
            <Fila izquierda="Ventas" derecha={cordobas(r.ventas)} />
            <Fila izquierda="Menos: lo que costó hacer esos sacos" derecha={`− ${cordobas(r.costo_ventas)}`} />
            <Fila izquierda={<strong>Ganancia de las ventas</strong>} derecha={<strong>{cordobas(r.ganancia_ventas)}</strong>} />
            <Fila izquierda="Menos: gastos fuera del costo del saco" derecha={`− ${cordobas(r.gastos_fuera_del_costo)}`} />
            <Fila izquierda={<strong>Utilidad</strong>} derecha={<strong className={Number(r.utilidad) < 0 ? 'texto-error' : 'texto-verde'}>{cordobas(r.utilidad)}</strong>} />
            <div className="texto-suave">Los gastos de planta ({cordobas(r.gastos_de_planta)}) ya van dentro del costo de cada saco.</div>
          </Tarjeta>
          {r.lineas_sin_costo > 0 && <Nota>Hay ventas de lotes sin costo calculado (producidos antes de anotar precios). Su costo cuenta como cero.</Nota>}
          {r.por_producto.length > 0 && (
            <Tarjeta titulo="Por alimento">
              {r.por_producto.map((x) => (
                <div key={x.producto} className="asignacion">
                  <Fila izquierda={<strong>{x.producto}</strong>} derecha={<strong>{cordobas(x.ganancia)}</strong>} />
                  <div className="texto-suave">{num(x.sacos)} sacos · {cordobas(x.ganancia_por_saco)} por saco</div>
                </div>
              ))}
            </Tarjeta>
          )}
          {r.por_cliente.length > 0 && (
            <Tarjeta titulo="Por cliente">
              {r.por_cliente.map((x) => (
                <div key={x.cliente} className="asignacion">
                  <Fila izquierda={<strong>{x.cliente}</strong>} derecha={<strong>{cordobas(x.ganancia)}</strong>} />
                  <div className="texto-suave">{num(x.sacos)} sacos · ventas {cordobas(x.ventas)} · margen {num(x.margen_pct)} %</div>
                </div>
              ))}
            </Tarjeta>
          )}
          {r.gastos_por_categoria.length > 0 && (
            <Tarjeta titulo="Gastos">
              {r.gastos_por_categoria.map((g) => <Fila key={g.categoria} izquierda={CATEGORIAS_GASTO[g.categoria]} derecha={cordobas(g.monto)} />)}
            </Tarjeta>
          )}
        </>
      )}
    </Pantalla>
  )
}
