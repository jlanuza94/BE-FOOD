import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { cordobas, fecha, fechaHora, num } from '../lib/formato'
import { FORMAS_PAGO, type Abono, type CuentaPorCobrar } from '../lib/tipos'
import { Boton, BotonWhatsApp, Campo, Cargando, Entrada, MensajeError, Fila, Nota, Pantalla, Selector, Tarjeta, Vacio } from '../components/ui'
import { ElegirCuenta, cuentaONulo } from '../components/ElegirCuenta'
import { TomarFoto, VerFoto } from '../components/Fotos'

export function Cobros() {
  const [filtro, setFiltro] = useState<'pendientes' | 'todas'>('pendientes')
  const { datos, cargando, error } = useDatos(async () => {
    let q = supabase.from('cuentas_por_cobrar').select('*').order('vence')
    if (filtro === 'pendientes') q = q.gt('saldo', 0)
    return (await leer(q)) as CuentaPorCobrar[]
  }, [filtro])
  const total = (datos ?? []).reduce((s, f) => s + Number(f.saldo), 0)
  const atrasado = (datos ?? []).filter((f) => f.dias_atraso > 0).reduce((s, f) => s + Number(f.saldo), 0)

  return (
    <Pantalla titulo="Cobros" atras>
      <div className="pestanas">
        <button className={filtro === 'pendientes' ? 'activa' : ''} onClick={() => setFiltro('pendientes')}>Por cobrar</button>
        <button className={filtro === 'todas' ? 'activa' : ''} onClick={() => setFiltro('todas')}>Todas las facturas</button>
      </div>
      {filtro === 'pendientes' && datos && (
        <div className="cifras">
          <div className="cifra"><div className="texto-suave">Por cobrar</div><div className="cifra-valor">{cordobas(total)}</div></div>
          <div className="cifra"><div className="texto-suave">Atrasado</div><div className="cifra-valor texto-error">{cordobas(atrasado)}</div></div>
        </div>
      )}
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.length === 0 && <Vacio>No hay facturas {filtro === 'pendientes' ? 'por cobrar' : ''}.</Vacio>}
      {datos?.map((f) => (
        <Tarjeta key={f.id} a={`/facturas/${f.id}`} titulo={`${f.numero} · ${f.cliente}`}>
          <Fila izquierda={`Total ${cordobas(f.total)}`} derecha={<strong>{Number(f.saldo) > 0 ? `Debe ${cordobas(f.saldo)}` : 'Pagada'}</strong>} />
          <div className={`texto-suave ${Number(f.saldo) > 0 && f.dias_atraso > 0 ? 'texto-error' : ''}`}>
            {f.condicion === 'credito' ? 'Crédito' : 'Contado'} · vence {fecha(f.vence)}
            {Number(f.saldo) > 0 && f.dias_atraso > 0 && ` · ${f.dias_atraso} días de atraso`}
          </div>
        </Tarjeta>
      ))}
    </Pantalla>
  )
}

interface LineaFactura { id: number; item_id: number; lote_id: number; sacos: number; precio_unitario: number; subtotal: number }

export function FacturaDetalle() {
  const id = Number(useParams().id)
  const { items, personas, puede } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    factura: (await leer(supabase.from('cuentas_por_cobrar').select('*').eq('id', id).single())) as CuentaPorCobrar,
    lineas: (await leer(supabase.from('facturas_lineas').select('*').eq('factura_id', id).order('id'))) as LineaFactura[],
    abonos: (await leer(supabase.from('abonos').select('*').eq('factura_id', id).order('fecha'))) as Abono[],
    lotes: new Map(((await leer(supabase.from('lotes').select('id, codigo'))) as { id: number; codigo: string }[]).map((l) => [l.id, l.codigo])),
  }), [id])
  const { datos: telefono } = useDatos(async () => datos
    ? ((await leer(supabase.from('clientes').select('telefono').eq('id', datos.factura.cliente_id).single())) as { telefono: string | null }).telefono
    : null, [datos?.factura.cliente_id])
  const [monto, setMonto] = useState('')
  const [forma, setForma] = useState('efectivo')
  const [referencia, setReferencia] = useState('')
  const [fotos, setFotos] = useState<string[]>([])
  const [cuenta, setCuenta] = useState('')
  const { ocupado, error: errorAccion, correr } = useAccion()

  if (!datos) return <Pantalla titulo="Factura" atras><Cargando cargando={cargando} error={error} /></Pantalla>
  const { factura: f, lineas, abonos, lotes } = datos

  const abonar = () => correr(() => rpc('registrar_abono', {
    p_factura_id: id, p_monto: Number(monto), p_forma: forma, p_referencia: referencia || null, p_foto_url: fotos[0] ?? null,
    p_cuenta_id: cuentaONulo(cuenta),
  })).then((ok) => { if (ok) { setMonto(''); setReferencia(''); setFotos([]); recargar() } })

  return (
    <Pantalla titulo={f.numero} atras>
      <Tarjeta titulo={f.cliente}>
        <Fila izquierda="Fecha" derecha={fecha(f.fecha)} />
        <Fila izquierda="Forma de pago" derecha={f.condicion === 'credito' ? `Crédito, vence ${fecha(f.vence)}` : 'Contado'} />
        <Link to={`/ventas/${f.venta_id}`}>Ver la venta</Link>
      </Tarjeta>
      <Tarjeta titulo="Detalle">
        {lineas.map((l) => (
          <div key={l.id} className="asignacion">
            <Fila izquierda={`${items.get(l.item_id)?.nombre} · ${num(l.sacos)} sacos`} derecha={cordobas(l.subtotal)} />
            <div className="texto-suave">Lote <Link to={`/lotes/${l.lote_id}`}>{lotes.get(l.lote_id)}</Link> · {cordobas(l.precio_unitario)} c/u</div>
          </div>
        ))}
        <Fila izquierda={<strong>Total</strong>} derecha={<strong>{cordobas(f.total)}</strong>} />
        <Fila izquierda="Abonado" derecha={cordobas(f.abonado)} />
        <Fila izquierda={<strong>Saldo</strong>} derecha={<strong className={f.dias_atraso > 0 && Number(f.saldo) > 0 ? 'texto-error' : ''}>{cordobas(f.saldo)}</strong>} />
      </Tarjeta>
      <Tarjeta titulo="Abonos">
        {abonos.length === 0 && <div className="texto-suave">Todavía no ha abonado.</div>}
        {abonos.map((a) => (
          <div key={a.id} className="asignacion">
            <Fila izquierda={`${FORMAS_PAGO[a.forma]}${a.referencia ? ` · ${a.referencia}` : ''}`} derecha={<strong>{cordobas(a.monto)}</strong>} />
            <div className="texto-suave">{personas.get(a.registrado_por)?.nombre} · {fechaHora(a.fecha)}</div>
            {a.foto_url && <div className="fotos"><VerFoto ruta={a.foto_url} /></div>}
          </div>
        ))}
      </Tarjeta>
      {Number(f.saldo) > 0 && puede('administracion') && (
        <Tarjeta titulo="Registrar abono">
          <Campo etiqueta="Monto (C$)">
            <Entrada type="number" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} />
          </Campo>
          <Campo etiqueta="Forma de pago">
            <Selector value={forma} onChange={(e) => setForma(e.target.value)}>
              {Object.entries(FORMAS_PAGO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Selector>
          </Campo>
          {forma !== 'efectivo' && (
            <Campo etiqueta="Número de transferencia, cheque o depósito">
              <Entrada value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </Campo>
          )}
          <ElegirCuenta valor={cuenta} onCambio={setCuenta} etiqueta="¿A qué caja o banco entra?" />
          <TomarFoto carpeta="abonos" etiqueta="Foto del recibo" fotos={fotos} onCambio={(x) => setFotos(x.slice(-1))} />
          <MensajeError mensaje={errorAccion} />
          <Boton onClick={abonar} ocupado={ocupado}>Guardar abono</Boton>
        </Tarjeta>
      )}
      {Number(f.saldo) > 0 && !puede('administracion') && <Nota>Los abonos los registra Administración.</Nota>}
      {Number(f.saldo) > 0 && (
        <BotonWhatsApp telefono={telefono} texto={
          `Hola ${f.cliente}, le saluda BE Food. Le recordamos que la factura ${f.numero} tiene un saldo de ${cordobas(f.saldo)}` +
          (f.condicion === 'credito' ? `, ${f.dias_atraso > 0 ? `venció el ${fecha(f.vence)}` : `vence el ${fecha(f.vence)}`}` : '') +
          '. ¡Gracias!'
        }>Recordar el pago por WhatsApp</BotonWhatsApp>
      )}
    </Pantalla>
  )
}
