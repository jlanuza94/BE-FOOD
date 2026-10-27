import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { leer, rpc, supabase } from './supabase'
import { VEN_CLIENTES, VEN_COSTOS, VEN_FACTURAS, VEN_FORMULAS, VEN_PRECIOS, type Item, type Perfil, type Proveedor, type Rol, type Ubicacion } from './tipos'

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
  /** Si puede ver costos, gastos y utilidad (el vendedor no). */
  veCostos: boolean
  /** Lo que cada grupo puede ver; la base de datos lo hace cumplir. */
  veClientes: boolean
  veFacturas: boolean
  veFormulas: boolean
  vePrecios: boolean
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
      // El precio de venta no se lee de items: solo lo da precios_venta() a quien puede verlo
      leer(supabase.from('items').select('id, codigo, nombre, tipo, unidad, stock_minimo, vida_util_dias, critico, peso_saco_lb, activo').order('nombre')),
      leer(supabase.from('ubicaciones').select('*').order('nombre')),
      leer(supabase.from('proveedores').select('*').order('nombre')),
    ])
    const precios = new Map((await rpc<{ item_id: number; precio_venta: number }[]>('precios_venta')).map((x) => [x.item_id, x.precio_venta]))
    setPersonas(porId(p as Perfil[]))
    setItems(porId((i as Omit<Item, 'precio_venta'>[]).map((x) => ({ ...x, precio_venta: precios.get(x.id) ?? null }))))
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
      value={{
        sesion, perfil, cargando, personas, items, ubicaciones, proveedores, recargarCatalogos, puede,
        veCostos: puede(...VEN_COSTOS),
        veClientes: puede(...VEN_CLIENTES),
        veFacturas: puede(...VEN_FACTURAS),
        veFormulas: puede(...VEN_FORMULAS),
        vePrecios: puede(...VEN_PRECIOS),
      }}
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
