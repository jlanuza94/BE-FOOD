import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { cordobas, fechaHora, num } from '../lib/formato'
import type { Cliente, CuentaPorCobrar, InventarioItem, Orden, VentaLinea, VentaResumen } from '../lib/tipos'
import { Boton, Campo, Cargando, Entrada, MensajeError, Estado, Fila, Nota, Pantalla, Selector, Tarjeta, Texto, Vacio } from '../components/ui'

export function Ventas() {
  const [filtro, setFiltro] = useState<'abiertas' | 'todas'>('abiertas')
  const { puede } = useSesion()
  const { datos, cargando, error } = useDatos(async () => {
    let q = supabase.from('ventas_resumen').select('*').order('id', { ascending: false }).limit(100)
    if (filtro === 'abiertas') q = q.eq('estado', 'abierta')
    return (await leer(q)) as VentaResumen[]
  }, [filtro])

  return (
    <Pantalla titulo="Ventas" atras>
      {puede('vendedor', 'administracion') && <Tarjeta a="/ventas/nueva" titulo="+ Nueva venta" />}
      <div className="pestanas">
        <button className={filtro === 'abiertas' ? 'activa' : ''} onClick={() => setFiltro('abiertas')}>Abiertas</button>
        <button className={filtro === 'todas' ? 'activa' : ''} onClick={() => setFiltro('todas')}>Todas</button>
      </div>
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.length === 0 && <Vacio>No hay ventas {filtro === 'abiertas' ? 'abiertas' : ''}.</Vacio>}
      {datos?.map((v) => (
        <Tarjeta key={v.id} a={`/ventas/${v.id}`} titulo={<>{v.numero} <Estado valor={v.estado} /></>}>
          <div>{v.cliente} · {num(v.sacos_entregados)} de {num(v.sacos)} sacos entregados</div>
          <div className="texto-suave">{cordobas(v.total)} · {v.condicion === 'credito' ? 'crédito' : 'contado'} · {fechaHora(v.creada_en)}</div>
        </Tarjeta>
      ))}
    </Pantalla>
  )
}

export function VentaNueva() {
  const { items, perfil } = useSesion()
  const navegar = useNavigate()
  const { datos } = useDatos(async () => ({
    clientes: (await leer(supabase.from('clientes').select('*').eq('activo', true).order('nombre'))) as Cliente[],
    stock: (await leer(supabase.from('inventario_items').select('*').eq('tipo', 'producto_terminado'))) as InventarioItem[],
  }))
  const [cliente, setCliente] = useState('')
  const [condicion, setCondicion] = useState<'contado' | 'credito'>('contado')
  const [sacos, setSacos] = useState<Record<number, string>>({})
  const [precios, setPrecios] = useState<Record<number, string>>({})
  const [notas, setNotas] = useState('')
  const { ocupado, error, correr } = useAccion()
  const productos = [...items.values()].filter((i) => i.activo && i.tipo === 'producto_terminado')
  const esGerencia = perfil?.rol === 'gerencia'
  const c = datos?.clientes.find((x) => x.id === Number(cliente))
  const precioDe = (id: number) => Number(precios[id] ?? items.get(id)?.precio_venta ?? 0)
  const total = productos.reduce((s, p) => s + Number(sacos[p.id] || 0) * precioDe(p.id), 0)

  async function guardar() {
    let nueva = 0
    const ok = await correr(async () => {
      const lineas = productos.filter((p) => Number(sacos[p.id]) > 0).map((p) => ({
        item_id: p.id, sacos: Number(sacos[p.id]),
        ...(precios[p.id] !== undefined ? { precio_unitario: Number(precios[p.id]) } : {}),
      }))
      if (!cliente) throw new Error('Elija el cliente.')
      if (!lineas.length) throw new Error('Escriba cuántos sacos de algún alimento.')
      nueva = await rpc<number>('crear_venta', { p_cliente_id: Number(cliente), p_condicion: condicion, p_lineas: lineas, p_notas: notas || null })
    })
    if (ok) navegar(`/ventas/${nueva}`, { replace: true })
  }

  return (
    <Pantalla titulo="Nueva venta" atras>
      <Campo etiqueta="Cliente">
        <Selector value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Elija…</option>
          {datos?.clientes.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </Selector>
      </Campo>
      <Link to="/clientes">¿Cliente nuevo? Regístrelo aquí</Link>
      <Campo etiqueta="Forma de pago">
        <Selector value={condicion} onChange={(e) => setCondicion(e.target.value as 'contado' | 'credito')}>
          <option value="contado">Contado</option>
          <option value="credito" disabled={!c || c.dias_credito === 0}>
            Crédito{c && c.dias_credito > 0 ? ` (${c.dias_credito} días)` : ' (el cliente no tiene)'}
          </option>
        </Selector>
      </Campo>
      {productos.map((p) => {
        const st = datos?.stock.find((s) => s.id === p.id)
        return (
          <Tarjeta key={p.id} titulo={p.nombre}>
            <div className="texto-suave">Hay {num(st?.disponible ?? 0)} sacos liberados · precio {cordobas(p.precio_venta)}</div>
            <div className="linea-numeros">
              <Entrada type="number" inputMode="numeric" placeholder="Sacos" aria-label={`Sacos de ${p.nombre}`}
                value={sacos[p.id] ?? ''} onChange={(e) => setSacos({ ...sacos, [p.id]: e.target.value })} />
              {esGerencia && (
                <Entrada type="number" inputMode="decimal" placeholder="Precio C$" aria-label={`Precio de ${p.nombre}`}
                  value={precios[p.id] ?? String(p.precio_venta ?? '')} onChange={(e) => setPrecios({ ...precios, [p.id]: e.target.value })} />
              )}
            </div>
          </Tarjeta>
        )
      })}
      <Fila izquierda={<strong>Total</strong>} derecha={<strong>{cordobas(total)}</strong>} />
      <Nota>Si no hay sacos suficientes, la app avisa a Producción y se despacha lo que haya.</Nota>
      <Campo etiqueta="Notas">
        <Texto value={notas} onChange={(e) => setNotas(e.target.value)} />
      </Campo>
      <MensajeError mensaje={error} />
      <Boton onClick={guardar} ocupado={ocupado}>Registrar venta</Boton>
    </Pantalla>
  )
}

export function VentaDetalle() {
  const id = Number(useParams().id)
  const { items, personas, puede, perfil } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    venta: (await leer(supabase.from('ventas_resumen').select('*').eq('id', id).single())) as VentaResumen,
    lineas: (await leer(supabase.from('ventas_lineas').select('*').eq('venta_id', id).order('id'))) as VentaLinea[],
    despachos: (await leer(supabase.from('ordenes').select('*').eq('venta_id', id).order('id'))) as Orden[],
    facturas: (await leer(supabase.from('cuentas_por_cobrar').select('*').eq('venta_id', id).order('id'))) as CuentaPorCobrar[],
  }), [id])
  const { ocupado, error: errorAccion, correr } = useAccion()
  const [motivo, setMotivo] = useState('')
  const [abierto, setAbierto] = useState<'anular' | 'cerrar' | null>(null)

  if (!datos) return <Pantalla titulo="Venta" atras><Cargando cargando={cargando} error={error} /></Pantalla>
  const { venta, lineas, despachos, facturas } = datos
  const enCamino = despachos.some((d) => ['pedida', 'aprobada', 'entregada'].includes(d.estado))
  const hacer = (f: () => Promise<unknown>) => correr(f).then((ok) => { if (ok) { setAbierto(null); recargar() } })
  const vendedor = puede('vendedor', 'administracion')

  return (
    <Pantalla titulo={venta.numero} atras>
      <Tarjeta titulo={<>{venta.cliente} <Estado valor={venta.estado} /></>}>
        <Fila izquierda="Forma de pago" derecha={venta.condicion === 'credito' ? 'Crédito' : 'Contado'} />
        <div className="texto-suave">Vendió {personas.get(venta.creada_por)?.nombre} · {fechaHora(venta.creada_en)}</div>
      </Tarjeta>
      <Tarjeta titulo="Productos">
        {lineas.map((l) => (
          <div key={l.id} className="asignacion">
            <Fila izquierda={items.get(l.item_id)?.nombre} derecha={`${l.sacos} sacos × ${cordobas(l.precio_unitario)}`} />
            {l.precio_lista !== null && Number(l.precio_lista) !== Number(l.precio_unitario) && (
              <div className="texto-suave">Precio de lista {cordobas(l.precio_lista)} (cambiado por Gerencia)</div>
            )}
          </div>
        ))}
        <Fila izquierda={<strong>Total</strong>} derecha={<strong>{cordobas(venta.total)}</strong>} />
        <Fila izquierda="Entregado" derecha={`${num(venta.sacos_entregados)} de ${num(venta.sacos)} sacos`} />
      </Tarjeta>
      <Tarjeta titulo="Despachos">
        {despachos.length === 0 && <div className="texto-suave">Sin despachos.</div>}
        {despachos.map((d) => (
          <Link key={d.id} to={`/ordenes/${d.id}`} className="enlace-fila">{d.numero} <Estado valor={d.estado} /></Link>
        ))}
      </Tarjeta>
      {facturas.length > 0 && (
        <Tarjeta titulo="Facturas">
          {facturas.map((f) => (
            <Link key={f.id} to={`/facturas/${f.id}`} className="enlace-fila">
              {f.numero} · {cordobas(f.total)} · {Number(f.saldo) > 0 ? `debe ${cordobas(f.saldo)}` : 'pagada'}
            </Link>
          ))}
        </Tarjeta>
      )}
      <MensajeError mensaje={errorAccion} />
      {venta.estado === 'abierta' && vendedor && !enCamino && Number(venta.sacos_entregados) < Number(venta.sacos) && despachos.length > 0 && (
        <Boton ocupado={ocupado} onClick={() => hacer(() => rpc('crear_despacho', { p_venta_id: id }))}>Despachar lo pendiente</Boton>
      )}
      {venta.estado === 'abierta' && vendedor && !enCamino && despachos.some((d) => d.estado === 'recibida') && abierto !== 'cerrar' && (
        <Boton variante="secundario" onClick={() => setAbierto('cerrar')}>Cerrar sin entregar lo pendiente</Boton>
      )}
      {venta.estado === 'abierta' && (venta.creada_por === perfil?.id || perfil?.rol === 'gerencia')
        && !despachos.some((d) => ['entregada', 'recibida'].includes(d.estado)) && abierto !== 'anular' && (
        <Boton variante="secundario" onClick={() => setAbierto('anular')}>Anular venta</Boton>
      )}
      {abierto && (
        <Tarjeta titulo={abierto === 'anular' ? 'Anular venta' : 'Cerrar venta'}>
          <Campo etiqueta="Motivo">
            <Texto value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Campo>
          <Boton variante="peligro" ocupado={ocupado} onClick={() => hacer(() =>
            rpc(abierto === 'anular' ? 'anular_venta' : 'cerrar_venta', { p_venta_id: id, p_motivo: motivo }))}>
            {abierto === 'anular' ? 'Anular' : 'Cerrar'}
          </Boton>
        </Tarjeta>
      )}
    </Pantalla>
  )
}
