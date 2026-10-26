import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { leer, supabase } from '../lib/supabase'
import { fecha, num } from '../lib/formato'
import type { LoteInventario } from '../lib/tipos'
import { Boton, Campo, Entrada, MensajeError, Pantalla, Tarjeta } from '../components/ui'

interface Resultado { lote: LoteInventario; antes: LoteInventario | null }

// Chrome en Android lee QR solo; si el celular no puede, se usa jsQR.
interface Detector { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
declare global { interface Window { BarcodeDetector?: new (o: { formats: string[] }) => Detector } }

async function crearLector(): Promise<(v: HTMLVideoElement) => Promise<string | null>> {
  if (window.BarcodeDetector) {
    try {
      const d = new window.BarcodeDetector({ formats: ['qr_code'] })
      return async (v) => (await d.detect(v))[0]?.rawValue ?? null
    } catch {
      // Sigue con jsQR
    }
  }
  const jsQR = (await import('jsqr')).default
  const lienzo = document.createElement('canvas')
  const ctx = lienzo.getContext('2d', { willReadFrequently: true })!
  return async (v) => {
    lienzo.width = v.videoWidth
    lienzo.height = v.videoHeight
    ctx.drawImage(v, 0, 0)
    const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height)
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null
  }
}

function bip() {
  try {
    const audio = new AudioContext()
    const o = audio.createOscillator()
    o.frequency.value = 1200
    o.connect(audio.destination)
    o.start()
    o.stop(audio.currentTime + 0.12)
    o.onended = () => audio.close()
  } catch {
    // Sin sonido no pasa nada
  }
  navigator.vibrate?.(120)
}

async function buscarLote(codigo: string): Promise<Resultado | null> {
  const lote = (await leer(supabase.from('inventario_lotes').select('*').eq('codigo', codigo.trim().toUpperCase()).maybeSingle())) as LoteInventario | null
  if (!lote) return null
  // FEFO: ¿hay otro lote liberado del mismo producto que vence antes?
  let antes: LoteInventario | null = null
  if (lote.estado === 'liberado' && lote.fecha_caducidad) {
    const otros = (await leer(supabase.from('inventario_lotes').select('*')
      .eq('item_id', lote.item_id).eq('estado', 'liberado').gt('disponible', 0).neq('id', lote.id)
      .gte('fecha_caducidad', new Date().toISOString().slice(0, 10))
      .lt('fecha_caducidad', lote.fecha_caducidad).order('fecha_caducidad').limit(1))) as LoteInventario[]
    antes = otros[0] ?? null
  }
  return { lote, antes }
}

function Veredicto({ r }: { r: Resultado }) {
  const { lote, antes } = r
  const vencido = lote.dias_para_vencer !== null && lote.dias_para_vencer < 0
  const [color, titulo, detalle] =
    vencido ? ['rojo', '⛔ Lote vencido. No lo use.', `Venció el ${fecha(lote.fecha_caducidad)}.`]
    : lote.estado === 'liberado' ? (Number(lote.disponible) > 0
      ? ['verde', '✅ Lote liberado. Puede usarlo.', `Disponible: ${num(lote.disponible)} ${lote.unidad}.`]
      : ['amarillo', 'Lote liberado, pero no le queda disponible.', `Existencia ${num(lote.existencia)} ${lote.unidad}, apartado ${num(lote.reservado)}.`])
    : lote.estado === 'cuarentena' ? ['amarillo', '⏳ En cuarentena. No lo use todavía.', 'Calidad tiene que liberarlo primero.']
    : ['rojo', `⛔ Lote ${lote.estado}. No lo use.`, lote.estado === 'rechazado' ? 'Calidad lo rechazó.' : '']
  return (
    <>
      <div className={`resultado resultado-${color}`} role="status">
        {titulo}
        <small>{detalle}</small>
      </div>
      {antes && (
        <div className="resultado resultado-amarillo">
          Ojo: use primero el lote que vence antes.
          <small><Link to={`/lotes/${antes.id}`}>{antes.codigo}</Link> vence el {fecha(antes.fecha_caducidad)}{antes.ubicacion ? `, en ${antes.ubicacion}` : ''}.</small>
        </div>
      )}
      <Tarjeta titulo={lote.codigo} a={`/lotes/${lote.id}`}>
        <div>{lote.item}</div>
        <div className="texto-suave">
          {lote.ubicacion ?? 'Sin ubicación'} · vence {fecha(lote.fecha_caducidad)}{lote.proveedor ? ` · ${lote.proveedor}` : ''}
        </div>
        <div className="texto-suave">Toque para ver el lote completo</div>
      </Tarjeta>
    </>
  )
}

/** Apunte la cámara al QR del lote o saco: suena un bip y dice si se puede usar. */
export function Escanear() {
  const video = useRef<HTMLVideoElement>(null)
  const [activo, setActivo] = useState(true)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')

  const mostrar = useCallback(async (texto: string) => {
    setError(null)
    try {
      const r = await buscarLote(texto)
      if (!r) setError(`No hay un lote con el código ${texto}.`)
      setResultado(r)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    if (!activo) return
    let flujo: MediaStream | null = null
    let seguir = true
    ;(async () => {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (!seguir || !video.current) return
        video.current.srcObject = flujo
        await video.current.play()
        const leer = await crearLector()
        while (seguir) {
          const v = video.current
          if (v && v.readyState >= 2) {
            const texto = await leer(v).catch(() => null)
            if (texto && seguir) {
              bip()
              setActivo(false)
              await mostrar(texto)
              return
            }
          }
          await new Promise((ok) => setTimeout(ok, 200))
        }
      } catch {
        setError('No se pudo abrir la cámara. Dé permiso a la cámara o escriba el código abajo.')
        setActivo(false)
      }
    })()
    return () => {
      seguir = false
      flujo?.getTracks().forEach((t) => t.stop())
    }
  }, [activo, mostrar])

  return (
    <Pantalla titulo="Escanear QR" atras>
      {activo && (
        <div className="escaner">
          <video ref={video} playsInline muted />
          <div className="escaner-marco" />
        </div>
      )}
      {activo && <div className="texto-suave">Apunte al código QR del lote o del saco.</div>}
      <MensajeError mensaje={error} />
      {resultado && <Veredicto r={resultado} />}
      {!activo && (
        <Boton onClick={() => { setResultado(null); setError(null); setActivo(true) }}>📷 Escanear otro</Boton>
      )}
      <Tarjeta titulo="¿No lee el QR?">
        <Campo etiqueta="Escriba el código del lote">
          <Entrada value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="MP-2026-1026-MAIZ-001" autoCapitalize="characters" />
        </Campo>
        <Boton variante="secundario" disabled={!codigo.trim()} onClick={() => { setActivo(false); mostrar(codigo) }}>Buscar</Boton>
      </Tarjeta>
    </Pantalla>
  )
}
