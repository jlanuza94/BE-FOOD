import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { cordobas, fecha, fechaHora, hoyISO, num } from '../lib/formato'
import {
  AREAS_EMPLEADO,
  type Adelanto, type AreaEmpleado, type Asistencia, type AsistenciaHoy, type Empleado, type EmpleadoLista, type Prestaciones,
} from '../lib/tipos'
import { Boton, Campo, Cargando, Entrada, Estado, Fila, MensajeError, Nota, Pantalla, Selector, Tarjeta, Texto, Vacio } from '../components/ui'
import { TomarFoto, VerFoto } from '../components/Fotos'
import { ElegirCuenta, cuentaONulo } from '../components/ElegirCuenta'

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-NI', { hour: 'numeric', minute: '2-digit' }) : '—')

// ---------------------------------------------------------------------
// Asistencia: se marca desde el celular de la planta, siempre con foto
// ---------------------------------------------------------------------
export function MarcarAsistencia() {
  const { puede } = useSesion()
  const [elegido, setElegido] = useState<EmpleadoLista | null>(null)
  const [fotos, setFotos] = useState<string[]>([])
  const [mensaje, setMensaje] = useState<string | null>(null)
  const { ocupado, error, correr } = useAccion()
  const { datos, cargando, error: errorCarga, recargar } = useDatos(async () => ({
    empleados: (await leer(supabase.from('empleados_lista').select('*').order('nombre'))) as EmpleadoLista[],
    hoy: (await leer(supabase.from('asistencia_hoy').select('*'))) as AsistenciaHoy[],
  }))
  const marca = (id: number) => datos?.hoy.find((a) => a.empleado_id === id)

  const marcar = () => correr(async () => {
    setMensaje(await rpc<string>('marcar_asistencia', { p_empleado_id: elegido!.id, p_foto_url: fotos[0] ?? '' }))
  }).then((ok) => { if (ok) { setElegido(null); setFotos([]); recargar() } })

  return (
    <Pantalla titulo="Asistencia" atras>
      {mensaje && <Nota>✓ {mensaje}</Nota>}
      <Cargando cargando={cargando && !datos} error={errorCarga} />
      {elegido ? (
        <Tarjeta titulo={elegido.nombre}>
          <div className="texto-suave">{elegido.puesto}</div>
          <div><strong>{marca(elegido.id) ? 'Marcar salida' : 'Marcar entrada'}</strong></div>
          <TomarFoto carpeta="asistencia" etiqueta="Foto de la persona" fotos={fotos} onCambio={(x) => setFotos(x.slice(-1))} />
          <MensajeError mensaje={error} />
          <Boton ocupado={ocupado} disabled={!fotos.length} onClick={marcar}>{marca(elegido.id) ? 'Marcar salida' : 'Marcar entrada'}</Boton>
          <Boton variante="secundario" onClick={() => { setElegido(null); setFotos([]) }}>Cancelar</Boton>
        </Tarjeta>
      ) : (
        <>
          <h2>¿Quién marca?</h2>
          {datos?.empleados.filter((e) => e.marca_asistencia).map((e) => {
            const m = marca(e.id)
            return (
              <button key={e.id} className="tarjeta" onClick={() => { setMensaje(null); setElegido(e) }} disabled={!!m?.salida}>
                <div className="tarjeta-titulo">{e.nombre}{m && <span className={`estado estado-${m.salida ? 'gris' : 'verde'}`}>{m.salida ? 'ya salió' : 'trabajando'}</span>}</div>
                <div className="texto-suave">
                  {m ? `Entró ${hora(m.entrada)}${m.salida ? ` · salió ${hora(m.salida)} · ${num(m.horas)} h` : ''}` : e.puesto}
                </div>
              </button>
            )
          })}
          {datos?.empleados.length === 0 && <Vacio>Administración tiene que agregar a los empleados primero.</Vacio>}
        </>
      )}
      {puede('administracion') && <CorregirAsistencia empleados={datos?.empleados ?? []} alTerminar={recargar} />}
    </Pantalla>
  )
}

function CorregirAsistencia({ empleados, alTerminar }: { empleados: EmpleadoLista[]; alTerminar: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [f, setF] = useState({ empleado: '', fecha: hoyISO(), entrada: '07:00', salida: '15:00', motivo: '' })
  const { ocupado, error, correr } = useAccion()
  if (!abierto) return <button className="enlace" onClick={() => setAbierto(true)}>Corregir una marca olvidada</button>
  return (
    <Tarjeta titulo="Corregir asistencia">
      <Campo etiqueta="Empleado">
        <Selector value={f.empleado} onChange={(e) => setF({ ...f, empleado: e.target.value })}>
          <option value="">Elija…</option>
          {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </Selector>
      </Campo>
      <Campo etiqueta="Día"><Entrada type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Campo>
      <div className="cifras">
        <Campo etiqueta="Entrada"><Entrada type="time" value={f.entrada} onChange={(e) => setF({ ...f, entrada: e.target.value })} /></Campo>
        <Campo etiqueta="Salida"><Entrada type="time" value={f.salida} onChange={(e) => setF({ ...f, salida: e.target.value })} /></Campo>
      </div>
      <Campo etiqueta="Motivo"><Texto value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} /></Campo>
      <MensajeError mensaje={error} />
      <Boton ocupado={ocupado} onClick={() => correr(() => rpc('corregir_asistencia', {
        p_empleado_id: Number(f.empleado), p_fecha: f.fecha,
        p_entrada: new Date(`${f.fecha}T${f.entrada}`).toISOString(),
        p_salida: f.salida ? new Date(`${f.fecha}T${f.salida}`).toISOString() : null, p_motivo: f.motivo,
      })).then((ok) => { if (ok) { setAbierto(false); alTerminar() } })}>Guardar corrección</Boton>
    </Tarjeta>
  )
}

// ---------------------------------------------------------------------
// Empleados
// ---------------------------------------------------------------------
export function Empleados() {
  const { puede } = useSesion()
  const navegar = useNavigate()
  const { datos, cargando, error } = useDatos(async () => ({
    empleados: (await leer(supabase.from('empleados').select('*').order('activo', { ascending: false }).order('nombre'))) as Empleado[],
    adelantos: (await leer(supabase.from('adelantos_saldo').select('*').in('estado', ['solicitado', 'aprobado']))) as Adelanto[],
  }))
  const activos = (datos?.empleados ?? []).filter((e) => e.activo)
  const totalMes = activos.reduce((s, e) => s + Number(e.salario_mensual), 0)
  return (
    <Pantalla titulo="Personal" atras>
      <Tarjeta a="/asistencia" titulo="🕒 Marcar asistencia" />
      <Tarjeta a="/planilla" titulo="💵 Planilla" />
      <Cargando cargando={cargando && !datos} error={error} />
      {datos && (
        <>
          <div className="cifras">
            <div className="cifra"><div className="texto-suave">Empleados</div><div className="cifra-valor">{activos.length}</div></div>
            <div className="cifra"><div className="texto-suave">Salarios al mes</div><div className="cifra-valor">{cordobas(totalMes)}</div></div>
          </div>
          {datos.adelantos.length > 0 && (
            <>
              <h2>Adelantos pendientes</h2>
              {datos.adelantos.map((a) => (
                <Tarjeta key={a.id} a={`/empleados/${a.empleado_id}`} titulo={<>{a.empleado} <Estado valor={a.estado} /></>}>
                  <div className="texto-suave">{cordobas(a.monto)} en {a.cuotas} cuota{a.cuotas === 1 ? '' : 's'} · {a.motivo}</div>
                </Tarjeta>
              ))}
            </>
          )}
          <h2>Empleados</h2>
          {datos.empleados.length === 0 && <Vacio>Todavía no hay empleados.</Vacio>}
          {datos.empleados.map((e) => (
            <Tarjeta key={e.id} a={`/empleados/${e.id}`} titulo={<>{e.nombre}{!e.activo && <span className="estado estado-gris">ya no trabaja</span>}</>}>
              <Fila izquierda={`${e.puesto} · ${AREAS_EMPLEADO[e.area].split(' ')[0]}`} derecha={cordobas(e.salario_mensual)} />
            </Tarjeta>
          ))}
          {puede('administracion') && <Boton variante="secundario" onClick={() => navegar('/empleados/nuevo')}>+ Agregar empleado</Boton>}
        </>
      )}
    </Pantalla>
  )
}

function FormEmpleado({ e, alGuardar }: { e?: Empleado; alGuardar: (id: number) => void }) {
  const [f, setF] = useState({
    nombre: e?.nombre ?? '', puesto: e?.puesto ?? '', area: (e?.area ?? 'planta') as AreaEmpleado,
    salario: e ? String(e.salario_mensual) : '', ingreso: e?.fecha_ingreso ?? hoyISO(), cedula: e?.cedula ?? '',
    inss: e?.numero_inss ?? '', telefono: e?.telefono ?? '', marca: e?.marca_asistencia ?? true, activo: e?.activo ?? true,
  })
  const { ocupado, error, correr } = useAccion()
  const guardar = () => correr(async () => {
    alGuardar(await rpc<number>('guardar_empleado', {
      p_id: e?.id ?? null, p_nombre: f.nombre, p_puesto: f.puesto, p_area: f.area, p_salario_mensual: Number(f.salario),
      p_fecha_ingreso: f.ingreso, p_cedula: f.cedula || null, p_numero_inss: f.inss || null, p_telefono: f.telefono || null,
      p_marca_asistencia: f.marca, p_activo: f.activo,
    }))
  })
  return (
    <Tarjeta titulo={e ? 'Datos del empleado' : 'Nuevo empleado'}>
      <Campo etiqueta="Nombre completo"><Entrada value={f.nombre} onChange={(x) => setF({ ...f, nombre: x.target.value })} /></Campo>
      <Campo etiqueta="Puesto"><Entrada value={f.puesto} onChange={(x) => setF({ ...f, puesto: x.target.value })} placeholder="Ej. Operador de molino" /></Campo>
      <Campo etiqueta="Área">
        <Selector value={f.area} onChange={(x) => setF({ ...f, area: x.target.value as AreaEmpleado })}>
          {Object.entries(AREAS_EMPLEADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Selector>
      </Campo>
      <Campo etiqueta="Salario mensual (C$)" ayuda={e ? 'Solo Gerencia puede cambiarlo.' : undefined}>
        <Entrada type="number" inputMode="decimal" value={f.salario} onChange={(x) => setF({ ...f, salario: x.target.value })} />
      </Campo>
      <Campo etiqueta="Fecha de ingreso"><Entrada type="date" value={f.ingreso} onChange={(x) => setF({ ...f, ingreso: x.target.value })} /></Campo>
      <Campo etiqueta="Cédula"><Entrada value={f.cedula} onChange={(x) => setF({ ...f, cedula: x.target.value })} /></Campo>
      <Campo etiqueta="Número INSS"><Entrada value={f.inss} onChange={(x) => setF({ ...f, inss: x.target.value })} /></Campo>
      <Campo etiqueta="Teléfono"><Entrada type="tel" value={f.telefono} onChange={(x) => setF({ ...f, telefono: x.target.value })} /></Campo>
      <label className="casilla"><input type="checkbox" checked={f.marca} onChange={(x) => setF({ ...f, marca: x.target.checked })} />Marca asistencia (si no marca, se le cuentan faltas)</label>
      {e && <label className="casilla"><input type="checkbox" checked={f.activo} onChange={(x) => setF({ ...f, activo: x.target.checked })} />Sigue trabajando</label>}
      <MensajeError mensaje={error} />
      <Boton ocupado={ocupado} onClick={guardar}>Guardar</Boton>
    </Tarjeta>
  )
}

export function EmpleadoNuevo() {
  const navegar = useNavigate()
  return (
    <Pantalla titulo="Nuevo empleado" atras>
      <FormEmpleado alGuardar={(id) => navegar(`/empleados/${id}`, { replace: true })} />
    </Pantalla>
  )
}

export function EmpleadoDetalle() {
  const id = Number(useParams().id)
  const { puede, perfil } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    e: (await leer(supabase.from('empleados').select('*').eq('id', id).single())) as Empleado,
    p: (await leer(supabase.from('prestaciones').select('*').eq('id', id).maybeSingle())) as Prestaciones | null,
    adelantos: (await leer(supabase.from('adelantos_saldo').select('*').eq('empleado_id', id).order('id', { ascending: false }))) as Adelanto[],
    asistencia: (await leer(supabase.from('asistencia').select('*').eq('empleado_id', id).order('fecha', { ascending: false }).limit(15))) as Asistencia[],
    vacaciones: (await leer(supabase.from('vacaciones').select('*').eq('empleado_id', id).order('desde', { ascending: false }))) as
      { id: number; desde: string; hasta: string; dias: number; nota: string | null }[],
  }), [id])
  const [editar, setEditar] = useState(false)
  const [vac, setVac] = useState({ desde: '', hasta: '', nota: '' })
  const [ad, setAd] = useState({ monto: '', cuotas: '1', motivo: '' })
  const [entrega, setEntrega] = useState<Record<number, { cuenta: string; fotos: string[]; motivo: string }>>({})
  const { ocupado, error: errorAccion, correr } = useAccion()

  if (!datos) return <Pantalla titulo="Empleado" atras><Cargando cargando={cargando} error={error} /></Pantalla>
  const { e, p, adelantos, asistencia, vacaciones } = datos
  const accion = (f: () => Promise<unknown>, limpiar?: () => void) => correr(f).then((ok) => { if (ok) { limpiar?.(); recargar() } })
  const de = (aid: number) => entrega[aid] ?? { cuenta: '', fotos: [], motivo: '' }

  return (
    <Pantalla titulo={e.nombre} atras>
      {editar ? <FormEmpleado e={e} alGuardar={() => { setEditar(false); recargar() }} /> : (
        <Tarjeta titulo={e.puesto}>
          <Fila izquierda="Área" derecha={AREAS_EMPLEADO[e.area].split(' (')[0]} />
          <Fila izquierda="Salario mensual" derecha={<strong>{cordobas(e.salario_mensual)}</strong>} />
          <Fila izquierda="Ingresó" derecha={fecha(e.fecha_ingreso)} />
          {e.cedula && <Fila izquierda="Cédula" derecha={e.cedula} />}
          {e.numero_inss && <Fila izquierda="INSS" derecha={e.numero_inss} />}
          {e.telefono && <Fila izquierda="Teléfono" derecha={e.telefono} />}
          {puede('administracion') && <button className="enlace" onClick={() => setEditar(true)}>Cambiar datos</button>}
        </Tarjeta>
      )}

      {p && (
        <Tarjeta titulo="Vacaciones y aguinaldo">
          <Fila izquierda="Vacaciones ganadas" derecha={`${num(p.vacaciones_ganadas)} días`} />
          <Fila izquierda="Vacaciones tomadas" derecha={`${num(p.vacaciones_tomadas)} días`} />
          <Fila izquierda={<strong>Le quedan</strong>} derecha={<strong>{num(p.vacaciones_saldo)} días</strong>} />
          <Fila izquierda="Aguinaldo acumulado (se paga en diciembre)" derecha={<strong>{cordobas(p.aguinaldo_acumulado)}</strong>} />
          {vacaciones.map((v) => <div key={v.id} className="texto-suave">{fecha(v.desde)} al {fecha(v.hasta)} · {num(v.dias)} días{v.nota ? ` · ${v.nota}` : ''}</div>)}
          {puede('administracion') && (
            <>
              <div className="cifras">
                <Campo etiqueta="Desde"><Entrada type="date" value={vac.desde} onChange={(x) => setVac({ ...vac, desde: x.target.value })} /></Campo>
                <Campo etiqueta="Hasta"><Entrada type="date" value={vac.hasta} onChange={(x) => setVac({ ...vac, hasta: x.target.value })} /></Campo>
              </div>
              <Boton variante="secundario" ocupado={ocupado} disabled={!vac.desde || !vac.hasta} onClick={() => accion(
                () => rpc('registrar_vacaciones', { p_empleado_id: id, p_desde: vac.desde, p_hasta: vac.hasta, p_nota: vac.nota || null }),
                () => setVac({ desde: '', hasta: '', nota: '' }))}>Anotar vacaciones</Boton>
            </>
          )}
        </Tarjeta>
      )}

      <MensajeError mensaje={errorAccion} />
      <h2>Adelantos y préstamos</h2>
      {adelantos.length === 0 && <Vacio>No tiene adelantos.</Vacio>}
      {adelantos.map((a) => {
        const d = de(a.id)
        return (
          <section key={a.id} className="tarjeta">
            <div className="tarjeta-titulo">{cordobas(a.monto)} <Estado valor={a.estado} /></div>
            <div className="texto-suave">{a.motivo} · {a.cuotas} cuota{a.cuotas === 1 ? '' : 's'} de {cordobas(Number(a.monto) / a.cuotas)} · {fechaHora(a.solicitado_en)}</div>
            {a.estado === 'entregado' && <Fila izquierda="Le falta pagar" derecha={<strong>{cordobas(a.saldo)}</strong>} />}
            {a.motivo_rechazo && <div className="texto-error">No aprobado: {a.motivo_rechazo}</div>}
            {a.comprobante_url && <div className="fotos"><VerFoto ruta={a.comprobante_url} /></div>}
            {a.estado === 'solicitado' && perfil?.rol === 'gerencia' && (
              <>
                <Boton ocupado={ocupado} onClick={() => accion(() => rpc('aprobar_adelanto', { p_adelanto_id: a.id, p_aprobar: true }))}>Aprobar adelanto</Boton>
                <Campo etiqueta="Si no lo aprueba, ¿por qué?">
                  <Texto value={d.motivo} onChange={(x) => setEntrega({ ...entrega, [a.id]: { ...d, motivo: x.target.value } })} />
                </Campo>
                <Boton variante="secundario" ocupado={ocupado}
                  onClick={() => accion(() => rpc('aprobar_adelanto', { p_adelanto_id: a.id, p_aprobar: false, p_motivo: d.motivo }))}>No aprobar</Boton>
              </>
            )}
            {a.estado === 'aprobado' && puede('administracion') && (
              <>
                <ElegirCuenta valor={d.cuenta} onCambio={(v) => setEntrega({ ...entrega, [a.id]: { ...d, cuenta: v } })}
                  etiqueta="¿De qué caja sale?" textoVacio="Caja general" soloCajas />
                <TomarFoto carpeta="adelantos" etiqueta="Foto del recibo firmado (obligatoria)" fotos={d.fotos}
                  onCambio={(x) => setEntrega({ ...entrega, [a.id]: { ...d, fotos: x.slice(-1) } })} />
                <Boton ocupado={ocupado} onClick={() => accion(() => rpc('entregar_adelanto', {
                  p_adelanto_id: a.id, p_cuenta_id: cuentaONulo(d.cuenta), p_comprobante_url: d.fotos[0] ?? '',
                }))}>Entregar el dinero</Boton>
              </>
            )}
          </section>
        )
      })}
      {puede('administracion') && e.activo && (
        <Tarjeta titulo="Pedir adelanto o préstamo">
          <Campo etiqueta="Monto (C$)"><Entrada type="number" inputMode="decimal" value={ad.monto} onChange={(x) => setAd({ ...ad, monto: x.target.value })} /></Campo>
          <Campo etiqueta="¿En cuántas planillas se descuenta?"><Entrada type="number" inputMode="numeric" value={ad.cuotas} onChange={(x) => setAd({ ...ad, cuotas: x.target.value })} /></Campo>
          <Campo etiqueta="Motivo"><Texto value={ad.motivo} onChange={(x) => setAd({ ...ad, motivo: x.target.value })} /></Campo>
          <Boton variante="secundario" ocupado={ocupado} onClick={() => accion(() => rpc('solicitar_adelanto', {
            p_empleado_id: id, p_monto: Number(ad.monto), p_cuotas: Number(ad.cuotas || 1), p_motivo: ad.motivo,
          }), () => setAd({ monto: '', cuotas: '1', motivo: '' }))}>Pedir aprobación a Gerencia</Boton>
        </Tarjeta>
      )}

      <h2>Asistencia reciente</h2>
      {asistencia.length === 0 && <Vacio>Sin marcas todavía.</Vacio>}
      {asistencia.map((a) => (
        <section key={a.id} className="tarjeta">
          <Fila izquierda={fecha(a.fecha)} derecha={a.horas !== null ? `${num(a.horas)} h${Number(a.horas_extra) > 0 ? ` · ${num(a.horas_extra)} extra` : ''}` : 'sin salida'} />
          <div className="texto-suave">Entró {hora(a.entrada)} · salió {hora(a.salida)}{a.nota ? ` · ${a.nota}` : ''}</div>
        </section>
      ))}
    </Pantalla>
  )
}
