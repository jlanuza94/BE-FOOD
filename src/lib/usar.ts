import { useCallback, useEffect, useState } from 'react'

/** Carga datos al abrir la pantalla y permite recargarlos después de una acción. */
export function useDatos<T>(cargar: () => Promise<T>, deps: unknown[] = []) {
  const [datos, setDatos] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recargar = useCallback(async () => {
    setCargando(true)
    try {
      setDatos(await cargar())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCargando(false)
    }
  }, deps)

  useEffect(() => {
    recargar()
  }, [recargar])

  return { datos, error, cargando, recargar }
}

/** Corre una acción mostrando "ocupado" y guardando el mensaje de error de la regla que la bloqueó. */
export function useAccion() {
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const correr = useCallback(async (accion: () => Promise<unknown>): Promise<boolean> => {
    setOcupado(true)
    setError(null)
    try {
      await accion()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setOcupado(false)
    }
  }, [])

  return { ocupado, error, setError, correr }
}
