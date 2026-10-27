import { Link } from 'react-router-dom'
import { leer, supabase } from '../lib/supabase'
import { useDatos } from '../lib/usar'
import { fecha, num } from '../lib/formato'
import { TURNOS, type OrdenProduccion, type Turno } from '../lib/tipos'
import { Cargando, Fila, Pantalla, Tarjeta, Vacio } from '../components/ui'

interface PorTurno { turno: Turno; lotes: number; merma_lb: number; merma_pct: number }
interface PorOperador { operador_id: string; operador: string; lotes: number; merma_lb: number; merma_pct: number }

export function Merma() {
  const { datos, cargando, error } = useDatos(async () => ({
    turnos: (await leer(supabase.from('merma_por_turno').select('*'))) as PorTurno[],
    operadores: (await leer(supabase.from('merma_por_operador').select('*').order('merma_pct', { ascending: false }))) as PorOperador[],
    lotes: (await leer(supabase.from('ordenes_produccion').select('*').eq('estado', 'terminada').order('id', { ascending: false }).limit(30))) as OrdenProduccion[],
  }))
  return (
    <Pantalla titulo="Merma" atras pdf="Merma BE Food">
      <Cargando cargando={cargando && !datos} error={error} />
      {datos && datos.lotes.length === 0 && <Vacio>Todavía no hay producción terminada.</Vacio>}
      {datos && datos.lotes.length > 0 && (
        <>
          <Tarjeta titulo="Por turno">
            {datos.turnos.map((t) => (
              <Fila key={t.turno} izquierda={`${TURNOS[t.turno]} (${t.lotes} lotes)`} derecha={`${num(t.merma_lb)} lb · ${num(t.merma_pct)} %`} />
            ))}
          </Tarjeta>
          <Tarjeta titulo="Por operador">
            {datos.operadores.map((o) => (
              <Fila key={o.operador_id} izquierda={`${o.operador} (${o.lotes} lotes)`} derecha={`${num(o.merma_lb)} lb · ${num(o.merma_pct)} %`} />
            ))}
          </Tarjeta>
          <Tarjeta titulo="Por lote">
            {datos.lotes.map((op) => (
              <Fila key={op.id} izquierda={<Link to={`/produccion/${op.id}`}>{op.numero} · {fecha(op.terminada_en)}</Link>}
                derecha={`${num(op.merma_lb)} lb · ${num(op.merma_pct)} %`} />
            ))}
          </Tarjeta>
        </>
      )}
    </Pantalla>
  )
}
