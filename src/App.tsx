import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { configurado } from './lib/supabase'
import { useSesion } from './lib/sesion'
import { Ingresar, SinActivar, SinConfigurar } from './pages/Ingresar'
import { Inicio } from './pages/Inicio'
import { Menu } from './pages/Menu'
import { Ordenes, OrdenDetalle } from './pages/Ordenes'
import { Inventario, LoteDetalle } from './pages/Inventario'
import { Recepcion } from './pages/Recepcion'
import { Calidad } from './pages/Calidad'
import { Compras, CompraDetalle, CompraNueva } from './pages/Compras'
import { Formulas, FormulaNueva } from './pages/Formulas'
import { Produccion, ProduccionDetalle, ProduccionNueva } from './pages/Produccion'
import { Conteos } from './pages/Conteos'
import { Avisos } from './pages/Avisos'
import { Catalogos, Usuarios } from './pages/Ajustes'
import { Merma } from './pages/Merma'
import { Ventas, VentaDetalle, VentaNueva } from './pages/Ventas'
import { Clientes } from './pages/Clientes'
import { Cobros, FacturaDetalle } from './pages/Cobros'
import { Pagos } from './pages/Pagos'
import { Gastos } from './pages/Gastos'
import { Costos } from './pages/Costos'
import { Utilidad } from './pages/Utilidad'
import { Bitacora } from './pages/Bitacora'
import { Escanear } from './pages/Escanear'

export function App() {
  const { sesion, perfil, cargando } = useSesion()

  if (!configurado) return <SinConfigurar />
  if (cargando) return <div className="cargando cargando-total">BE Food</div>
  if (!sesion) return <Ingresar />
  if (!perfil?.activo) return <SinActivar />

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/menu" element={<Menu />} />
        <Route path="/ordenes" element={<Ordenes />} />
        <Route path="/ordenes/:id" element={<OrdenDetalle />} />
        <Route path="/inventario" element={<Inventario />} />
        <Route path="/lotes/:id" element={<LoteDetalle />} />
        <Route path="/recepcion" element={<Recepcion />} />
        <Route path="/calidad" element={<Calidad />} />
        <Route path="/compras" element={<Compras />} />
        <Route path="/compras/nueva" element={<CompraNueva />} />
        <Route path="/compras/:id" element={<CompraDetalle />} />
        <Route path="/formulas" element={<Formulas />} />
        <Route path="/formulas/nueva" element={<FormulaNueva />} />
        <Route path="/produccion" element={<Produccion />} />
        <Route path="/produccion/nueva" element={<ProduccionNueva />} />
        <Route path="/produccion/:id" element={<ProduccionDetalle />} />
        <Route path="/conteos" element={<Conteos />} />
        <Route path="/merma" element={<Merma />} />
        <Route path="/ventas" element={<Ventas />} />
        <Route path="/ventas/nueva" element={<VentaNueva />} />
        <Route path="/ventas/:id" element={<VentaDetalle />} />
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/cobros" element={<Cobros />} />
        <Route path="/facturas/:id" element={<FacturaDetalle />} />
        <Route path="/pagos" element={<Pagos />} />
        <Route path="/gastos" element={<Gastos />} />
        <Route path="/costos" element={<Costos />} />
        <Route path="/utilidad" element={<Utilidad />} />
        <Route path="/avisos" element={<Avisos />} />
        <Route path="/bitacora" element={<Bitacora />} />
        <Route path="/escanear" element={<Escanear />} />
        <Route path="/ajustes" element={<Catalogos />} />
        <Route path="/proveedores" element={<Navigate to="/ajustes" replace />} />
        <Route path="/usuarios" element={<Usuarios />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <nav className="nav-inferior">
        <NavLink to="/" end>
          <span aria-hidden>🏠</span>Inicio
        </NavLink>
        <NavLink to="/ordenes">
          <span aria-hidden>📋</span>Órdenes
        </NavLink>
        <NavLink to="/inventario">
          <span aria-hidden>📦</span>Inventario
        </NavLink>
        <NavLink to="/avisos">
          <span aria-hidden>🔔</span>Avisos
        </NavLink>
        <NavLink to="/menu">
          <span aria-hidden>☰</span>Menú
        </NavLink>
      </nav>
    </div>
  )
}
