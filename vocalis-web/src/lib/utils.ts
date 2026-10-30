import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { CURRENCY } from '@/config/brand'

export const cn = (...i: ClassValue[]) => twMerge(clsx(i))
export const money = (n: number, d = 0) => CURRENCY + n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
export const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
export const pct = (n: number) => `${Math.round(n)}%`
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export function timeAgo(iso: string) {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} hr ago`
  return `${Math.round(m / 1440)} d ago`
}
export function seeded(seed: number) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
}
export function download(name: string, text: string, type = 'text/csv') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
}
