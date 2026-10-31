/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Plus Jakarta Sans', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
      colors: {
        bg: 'hsl(var(--bg))', surface: 'hsl(var(--surface))', muted: 'hsl(var(--muted))',
        line: 'hsl(var(--line))', ink: 'hsl(var(--ink))', soft: 'hsl(var(--soft))',
        accent: { DEFAULT: 'hsl(var(--accent))', fg: 'hsl(var(--accent-fg))', soft: 'hsl(var(--accent-soft))' },
        ok: 'hsl(var(--ok))', warn: 'hsl(var(--warn))', bad: 'hsl(var(--bad))',
      },
      borderRadius: { xl: '1rem', '2xl': '1.375rem' },
      boxShadow: { card: '0 1px 2px hsl(var(--shadow) / .04), 0 8px 24px -12px hsl(var(--shadow) / .08)', pop: '0 12px 32px -8px hsl(var(--shadow) / .18), 0 2px 6px hsl(var(--shadow) / .06)' },
      keyframes: { wave: { '0%,100%': { transform: 'scaleY(.3)' }, '50%': { transform: 'scaleY(1)' } }, shimmer: { '100%': { transform: 'translateX(100%)' } } },
      animation: { wave: 'wave 1s ease-in-out infinite' },
    },
  },
  plugins: [],
}
