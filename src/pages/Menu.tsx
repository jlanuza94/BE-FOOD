import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { ROLES, type Rol } from '../lib/tipos'
import { Boton, Pantalla, Tarjeta } from '../components/ui'

const OPCIONES: { a: string; texto: string; detalle: string; roles: Rol[] }[] = [
  { a: '/ordenes', texto: 'Órdenes', detalle: 'Pedir, aprobar, entregar y recibir', roles: [] },
  { a: '/inventario', texto: 'Inventario', detalle: 'Existencias por lote, kárdex y etiquetas', roles: [] },
  { a: '/recepcion', texto: 'Recibir materia prima', detalle: 'Pesaje, foto del ticket y cuarentena', roles: ['inventario', 'bodeguero'] },
  { a: '/calidad', texto: 'Calidad', detalle: 'Liberar o rechazar lotes', roles: ['calidad'] },
  { a: '/produccion', texto: 'Producción', detalle: 'Órdenes de producción y etapas', roles: ['jefe_produccion', 'operador', 'calidad', 'inventario'] },
  { a: '/merma', texto: 'Merma', detalle: 'Por lote, turno y operador', roles: ['jefe_produccion', 'socio'] },
  { a: '/formulas', texto: 'Fórmulas', detalle: 'Recetas y sus versiones', roles: ['jefe_produccion', 'calidad', 'inventario'] },
  { a: '/compras', texto: 'Compras', detalle: 'Órdenes de compra', roles: ['inventario'] },
  { a: '/conteos', texto: 'Conteo cíclico', detalle: 'Lo que toca contar hoy', roles: ['inventario', 'bodeguero'] },
  { a: '/usuarios', texto: 'Usuarios', detalle: 'Activar personas y darles su rol', roles: [] },
  { a: '/ajustes', texto: 'Catálogos', detalle: 'Productos, ubicaciones, proveedores y reglas', roles: [] },
]

export function Menu() {
  const { perfil, puede } = useSesion()
  const soloGerencia = new Set(['/usuarios', '/ajustes'])
  const visibles = OPCIONES.filter((o) =>
    soloGerencia.has(o.a) ? perfil?.rol === 'gerencia' : o.roles.length === 0 || puede(...o.roles),
  )
  return (
    <Pantalla titulo="Menú">
      <Tarjeta titulo={perfil?.nombre}>
        <div className="texto-suave">{perfil && ROLES[perfil.rol]}</div>
      </Tarjeta>
      {visibles.map((o) => (
        <Tarjeta key={o.a} a={o.a} titulo={o.texto}>
          <div className="texto-suave">{o.detalle}</div>
        </Tarjeta>
      ))}
      <Boton variante="secundario" onClick={() => supabase.auth.signOut()}>Salir</Boton>
    </Pantalla>
  )
}
