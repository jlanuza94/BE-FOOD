import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { cordobas, fecha, fechaHora } from '../lib/formato'
import {
  CATEGORIAS_DINERO, CATEGORIAS_MANUALES, TIPOS_CUENTA,
  type Cierre, type Cuenta, type Flujo, type MovimientoDinero, type TipoCuenta,
} from '../lib/tipos'
import { Boton, Campo, Cargando, Entrada, Fila, MensajeError, Nota, Pantalla, Selector, Tarjeta, Texto, Vacio } from '../components/ui'
import { TomarFoto, VerFoto } from '../components/Fotos'

export function Dinero() {
  const { puede, perfil } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(
    async () => (await leer(supabase.from('saldos_cuentas').select('*').order('id'))) as Cuenta[],
  )
  const activas = (datos ?? []).filter((c) => c.activa)
  const total = activas.reduce((s, c) => s + Number(c.saldo), 0)

  return (
    <Pantalla titulo="Caja y bancos" atras>
      <div className="cifras">
        <div className="cifra cifra-grande"><div className="texto-suave">Dinero en caja y bancos</div><div className="cifra-valor">{cordobas(total)}</div></div>
      </div>
      <Tarjeta a="/flujo" titulo="📈 Flujo de caja">
        <div className="texto-suave">Lo que entra y sale cada semana, y si va a alcanzar el efectivo</div>
      </Tarjeta>
      <Cargando cargando={cargando && !datos} error={error} />
      {activas.map((c) => (
        <Tarjeta key={c.id} a={`/dinero/${c.id}`} titulo={c.nombre}>
          <Fila izquierda={TIPOS_CUENTA[c.tipo]} derecha={<strong className={Number(c.saldo) < 0 ? 'texto-error' : ''}>{cordobas(c.saldo)}</strong>} />
          {c.tipo !== 'banco' && (
            <div className="texto-suave">
              {c.ultimo_cierre === hoyLocal() ? '✓ Cerrada hoy' : `Último cierre: ${c.ultimo_cierre ? fecha(c.ultimo_cierre) : 'nunca'}`}
            </div>
          )}
          {c.tipo === 'banco' && c.hay_sin_conciliar && <div className="texto-suave">Hay movimientos sin revisar con el estado de cuenta</div>}
        </Tarjeta>
      ))}
      {puede('administracion') && activas.length > 1 && <Transferir cuentas={activas} alTerminar={recargar} />}
      {perfil?.rol === 'gerencia' && <NuevaCuenta alTerminar={recargar} />}
    </Pantalla>
  )
}

const hoyLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

function Transferir({ cuentas, alTerminar }: { cuentas: Cuenta[]; alTerminar: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [f, setF] = useState({ origen: '', destino: '', monto: '', referencia: '' })
  const [fotos, setFotos] = useState<string[]>([])
  const { ocupado, error, correr } = useAccion()
  if (!abierto) return <Boton variante="secundario" onClick={() => setAbierto(true)}>Pasar dinero de una cuenta a otra</Boton>
  const pasar = () => correr(() => rpc('transferir_dinero', {
    p_origen_id: Number(f.origen), p_destino_id: Number(f.destino), p_monto: Number(f.monto),
    p_referencia: f.referencia || null, p_foto_url: fotos[0] ?? null,
  })).then((ok) => { if (ok) { setAbierto(false); setF({ origen: '', destino: '', monto: '', referencia: '' }); setFotos([]); alTerminar() } })
  return (
    <Tarjeta titulo="Pasar dinero">
      <Nota>Por ejemplo, depositar la caja en el banco o llenar la caja chica.</Nota>
      <Campo etiqueta="Sale de">
        <Selector value={f.origen} onChange={(e) => setF({ ...f, origen: e.target.value })}>
          <option value="">Elija…</option>
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {cordobas(c.saldo)}</option>)}
        </Selector>
      </Campo>
      <Campo etiqueta="Entra a">
        <Selector value={f.destino} onChange={(e) => setF({ ...f, destino: e.target.value })}>
          <option value="">Elija…</option>
          {cuentas.filter((c) => String(c.id) !== f.origen).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </Selector>
      </Campo>
      <Campo etiqueta="Monto (C$)"><Entrada type="number" inputMode="decimal" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} /></Campo>
      <Campo etiqueta="Número de boleta o transferencia"><Entrada value={f.referencia} onChange={(e) => setF({ ...f, referencia: e.target.value })} /></Campo>
      <TomarFoto carpeta="dinero" etiqueta="Foto de la boleta" fotos={fotos} onCambio={(x) => setFotos(x.slice(-1))} />
      <MensajeError mensaje={error} />
      <Boton ocupado={ocupado} onClick={pasar}>Pasar dinero</Boton>
    </Tarjeta>
  )
}

function NuevaCuenta({ alTerminar }: { alTerminar: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [f, setF] = useState({ nombre: '', tipo: 'banco' as TipoCuenta, banco: '', numero: '', saldo: '' })
  const { ocupado, error, correr } = useAccion()
  if (!abierto) return <button className="enlace" onClick={() => setAbierto(true)}>+ Agregar caja o cuenta de banco</button>
  return (
    <Tarjeta titulo="Nueva cuenta">
      <Campo etiqueta="Nombre"><Entrada value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej. BAC córdobas" /></Campo>
      <Campo etiqueta="Tipo">
        <Selector value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoCuenta })}>
          {Object.entries(TIPOS_CUENTA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Selector>
      </Campo>
      {f.tipo === 'banco' && (
        <>
          <Campo etiqueta="Banco"><Entrada value={f.banco} onChange={(e) => setF({ ...f, banco: e.target.value })} /></Campo>
          <Campo etiqueta="Número de cuenta"><Entrada value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} /></Campo>
        </>
      )}
      <Campo etiqueta="Saldo con que empieza (C$)"><Entrada type="number" inputMode="decimal" value={f.saldo} onChange={(e) => setF({ ...f, saldo: e.target.value })} /></Campo>
      <MensajeError mensaje={error} />
      <Boton ocupado={ocupado} onClick={() => correr(() => rpc('guardar_cuenta_dinero', {
        p_id: null, p_nombre: f.nombre, p_tipo: f.tipo, p_banco: f.banco || null, p_numero: f.numero || null, p_saldo_inicial: Number(f.saldo || 0),
      })).then((ok) => { if (ok) { setAbierto(false); alTerminar() } })}>Guardar cuenta</Boton>
    </Tarjeta>
  )
}

export function CuentaDetalle() {
  const id = Number(useParams().id)
  const { puede, personas, perfil } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    cuenta: (await leer(supabase.from('saldos_cuentas').select('*').eq('id', id).single())) as Cuenta,
    movimientos: (await leer(supabase.from('movimientos_dinero').select('*').eq('cuenta_id', id)
      .order('fecha', { ascending: false }).order('id', { ascending: false }).limit(150))) as MovimientoDinero[],
    cierres: (await leer(supabase.from('cierres_caja').select('*').eq('cuenta_id', id).order('fecha', { ascending: false }).limit(10))) as Cierre[],
  }), [id])
  const [marcados, setMarcados] = useState<number[]>([])
  const [contado, setContado] = useState('')
  const [motivoCierre, setMotivoCierre] = useState('')
  const [mov, setMov] = useState({ tipo: 'salida', categoria: 'otro', monto: '', motivo: '', referencia: '' })
  const [fotos, setFotos] = useState<string[]>([])
  const { ocupado, error: errorAccion, correr } = useAccion()

  if (!datos) return <Pantalla titulo="Cuenta" atras><Cargando cargando={cargando} error={error} /></Pantalla>
  const { cuenta: c, movimientos, cierres } = datos
  const esBanco = c.tipo === 'banco'
  const sinConciliar = movimientos.filter((m) => !m.conciliado_en)
  const cerradaHoy = cierres[0]?.fecha === hoyLocal()
  const diferencia = contado === '' ? 0 : Number(contado) - Number(c.saldo)

  const accion = (f: () => Promise<unknown>, limpiar: () => void) =>
    correr(f).then((ok) => { if (ok) { limpiar(); recargar() } })

  return (
    <Pantalla titulo={c.nombre} atras pdf={c.nombre}>
      <div className="cifras">
        <div className="cifra cifra-grande">
          <div className="texto-suave">{TIPOS_CUENTA[c.tipo]}{c.banco ? ` · ${c.banco}` : ''}{c.numero ? ` · ${c.numero}` : ''}</div>
          <div className="cifra-valor">{cordobas(c.saldo)}</div>
        </div>
      </div>

      {!esBanco && puede('administracion') && (cerradaHoy ? (
        <Nota>✓ Esta caja ya se cerró hoy.</Nota>
      ) : (
        <Tarjeta titulo="Cierre de caja de hoy">
          <Fila izquierda="La app dice que hay" derecha={<strong>{cordobas(c.saldo)}</strong>} />
          <Campo etiqueta="Efectivo contado (C$)">
            <Entrada type="number" inputMode="decimal" value={contado} onChange={(e) => setContado(e.target.value)} />
          </Campo>
          {contado !== '' && Math.abs(diferencia) >= 0.01 && (
            <>
              <MensajeError mensaje={`No cuadra: ${diferencia > 0 ? 'sobran' : 'faltan'} ${cordobas(Math.abs(diferencia))}. Se avisará a Gerencia.`} />
              <Campo etiqueta="Motivo (obligatorio)"><Texto value={motivoCierre} onChange={(e) => setMotivoCierre(e.target.value)} /></Campo>
            </>
          )}
          {contado !== '' && Math.abs(diferencia) < 0.01 && <Nota>✓ Cuadra.</Nota>}
          <Boton ocupado={ocupado} disabled={contado === ''} onClick={() => accion(
            () => rpc('cerrar_caja', { p_cuenta_id: id, p_contado: Number(contado), p_motivo: motivoCierre || null }),
            () => { setContado(''); setMotivoCierre('') },
          )}>Cerrar caja</Boton>
        </Tarjeta>
      ))}

      {puede('administracion') && (
        <Tarjeta titulo="Anotar entrada o salida">
          <Nota>Cobros, pagos, gastos y planilla se anotan solos desde su pantalla. Aquí van los demás.</Nota>
          <div className="pestanas">
            {(['salida', 'entrada'] as const).map((t) => (
              <button key={t} className={mov.tipo === t ? 'activa' : ''} onClick={() => setMov({ ...mov, tipo: t })}>{t === 'salida' ? 'Sale' : 'Entra'}</button>
            ))}
          </div>
          <Campo etiqueta="Tipo">
            <Selector value={mov.categoria} onChange={(e) => setMov({ ...mov, categoria: e.target.value })}>
              {CATEGORIAS_MANUALES.map((k) => <option key={k} value={k}>{CATEGORIAS_DINERO[k]}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Monto (C$)"><Entrada type="number" inputMode="decimal" value={mov.monto} onChange={(e) => setMov({ ...mov, monto: e.target.value })} /></Campo>
          <Campo etiqueta="Motivo"><Texto value={mov.motivo} onChange={(e) => setMov({ ...mov, motivo: e.target.value })} /></Campo>
          <Campo etiqueta="Número de recibo o referencia"><Entrada value={mov.referencia} onChange={(e) => setMov({ ...mov, referencia: e.target.value })} /></Campo>
          <TomarFoto carpeta="dinero" etiqueta={mov.tipo === 'salida' ? 'Foto del recibo (obligatoria)' : 'Foto del recibo'} fotos={fotos} onCambio={(x) => setFotos(x.slice(-1))} />
          <MensajeError mensaje={errorAccion} />
          <Boton ocupado={ocupado} onClick={() => accion(() => rpc('registrar_movimiento_dinero', {
            p_cuenta_id: id, p_tipo: mov.tipo, p_monto: Number(mov.monto), p_categoria: mov.categoria, p_motivo: mov.motivo,
            p_referencia: mov.referencia || null, p_foto_url: fotos[0] ?? null,
          }), () => { setMov({ ...mov, monto: '', motivo: '', referencia: '' }); setFotos([]) })}>Guardar</Boton>
        </Tarjeta>
      )}

      {esBanco && puede('administracion') && sinConciliar.length > 0 && (
        <Nota>Revise con el estado de cuenta del banco: marque los movimientos que ya aparecen allí y toque "Están en el estado de cuenta".</Nota>
      )}
      <h2>Movimientos</h2>
      {movimientos.length === 0 && <Vacio>Todavía no hay movimientos.</Vacio>}
      {movimientos.map((m) => (
        <section key={m.id} className="tarjeta">
          <div className="tarjeta-titulo">
            {esBanco && puede('administracion') && !m.conciliado_en && (
              <input type="checkbox" aria-label="Está en el estado de cuenta" style={{ width: 24, height: 24 }}
                checked={marcados.includes(m.id)}
                onChange={(e) => setMarcados(e.target.checked ? [...marcados, m.id] : marcados.filter((x) => x !== m.id))} />
            )}
            {CATEGORIAS_DINERO[m.categoria] ?? m.categoria}
            {esBanco && m.conciliado_en && <span className="estado estado-verde">en el banco</span>}
          </div>
          <Fila izquierda={m.motivo} derecha={
            <strong className={m.tipo === 'entrada' ? 'texto-verde' : 'texto-error'}>{m.tipo === 'entrada' ? '+' : '−'} {cordobas(m.monto)}</strong>
          } />
          <div className="texto-suave">{fechaHora(m.fecha)} · {personas.get(m.registrado_por)?.nombre}{m.referencia ? ` · ${m.referencia}` : ''}</div>
          {m.foto_url && <div className="fotos"><VerFoto ruta={m.foto_url} /></div>}
        </section>
      ))}
      {marcados.length > 0 && (
        <Boton ocupado={ocupado} onClick={() => accion(() => rpc('conciliar_movimientos', { p_ids: marcados }), () => setMarcados([]))}>
          Están en el estado de cuenta ({marcados.length})
        </Boton>
      )}

      {cierres.length > 0 && (
        <>
          <h2>Cierres</h2>
          {cierres.map((k) => (
            <section key={k.id} className="tarjeta">
              <Fila izquierda={fecha(k.fecha)} derecha={Number(k.diferencia) === 0 ? <span className="texto-verde">Cuadró</span>
                : <span className="texto-error">{Number(k.diferencia) > 0 ? 'Sobró' : 'Faltó'} {cordobas(Math.abs(Number(k.diferencia)))}</span>} />
              <div className="texto-suave">Contado {cordobas(k.contado)} · {personas.get(k.cerrado_por)?.nombre}{k.motivo ? ` · ${k.motivo}` : ''}</div>
            </section>
          ))}
        </>
      )}
      {perfil?.rol === 'gerencia' && <EditarCuenta cuenta={c} alTerminar={recargar} />}
    </Pantalla>
  )
}

function EditarCuenta({ cuenta, alTerminar }: { cuenta: Cuenta; alTerminar: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [f, setF] = useState({ nombre: cuenta.nombre, banco: cuenta.banco ?? '', numero: cuenta.numero ?? '', saldo: String(cuenta.saldo_inicial), activa: cuenta.activa })
  const { ocupado, error, correr } = useAccion()
  if (!abierto) return <button className="enlace" onClick={() => setAbierto(true)}>Cambiar datos de la cuenta</button>
  return (
    <Tarjeta titulo="Datos de la cuenta">
      <Campo etiqueta="Nombre"><Entrada value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
      {cuenta.tipo === 'banco' && (
        <>
          <Campo etiqueta="Banco"><Entrada value={f.banco} onChange={(e) => setF({ ...f, banco: e.target.value })} /></Campo>
          <Campo etiqueta="Número de cuenta"><Entrada value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} /></Campo>
        </>
      )}
      <Campo etiqueta="Saldo con que empezó (C$)"><Entrada type="number" inputMode="decimal" value={f.saldo} onChange={(e) => setF({ ...f, saldo: e.target.value })} /></Campo>
      <label className="casilla"><input type="checkbox" checked={f.activa} onChange={(e) => setF({ ...f, activa: e.target.checked })} />Activa</label>
      <MensajeError mensaje={error} />
      <Boton ocupado={ocupado} onClick={() => correr(() => rpc('guardar_cuenta_dinero', {
        p_id: cuenta.id, p_nombre: f.nombre, p_tipo: cuenta.tipo, p_banco: f.banco || null, p_numero: f.numero || null,
        p_saldo_inicial: Number(f.saldo || 0), p_activa: f.activa,
      })).then((ok) => { if (ok) { setAbierto(false); alTerminar() } })}>Guardar</Boton>
    </Tarjeta>
  )
}

export function FlujoCaja() {
  const { datos: f, cargando, error } = useDatos(() => rpc<Flujo>('flujo_de_caja', { p_semanas: 6 }))
  const semana = (iso: string) => `Semana del ${fecha(iso.slice(0, 10)).slice(0, 5)}`
  return (
    <Pantalla titulo="Flujo de caja" atras pdf="Flujo de caja BE Food">
      <Cargando cargando={cargando && !f} error={error} />
      {f && (
        <>
          <div className="cifras">
            <div className="cifra cifra-grande"><div className="texto-suave">Hay hoy en caja y bancos</div><div className="cifra-valor">{cordobas(f.saldo_actual)}</div></div>
          </div>
          <h2>Lo que viene</h2>
          <Nota>Según las facturas por cobrar y por pagar (con su fecha de vencimiento) y la planilla de cada semana.</Nota>
          {f.proximas.map((s) => (
            <section key={s.semana} className={`tarjeta ${Number(s.saldo_esperado) < 0 ? 'nota-importante' : ''}`}>
              <div className="tarjeta-titulo">{semana(s.semana)}</div>
              <Fila izquierda="Entra (cobros)" derecha={<span className="texto-verde">+ {cordobas(s.por_cobrar)}</span>} />
              <Fila izquierda="Sale (proveedores)" derecha={<span className="texto-error">− {cordobas(s.por_pagar)}</span>} />
              <Fila izquierda="Sale (planilla)" derecha={<span className="texto-error">− {cordobas(s.planilla)}</span>} />
              <Fila izquierda={<strong>Quedaría</strong>} derecha={<strong className={Number(s.saldo_esperado) < 0 ? 'texto-error' : ''}>{cordobas(s.saldo_esperado)}</strong>} />
              {Number(s.saldo_esperado) < 0 && <div className="texto-error">⚠️ Va a faltar efectivo esta semana.</div>}
            </section>
          ))}
          <h2>Las últimas semanas</h2>
          {f.pasadas.map((s) => (
            <section key={s.semana} className="tarjeta">
              <div className="tarjeta-titulo">{semana(s.semana)}</div>
              <Fila izquierda="Entró" derecha={<span className="texto-verde">+ {cordobas(s.entradas)}</span>} />
              <Fila izquierda="Salió" derecha={<span className="texto-error">− {cordobas(s.salidas)}</span>} />
            </section>
          ))}
        </>
      )}
    </Pantalla>
  )
}
