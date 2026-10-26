import { useState } from 'react'
import { Link } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { fecha, num } from '../lib/formato'
import type { LoteInventario } from '../lib/tipos'
import { Boton, Campo, Cargando, MensajeError, Estado, Pantalla, Tarjeta, Texto, Vacio } from '../components/ui'
import { TomarFoto } from '../components/Fotos'

// Lo que se revisa a simple vista, según el documento (sección 5.1 y 7.1).
const REVISION_MP = [
  ['color_normal', 'Color normal'],
  ['olor_normal', 'Olor normal'],
  ['sin_moho', 'Sin moho'],
  ['sin_plagas', 'Sin plagas'],
  ['sin_piedras_ni_basura', 'Sin piedras ni basura'],
  ['grano_seco', 'Se ve y se siente seco'],
] as const
const REVISION_PT = [
  ['pellet_parejo', 'Pellet de tamaño parejo'],
  ['pellet_firme', 'Pellet firme'],
  ['poco_polvo', 'Sin mucho polvo'],
  ['formula_correcta', 'Se usó la fórmula correcta'],
] as const

export function Calidad() {
  const { datos, cargando, error, recargar } = useDatos(
    async () => (await leer(supabase.from('inventario_lotes').select('*').eq('estado', 'cuarentena').order('fecha_ingreso'))) as LoteInventario[],
  )
  const [lote, setLote] = useState<LoteInventario | null>(null)

  if (lote) return <Revisar lote={lote} alTerminar={() => { setLote(null); recargar() }} />

  return (
    <Pantalla titulo="Calidad" atras>
      <h2>Lotes en cuarentena</h2>
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.length === 0 && <Vacio>No hay lotes esperando revisión.</Vacio>}
      {datos?.map((l) => (
        <Tarjeta key={l.id} titulo={<>{l.codigo} <Estado valor={l.estado} /></>}>
          <div>{l.item} · {num(l.orden_produccion_id ? l.cantidad_inicial : l.existencia)} {l.unidad}</div>
          <div className="texto-suave">{l.proveedor ?? 'Producción propia'} · entró {fecha(l.fecha_ingreso)}</div>
          <Boton variante="secundario" onClick={() => setLote(l)}>Revisar</Boton>
        </Tarjeta>
      ))}
    </Pantalla>
  )
}

function Revisar({ lote, alTerminar }: { lote: LoteInventario; alTerminar: () => void }) {
  const lista = lote.orden_produccion_id ? REVISION_PT : REVISION_MP
  const [marcas, setMarcas] = useState<Record<string, boolean>>({})
  const [observaciones, setObservaciones] = useState('')
  const [fotos, setFotos] = useState<string[]>([])
  const { ocupado, error, correr } = useAccion()
  const todoBien = lista.every(([k]) => marcas[k])

  const decidir = (resultado: 'liberado' | 'rechazado') =>
    correr(() => rpc('inspeccionar_lote', {
      p_lote_id: lote.id,
      p_resultado: resultado,
      p_revision: Object.fromEntries(lista.map(([k]) => [k, !!marcas[k]])),
      p_observaciones: observaciones || null,
      p_fotos: fotos,
    })).then((ok) => ok && alTerminar())

  return (
    <Pantalla titulo="Revisar lote" atras>
      <Tarjeta titulo={lote.codigo}>
        <div>{lote.item}</div>
        <Link to={`/lotes/${lote.id}`}>Ver lote y fotos de recepción</Link>
      </Tarjeta>
      <Tarjeta titulo="Revisión a simple vista">
        {lista.map(([clave, texto]) => (
          <label key={clave} className="casilla">
            <input type="checkbox" checked={!!marcas[clave]} onChange={(e) => setMarcas({ ...marcas, [clave]: e.target.checked })} />
            {texto}
          </label>
        ))}
      </Tarjeta>
      <TomarFoto carpeta="calidad" etiqueta="Fotos" fotos={fotos} onCambio={setFotos} />
      <Campo etiqueta="Observaciones" ayuda="Obligatorio si se rechaza.">
        <Texto value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
      </Campo>
      <MensajeError mensaje={error} />
      <Boton onClick={() => decidir('liberado')} ocupado={ocupado} disabled={!todoBien}>
        {todoBien ? 'Liberar lote' : 'Marque todo para liberar'}
      </Boton>
      <Boton variante="peligro" onClick={() => decidir('rechazado')} ocupado={ocupado}>Rechazar lote</Boton>
    </Pantalla>
  )
}
