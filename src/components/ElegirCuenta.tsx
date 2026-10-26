import { leer, supabase } from '../lib/supabase'
import { useDatos } from '../lib/usar'
import { cordobas } from '../lib/formato'
import type { Cuenta } from '../lib/tipos'
import { Campo, Selector } from './ui'

/** De qué caja o banco sale (o a cuál entra) el dinero. Vacío = según la forma de pago. */
export function ElegirCuenta({ valor, onCambio, etiqueta = 'Caja o banco', textoVacio = 'Según la forma de pago', soloCajas = false }: {
  valor: string
  onCambio: (v: string) => void
  etiqueta?: string
  textoVacio?: string
  soloCajas?: boolean
}) {
  const { datos } = useDatos(async () => (await leer(supabase.from('saldos_cuentas').select('*').eq('activa', true).order('id'))) as Cuenta[])
  const cuentas = (datos ?? []).filter((c) => !soloCajas || c.tipo !== 'banco')
  return (
    <Campo etiqueta={etiqueta}>
      <Selector value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">{textoVacio}</option>
        {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {cordobas(c.saldo)}</option>)}
      </Selector>
    </Campo>
  )
}

export const cuentaONulo = (v: string) => (v ? Number(v) : null)
