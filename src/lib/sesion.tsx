import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { leer, supabase } from './supabase'
import type { Item, Perfil, Proveedor, Rol, Ubicacion } from './tipos'

interface Sesion {
  sesion: Session | null
  perfil: Perfil | null
  cargando: boolean
  personas: Map<string, Perfil>
  items: Map<number, Item>
  ubicaciones: Map<number, Ubicacion>
  proveedores: Map<number, Proveedor>
  recargarCatalogos: () => Promise<void>
  /** Gerencia puede todo; los demás solo lo de sus roles. */
  puede: (...roles: Rol[]) => boolean
}

const Contexto = createContext<Sesion | null>(null)

const porId = <K, T extends { id: K }>(filas: T[]) => new Map(filas.map((f) => [f.id, f]))

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [cargando, setCargando] = useState(true)
  const [personas, setPersonas] = useState(new Map<string, Perfil>())
  const [items, setItems] = useState(new Map<number, Item>())
  const [ubicaciones, setUbicaciones] = useState(new Map<number, Ubicacion>())
  const [proveedores, setProveedores] = useState(new Map<number, Proveedor>())

  const recargarCatalogos = useCallback(async () => {
    const [p, i, u, pr] = await Promise.all([
      leer(supabase.from('perfiles').select('*').order('nombre')),
      leer(supabase.from('items').select('*').order('nombre')),
      leer(supabase.from('ubicaciones').select('*').order('nombre')),
      leer(supabase.from('proveedores').select('*').order('nombre')),
    ])
    setPersonas(porId(p as Perfil[]))
    setItems(porId(i as Item[]))
    setUbicaciones(porId(u as Ubicacion[]))
    setProveedores(porId(pr as Proveedor[]))
  }, [])

  const cargarPerfil = useCallback(
    async (s: Session | null) => {
      setSesion(s)
      if (!s) {
        setPerfil(null)
        setCargando(false)
        return
      }
      try {
        const p = await leer(supabase.from('perfiles').select('*').eq('id', s.user.id).maybeSingle())
        setPerfil(p as Perfil | null)
        if (p && (p as Perfil).activo) await recargarCatalogos()
      } catch (e) {
        console.error('No se pudo cargar el usuario', e)
      } finally {
        setCargando(false)
      }
    },
    [recargarCatalogos],
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => cargarPerfil(data.session))
    const { data } = supabase.auth.onAuthStateChange((evento, s) => {
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT') cargarPerfil(s)
    })
    return () => data.subscription.unsubscribe()
  }, [cargarPerfil])

  const puede = useCallback(
    (...roles: Rol[]) => !!perfil?.activo && (perfil.rol === 'gerencia' || roles.includes(perfil.rol)),
    [perfil],
  )

  return (
    <Contexto.Provider
      value={{ sesion, perfil, cargando, personas, items, ubicaciones, proveedores, recargarCatalogos, puede }}
    >
      {children}
    </Contexto.Provider>
  )
}

export function useSesion(): Sesion {
  const s = useContext(Contexto)
  if (!s) throw new Error('useSesion fuera de ProveedorSesion')
  return s
}
