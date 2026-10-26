import { useEffect, useState } from 'react'
import { subirFoto, urlFoto } from '../lib/supabase'

/** Toma una foto con la cámara del celular y la sube como prueba. */
export function TomarFoto({ carpeta, etiqueta, fotos, onCambio }: {
  carpeta: string
  etiqueta: string
  fotos: string[]
  onCambio: (fotos: string[]) => void
}) {
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    setSubiendo(true)
    setError(null)
    try {
      onCambio([...fotos, await subirFoto(carpeta, archivo)])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <div className="campo">
      <span className="campo-etiqueta">{etiqueta}</span>
      <div className="fotos">
        {fotos.map((f) => <VerFoto key={f} ruta={f} />)}
        <label className="foto-nueva">
          {subiendo ? 'Subiendo…' : '📷 Tomar foto'}
          <input type="file" accept="image/*" capture="environment" onChange={elegir} hidden />
        </label>
      </div>
      {error && <span className="campo-ayuda texto-error">{error}</span>}
    </div>
  )
}

export function VerFoto({ ruta }: { ruta: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    urlFoto(ruta).then(setUrl).catch(() => setUrl(null))
  }, [ruta])
  if (!url) return <div className="foto foto-vacia" />
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img className="foto" src={url} alt="Foto de prueba" />
    </a>
  )
}
