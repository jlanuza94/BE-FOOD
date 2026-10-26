import { useState } from 'react'
import { leer, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { num } from '../lib/formato'
import { ROLES, type Item, type Perfil, type Rol } from '../lib/tipos'
import { Boton, Campo, Cargando, Entrada, MensajeError, Fila, Nota, Pantalla, Selector, Tarjeta } from '../components/ui'

const TIPOS: Record<Item['tipo'], string> = {
  materia_prima: 'Materia prima', empaque: 'Empaque (sacos vacíos, hilo…)', producto_terminado: 'Alimento terminado',
}

async function guardar(consulta: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await consulta
  if (error) throw new Error(error.message.includes('row-level') ? 'Solo Gerencia puede cambiar esto.' : error.message)
}

export function Catalogos() {
  const { items, ubicaciones, proveedores, recargarCatalogos } = useSesion()
  const config = useDatos(async () => (await leer(supabase.from('configuracion').select('*').order('clave'))) as { clave: string; valor: number; descripcion: string }[])
  const { ocupado, error, correr } = useAccion()
  const [item, setItem] = useState({ codigo: '', nombre: '', tipo: 'materia_prima' as Item['tipo'], stock_minimo: '', vida_util_dias: '', peso_saco_lb: '100' })
  const [ubicacion, setUbicacion] = useState('')
  const [proveedor, setProveedor] = useState({ nombre: '', telefono: '' })
  const [valores, setValores] = useState<Record<string, string>>({})

  const hacer = (f: () => Promise<unknown>, limpiar: () => void) =>
    correr(async () => {
      await f()
      await recargarCatalogos()
    }).then((ok) => ok && limpiar())

  const esPT = item.tipo === 'producto_terminado'
  return (
    <Pantalla titulo="Catálogos" atras>
      <MensajeError mensaje={error} />

      <Tarjeta titulo="Productos">
        {[...items.values()].map((i) => (
          <Fila key={i.id} izquierda={`${i.nombre} (${i.codigo})`} derecha={`${TIPOS[i.tipo].split(' ')[0]} · mín. ${num(i.stock_minimo)} ${i.unidad}`} />
        ))}
        <h3>Agregar producto</h3>
        <Campo etiqueta="Código corto (va en el código de lote)" ayuda="Solo mayúsculas y números. Ejemplo: MAIZ, SOYA, ENGORDE">
          <Entrada value={item.codigo} onChange={(e) => setItem({ ...item, codigo: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
        </Campo>
        <Campo etiqueta="Nombre"><Entrada value={item.nombre} onChange={(e) => setItem({ ...item, nombre: e.target.value })} /></Campo>
        <Campo etiqueta="Tipo">
          <Selector value={item.tipo} onChange={(e) => setItem({ ...item, tipo: e.target.value as Item['tipo'] })}>
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta={`Stock mínimo (${item.tipo === 'materia_prima' ? 'lb' : 'unidades'})`}>
          <Entrada type="number" inputMode="decimal" value={item.stock_minimo} onChange={(e) => setItem({ ...item, stock_minimo: e.target.value })} />
        </Campo>
        <Campo etiqueta="Días que dura antes de vencer">
          <Entrada type="number" inputMode="numeric" value={item.vida_util_dias} onChange={(e) => setItem({ ...item, vida_util_dias: e.target.value })} />
        </Campo>
        {esPT && (
          <Campo etiqueta="Peso del saco (lb)">
            <Entrada type="number" inputMode="decimal" value={item.peso_saco_lb} onChange={(e) => setItem({ ...item, peso_saco_lb: e.target.value })} />
          </Campo>
        )}
        <Boton ocupado={ocupado} onClick={() => hacer(() => guardar(supabase.from('items').insert({
          codigo: item.codigo, nombre: item.nombre.trim(), tipo: item.tipo,
          unidad: item.tipo === 'materia_prima' ? 'lb' : 'saco',
          stock_minimo: Number(item.stock_minimo || 0),
          vida_util_dias: item.vida_util_dias ? Number(item.vida_util_dias) : null,
          peso_saco_lb: esPT ? Number(item.peso_saco_lb) : null,
        })), () => setItem({ ...item, codigo: '', nombre: '', stock_minimo: '', vida_util_dias: '' }))}>Agregar producto</Boton>
      </Tarjeta>

      <Tarjeta titulo="Ubicaciones">
        {[...ubicaciones.values()].map((u) => <div key={u.id}>{u.nombre}</div>)}
        <Campo etiqueta="Nueva ubicación (silo 1, bodega A, estante 3…)">
          <Entrada value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} />
        </Campo>
        <Boton variante="secundario" ocupado={ocupado} onClick={() => hacer(() => guardar(supabase.from('ubicaciones').insert({ nombre: ubicacion.trim() })), () => setUbicacion(''))}>
          Agregar ubicación
        </Boton>
      </Tarjeta>

      <Tarjeta titulo="Proveedores">
        {[...proveedores.values()].map((p) => <div key={p.id}>{p.nombre}{p.telefono ? ` · ${p.telefono}` : ''}</div>)}
        <Campo etiqueta="Nombre"><Entrada value={proveedor.nombre} onChange={(e) => setProveedor({ ...proveedor, nombre: e.target.value })} /></Campo>
        <Campo etiqueta="Teléfono"><Entrada type="tel" value={proveedor.telefono} onChange={(e) => setProveedor({ ...proveedor, telefono: e.target.value })} /></Campo>
        <Boton variante="secundario" ocupado={ocupado} onClick={() => hacer(() => guardar(supabase.from('proveedores').insert({
          nombre: proveedor.nombre.trim(), telefono: proveedor.telefono || null,
        })), () => setProveedor({ nombre: '', telefono: '' }))}>Agregar proveedor</Boton>
      </Tarjeta>

      <Tarjeta titulo="Reglas que se pueden cambiar">
        <Cargando cargando={config.cargando && !config.datos} error={config.error} />
        {config.datos?.map((c) => (
          <Campo key={c.clave} etiqueta={c.descripcion}>
            <div className="linea-numeros">
              <Entrada type="number" inputMode="decimal" value={valores[c.clave] ?? String(c.valor)}
                onChange={(e) => setValores({ ...valores, [c.clave]: e.target.value })} />
              {valores[c.clave] !== undefined && (
                <Boton variante="secundario" ocupado={ocupado} onClick={() => hacer(
                  () => guardar(supabase.from('configuracion').update({ valor: Number(valores[c.clave]) }).eq('clave', c.clave)),
                  () => { setValores({}); config.recargar() },
                )}>Guardar</Boton>
              )}
            </div>
          </Campo>
        ))}
      </Tarjeta>
    </Pantalla>
  )
}

export function Usuarios() {
  const { personas, recargarCatalogos, perfil } = useSesion()
  const { ocupado, error, correr } = useAccion()
  const [cambios, setCambios] = useState<Record<string, Partial<Perfil>>>({})
  const lista = [...personas.values()].sort((a, b) => Number(a.activo) - Number(b.activo) || a.nombre.localeCompare(b.nombre))

  return (
    <Pantalla titulo="Usuarios" atras>
      <Nota>Cada persona crea su usuario desde la pantalla de entrada. Aquí se activa y se le da su rol.</Nota>
      <MensajeError mensaje={error} />
      {lista.map((p) => {
        const c = { ...p, ...cambios[p.id] }
        const cambiado = !!cambios[p.id]
        return (
          <Tarjeta key={p.id} titulo={<>{p.nombre}{!p.activo && <span className="estado estado-amarillo">sin activar</span>}</>}>
            <Campo etiqueta="Rol">
              <Selector value={c.rol} disabled={p.id === perfil?.id}
                onChange={(e) => setCambios({ ...cambios, [p.id]: { ...cambios[p.id], rol: e.target.value as Rol } })}>
                {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Selector>
            </Campo>
            <label className="casilla">
              <input type="checkbox" checked={c.activo} disabled={p.id === perfil?.id}
                onChange={(e) => setCambios({ ...cambios, [p.id]: { ...cambios[p.id], activo: e.target.checked } })} />
              Activo (puede entrar)
            </label>
            {cambiado && (
              <Boton ocupado={ocupado} onClick={() => correr(async () => {
                await guardar(supabase.from('perfiles').update({ rol: c.rol, activo: c.activo }).eq('id', p.id))
                await recargarCatalogos()
                setCambios(({ [p.id]: _, ...resto }) => resto)
              })}>Guardar</Boton>
            )}
          </Tarjeta>
        )
      })}
    </Pantalla>
  )
}
