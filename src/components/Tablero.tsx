import { rpc } from '../lib/supabase'
import { useDatos } from '../lib/usar'
import { cordobas, fecha, num } from '../lib/formato'
import type { ResumenDia } from '../lib/tipos'
import { BotonWhatsApp, Cargando } from './ui'
import { Link } from 'react-router-dom'

function Cifra({ titulo, valor, a, clase }: { titulo: string; valor: string; a?: string; clase?: string }) {
  const cuerpo = (
    <>
      <div className="texto-suave">{titulo}</div>
      <div className={`cifra-valor ${clase ?? ''}`}>{valor}</div>
    </>
  )
  return a ? <Link to={a} className="cifra tarjeta-enlace" style={{ color: 'inherit', textDecoration: 'none' }}>{cuerpo}</Link> : <div className="cifra">{cuerpo}</div>
}

export function textoResumen(r: ResumenDia): string {
  return [
    `BE Food · Resumen del ${fecha(r.fecha)}`,
    `Producción: ${num(r.sacos_producidos)} sacos${r.merma_pct !== null ? `, merma ${num(r.merma_pct)} %` : ''}`,
    `Ventas: ${cordobas(r.ventas)} (${num(r.sacos_vendidos)} sacos)`,
    `Utilidad del día: ${cordobas(r.utilidad)}`,
    `Cobrado hoy: ${cordobas(r.cobrado)} · Gastos hoy: ${cordobas(r.gastos)}`,
    `Por cobrar: ${cordobas(r.por_cobrar)} (vencido ${cordobas(r.por_cobrar_vencido)})`,
    `Por pagar: ${cordobas(r.por_pagar)}`,
    `Sacos en bodega: ${num(r.sacos_en_bodega)}`,
  ].join('\n')
}

/** El negocio de hoy en una sola pantalla, para el dueño. */
export function Tablero() {
  const { datos: r, cargando, error } = useDatos(() => rpc<ResumenDia>('resumen_del_dia'))
  if (!r) return <Cargando cargando={cargando} error={error} />
  return (
    <>
      <h2>Hoy</h2>
      <div className="cifras">
        <div className="cifra cifra-grande">
          <div className="texto-suave">Utilidad de hoy</div>
          <div className="cifra-valor">{cordobas(r.utilidad)}</div>
        </div>
        <Cifra titulo="Sacos producidos" valor={num(r.sacos_producidos)} a="/produccion" />
        <Cifra titulo="Merma" valor={r.merma_pct === null ? '—' : `${num(r.merma_pct)} %`} a="/merma" />
        <Cifra titulo="Ventas" valor={cordobas(r.ventas)} a="/utilidad" />
        <Cifra titulo="Cobrado" valor={cordobas(r.cobrado)} a="/cobros" />
        <Cifra titulo="Por cobrar" valor={cordobas(r.por_cobrar)} a="/cobros"
          clase={Number(r.por_cobrar_vencido) > 0 ? 'texto-error' : ''} />
        <Cifra titulo="Por pagar" valor={cordobas(r.por_pagar)} a="/pagos" />
        <Cifra titulo="Sacos en bodega" valor={num(r.sacos_en_bodega)} a="/inventario" />
        <Cifra titulo="Gastos de hoy" valor={cordobas(r.gastos)} a="/gastos" />
      </div>
      {Number(r.por_cobrar_vencido) > 0 && (
        <div className="texto-suave texto-error">Hay {cordobas(r.por_cobrar_vencido)} vencido por cobrar.</div>
      )}
      <BotonWhatsApp texto={textoResumen(r)}>Mandar el resumen por WhatsApp</BotonWhatsApp>
    </>
  )
}
