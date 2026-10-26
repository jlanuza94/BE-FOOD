import { useEffect, useRef, useState } from 'react'

/** El cliente firma con el dedo en la pantalla. Devuelve la firma como imagen PNG. */
export function Firma({ onCambio }: { onCambio: (archivo: File | null) => void }) {
  const lienzo = useRef<HTMLCanvasElement>(null)
  const dibujando = useRef(false)
  const [vacia, setVacia] = useState(true)

  useEffect(() => {
    const c = lienzo.current!
    const escala = window.devicePixelRatio || 1
    c.width = c.offsetWidth * escala
    c.height = c.offsetHeight * escala
    const ctx = c.getContext('2d')!
    ctx.scale(escala, escala)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1d211e'
  }, [])

  const punto = (e: React.PointerEvent) => {
    const r = lienzo.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }

  function empezar(e: React.PointerEvent) {
    dibujando.current = true
    lienzo.current!.setPointerCapture(e.pointerId)
    const ctx = lienzo.current!.getContext('2d')!
    ctx.beginPath()
    ctx.moveTo(...punto(e))
  }

  function mover(e: React.PointerEvent) {
    if (!dibujando.current) return
    const ctx = lienzo.current!.getContext('2d')!
    ctx.lineTo(...punto(e))
    ctx.stroke()
  }

  function terminar() {
    if (!dibujando.current) return
    dibujando.current = false
    setVacia(false)
    lienzo.current!.toBlob((b) => onCambio(b ? new File([b], 'firma.png', { type: 'image/png' }) : null), 'image/png')
  }

  function borrar() {
    const c = lienzo.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setVacia(true)
    onCambio(null)
  }

  return (
    <div className="campo">
      <span className="campo-etiqueta">Firma del cliente</span>
      <canvas ref={lienzo} className="firma" aria-label="Espacio para firmar"
        onPointerDown={empezar} onPointerMove={mover} onPointerUp={terminar} onPointerLeave={terminar} />
      {!vacia && <button type="button" className="enlace" onClick={borrar}>Borrar firma</button>}
    </div>
  )
}
