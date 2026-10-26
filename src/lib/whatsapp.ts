/** Enlace que abre WhatsApp con el mensaje ya escrito. Sin teléfono, WhatsApp pregunta a quién mandarlo. */
export function enlaceWhatsApp(texto: string, telefono?: string | null): string {
  let numero = (telefono ?? '').replace(/\D/g, '')
  // Números de Nicaragua de 8 dígitos: se les pone el 505
  if (numero.length === 8) numero = '505' + numero
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
}
