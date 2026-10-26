import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/sesion'
import { ROLES, VEN_COSTOS, type Rol } from '../lib/tipos'
import { useState } from 'react'
import { Boton, Campo, Pantalla, Selector, Tarjeta } from '../components/ui'
import { aplicarTema, temaGuardado, TEMAS, type Tema } from '../lib/tema'

const OPCIONES: { a: string; texto: string; detalle: string; roles: Rol[] }[] = [
  { a: '/utilidad', texto: 'Utilidad', detalle: 'Ventas, costos, gastos y ganancia', roles: VEN_COSTOS },
  { a: '/ventas', texto: 'Ventas', detalle: 'Pedidos de clientes y despachos', roles: ['vendedor', 'administracion', 'despacho', 'bodeguero', 'socio'] },
  { a: '/clientes', texto: 'Clientes', detalle: 'Datos, crédito y lo que deben', roles: ['vendedor', 'administracion', 'socio'] },
  { a: '/cobros', texto: 'Cobros', detalle: 'Facturas y abonos de clientes', roles: ['administracion', 'vendedor', 'socio'] },
  { a: '/pagos', texto: 'Pagos a proveedores', detalle: 'Facturas, aprobación y comprobantes', roles: ['administracion', 'inventario', 'socio'] },
  { a: '/gastos', texto: 'Gastos', detalle: 'Luz, salarios, transporte y demás', roles: ['administracion', 'socio'] },
  { a: '/costos', texto: 'Costo por saco', detalle: 'Cuánto cuesta y cuánto se gana', roles: VEN_COSTOS },
  { a: '/bitacora', texto: 'Bitácora de turno', detalle: 'Notas del turno que sale al que entra', roles: [] },
  { a: '/escanear', texto: 'Escanear QR', detalle: 'Ver si un lote se puede usar', roles: [] },
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
  const [tema, setTema] = useState<Tema>(temaGuardado())
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
      <Tarjeta>
        <Campo etiqueta="Pantalla" ayuda="El modo oscuro no encandila en los turnos de madrugada.">
          <Selector value={tema} onChange={(e) => { const t = e.target.value as Tema; setTema(t); aplicarTema(t) }}>
            {Object.entries(TEMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Selector>
        </Campo>
      </Tarjeta>
      <Boton variante="secundario" onClick={() => supabase.auth.signOut()}>Salir</Boton>
    </Pantalla>
  )
}
