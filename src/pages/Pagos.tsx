import { useState } from 'react'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { cordobas, fecha, fechaHora } from '../lib/formato'
import { FORMAS_PAGO, type CuentaPorPagar, type OrdenCompra, type OrdenCompraLinea, type PagoProveedor } from '../lib/tipos'
import { Boton, Campo, Cargando, Entrada, MensajeError, Estado, Fila, Nota, Pantalla, Selector, Tarjeta, Texto, Vacio } from '../components/ui'
import { TomarFoto, VerFoto } from '../components/Fotos'

export function Pagos() {
  const { puede, proveedores } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    cuentas: (await leer(supabase.from('cuentas_por_pagar').select('*').order('vence'))) as CuentaPorPagar[],
    pagos: (await leer(supabase.from('pagos_proveedor').select('*').order('id', { ascending: false }))) as PagoProveedor[],
  }))
  const [nueva, setNueva] = useState(false)
  const pendientes = (datos?.cuentas ?? []).filter((c) => Number(c.saldo) > 0)
  const total = pendientes.reduce((s, c) => s + Number(c.saldo), 0)

  if (nueva) return <NuevaFactura alTerminar={() => { setNueva(false); recargar() }} />

  return (
    <Pantalla titulo="Pagos a proveedores" atras>
      <Nota>Ningún pago sale sin orden de compra, factura y aprobación de Gerencia.</Nota>
      {puede('administracion', 'inventario') && <Boton onClick={() => setNueva(true)}>+ Registrar factura de proveedor</Boton>}
      <Cargando cargando={cargando && !datos} error={error} />
      {datos && (
        <div className="cifras">
          <div className="cifra cifra-grande"><div className="texto-suave">Le debemos a proveedores</div><div className="cifra-valor">{cordobas(total)}</div></div>
        </div>
      )}
      {datos?.cuentas.length === 0 && <Vacio>No hay facturas de proveedores.</Vacio>}
      {datos?.cuentas.map((c) => (
        <FacturaProveedor key={c.id} cuenta={c} pagos={datos.pagos.filter((p) => p.factura_proveedor_id === c.id)}
          proveedor={proveedores.get(c.proveedor_id)?.nombre ?? c.proveedor} alCambiar={recargar} />
      ))}
    </Pantalla>
  )
}

function FacturaProveedor({ cuenta: c, pagos, proveedor, alCambiar }: {
  cuenta: CuentaPorPagar; pagos: PagoProveedor[]; proveedor: string; alCambiar: () => void
}) {
  const { puede, perfil, personas } = useSesion()
  const { ocupado, error, correr } = useAccion()
  const [monto, setMonto] = useState('')
  const [pago, setPago] = useState<Record<number, { forma: string; referencia: string; fotos: string[]; motivo: string }>>({})
  const hacer = (f: () => Promise<unknown>) => correr(f).then((ok) => { if (ok) { setMonto(''); alCambiar() } })
  const datosPago = (id: number) => pago[id] ?? { forma: 'transferencia', referencia: '', fotos: [], motivo: '' }
  const libre = Number(c.saldo) - Number(c.en_tramite)
  const vence = Number(c.saldo) > 0 && c.dias_para_vencer <= 3

  return (
    <Tarjeta titulo={`${proveedor} · factura ${c.numero}`}>
      <Fila izquierda={`Total ${cordobas(c.monto)} · ${c.orden_compra}`} derecha={<strong>{Number(c.saldo) > 0 ? `Debemos ${cordobas(c.saldo)}` : 'Pagada'}</strong>} />
      <div className={`texto-suave ${vence ? 'texto-error' : ''}`}>
        Vence {fecha(c.vence)}{Number(c.saldo) > 0 && c.dias_para_vencer < 0 ? ` · vencida hace ${-c.dias_para_vencer} días` : ''}
      </div>
      {pagos.map((p) => {
        const d = datosPago(p.id)
        return (
          <div key={p.id} className="asignacion">
            <Fila izquierda={<strong>{cordobas(p.monto)}</strong>} derecha={<Estado valor={p.estado} />} />
            <div className="texto-suave">Pidió {personas.get(p.solicitado_por)?.nombre} · {fechaHora(p.solicitado_en)}</div>
            {p.aprobado_por && <div className="texto-suave">{p.estado === 'rechazado' ? 'Rechazó' : 'Aprobó'} {personas.get(p.aprobado_por)?.nombre}{p.motivo_rechazo ? `: ${p.motivo_rechazo}` : ''}</div>}
            {p.pagado_por && <div className="texto-suave">Pagó {personas.get(p.pagado_por)?.nombre} · {FORMAS_PAGO[p.forma ?? '']} {p.referencia} · {fechaHora(p.pagado_en)}</div>}
            {p.comprobante_url && <div className="fotos"><VerFoto ruta={p.comprobante_url} /></div>}

            {p.estado === 'solicitado' && perfil?.rol === 'gerencia' && (
              <>
                <Boton ocupado={ocupado} onClick={() => hacer(() => rpc('aprobar_pago', { p_pago_id: p.id, p_aprobar: true }))}>Aprobar pago</Boton>
                <Campo etiqueta="Si no lo aprueba, ¿por qué?">
                  <Texto value={d.motivo} onChange={(e) => setPago({ ...pago, [p.id]: { ...d, motivo: e.target.value } })} />
                </Campo>
                <Boton variante="secundario" ocupado={ocupado}
                  onClick={() => hacer(() => rpc('aprobar_pago', { p_pago_id: p.id, p_aprobar: false, p_motivo: d.motivo }))}>No aprobar</Boton>
              </>
            )}
            {p.estado === 'aprobado' && puede('administracion') && (
              <>
                <Campo etiqueta="¿Cómo se pagó?">
                  <Selector value={d.forma} onChange={(e) => setPago({ ...pago, [p.id]: { ...d, forma: e.target.value } })}>
                    {Object.entries(FORMAS_PAGO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Selector>
                </Campo>
                <Campo etiqueta="Número de transferencia o cheque">
                  <Entrada value={d.referencia} onChange={(e) => setPago({ ...pago, [p.id]: { ...d, referencia: e.target.value } })} />
                </Campo>
                <TomarFoto carpeta="comprobantes" etiqueta="Foto del comprobante (obligatoria)" fotos={d.fotos}
                  onCambio={(f) => setPago({ ...pago, [p.id]: { ...d, fotos: f.slice(-1) } })} />
                <Boton ocupado={ocupado} onClick={() => hacer(() => rpc('registrar_pago_hecho', {
                  p_pago_id: p.id, p_forma: d.forma, p_referencia: d.referencia || null, p_comprobante_url: d.fotos[0] ?? null,
                }))}>Registrar pago hecho</Boton>
              </>
            )}
          </div>
        )
      })}
      {libre > 0 && puede('administracion') && (
        <div className="asignacion">
          <Campo etiqueta={`Pedir pago a Gerencia (queda ${cordobas(libre)})`}>
            <Entrada type="number" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} />
          </Campo>
          <Boton variante="secundario" ocupado={ocupado}
            onClick={() => hacer(() => rpc('solicitar_pago', { p_factura_proveedor_id: c.id, p_monto: Number(monto) }))}>Pedir aprobación</Boton>
        </div>
      )}
      <MensajeError mensaje={error} />
    </Tarjeta>
  )
}

function NuevaFactura({ alTerminar }: { alTerminar: () => void }) {
  const { proveedores } = useSesion()
  const { datos } = useDatos(async () => {
    const ocs = (await leer(supabase.from('ordenes_compra').select('*').in('estado', ['aprobada', 'recibida']).order('id', { ascending: false }))) as OrdenCompra[]
    const lineas = ocs.length
      ? ((await leer(supabase.from('ordenes_compra_lineas').select('*').in('orden_compra_id', ocs.map((o) => o.id)))) as OrdenCompraLinea[])
      : []
    return { ocs, lineas }
  })
  const [oc, setOc] = useState('')
  const [numero, setNumero] = useState('')
  const [fechaF, setFechaF] = useState(new Date().toISOString().slice(0, 10))
  const [dias, setDias] = useState('0')
  const [monto, setMonto] = useState('')
  const [fotos, setFotos] = useState<string[]>([])
  const { ocupado, error, correr } = useAccion()
  const recibido = (datos?.lineas ?? []).filter((l) => l.orden_compra_id === Number(oc))
    .reduce((s, l) => s + Number(l.cantidad_recibida) * Number(l.precio_unitario ?? 0), 0)

  return (
    <Pantalla titulo="Factura de proveedor" atras>
      <Campo etiqueta="Orden de compra">
        <Selector value={oc} onChange={(e) => setOc(e.target.value)}>
          <option value="">Elija…</option>
          {datos?.ocs.map((o) => <option key={o.id} value={o.id}>{o.numero} · {proveedores.get(o.proveedor_id)?.nombre}</option>)}
        </Selector>
      </Campo>
      {oc && <Nota>Lo recibido de esta orden vale {cordobas(recibido)} según los precios de compra.</Nota>}
      <Campo etiqueta="Número de factura"><Entrada value={numero} onChange={(e) => setNumero(e.target.value)} /></Campo>
      <Campo etiqueta="Fecha de la factura"><Entrada type="date" value={fechaF} onChange={(e) => setFechaF(e.target.value)} /></Campo>
      <Campo etiqueta="Días de crédito que nos da"><Entrada type="number" inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value)} /></Campo>
      <Campo etiqueta="Monto (C$)"><Entrada type="number" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} /></Campo>
      <TomarFoto carpeta="facturas-proveedor" etiqueta="Foto de la factura" fotos={fotos} onCambio={(f) => setFotos(f.slice(-1))} />
      <MensajeError mensaje={error} />
      <Boton ocupado={ocupado} onClick={() => correr(() => rpc('registrar_factura_proveedor', {
        p_orden_compra_id: Number(oc), p_numero: numero, p_fecha: fechaF, p_dias_credito: Number(dias || 0),
        p_monto: Number(monto), p_foto_url: fotos[0] ?? null,
      })).then((ok) => { if (ok) alTerminar() })}>Guardar factura</Boton>
    </Pantalla>
  )
}
