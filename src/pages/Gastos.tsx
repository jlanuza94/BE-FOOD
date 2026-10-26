import { useState } from 'react'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { cordobas, fecha } from '../lib/formato'
import { CATEGORIAS_GASTO, type Gasto } from '../lib/tipos'
import { Boton, Campo, Cargando, Entrada, MensajeError, Fila, Pantalla, Selector, Tarjeta, Texto, Vacio } from '../components/ui'
import { TomarFoto, VerFoto } from '../components/Fotos'

const inicioMes = () => new Date().toISOString().slice(0, 8) + '01'

export function Gastos() {
  const { puede, perfil, personas } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(
    async () => (await leer(supabase.from('gastos').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }).limit(200))) as Gasto[],
  )
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0, 10), categoria: 'luz', descripcion: '', monto: '', incluir: true })
  const [fotos, setFotos] = useState<string[]>([])
  const [anular, setAnular] = useState<{ id: number; motivo: string } | null>(null)
  const { ocupado, error: errorAccion, correr } = useAccion()
  const delMes = (datos ?? []).filter((g) => !g.anulado && g.fecha >= inicioMes())
  const totalMes = delMes.reduce((s, g) => s + Number(g.monto), 0)

  const guardar = () => correr(() => rpc('registrar_gasto', {
    p_fecha: form.fecha, p_categoria: form.categoria, p_descripcion: form.descripcion, p_monto: Number(form.monto),
    p_incluir_en_costo: form.incluir, p_foto_url: fotos[0] ?? null,
  })).then((ok) => { if (ok) { setForm({ ...form, descripcion: '', monto: '' }); setFotos([]); recargar() } })

  return (
    <Pantalla titulo="Gastos" atras>
      <div className="cifras">
        <div className="cifra cifra-grande"><div className="texto-suave">Gastos de este mes</div><div className="cifra-valor">{cordobas(totalMes)}</div></div>
      </div>
      {puede('administracion') && (
        <Tarjeta titulo="Anotar gasto">
          <Campo etiqueta="Fecha"><Entrada type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></Campo>
          <Campo etiqueta="Tipo">
            <Selector value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value, incluir: e.target.value !== 'administracion' })}>
              {Object.entries(CATEGORIAS_GASTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="¿En qué se gastó?"><Texto value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} /></Campo>
          <Campo etiqueta="Monto (C$)"><Entrada type="number" inputMode="decimal" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} /></Campo>
          <label className="casilla">
            <input type="checkbox" checked={form.incluir} onChange={(e) => setForm({ ...form, incluir: e.target.checked })} />
            Es gasto de la planta (entra al costo del saco)
          </label>
          <TomarFoto carpeta="gastos" etiqueta="Foto del recibo" fotos={fotos} onCambio={(f) => setFotos(f.slice(-1))} />
          <MensajeError mensaje={errorAccion} />
          <Boton onClick={guardar} ocupado={ocupado}>Guardar gasto</Boton>
        </Tarjeta>
      )}
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.length === 0 && <Vacio>Todavía no hay gastos anotados.</Vacio>}
      {datos?.map((g) => (
        <Tarjeta key={g.id} titulo={<>{CATEGORIAS_GASTO[g.categoria]}{g.anulado && <span className="estado estado-gris">anulado</span>}</>}>
          <Fila izquierda={g.descripcion} derecha={<strong>{cordobas(g.monto)}</strong>} />
          <div className="texto-suave">
            {fecha(g.fecha)} · {personas.get(g.registrado_por)?.nombre} · {g.incluir_en_costo ? 'gasto de planta' : 'fuera del costo del saco'}
          </div>
          {g.anulado && <div className="texto-suave">Anulado: {g.motivo_anulacion}</div>}
          {g.foto_url && <div className="fotos"><VerFoto ruta={g.foto_url} /></div>}
          {!g.anulado && perfil?.rol === 'gerencia' && (anular?.id === g.id ? (
            <>
              <Campo etiqueta="Motivo"><Texto value={anular.motivo} onChange={(e) => setAnular({ ...anular, motivo: e.target.value })} /></Campo>
              <Boton variante="peligro" ocupado={ocupado} onClick={() => correr(() => rpc('anular_gasto', { p_gasto_id: g.id, p_motivo: anular.motivo }))
                .then((ok) => { if (ok) { setAnular(null); recargar() } })}>Anular gasto</Boton>
            </>
          ) : <button className="enlace" onClick={() => setAnular({ id: g.id, motivo: '' })}>Anular</button>)}
        </Tarjeta>
      ))}
    </Pantalla>
  )
}
