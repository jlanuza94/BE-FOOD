import { useState } from 'react'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { cordobas } from '../lib/formato'
import type { Cliente, CuentaPorCobrar } from '../lib/tipos'
import { Boton, Campo, Cargando, Entrada, MensajeError, Fila, Pantalla, Tarjeta, Vacio } from '../components/ui'

const VACIO = { nombre: '', telefono: '', direccion: '', dias_credito: '0', limite_credito: '0', activo: true }

export function Clientes() {
  const { puede } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    clientes: (await leer(supabase.from('clientes').select('*').order('nombre'))) as Cliente[],
    cuentas: (await leer(supabase.from('cuentas_por_cobrar').select('cliente_id, saldo, dias_atraso'))) as Pick<CuentaPorCobrar, 'cliente_id' | 'saldo' | 'dias_atraso'>[],
  }))
  const [editando, setEditando] = useState<number | 'nuevo' | null>(null)
  const [form, setForm] = useState(VACIO)
  const { ocupado, error: errorAccion, correr } = useAccion()
  const daCredito = puede('administracion')

  function abrir(c?: Cliente) {
    setEditando(c ? c.id : 'nuevo')
    setForm(c ? {
      nombre: c.nombre, telefono: c.telefono ?? '', direccion: c.direccion ?? '',
      dias_credito: String(c.dias_credito), limite_credito: String(c.limite_credito), activo: c.activo,
    } : VACIO)
  }

  const guardar = () => correr(() => rpc('guardar_cliente', {
    p_id: editando === 'nuevo' ? null : editando, p_nombre: form.nombre, p_telefono: form.telefono || null,
    p_direccion: form.direccion || null, p_dias_credito: Number(form.dias_credito || 0),
    p_limite_credito: Number(form.limite_credito || 0), p_activo: form.activo,
  })).then((ok) => { if (ok) { setEditando(null); recargar() } })

  if (editando !== null) {
    return (
      <Pantalla titulo={editando === 'nuevo' ? 'Cliente nuevo' : 'Editar cliente'} atras>
        <Campo etiqueta="Nombre"><Entrada value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></Campo>
        <Campo etiqueta="Teléfono"><Entrada type="tel" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></Campo>
        <Campo etiqueta="Dirección"><Entrada value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} /></Campo>
        <Campo etiqueta="Días de crédito" ayuda={daCredito ? '0 = solo contado' : 'El crédito lo asigna Gerencia o Administración.'}>
          <Entrada type="number" inputMode="numeric" disabled={!daCredito} value={form.dias_credito}
            onChange={(e) => setForm({ ...form, dias_credito: e.target.value })} />
        </Campo>
        <Campo etiqueta="Límite de crédito (C$)" ayuda="0 = sin límite">
          <Entrada type="number" inputMode="decimal" disabled={!daCredito} value={form.limite_credito}
            onChange={(e) => setForm({ ...form, limite_credito: e.target.value })} />
        </Campo>
        {daCredito && (
          <label className="casilla">
            <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /> Cliente activo
          </label>
        )}
        <MensajeError mensaje={errorAccion} />
        <Boton onClick={guardar} ocupado={ocupado}>Guardar</Boton>
        <Boton variante="secundario" onClick={() => setEditando(null)}>Cancelar</Boton>
      </Pantalla>
    )
  }

  return (
    <Pantalla titulo="Clientes" atras>
      {puede('vendedor', 'administracion') && <Boton onClick={() => abrir()}>+ Cliente nuevo</Boton>}
      <Cargando cargando={cargando && !datos} error={error} />
      {datos?.clientes.length === 0 && <Vacio>Todavía no hay clientes.</Vacio>}
      {datos?.clientes.map((c) => {
        const suyas = datos.cuentas.filter((x) => x.cliente_id === c.id)
        const debe = suyas.reduce((s, x) => s + Number(x.saldo), 0)
        const atrasado = suyas.some((x) => Number(x.saldo) > 0 && x.dias_atraso > 0)
        return (
          <Tarjeta key={c.id} titulo={<>{c.nombre}{!c.activo && <span className="estado estado-gris">inactivo</span>}</>}>
            {c.telefono && <div className="texto-suave">{c.telefono}{c.direccion ? ` · ${c.direccion}` : ''}</div>}
            <Fila izquierda="Crédito" derecha={c.dias_credito > 0 ? `${c.dias_credito} días${Number(c.limite_credito) > 0 ? ` · hasta ${cordobas(c.limite_credito)}` : ''}` : 'Solo contado'} />
            {debe > 0 && <Fila izquierda="Debe" derecha={<strong className={atrasado ? 'texto-error' : ''}>{cordobas(debe)}{atrasado ? ' · atrasado' : ''}</strong>} />}
            {puede('vendedor', 'administracion') && <Boton variante="secundario" onClick={() => abrir(c)}>Editar</Boton>}
          </Tarjeta>
        )
      })}
    </Pantalla>
  )
}
