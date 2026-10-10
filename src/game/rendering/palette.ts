/** Design tokens shared by the canvas and the HUD (mirrors src/index.css). */
export const COLORS = {
  bg: '#080F20',
  card: '#101B30',
  outline: '#2A4262',
  text: '#F4F7FF',
  text2: '#A9BCD5',
  cyan: '#4DCFF5',
  amber: '#FFB64D',
  gold: '#FFD27A',
  green: '#37DCA0',
  red: '#F47777',
  orbit: 'rgba(132, 168, 220, 0.16)',
  orbitStrong: 'rgba(132, 168, 220, 0.32)',
  ghost: 'rgba(169, 188, 213, 0.38)',
} as const

export const FONT = '"Manrope Variable", "Manrope", system-ui, sans-serif'

export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
