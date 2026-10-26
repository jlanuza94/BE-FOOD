import { useState } from 'react'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { fechaHora } from '../lib/formato'
import type { Comentario, EntidadComentario } from '../lib/tipos'
import { Boton, Cargando, MensajeError, Tarjeta, Texto } from './ui'

/** Comentarios dentro de una orden. Al comentar, les llega un aviso a quienes la tocaron y a sus áreas. */
export function Comentarios({ entidad, id }: { entidad: EntidadComentario; id: number }) {
  const { personas } = useSesion()
  const [texto, setTexto] = useState('')
  const { ocupado, error, correr } = useAccion()
  const { datos, cargando, error: errorCarga, recargar } = useDatos(
    async () => (await leer(supabase.from('comentarios').select('*')
      .eq('entidad', entidad).eq('entidad_id', id).order('id'))) as Comentario[],
    [entidad, id],
  )

  async function enviar() {
    if (await correr(() => rpc('comentar', { p_entidad: entidad, p_entidad_id: id, p_texto: texto }))) {
      setTexto('')
      recargar()
    }
  }

  return (
    <Tarjeta titulo={`Comentarios${datos?.length ? ` (${datos.length})` : ''}`}>
      <Cargando cargando={cargando && !datos} error={errorCarga} />
      {datos?.map((c) => (
        <div key={c.id} className="comentario">
          <div className="comentario-autor">
            {personas.get(c.autor)?.nombre ?? '—'} <span className="texto-suave">· {fechaHora(c.creado_en)}</span>
          </div>
          <div>{c.texto}</div>
        </div>
      ))}
      <Texto value={texto} onChange={(e) => setTexto(e.target.value)}
        placeholder="Escriba o dicte con el micrófono del teclado" aria-label="Comentario" />
      <MensajeError mensaje={error} />
      <Boton variante="secundario" ocupado={ocupado} disabled={!texto.trim()} onClick={enviar}>Comentar y avisar</Boton>
    </Tarjeta>
  )
}
