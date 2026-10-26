import { useNavigate } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { fechaHora } from '../lib/formato'
import type { Aviso } from '../lib/tipos'
import { Boton, Cargando, Pantalla, Vacio } from '../components/ui'

export function Avisos() {
  const { perfil } = useSesion()
  const navegar = useNavigate()
  const { datos, cargando, error, recargar } = useDatos(
    async () => (await leer(supabase.from('avisos').select('*').order('id', { ascending: false }).limit(100))) as Aviso[],
  )
  const sinLeer = (datos ?? []).filter((a) => !a.leido_por.includes(perfil!.id))

  async function abrir(a: Aviso) {
    if (!a.leido_por.includes(perfil!.id)) await rpc('marcar_aviso_leido', { p_aviso_id: a.id })
    if (a.enlace) navegar(a.enlace)
    else recargar()
  }

  return (
    <Pantalla titulo="Avisos">
      {sinLeer.length > 0 && (
        <Boton variante="secundario" onClick={async () => {
          await Promise.all(sinLeer.map((a) => rpc('marcar_aviso_leido', { p_aviso_id: a.id })))
          recargar()
        }}>Marcar todos como leídos</Boton>
      )}
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.length === 0 && <Vacio>No hay avisos.</Vacio>}
      {datos?.map((a) => (
        <button key={a.id} className={`tarjeta aviso ${a.leido_por.includes(perfil!.id) ? '' : 'aviso-nuevo'}`} onClick={() => abrir(a)}>
          <div>{a.mensaje}</div>
          <div className="texto-suave">{fechaHora(a.creado_en)}</div>
        </button>
      ))}
    </Pantalla>
  )
}
