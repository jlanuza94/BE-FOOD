import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { cordobas, fecha, fechaHora, num } from '../lib/formato'
import type { Empleado, LineaPlanilla, Planilla as TPlanilla } from '../lib/tipos'
import { Boton, Campo, Cargando, Entrada, Estado, Fila, MensajeError, Nota, Pantalla, Tarjeta, Texto, Vacio } from '../components/ui'
import { TomarFoto, VerFoto } from '../components/Fotos'
import { ElegirCuenta, cuentaONulo } from '../components/ElegirCuenta'

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)

/** La quincena en curso: del 1 al 15, o del 16 al fin de mes. */
function quincenaActual() {
  const h = new Date()
  const y = h.getFullYear()
  const m = h.getMonth()
  return h.getDate() <= 15
    ? { desde: iso(new Date(y, m, 1)), hasta: iso(new Date(y, m, 15)) }
    : { desde: iso(new Date(y, m, 16)), hasta: iso(new Date(y, m + 1, 0)) }
}

export function Planillas() {
  const { puede } = useSesion()
  const navegar = useNavigate()
  const [periodo, setPeriodo] = useState(quincenaActual())
  const { ocupado, error: errorAccion, correr } = useAccion()
  const { datos, cargando, error } = useDatos(async () => ({
    planillas: (await leer(supabase.from('planillas').select('*').order('desde', { ascending: false }).limit(30))) as TPlanilla[],
    lineas: (await leer(supabase.from('planillas_lineas').select('planilla_id, neto'))) as { planilla_id: number; neto: number }[],
  }))
  const neto = (pid: number) => (datos?.lineas ?? []).filter((l) => l.planilla_id === pid).reduce((s, l) => s + Number(l.neto), 0)

  return (
    <Pantalla titulo="Planilla" atras>
      {puede('administracion') && (
        <Tarjeta titulo="Calcular planilla">
          <Nota>La app toma los días trabajados y las horas extra de la asistencia, rebaja INSS, IR y adelantos. Queda en borrador para revisarla.</Nota>
          <div className="cifras">
            <Campo etiqueta="Desde"><Entrada type="date" value={periodo.desde} onChange={(e) => setPeriodo({ ...periodo, desde: e.target.value })} /></Campo>
            <Campo etiqueta="Hasta"><Entrada type="date" value={periodo.hasta} onChange={(e) => setPeriodo({ ...periodo, hasta: e.target.value })} /></Campo>
          </div>
          <MensajeError mensaje={errorAccion} />
          <Boton ocupado={ocupado} onClick={() => correr(async () => {
            navegar(`/planilla/${await rpc<number>('calcular_planilla', { p_desde: periodo.desde, p_hasta: periodo.hasta })}`)
          })}>Calcular</Boton>
        </Tarjeta>
      )}
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.planillas.length === 0 && <Vacio>Todavía no hay planillas.</Vacio>}
      {datos?.planillas.map((p) => (
        <Tarjeta key={p.id} a={`/planilla/${p.id}`} titulo={<>{p.numero} <Estado valor={p.estado} /></>}>
          <Fila izquierda={`Del ${fecha(p.desde)} al ${fecha(p.hasta)}`} derecha={<strong>{cordobas(neto(p.id))}</strong>} />
        </Tarjeta>
      ))}
    </Pantalla>
  )
}

export function PlanillaDetalle() {
  const id = Number(useParams().id)
  const { puede, perfil, personas } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    p: (await leer(supabase.from('planillas').select('*').eq('id', id).single())) as TPlanilla,
    lineas: (await leer(supabase.from('planillas_lineas').select('*').eq('planilla_id', id).order('id'))) as LineaPlanilla[],
    empleados: new Map(((await leer(supabase.from('empleados').select('*'))) as Empleado[]).map((e) => [e.id, e])),
  }), [id])
  const [editando, setEditando] = useState<number | null>(null)
  const [ed, setEd] = useState({ faltas: '', extra: '', otros: '', deducciones: '', nota: '' })
  const [pago, setPago] = useState({ cuenta: '', referencia: '' })
  const [fotos, setFotos] = useState<string[]>([])
  const [motivoAnular, setMotivoAnular] = useState('')
  const { ocupado, error: errorAccion, correr } = useAccion()

  if (!datos) return <Pantalla titulo="Planilla" atras><Cargando cargando={cargando} error={error} /></Pantalla>
  const { p, lineas, empleados } = datos
  const suma = (k: keyof LineaPlanilla) => lineas.reduce((s, l) => s + Number(l[k]), 0)
  const accion = (f: () => Promise<unknown>, limpiar?: () => void) => correr(f).then((ok) => { if (ok) { limpiar?.(); recargar() } })
  const borrador = p.estado === 'borrador'

  return (
    <Pantalla titulo={p.numero} atras>
      <Tarjeta titulo={<>Del {fecha(p.desde)} al {fecha(p.hasta)} <Estado valor={p.estado} /></>}>
        <Fila izquierda="Total bruto" derecha={cordobas(suma('bruto'))} />
        <Fila izquierda={<strong>A pagar a los empleados</strong>} derecha={<strong>{cordobas(suma('neto'))}</strong>} />
        <Fila izquierda="INSS a pagar (laboral + patronal)" derecha={cordobas(suma('inss_laboral') + suma('inss_patronal'))} />
        <Fila izquierda="IR a pagar a la DGI" derecha={cordobas(suma('ir'))} />
        <Fila izquierda="INATEC" derecha={cordobas(suma('inatec'))} />
        <Fila izquierda="Costo total para la empresa" derecha={cordobas(suma('bruto') + suma('inss_patronal') + suma('inatec'))} />
        {p.aprobada_por && <div className="texto-suave">Aprobó {personas.get(p.aprobada_por)?.nombre} · {fechaHora(p.aprobada_en)}</div>}
        {p.pagada_por && <div className="texto-suave">Pagó {personas.get(p.pagada_por)?.nombre} · {fechaHora(p.pagada_en)}{p.referencia ? ` · ${p.referencia}` : ''}</div>}
        {p.comprobante_url && <div className="fotos"><VerFoto ruta={p.comprobante_url} /></div>}
        {p.motivo_anulacion && <MensajeError mensaje={`Anulada: ${p.motivo_anulacion}`} />}
      </Tarjeta>
      <Nota>INSS 7 % al empleado, 21.5 % patronal, INATEC 2 % e IR según la tabla de ley. Gerencia puede cambiar los porcentajes en Catálogos; revíselos con el contador.</Nota>

      <MensajeError mensaje={errorAccion} />
      {lineas.map((l) => {
        const e = empleados.get(l.empleado_id)
        return (
          <section key={l.id} className="tarjeta">
            <div className="tarjeta-titulo">{e?.nombre}</div>
            <div className="texto-suave">{e?.puesto} · salario {cordobas(l.salario_mensual)} al mes</div>
            <Fila izquierda={`Días pagados ${num(Number(l.dias_periodo) - Number(l.dias_falta))} de ${num(l.dias_periodo)}`} derecha={cordobas(l.salario)} />
            {Number(l.dias_falta) > 0 && <div className="texto-error">{num(l.dias_falta)} día(s) sin marcar asistencia</div>}
            {Number(l.dias_vacaciones) > 0 && <div className="texto-suave">{num(l.dias_vacaciones)} día(s) de vacaciones (pagados)</div>}
            {Number(l.horas_extra) > 0 && <Fila izquierda={`Horas extra (${num(l.horas_extra)})`} derecha={cordobas(l.pago_horas_extra)} />}
            {Number(l.otros_ingresos) > 0 && <Fila izquierda="Otros ingresos" derecha={cordobas(l.otros_ingresos)} />}
            <Fila izquierda="Bruto" derecha={cordobas(l.bruto)} />
            <Fila izquierda="INSS" derecha={`− ${cordobas(l.inss_laboral)}`} />
            {Number(l.ir) > 0 && <Fila izquierda="IR" derecha={`− ${cordobas(l.ir)}`} />}
            {Number(l.adelantos) > 0 && <Fila izquierda="Adelantos" derecha={`− ${cordobas(l.adelantos)}`} />}
            {Number(l.otras_deducciones) > 0 && <Fila izquierda="Otras deducciones" derecha={`− ${cordobas(l.otras_deducciones)}`} />}
            <Fila izquierda={<strong>Recibe</strong>} derecha={<strong>{cordobas(l.neto)}</strong>} />
            {l.nota && <div className="texto-suave">Nota: {l.nota}</div>}
            {borrador && puede('administracion') && (editando === l.id ? (
              <>
                <div className="cifras">
                  <Campo etiqueta="Días de falta"><Entrada type="number" inputMode="decimal" value={ed.faltas} onChange={(x) => setEd({ ...ed, faltas: x.target.value })} /></Campo>
                  <Campo etiqueta="Horas extra"><Entrada type="number" inputMode="decimal" value={ed.extra} onChange={(x) => setEd({ ...ed, extra: x.target.value })} /></Campo>
                  <Campo etiqueta="Otros ingresos C$"><Entrada type="number" inputMode="decimal" value={ed.otros} onChange={(x) => setEd({ ...ed, otros: x.target.value })} /></Campo>
                  <Campo etiqueta="Otras deducciones C$"><Entrada type="number" inputMode="decimal" value={ed.deducciones} onChange={(x) => setEd({ ...ed, deducciones: x.target.value })} /></Campo>
                </div>
                <Campo etiqueta="Motivo del cambio"><Texto value={ed.nota} onChange={(x) => setEd({ ...ed, nota: x.target.value })} /></Campo>
                <Boton ocupado={ocupado} onClick={() => accion(() => rpc('ajustar_linea_planilla', {
                  p_linea_id: l.id, p_dias_falta: Number(ed.faltas || 0), p_horas_extra: Number(ed.extra || 0),
                  p_otros_ingresos: Number(ed.otros || 0), p_otras_deducciones: Number(ed.deducciones || 0), p_nota: ed.nota,
                }), () => setEditando(null))}>Guardar cambio</Boton>
              </>
            ) : (
              <button className="enlace" onClick={() => {
                setEditando(l.id)
                setEd({ faltas: String(l.dias_falta), extra: String(l.horas_extra), otros: String(l.otros_ingresos), deducciones: String(l.otras_deducciones), nota: l.nota ?? '' })
              }}>Corregir</button>
            ))}
          </section>
        )
      })}

      {borrador && puede('administracion') && (
        <Boton variante="secundario" ocupado={ocupado} onClick={() => accion(() => rpc('enviar_planilla', { p_planilla_id: id }))}>Avisar a Gerencia que está lista</Boton>
      )}
      {borrador && perfil?.rol === 'gerencia' && (
        <Boton ocupado={ocupado} onClick={() => accion(() => rpc('aprobar_planilla', { p_planilla_id: id }))}>Aprobar planilla</Boton>
      )}
      {p.estado === 'aprobada' && puede('administracion') && (
        <Tarjeta titulo="Pagar planilla">
          <ElegirCuenta valor={pago.cuenta} onCambio={(v) => setPago({ ...pago, cuenta: v })} etiqueta="¿De qué caja o banco sale?" textoVacio="Caja general" />
          <Campo etiqueta="Número de transferencia (si fue por banco)"><Entrada value={pago.referencia} onChange={(x) => setPago({ ...pago, referencia: x.target.value })} /></Campo>
          <TomarFoto carpeta="planillas" etiqueta="Foto de la planilla firmada" fotos={fotos} onCambio={(x) => setFotos(x.slice(-1))} />
          <Boton ocupado={ocupado} onClick={() => accion(() => rpc('pagar_planilla', {
            p_planilla_id: id, p_cuenta_id: cuentaONulo(pago.cuenta), p_referencia: pago.referencia || null, p_comprobante_url: fotos[0] ?? null,
          }))}>Registrar pago de {cordobas(suma('neto'))}</Boton>
        </Tarjeta>
      )}
      {(borrador || p.estado === 'aprobada') && perfil?.rol === 'gerencia' && (
        <Tarjeta titulo="Anular planilla">
          <Campo etiqueta="Motivo"><Texto value={motivoAnular} onChange={(x) => setMotivoAnular(x.target.value)} /></Campo>
          <Boton variante="peligro" ocupado={ocupado} onClick={() => accion(() => rpc('anular_planilla', { p_planilla_id: id, p_motivo: motivoAnular }))}>Anular</Boton>
        </Tarjeta>
      )}
    </Pantalla>
  )
}
