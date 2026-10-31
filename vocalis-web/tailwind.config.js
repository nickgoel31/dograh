/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
      colors: {
        bg: 'hsl(var(--bg))', surface: 'hsl(var(--surface))', muted: 'hsl(var(--muted))',
        line: 'hsl(var(--line))', ink: 'hsl(var(--ink))', soft: 'hsl(var(--soft))',
        accent: { DEFAULT: 'hsl(var(--accent))', fg: 'hsl(var(--accent-fg))', soft: 'hsl(var(--accent-soft))' },
        ok: 'hsl(var(--ok))', warn: 'hsl(var(--warn))', bad: 'hsl(var(--bad))',
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.25rem' },
      boxShadow: { card: '0 1px 0 hsl(0 0% 100% / .6) inset, 0 1px 2px hsl(var(--shadow) / .05), 0 12px 28px -16px hsl(var(--shadow) / .14)', pop: '0 24px 48px -12px hsl(var(--shadow) / .26), 0 4px 12px hsl(var(--shadow) / .08), 0 0 0 1px hsl(var(--line))', glow: '0 8px 24px -8px hsl(var(--accent) / .55)' },
      keyframes: { wave: { '0%,100%': { transform: 'scaleY(.3)' }, '50%': { transform: 'scaleY(1)' } }, shimmer: { '100%': { transform: 'translateX(100%)' } } },
      animation: { wave: 'wave 1s ease-in-out infinite' },
    },
  },
  plugins: [],
}
