import { useState } from 'react'
import { Link } from 'react-router-dom'
import { leer, rpc, supabase } from '../lib/supabase'
import { useAccion, useDatos } from '../lib/usar'
import { useSesion } from '../lib/sesion'
import { fechaHora, num } from '../lib/formato'
import { Boton, Campo, Cargando, Entrada, MensajeError, Estado, Fila, Nota, Pantalla, Tarjeta, Texto, Vacio } from '../components/ui'

export interface PorContar { lote_id: number; codigo: string; item: string; unidad: string; ubicacion: string | null }
interface Conteo {
  id: number; lote_id: number; cantidad_sistema: number; cantidad_contada: number; diferencia: number
  motivo: string | null; estado: string; contado_por: string; contado_en: string
}

export function Conteos() {
  const { puede, perfil, personas } = useSesion()
  const { datos, cargando, error, recargar } = useDatos(async () => ({
    hoy: puede('bodeguero', 'inventario') ? ((await rpc<PorContar[]>('lotes_para_contar_hoy')) ?? []) : [],
    recientes: (await leer(supabase.from('conteos').select('*').order('id', { ascending: false }).limit(50))) as Conteo[],
    codigos: new Map(((await leer(supabase.from('lotes').select('id, codigo'))) as { id: number; codigo: string }[]).map((l) => [l.id, l.codigo])),
  }))

  const pendientes = (datos?.recientes ?? []).filter((c) => c.estado === 'pendiente')
  return (
    <Pantalla titulo="Conteo cíclico" atras>
      <Cargando cargando={cargando && !datos} error={error} />
      {datos && puede('bodeguero', 'inventario') && (
        <>
          <Tarjeta a="/conteo-general" titulo="📋 Conteo general">
            <div className="texto-suave">Contar toda la bodega o una ubicación de una vez</div>
          </Tarjeta>
          <h2>Contar hoy</h2>
          <Nota>Cuente sin mirar el sistema. Si no cuadra, la app le pedirá la explicación.</Nota>
          {datos.hoy.length === 0 && <Vacio>Ya se contó todo lo de hoy.</Vacio>}
          {datos.hoy.map((l) => <ContarLote key={l.lote_id} lote={l} alGuardar={recargar} />)}
        </>
      )}
      {perfil?.rol === 'gerencia' && pendientes.length > 0 && (
        <>
          <h2>Ajustes por autorizar</h2>
          {pendientes.map((c) => <Autorizar key={c.id} conteo={c} codigo={datos!.codigos.get(c.lote_id) ?? ''} alGuardar={recargar} />)}
        </>
      )}
      {datos && (
        <>
          <h2>Historial</h2>
          {datos.recientes.map((c) => (
            <Tarjeta key={c.id} titulo={<><Link to={`/lotes/${c.lote_id}`}>{datos.codigos.get(c.lote_id)}</Link> <Estado valor={c.estado} /></>}>
              <Fila izquierda="Sistema / contado" derecha={`${num(c.cantidad_sistema)} / ${num(c.cantidad_contada)}`} />
              {Number(c.diferencia) !== 0 && <Fila izquierda="Diferencia" derecha={<strong>{num(c.diferencia)}</strong>} />}
              {c.motivo && <div>{c.motivo}</div>}
              <div className="texto-suave">{personas.get(c.contado_por)?.nombre} · {fechaHora(c.contado_en)}</div>
            </Tarjeta>
          ))}
        </>
      )}
    </Pantalla>
  )
}

/** Conteo a ciegas de un lote: no muestra lo que dice el sistema. */
export function ContarLote({ lote, conteoGeneralId, alGuardar }: { lote: PorContar; conteoGeneralId?: number; alGuardar: () => void }) {
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const { ocupado, error, correr } = useAccion()
  const pideMotivo = !!error?.includes('explicación')
  return (
    <Tarjeta titulo={lote.codigo}>
      <div className="texto-suave">{lote.item} · {lote.ubicacion ?? 'Sin ubicación'}</div>
      <Campo etiqueta={`Lo que contó (${lote.unidad})`}>
        <Entrada type="number" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
      </Campo>
      {pideMotivo && (
        <Campo etiqueta="Explicación">
          <Texto value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Campo>
      )}
      <MensajeError mensaje={error} />
      <Boton ocupado={ocupado} disabled={cantidad === ''} onClick={() => correr(() => conteoGeneralId
        ? rpc('contar_en_conteo_general', { p_conteo_general_id: conteoGeneralId, p_lote_id: lote.lote_id, p_cantidad: Number(cantidad), p_motivo: motivo || null })
        : rpc('registrar_conteo', { p_lote_id: lote.lote_id, p_cantidad: Number(cantidad), p_motivo: motivo || null }),
      ).then((ok) => ok && alGuardar())}>Guardar conteo</Boton>
    </Tarjeta>
  )
}

function Autorizar({ conteo, codigo, alGuardar }: { conteo: Conteo; codigo: string; alGuardar: () => void }) {
  const { personas } = useSesion()
  const { ocupado, error, correr } = useAccion()
  const decidir = (aprobar: boolean) =>
    correr(() => rpc('revisar_conteo', { p_conteo_id: conteo.id, p_aprobar: aprobar })).then((ok) => ok && alGuardar())
  return (
    <Tarjeta titulo={codigo}>
      <Fila izquierda="Sistema / contado" derecha={`${num(conteo.cantidad_sistema)} / ${num(conteo.cantidad_contada)}`} />
      <Fila izquierda="Diferencia" derecha={<strong>{num(conteo.diferencia)}</strong>} />
      <div>{conteo.motivo}</div>
      <div className="texto-suave">Contó {personas.get(conteo.contado_por)?.nombre} · {fechaHora(conteo.contado_en)}</div>
      <MensajeError mensaje={error} />
      <Boton ocupado={ocupado} onClick={() => decidir(true)}>Autorizar ajuste</Boton>
      <Boton variante="secundario" ocupado={ocupado} onClick={() => decidir(false)}>No ajustar</Boton>
    </Tarjeta>
  )
}
