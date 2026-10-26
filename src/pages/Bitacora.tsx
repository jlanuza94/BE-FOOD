import { useState } from 'react'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { fecha, fechaHora } from '../lib/formato'
import { TURNOS, type NotaBitacora, type Turno } from '../lib/tipos'
import { Boton, BotonWhatsApp, Campo, Cargando, Entrada, MensajeError, Pantalla, Selector, Tarjeta, Texto, Vacio } from '../components/ui'
import { TomarFoto, VerFoto } from '../components/Fotos'

const AREAS = ['Molienda', 'Dosificación', 'Mezcladora', 'Peletizadora', 'Envasado', 'Bodega', 'Calidad', 'Despacho', 'Limpieza', 'General']

/** El turno según la hora: mañana de 6 a 2, tarde de 2 a 10, noche el resto. */
export function turnoDeAhora(): Turno {
  const h = new Date().getHours()
  return h >= 6 && h < 14 ? 'manana' : h >= 14 && h < 22 ? 'tarde' : 'noche'
}

export function Bitacora() {
  const { personas } = useSesion()
  const [turno, setTurno] = useState<Turno>(turnoDeAhora())
  const [area, setArea] = useState('')
  const [nota, setNota] = useState('')
  const [importante, setImportante] = useState(false)
  const [fotos, setFotos] = useState<string[]>([])
  const { ocupado, error, correr } = useAccion()
  const { datos, cargando, error: errorCarga, recargar } = useDatos(
    async () => (await leer(supabase.from('bitacora').select('*').order('id', { ascending: false }).limit(60))) as NotaBitacora[],
  )

  const guardar = () => correr(() => rpc('escribir_bitacora', {
    p_turno: turno, p_area: area, p_nota: nota, p_importante: importante, p_foto_url: fotos[0] ?? null,
  })).then((ok) => {
    if (ok) {
      setNota('')
      setImportante(false)
      setFotos([])
      recargar()
    }
  })

  // Agrupadas por día y turno, la más nueva primero
  const grupos: { clave: string; titulo: string; notas: NotaBitacora[] }[] = []
  for (const n of datos ?? []) {
    const clave = `${n.fecha}-${n.turno}`
    let g = grupos.find((x) => x.clave === clave)
    if (!g) grupos.push((g = { clave, titulo: `${fecha(n.fecha)} · Turno ${TURNOS[n.turno].toLowerCase()}`, notas: [] }))
    g.notas.push(n)
  }

  return (
    <Pantalla titulo="Bitácora de turno" atras>
      <Tarjeta titulo="Dejar nota al siguiente turno">
        <Campo etiqueta="Turno">
          <Selector value={turno} onChange={(e) => setTurno(e.target.value as Turno)}>
            {Object.entries(TURNOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Área o máquina">
          <Entrada list="areas" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ej. Peletizadora" />
          <datalist id="areas">{AREAS.map((a) => <option key={a} value={a} />)}</datalist>
        </Campo>
        <Campo etiqueta="Nota" ayuda="Puede dictarla con el micrófono del teclado.">
          <Texto value={nota} onChange={(e) => setNota(e.target.value)} rows={3}
            placeholder="Ej. La mezcladora hace un ruido raro, ya avisé a mantenimiento" />
        </Campo>
        <label className="casilla">
          <input type="checkbox" checked={importante} onChange={(e) => setImportante(e.target.checked)} />
          Es importante: avisar a todos
        </label>
        <TomarFoto carpeta="bitacora" etiqueta="Foto (opcional)" fotos={fotos} onCambio={(x) => setFotos(x.slice(-1))} />
        <MensajeError mensaje={error} />
        <Boton onClick={guardar} ocupado={ocupado} disabled={!nota.trim() || !area.trim()}>Guardar nota</Boton>
      </Tarjeta>

      <Cargando cargando={cargando && !datos} error={errorCarga} />
      {datos?.length === 0 && <Vacio>Todavía no hay notas.</Vacio>}
      {grupos.map((g) => (
        <div key={g.clave}>
          <h2>{g.titulo}</h2>
          {g.notas.map((n) => (
            <section key={n.id} className={`tarjeta ${n.importante ? 'nota-importante' : ''}`}>
              <div className="tarjeta-titulo">{n.importante && '⚠️ '}{n.area}</div>
              <div>{n.nota}</div>
              <div className="texto-suave">{personas.get(n.autor)?.nombre} · {fechaHora(n.creado_en)}</div>
              {n.foto_url && <div className="fotos"><VerFoto ruta={n.foto_url} /></div>}
              {n.importante && (
                <BotonWhatsApp texto={`BE Food, bitácora · ${n.area}: ${n.nota} (${personas.get(n.autor)?.nombre ?? ''})`}>
                  Compartir por WhatsApp
                </BotonWhatsApp>
              )}
            </section>
          ))}
        </div>
      ))}
    </Pantalla>
  )
}
