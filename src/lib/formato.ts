const numero = new Intl.NumberFormat('es-NI', { maximumFractionDigits: 2 })

export function num(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : numero.format(Number(n))
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-NI', { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit' })
}

export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.length === 10 ? new Date(iso + 'T12:00:00') : new Date(iso)
  return d.toLocaleDateString('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
