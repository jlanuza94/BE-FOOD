import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { enlaceWhatsApp } from '../lib/whatsapp'

export function Pantalla({ titulo, atras, children, accion, pdf }: {
  titulo: string
  atras?: boolean
  accion?: ReactNode
  /** Nombre del archivo: muestra el botón para guardar o compartir la pantalla en PDF. */
  pdf?: string
  children: ReactNode
}) {
  const navegar = useNavigate()
  return (
    <div className="pantalla">
      <header className="encabezado">
        {atras && (
          <button className="boton-atras" onClick={() => navegar(-1)} aria-label="Regresar">‹</button>
        )}
        <h1>{titulo}</h1>
        {accion}
        {pdf && <button className="encabezado-accion encabezado-pdf" onClick={() => guardarPDF(pdf)} aria-label="Guardar en PDF">PDF</button>}
      </header>
      {pdf && (
        <div className="pdf-membrete">
          <strong>BE Food Company</strong>
          <span>{new Date().toLocaleString('es-NI', { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </div>
      )}
      <main className="contenido">{children}</main>
    </div>
  )
}

/** Abre la ventana de imprimir del teléfono, donde se elige "Guardar como PDF" o compartir.
 *  El título de la página es el nombre que lleva el archivo. */
export function guardarPDF(nombre: string) {
  const antes = document.title
  document.title = nombre
  document.body.classList.add('modo-pdf')
  const terminar = () => {
    document.title = antes
    document.body.classList.remove('modo-pdf')
    window.removeEventListener('afterprint', terminar)
  }
  window.addEventListener('afterprint', terminar)
  window.print()
}

export function Tarjeta({ titulo, children, a }: { titulo?: ReactNode; children?: ReactNode; a?: string }) {
  const cuerpo = (
    <>
      {titulo && <div className="tarjeta-titulo">{titulo}</div>}
      {children}
    </>
  )
  return a ? <Link to={a} className="tarjeta tarjeta-enlace">{cuerpo}</Link> : <section className="tarjeta">{cuerpo}</section>
}

export function Boton({ variante = 'principal', ocupado, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: 'principal' | 'secundario' | 'peligro'
  ocupado?: boolean
}) {
  return (
    <button className={`boton boton-${variante}`} disabled={ocupado || props.disabled} {...props}>
      {ocupado ? 'Guardando…' : children}
    </button>
  )
}

export function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <label className="campo">
      <span className="campo-etiqueta">{etiqueta}</span>
      {children}
      {ayuda && <span className="campo-ayuda">{ayuda}</span>}
    </label>
  )
}

export const Entrada = (props: InputHTMLAttributes<HTMLInputElement>) => <input className="entrada" {...props} />
export const Texto = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className="entrada" rows={2} {...props} />
export const Selector = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select className="entrada" {...props} />

export function MensajeError({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null
  return <div className="mensaje mensaje-error" role="alert">{mensaje}</div>
}

export function Nota({ children }: { children: ReactNode }) {
  return <div className="mensaje mensaje-nota">{children}</div>
}

const COLOR_ESTADO: Record<string, string> = {
  cuarentena: 'amarillo', liberado: 'verde', rechazado: 'rojo', vencido: 'rojo',
  pedida: 'azul', aprobada: 'amarillo', entregada: 'morado', recibida: 'verde', anulada: 'gris',
  pendiente: 'azul', en_proceso: 'morado', terminada: 'verde',
  cuadrado: 'verde', ajustado: 'verde',
  abierta: 'azul', completa: 'verde', solicitado: 'azul', aprobado: 'amarillo', pagado: 'verde',
  entregado: 'verde', borrador: 'azul', pagada: 'verde', abierto: 'azul', cerrado: 'verde', anulado: 'gris',
}

const TEXTO_ESTADO: Record<string, string> = {
  en_proceso: 'en proceso', cuarentena: 'en cuarentena',
}

export function Estado({ valor }: { valor: string }) {
  return <span className={`estado estado-${COLOR_ESTADO[valor] ?? 'gris'}`}>{TEXTO_ESTADO[valor] ?? valor}</span>
}

export function Cargando({ cargando, error }: { cargando: boolean; error: string | null }) {
  if (error) return <MensajeError mensaje={error} />
  if (cargando) return <div className="cargando">Cargando…</div>
  return null
}

export function Vacio({ children }: { children: ReactNode }) {
  return <div className="vacio">{children}</div>
}

export function Fila({ izquierda, derecha }: { izquierda: ReactNode; derecha: ReactNode }) {
  return (
    <div className="fila">
      <span>{izquierda}</span>
      <span className="fila-derecha">{derecha}</span>
    </div>
  )
}

/** Abre WhatsApp con el mensaje ya escrito; la persona solo le da enviar. */
export function BotonWhatsApp({ texto, telefono, children }: { texto: string; telefono?: string | null; children: ReactNode }) {
  return (
    <a className="boton boton-whatsapp" href={enlaceWhatsApp(texto, telefono)} target="_blank" rel="noreferrer">
      <span aria-hidden>💬</span>{children}
    </a>
  )
}
