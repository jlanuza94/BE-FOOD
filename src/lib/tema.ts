export type Tema = 'auto' | 'claro' | 'oscuro'

export const TEMAS: Record<Tema, string> = { auto: 'Como el celular', claro: 'Claro', oscuro: 'Oscuro' }

export function temaGuardado(): Tema {
  try {
    const t = localStorage.getItem('tema')
    if (t === 'claro' || t === 'oscuro') return t
  } catch {
    // Sin almacenamiento: se usa el del celular
  }
  return 'auto'
}

/** Pone el modo claro u oscuro en toda la app y lo recuerda en este celular. */
export function aplicarTema(tema: Tema) {
  const raiz = document.documentElement
  if (tema === 'auto') raiz.removeAttribute('data-tema')
  else raiz.setAttribute('data-tema', tema)
  const oscuro = tema === 'oscuro' || (tema === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', oscuro ? '#17402a' : '#1f6b3a')
  try {
    if (tema === 'auto') localStorage.removeItem('tema')
    else localStorage.setItem('tema', tema)
  } catch {
    // Sin almacenamiento: dura hasta cerrar la app
  }
}
