import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { fecha, num } from '../lib/formato'
import type { LoteInventario } from '../lib/tipos'
import { Estado } from './ui'

/** Etiqueta del lote con QR: código, proveedor, lote del proveedor, fechas, ubicación y estado. */
export function EtiquetaQR({ lote }: { lote: LoteInventario }) {
  const [qr, setQr] = useState<string>('')
  useEffect(() => {
    QRCode.toDataURL(lote.codigo, { margin: 1, width: 240 }).then(setQr)
  }, [lote.codigo])

  return (
    <div className="etiqueta" id="etiqueta">
      {qr && <img src={qr} alt={`QR ${lote.codigo}`} className="etiqueta-qr" />}
      <div className="etiqueta-datos">
        <strong className="etiqueta-codigo">{lote.codigo}</strong>
        <div>{lote.item}</div>
        {lote.proveedor && <div>Proveedor: {lote.proveedor}{lote.lote_proveedor ? ` · Lote ${lote.lote_proveedor}` : ''}</div>}
        <div>Recibido: {fecha(lote.fecha_ingreso)}</div>
        <div>Vence: {fecha(lote.fecha_caducidad)}</div>
        <div>Ubicación: {lote.ubicacion ?? '—'}</div>
        <div>Cantidad: {num(lote.cantidad_inicial)} {lote.unidad}</div>
        <Estado valor={lote.estado} />
      </div>
    </div>
  )
}
