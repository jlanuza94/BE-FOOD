import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { cordobas, fecha, fechaHora, num } from '../lib/formato'
import type { CostoEntrega, CostoOrdenTrabajo, EstadoEquipo, HistorialEquipo, Orden, OrdenTrabajo } from '../lib/tipos'
import { Boton, Campo, Cargando, Entrada, Estado, Fila, MensajeError, Nota, Pantalla, Selector, Tarjeta, Texto, Vacio } from '../components/ui'
import { TomarFoto, VerFoto } from '../components/Fotos'
import { EditarLineas, type LineaEditable } from '../components/Lineas'
import { ElegirCuenta, cuentaONulo } from '../components/ElegirCuenta'

// ---------------------------------------------------------------------
// Órdenes de trabajo y reporte de fallas
// ---------------------------------------------------------------------
export function Mantenimiento() {
  const { puede } = useSesion()
  const navegar = useNavigate()
  const [filtro, setFiltro] = useState<'abiertas' | 'todas'>('abiertas')
  const { datos, cargando, error } = useDatos(async () => {
    let q = supabase.from('ordenes_trabajo').select('*').order('id', { ascending: false }).limit(100)
    if (filtro === 'abiertas') q = q.in('estado', ['abierta', 'en_proceso'])
    return {
      ots: (await leer(q)) as OrdenTrabajo[],
      equipos: new Map(((await leer(supabase.from('equipos').select('id, nombre'))) as { id: number; nombre: string }[]).map((e) => [e.id, e.nombre])),
    }
  }, [filtro])

  return (
    <Pantalla titulo="Mantenimiento" atras>
      <Boton variante="peligro" onClick={() => navegar('/mantenimiento/falla')}>⚠️ Reportar una falla</Boton>
      <Tarjeta a="/equipos" titulo="🛠️ Máquinas y vehículos"><div className="texto-suave">Qué toca revisar, historial y costos</div></Tarjeta>
      {puede('despacho', 'administracion') && <Tarjeta a="/viajes" titulo="🚚 Viajes y combustible" />}
      <div className="pestanas">
        <button className={filtro === 'abiertas' ? 'activa' : ''} onClick={() => setFiltro('abiertas')}>Abiertas</button>
        <button className={filtro === 'todas' ? 'activa' : ''} onClick={() => setFiltro('todas')}>Todas</button>
      </div>
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.ots.length === 0 && <Vacio>No hay órdenes de trabajo {filtro === 'abiertas' ? 'abiertas' : ''}.</Vacio>}
      {datos?.ots.map((o) => (
        <Tarjeta key={o.id} a={`/mantenimiento/${o.id}`} titulo={<>{o.numero} · {datos.equipos.get(o.equipo_id)} <Estado valor={o.estado} /></>}>
          <div>{o.equipo_parado && o.estado !== 'terminada' && <strong className="texto-error">PARADA · </strong>}{o.descripcion}</div>
          <div className="texto-suave">{o.tipo === 'preventivo' ? 'Preventivo' : 'Falla'} · {fechaHora(o.reportada_en)}</div>
        </Tarjeta>
      ))}
    </Pantalla>
  )
}

export function ReportarFalla() {
  const navegar = useNavigate()
  const { datos: equipos } = useDatos(async () => (await leer(supabase.from('equipos').select('id, nombre, tipo').eq('activo', true).order('nombre'))) as
    { id: number; nombre: string; tipo: string }[])
  const [equipo, setEquipo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [parado, setParado] = useState(false)
  const [fotos, setFotos] = useState<string[]>([])
  const { ocupado, error, correr } = useAccion()
  return (
    <Pantalla titulo="Reportar falla" atras>
      <Campo etiqueta="¿Qué máquina o vehículo?">
        <Selector value={equipo} onChange={(e) => setEquipo(e.target.value)}>
          <option value="">Elija…</option>
          {(equipos ?? []).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </Selector>
      </Campo>
      <Campo etiqueta="¿Qué pasa?" ayuda="Puede dictarlo con el micrófono del teclado.">
        <Texto value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} />
      </Campo>
      <label className="casilla"><input type="checkbox" checked={parado} onChange={(e) => setParado(e.target.checked)} />Se paró: no se puede trabajar</label>
      <TomarFoto carpeta="fallas" etiqueta="Foto de la falla (obligatoria)" fotos={fotos} onCambio={(x) => setFotos(x.slice(-1))} />
      <MensajeError mensaje={error} />
      <Boton ocupado={ocupado} onClick={() => correr(async () => {
        const id = await rpc<number>('reportar_falla', { p_equipo_id: Number(equipo), p_descripcion: descripcion, p_foto_url: fotos[0] ?? '', p_equipo_parado: parado })
        navegar(`/mantenimiento/${id}`, { replace: true })
      })}>Reportar y avisar a Mantenimiento</Boton>
    </Pantalla>
  )
}

export function OrdenTrabajoDetalle() {
  const id = Number(useParams().id)
  const { puede, personas, items } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => {
    const ot = (await leer(supabase.from('ordenes_trabajo').select('*').eq('id', id).single())) as OrdenTrabajo
    return {
      ot,
      equipo: (await leer(supabase.from('equipos').select('id, nombre').eq('id', ot.equipo_id).single())) as { id: number; nombre: string },
      ordenes: (await leer(supabase.from('ordenes').select('*').eq('orden_trabajo_id', id).order('id'))) as Orden[],
      costo: (await leer(supabase.from('costos_ordenes_trabajo').select('*').eq('id', id).single())) as CostoOrdenTrabajo,
    }
  }, [id])
  const [lineas, setLineas] = useState<LineaEditable[]>([{ item_id: '', cantidad: '' }])
  const [pidiendo, setPidiendo] = useState(false)
  const [trabajo, setTrabajo] = useState('')
  const [fotos, setFotos] = useState<string[]>([])
  const [motivo, setMotivo] = useState('')
  const { ocupado, error: errorAccion, correr } = useAccion()

  if (!datos) return <Pantalla titulo="Orden de trabajo" atras><Cargando cargando={cargando} error={error} /></Pantalla>
  const { ot, equipo, ordenes, costo } = datos
  const abierta = ot.estado === 'abierta' || ot.estado === 'en_proceso'
  const esMant = puede('mantenimiento')
  const repuestos = [...items.values()].filter((i) => i.tipo === 'repuesto' && i.activo)
  const nombre = (u: string | null) => (u ? personas.get(u)?.nombre ?? '—' : '—')
  const accion = (f: () => Promise<unknown>, limpiar?: () => void) => correr(f).then((ok) => { if (ok) { limpiar?.(); recargar() } })

  return (
    <Pantalla titulo={ot.numero} atras>
      <Tarjeta titulo={<><Link to={`/equipos/${equipo.id}`}>{equipo.nombre}</Link> <Estado valor={ot.estado} /></>}>
        {ot.equipo_parado && abierta && <div className="texto-error"><strong>La máquina está parada.</strong></div>}
        <div>{ot.descripcion}</div>
        <div className="texto-suave">
          {ot.tipo === 'preventivo' ? 'Mantenimiento preventivo' : `Falla reportada por ${nombre(ot.reportada_por)}`} · {fechaHora(ot.reportada_en)}
        </div>
        {ot.foto_url && <div className="fotos"><VerFoto ruta={ot.foto_url} /></div>}
        {ot.iniciada_en && <div className="texto-suave">Empezó {nombre(ot.iniciada_por)} · {fechaHora(ot.iniciada_en)}</div>}
        {ot.trabajo_realizado && (
          <>
            <div><strong>Trabajo hecho:</strong> {ot.trabajo_realizado}</div>
            <div className="texto-suave">Terminó {nombre(ot.terminada_por)} · {fechaHora(ot.terminada_en)}</div>
            {ot.foto_trabajo_url && <div className="fotos"><VerFoto ruta={ot.foto_trabajo_url} /></div>}
          </>
        )}
        {ot.motivo_anulacion && <div className="texto-error">Anulada: {ot.motivo_anulacion}</div>}
      </Tarjeta>

      <Tarjeta titulo="Costo">
        <Fila izquierda="Repuestos" derecha={cordobas(costo.costo_repuestos)} />
        <Fila izquierda="Servicios y otros gastos" derecha={cordobas(costo.costo_servicios)} />
        {Number(costo.horas_parado) > 0 && <Fila izquierda="Horas parada" derecha={`${num(costo.horas_parado)} h`} />}
        <div className="texto-suave">Los servicios de afuera (torno, técnico) los anota Administración en Gastos, con esta orden.</div>
      </Tarjeta>

      <h2>Repuestos</h2>
      {ordenes.length === 0 && <Vacio>No se han pedido repuestos.</Vacio>}
      {ordenes.map((o) => (
        <Tarjeta key={o.id} a={`/ordenes/${o.id}`} titulo={<>{o.numero} <Estado valor={o.estado} /></>}>
          <div className="texto-suave">Pedida {fechaHora(o.pedida_en)}</div>
        </Tarjeta>
      ))}
      <MensajeError mensaje={errorAccion} />
      {abierta && esMant && (pidiendo ? (
        <Tarjeta titulo="Pedir repuestos a bodega">
          <EditarLineas lineas={lineas} onCambio={setLineas} opciones={repuestos} etiquetaCantidad={() => 'Cantidad'} />
          {repuestos.length === 0 && <Nota>Gerencia tiene que agregar los repuestos en Catálogos.</Nota>}
          <Boton ocupado={ocupado} onClick={() => accion(() => rpc('pedir_repuestos', {
            p_ot_id: id, p_lineas: lineas.filter((l) => l.item_id).map((l) => ({ item_id: Number(l.item_id), cantidad: Number(l.cantidad) })),
          }), () => { setPidiendo(false); setLineas([{ item_id: '', cantidad: '' }]) })}>Pedir</Boton>
        </Tarjeta>
      ) : <Boton variante="secundario" onClick={() => setPidiendo(true)}>Pedir repuestos</Boton>)}

      {ot.estado === 'abierta' && esMant && (
        <Boton ocupado={ocupado} onClick={() => accion(() => rpc('iniciar_trabajo', { p_ot_id: id }))}>Empezar el trabajo</Boton>
      )}
      {abierta && esMant && (
        <Tarjeta titulo="Terminar">
          <Campo etiqueta="¿Qué se hizo?"><Texto value={trabajo} onChange={(e) => setTrabajo(e.target.value)} rows={3} /></Campo>
          <TomarFoto carpeta="trabajos" etiqueta="Foto del trabajo" fotos={fotos} onCambio={(x) => setFotos(x.slice(-1))} />
          <Boton ocupado={ocupado} onClick={() => accion(() => rpc('terminar_trabajo', { p_ot_id: id, p_trabajo: trabajo, p_foto_url: fotos[0] ?? null }))}>
            Trabajo terminado
          </Boton>
          <Campo etiqueta="Si no se va a hacer, ¿por qué?"><Texto value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
          <Boton variante="secundario" ocupado={ocupado} onClick={() => accion(() => rpc('anular_orden_trabajo', { p_ot_id: id, p_motivo: motivo }))}>Anular</Boton>
        </Tarjeta>
      )}
    </Pantalla>
  )
}

// ---------------------------------------------------------------------
// Máquinas y vehículos
// ---------------------------------------------------------------------
function proximo(e: EstadoEquipo): string {
  const partes: string[] = []
  if (e.cada_dias) partes.push(`${e.dias_desde} de ${e.cada_dias} días`)
  if (e.cada_sacos) partes.push(`${num(e.sacos_desde)} de ${num(e.cada_sacos)} sacos`)
  if (e.cada_km) partes.push(`${num(e.km_desde)} de ${num(e.cada_km)} km`)
  return partes.length ? partes.join(' · ') : 'Sin mantenimiento programado'
}

export function Equipos() {
  const { puede } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    equipos: (await leer(supabase.from('estado_equipos').select('*').order('nombre'))) as EstadoEquipo[],
    historial: new Map(((await leer(supabase.from('historial_equipos').select('*'))) as HistorialEquipo[]).map((h) => [h.id, h])),
  }))
  return (
    <Pantalla titulo="Máquinas y vehículos" atras>
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.equipos.length === 0 && <Vacio>Todavía no hay equipos. Agregue el molino, la mezcladora, la peletizadora y los vehículos.</Vacio>}
      {datos?.equipos.filter((e) => e.activo).map((e) => (
        <Tarjeta key={e.id} a={`/equipos/${e.id}`} titulo={<>
          {e.nombre}
          {e.parado ? <span className="estado estado-rojo">parada</span> : e.toca_mantenimiento ? <span className="estado estado-amarillo">toca mantenimiento</span>
            : <span className="estado estado-verde">bien</span>}
        </>}>
          <div className="texto-suave">{proximo(e)}</div>
          <div className="texto-suave">Gastado: {cordobas(datos.historial.get(e.id)?.costo_total)} · {num(datos.historial.get(e.id)?.horas_parado)} h parada</div>
        </Tarjeta>
      ))}
      {puede('mantenimiento') && <FormEquipo alGuardar={recargar} />}
    </Pantalla>
  )
}

function FormEquipo({ e, alGuardar }: { e?: EstadoEquipo; alGuardar: () => void }) {
  const [abierto, setAbierto] = useState(!!e)
  const [f, setF] = useState({
    codigo: e?.codigo ?? '', nombre: e?.nombre ?? '', tipo: e?.tipo ?? 'maquina', placa: e?.placa ?? '',
    dias: e?.cada_dias ? String(e.cada_dias) : '', sacos: e?.cada_sacos ? String(e.cada_sacos) : '',
    km: e?.cada_km ? String(e.cada_km) : '', kmActual: e ? String(e.km_actual) : '', activo: e?.activo ?? true,
  })
  const { ocupado, error, correr } = useAccion()
  if (!abierto) return <Boton variante="secundario" onClick={() => setAbierto(true)}>+ Agregar máquina o vehículo</Boton>
  const n = (v: string) => (v ? Number(v) : null)
  return (
    <Tarjeta titulo={e ? 'Datos y mantenimiento programado' : 'Nuevo equipo'}>
      <Campo etiqueta="Código corto"><Entrada value={f.codigo} onChange={(x) => setF({ ...f, codigo: x.target.value.toUpperCase() })} placeholder="PEL1" /></Campo>
      <Campo etiqueta="Nombre"><Entrada value={f.nombre} onChange={(x) => setF({ ...f, nombre: x.target.value })} placeholder="Peletizadora" /></Campo>
      <Campo etiqueta="Tipo">
        <Selector value={f.tipo} onChange={(x) => setF({ ...f, tipo: x.target.value as 'maquina' | 'vehiculo' })}>
          <option value="maquina">Máquina</option>
          <option value="vehiculo">Vehículo</option>
        </Selector>
      </Campo>
      {f.tipo === 'vehiculo' && (
        <>
          <Campo etiqueta="Placa"><Entrada value={f.placa} onChange={(x) => setF({ ...f, placa: x.target.value })} /></Campo>
          {!e && <Campo etiqueta="Kilometraje actual"><Entrada type="number" inputMode="numeric" value={f.kmActual} onChange={(x) => setF({ ...f, kmActual: x.target.value })} /></Campo>}
        </>
      )}
      <Nota>Cada cuánto se revisa. Llene uno o varios; la app avisa con lo que llegue primero.</Nota>
      <Campo etiqueta="Cada cuántos días"><Entrada type="number" inputMode="numeric" value={f.dias} onChange={(x) => setF({ ...f, dias: x.target.value })} /></Campo>
      {f.tipo === 'maquina'
        ? <Campo etiqueta="Cada cuántos sacos producidos"><Entrada type="number" inputMode="numeric" value={f.sacos} onChange={(x) => setF({ ...f, sacos: x.target.value })} /></Campo>
        : <Campo etiqueta="Cada cuántos km"><Entrada type="number" inputMode="numeric" value={f.km} onChange={(x) => setF({ ...f, km: x.target.value })} /></Campo>}
      {e && <label className="casilla"><input type="checkbox" checked={f.activo} onChange={(x) => setF({ ...f, activo: x.target.checked })} />Sigue en uso</label>}
      <MensajeError mensaje={error} />
      <Boton ocupado={ocupado} onClick={() => correr(() => rpc('guardar_equipo', {
        p_id: e?.id ?? null, p_codigo: f.codigo, p_nombre: f.nombre, p_tipo: f.tipo, p_placa: f.placa || null,
        p_cada_dias: n(f.dias), p_cada_sacos: f.tipo === 'maquina' ? n(f.sacos) : null, p_cada_km: f.tipo === 'vehiculo' ? n(f.km) : null,
        p_km_actual: Number(f.kmActual || 0), p_activo: f.activo,
      })).then((ok) => { if (ok) { if (!e) setAbierto(false); alGuardar() } })}>Guardar</Boton>
    </Tarjeta>
  )
}

export function EquipoDetalle() {
  const id = Number(useParams().id)
  const { puede } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    e: (await leer(supabase.from('estado_equipos').select('*').eq('id', id).single())) as EstadoEquipo,
    h: (await leer(supabase.from('historial_equipos').select('*').eq('id', id).single())) as HistorialEquipo,
    ots: (await leer(supabase.from('costos_ordenes_trabajo').select('*').eq('equipo_id', id).order('id', { ascending: false }))) as CostoOrdenTrabajo[],
  }), [id])
  const [editar, setEditar] = useState(false)
  if (!datos) return <Pantalla titulo="Equipo" atras><Cargando cargando={cargando} error={error} /></Pantalla>
  const { e, h, ots } = datos
  return (
    <Pantalla titulo={e.nombre} atras>
      <div className="cifras">
        <div className="cifra"><div className="texto-suave">Gastado</div><div className="cifra-valor">{cordobas(h.costo_total)}</div></div>
        <div className="cifra"><div className="texto-suave">Horas parada</div><div className="cifra-valor">{num(h.horas_parado)}</div></div>
        <div className="cifra"><div className="texto-suave">Fallas</div><div className="cifra-valor">{h.fallas}</div></div>
        <div className="cifra"><div className="texto-suave">En repuestos</div><div className="cifra-valor">{cordobas(h.costo_repuestos)}</div></div>
      </div>
      <Tarjeta titulo={e.parado ? <span className="texto-error">Parada</span> : e.toca_mantenimiento ? 'Toca mantenimiento' : 'Funcionando'}>
        <div className="texto-suave">{proximo(e)}</div>
        <div className="texto-suave">Último mantenimiento: {fecha(e.ultimo_mantenimiento)}</div>
        {e.tipo === 'vehiculo' && <Fila izquierda="Kilometraje" derecha={`${num(e.km_actual)} km`} />}
      </Tarjeta>
      {editar ? <FormEquipo e={e} alGuardar={() => { setEditar(false); recargar() }} />
        : puede('mantenimiento') && <button className="enlace" onClick={() => setEditar(true)}>Cambiar datos o cada cuánto se revisa</button>}
      <h2>Historial</h2>
      {ots.length === 0 && <Vacio>Sin trabajos todavía.</Vacio>}
      {ots.map((o) => (
        <Tarjeta key={o.id} a={`/mantenimiento/${o.id}`} titulo={<>{o.numero} <Estado valor={o.estado} /></>}>
          <div>{o.descripcion}</div>
          <div className="texto-suave">{o.tipo === 'preventivo' ? 'Preventivo' : 'Falla'} · {fecha(o.reportada_en)} · {cordobas(Number(o.costo_repuestos) + Number(o.costo_servicios))}
            {Number(o.horas_parado) > 0 ? ` · ${num(o.horas_parado)} h parada` : ''}</div>
        </Tarjeta>
      ))}
    </Pantalla>
  )
}

// ---------------------------------------------------------------------
// Viajes: kilometraje y combustible
// ---------------------------------------------------------------------
export function Viajes() {
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    vehiculos: (await leer(supabase.from('equipos').select('id, nombre, km_actual').eq('tipo', 'vehiculo').eq('activo', true).order('nombre'))) as
      { id: number; nombre: string; km_actual: number }[],
    despachos: (await leer(supabase.from('ordenes').select('id, numero').eq('tipo', 'despacho').in('estado', ['entregada', 'recibida'])
      .order('id', { ascending: false }).limit(20))) as { id: number; numero: string }[],
    entregas: (await leer(supabase.from('costo_entregas').select('*').order('id', { ascending: false }).limit(30))) as CostoEntrega[],
  }))
  const [f, setF] = useState({ vehiculo: '', kmInicio: '', kmFin: '', litros: '', monto: '', despacho: '', destino: '', cuenta: '' })
  const [fotos, setFotos] = useState<string[]>([])
  const { ocupado, error: errorAccion, correr } = useAccion()
  const vehiculo = datos?.vehiculos.find((v) => String(v.id) === f.vehiculo)

  return (
    <Pantalla titulo="Viajes y combustible" atras>
      <Cargando cargando={cargando && !datos} error={error} />
      {datos && datos.vehiculos.length === 0 && <Vacio>Mantenimiento tiene que agregar los vehículos en Máquinas y vehículos.</Vacio>}
      {datos && datos.vehiculos.length > 0 && (
        <Tarjeta titulo="Anotar viaje">
          <Campo etiqueta="Vehículo">
            <Selector value={f.vehiculo} onChange={(e) => {
              const v = datos.vehiculos.find((x) => String(x.id) === e.target.value)
              setF({ ...f, vehiculo: e.target.value, kmInicio: v ? String(v.km_actual) : '' })
            }}>
              <option value="">Elija…</option>
              {datos.vehiculos.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </Selector>
          </Campo>
          <div className="cifras">
            <Campo etiqueta="Km al salir"><Entrada type="number" inputMode="numeric" value={f.kmInicio} onChange={(e) => setF({ ...f, kmInicio: e.target.value })} /></Campo>
            <Campo etiqueta="Km al regresar"><Entrada type="number" inputMode="numeric" value={f.kmFin} onChange={(e) => setF({ ...f, kmFin: e.target.value })} /></Campo>
          </div>
          {vehiculo && f.kmFin && Number(f.kmFin) >= Number(f.kmInicio) && <div className="texto-suave">{num(Number(f.kmFin) - Number(f.kmInicio))} km recorridos</div>}
          <Campo etiqueta="Despacho que llevó (opcional)">
            <Selector value={f.despacho} onChange={(e) => setF({ ...f, despacho: e.target.value })}>
              <option value="">Ninguno</option>
              {datos.despachos.map((d) => <option key={d.id} value={d.id}>{d.numero}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Destino"><Entrada value={f.destino} onChange={(e) => setF({ ...f, destino: e.target.value })} /></Campo>
          <div className="cifras">
            <Campo etiqueta="Litros de combustible"><Entrada type="number" inputMode="decimal" value={f.litros} onChange={(e) => setF({ ...f, litros: e.target.value })} /></Campo>
            <Campo etiqueta="Pagado C$"><Entrada type="number" inputMode="decimal" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} /></Campo>
          </div>
          {Number(f.monto) > 0 && (
            <>
              <ElegirCuenta valor={f.cuenta} onCambio={(v) => setF({ ...f, cuenta: v })} etiqueta="¿De qué caja salió?" textoVacio="Caja chica" soloCajas />
              <TomarFoto carpeta="combustible" etiqueta="Foto del recibo (obligatoria)" fotos={fotos} onCambio={(x) => setFotos(x.slice(-1))} />
            </>
          )}
          <MensajeError mensaje={errorAccion} />
          <Boton ocupado={ocupado} onClick={() => correr(() => rpc('registrar_viaje', {
            p_equipo_id: Number(f.vehiculo), p_km_inicio: Number(f.kmInicio), p_km_fin: Number(f.kmFin),
            p_litros: Number(f.litros || 0), p_monto_combustible: Number(f.monto || 0), p_foto_recibo: fotos[0] ?? null,
            p_orden_id: f.despacho ? Number(f.despacho) : null, p_destino: f.destino || null, p_cuenta_id: cuentaONulo(f.cuenta),
          })).then((ok) => { if (ok) { setF({ vehiculo: '', kmInicio: '', kmFin: '', litros: '', monto: '', despacho: '', destino: '', cuenta: '' }); setFotos([]); recargar() } })}>
            Guardar viaje
          </Boton>
        </Tarjeta>
      )}
      {datos && datos.entregas.length > 0 && <h2>Últimos viajes</h2>}
      {datos?.entregas.map((v) => (
        <section key={v.id} className="tarjeta">
          <div className="tarjeta-titulo">{v.vehiculo} · {fecha(v.fecha)}</div>
          <Fila izquierda={`${num(v.km)} km${v.destino ? ` · ${v.destino}` : ''}`} derecha={cordobas(v.monto_combustible)} />
          {v.despacho && <div className="texto-suave">{v.despacho} · {v.cliente} · {num(v.sacos)} sacos{v.costo_por_saco ? ` · ${cordobas(v.costo_por_saco)} por saco` : ''}</div>}
        </section>
      ))}
    </Pantalla>
  )
}
