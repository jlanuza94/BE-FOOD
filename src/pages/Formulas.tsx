import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { fecha, num } from '../lib/formato'
import type { Formula, FormulaLinea } from '../lib/tipos'
import { Boton, Campo, Cargando, MensajeError, Fila, Nota, Pantalla, Selector, Tarjeta, Texto, Vacio } from '../components/ui'
import { EditarLineas, type LineaEditable } from '../components/Lineas'

export function Formulas() {
  const { items, personas, perfil } = useSesion()
  const { datos, cargando, error } = useDatos(async () => ({
    formulas: (await leer(supabase.from('formulas').select('*').order('version', { ascending: false }))) as Formula[],
    lineas: (await leer(supabase.from('formulas_lineas').select('*'))) as FormulaLinea[],
  }))
  const [verHistorial, setVerHistorial] = useState(false)

  const lista = (datos?.formulas ?? []).filter((f) => verHistorial || f.activa)
  return (
    <Pantalla titulo="Fórmulas" atras>
      {perfil?.rol === 'gerencia' && <Tarjeta a="/formulas/nueva" titulo="+ Nueva fórmula o nueva versión" />}
      <Nota>Una fórmula nunca se edita: se crea una versión nueva y los lotes viejos guardan la versión que usaron.</Nota>
      <label className="casilla">
        <input type="checkbox" checked={verHistorial} onChange={(e) => setVerHistorial(e.target.checked)} /> Ver versiones anteriores
      </label>
      <Cargando cargando={cargando && !datos} error={error} />
      {datos && lista.length === 0 && <Vacio>Todavía no hay fórmulas.</Vacio>}
      {lista.map((f) => {
        const suyas = datos!.lineas.filter((l) => l.formula_id === f.id)
        const totalLb = suyas.filter((l) => items.get(l.item_id)?.unidad === 'lb').reduce((s, l) => s + Number(l.cantidad_por_saco), 0)
        return (
          <Tarjeta key={f.id} titulo={`${items.get(f.producto_id)?.nombre} · versión ${f.version}${f.activa ? '' : ' (anterior)'}`}>
            {suyas.map((l) => {
              const it = items.get(l.item_id)
              return <Fila key={l.id} izquierda={it?.nombre} derecha={`${num(l.cantidad_por_saco)} ${it?.unidad} por saco`} />
            })}
            <Fila izquierda={<strong>Total por saco</strong>} derecha={<strong>{num(totalLb)} lb</strong>} />
            <div className="texto-suave">{personas.get(f.creada_por)?.nombre} · {fecha(f.creada_en)}{f.notas ? ` · ${f.notas}` : ''}</div>
          </Tarjeta>
        )
      })}
    </Pantalla>
  )
}

export function FormulaNueva() {
  const { items } = useSesion()
  const navegar = useNavigate()
  const [params] = useSearchParams()
  const [producto, setProducto] = useState(params.get('producto') ?? '')
  const [lineas, setLineas] = useState<LineaEditable[]>([{ item_id: '', cantidad: '' }])
  const [notas, setNotas] = useState('')
  const { ocupado, error, correr } = useAccion()
  const productos = [...items.values()].filter((i) => i.activo && i.tipo === 'producto_terminado')
  const ingredientes = [...items.values()].filter((i) => i.activo && i.tipo !== 'producto_terminado')
  const peso = items.get(Number(producto))?.peso_saco_lb
  const totalLb = lineas.filter((l) => items.get(Number(l.item_id))?.unidad === 'lb').reduce((s, l) => s + Number(l.cantidad || 0), 0)

  // Al elegir el producto se copia la versión activa para cambiar solo lo necesario.
  async function elegirProducto(id: string) {
    setProducto(id)
    if (!id) return
    const activa = (await leer(supabase.from('formulas').select('id').eq('producto_id', Number(id)).eq('activa', true).maybeSingle())) as { id: number } | null
    if (!activa) return
    const ls = (await leer(supabase.from('formulas_lineas').select('*').eq('formula_id', activa.id).order('id'))) as FormulaLinea[]
    setLineas(ls.map((l) => ({ item_id: String(l.item_id), cantidad: String(l.cantidad_por_saco) })))
  }

  const guardar = () =>
    correr(() => rpc('crear_formula', {
      p_producto_id: Number(producto),
      p_lineas: lineas.filter((l) => l.item_id && Number(l.cantidad) > 0)
        .map((l) => ({ item_id: Number(l.item_id), cantidad_por_saco: Number(l.cantidad) })),
      p_notas: notas || null,
    })).then((ok) => ok && navegar('/formulas', { replace: true }))

  return (
    <Pantalla titulo="Nueva versión de fórmula" atras>
      <Campo etiqueta="Producto">
        <Selector value={producto} onChange={(e) => elegirProducto(e.target.value)}>
          <option value="">Elija…</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Selector>
      </Campo>
      <EditarLineas lineas={lineas} onCambio={setLineas} opciones={ingredientes}
        etiquetaCantidad={(it) => `Por saco${it ? ` (${it.unidad})` : ''}`} />
      {peso && (
        <Nota>Suma de ingredientes en libras: {num(totalLb)} lb · el saco pesa {num(peso)} lb.</Nota>
      )}
      <Campo etiqueta="¿Qué cambió?">
        <Texto value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Campo>
      <MensajeError mensaje={error} />
      <Boton onClick={guardar} ocupado={ocupado} disabled={!producto}>Guardar versión nueva</Boton>
    </Pantalla>
  )
}
