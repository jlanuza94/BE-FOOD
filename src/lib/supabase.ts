import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const clave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configurado = Boolean(url && clave)
export const supabase = createClient(url ?? 'http://localhost', clave ?? 'sin-configurar')

/** Llama una acción de la base de datos. Si una regla la bloquea, lanza el mensaje para el usuario. */
export async function rpc<T = unknown>(funcion: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(funcion, args)
  if (error) throw new Error(error.message)
  return data as T
}

/** Espera una consulta y devuelve sus datos, o lanza el error. */
export async function leer<T>(consulta: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await consulta
  if (error) throw new Error(error.message)
  return data as T
}

/** Sube una foto de prueba y devuelve su ruta dentro del depósito de fotos. */
export async function subirFoto(carpeta: string, archivo: File): Promise<string> {
  const ext = archivo.name.split('.').pop()?.toLowerCase() || 'jpg'
  const ruta = `${carpeta}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('fotos').upload(ruta, archivo, { upsert: false })
  if (error) throw new Error('No se pudo subir la foto: ' + error.message)
  return ruta
}

export async function urlFoto(ruta: string): Promise<string> {
  const { data, error } = await supabase.storage.from('fotos').createSignedUrl(ruta, 3600)
  if (error) throw new Error(error.message)
  return data.signedUrl
}
