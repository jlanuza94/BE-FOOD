import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAccion } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { Boton, Campo, Entrada, MensajeError, Nota } from '../components/ui'

export function Ingresar() {
  const [modo, setModo] = useState<'entrar' | 'registrarse'>('entrar')
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [nombre, setNombre] = useState('')
  const [listo, setListo] = useState(false)
  const { ocupado, error, correr } = useAccion()

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    await correr(async () => {
      if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email: correo.trim(), password: clave })
        if (error) throw new Error('Correo o contraseña incorrectos.')
      } else {
        if (!nombre.trim()) throw new Error('Escriba su nombre.')
        const { error } = await supabase.auth.signUp({
          email: correo.trim(), password: clave, options: { data: { nombre: nombre.trim() } },
        })
        if (error) throw new Error(error.message)
        setListo(true)
      }
    })
  }

  return (
    <div className="ingreso">
      <img src="/icono-192.png" alt="" className="ingreso-logo" />
      <h1>BE Food</h1>
      <p className="ingreso-sub">Control de órdenes, inventario, calidad y producción</p>
      <form onSubmit={enviar} className="ingreso-form">
        {modo === 'registrarse' && (
          <Campo etiqueta="Su nombre">
            <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" />
          </Campo>
        )}
        <Campo etiqueta="Correo">
          <Entrada type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} autoComplete="email" required />
        </Campo>
        <Campo etiqueta="Contraseña">
          <Entrada type="password" value={clave} onChange={(e) => setClave(e.target.value)} minLength={6} required
            autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} />
        </Campo>
        <MensajeError mensaje={error} />
        {listo && <Nota>Listo. Si se le pide confirmar el correo, hágalo; luego Gerencia debe activar su usuario.</Nota>}
        <Boton type="submit" ocupado={ocupado}>{modo === 'entrar' ? 'Entrar' : 'Crear mi usuario'}</Boton>
      </form>
      <button className="enlace" onClick={() => setModo(modo === 'entrar' ? 'registrarse' : 'entrar')}>
        {modo === 'entrar' ? '¿Es nuevo? Cree su usuario' : 'Ya tengo usuario'}
      </button>
    </div>
  )
}

export function SinActivar() {
  const { perfil } = useSesion()
  return (
    <div className="ingreso">
      <h1>Hola{perfil ? `, ${perfil.nombre}` : ''}</h1>
      <p className="ingreso-sub">Su usuario está creado. Gerencia tiene que activarlo y darle su rol antes de que pueda usar la aplicación.</p>
      <Boton variante="secundario" onClick={() => location.reload()}>Ya me activaron</Boton>
      <button className="enlace" onClick={() => supabase.auth.signOut()}>Salir</button>
    </div>
  )
}

export function SinConfigurar() {
  return (
    <div className="ingreso">
      <h1>Falta conectar la base de datos</h1>
      <p className="ingreso-sub">
        Ponga VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el archivo .env.local (vea el README).
      </p>
    </div>
  )
}
