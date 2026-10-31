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
        accent: { DEFAULT: 'hsl(var(--accent))', 2: 'hsl(var(--accent-2))', fg: 'hsl(var(--accent-fg))', soft: 'hsl(var(--accent-soft))' },
        ok: 'hsl(var(--ok))', warn: 'hsl(var(--warn))', bad: 'hsl(var(--bad))',
      },
      borderRadius: { lg: '0.625rem', xl: '0.875rem', '2xl': '1.25rem', '3xl': '1.75rem' },
      boxShadow: {
        card: '0 1px 0 hsl(var(--hl)) inset, 0 1px 2px hsl(var(--shadow) / .05), 0 10px 28px -16px hsl(var(--shadow) / .16)',
        raised: '0 1px 0 hsl(var(--hl)) inset, 0 2px 4px hsl(var(--shadow) / .06), 0 14px 32px -14px hsl(var(--shadow) / .22)',
        pop: '0 0 0 1px hsl(var(--line)), 0 28px 60px -18px hsl(var(--shadow) / .4), 0 10px 24px -10px hsl(var(--shadow) / .18)',
        glow: '0 1px 0 hsl(0 0% 100% / .22) inset, 0 8px 22px -8px hsl(var(--accent) / .6)',
        field: '0 1px 2px hsl(var(--shadow) / .05) inset, 0 1px 0 hsl(var(--hl))',
      },
      keyframes: {
        wave: { '0%,100%': { transform: 'scaleY(.3)' }, '50%': { transform: 'scaleY(1)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'pop-in': { from: { opacity: 0, transform: 'translateY(4px) scale(.98)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: { wave: 'wave 1s ease-in-out infinite', 'pop-in': 'pop-in .16s ease-out' },
    },
  },
  plugins: [],
}
