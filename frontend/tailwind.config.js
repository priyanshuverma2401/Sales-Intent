// Every neutral and every pale tint resolves through a CSS variable, so the
// dark theme is one block of variable overrides in index.css rather than a
// `dark:` class on several hundred elements. Saturated brand shades stay
// literal: they are used as button backgrounds, where the colour must not move.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Product blue. `brand` is the interactive colour, `navy` the chrome.
        brand: {
          50: v('--tint-brand'),
          // Stays literal: the navy sidebar and the auth panel use brand-100 as
          // TEXT on chrome that is dark in both themes, so it must never follow
          // the theme. Its two `hover:bg-brand-100` uses get a dark-mode
          // override by class name in index.css instead.
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        navy: {
          700: '#152c54',
          800: '#0f2444',
          900: '#0a1a33',
          950: '#060f1f',
        },
        ink: {
          DEFAULT: v('--ink'),
          soft: v('--ink-soft'),
          muted: v('--ink-muted'),
          faint: v('--ink-faint'),
        },
        // Cards, inputs, menus - anything that sits on top of the page colour.
        // Replaces bare `bg-white`, which cannot flip with the theme.
        surface: v('--surface'),
        slate: {
          50: v('--slate-50'),
          100: v('--slate-100'),
          200: v('--slate-200'),
          300: v('--slate-300'),
          400: v('--slate-400'),
          500: v('--slate-500'),
          600: v('--slate-600'),
          700: v('--slate-700'),
          800: v('--slate-800'),
          900: v('--slate-900'),
        },
        // Only the pale ends are variable - these are backgrounds. The darker
        // shades of these hues are text, handled by overrides in index.css.
        red: { 50: v('--tint-red') },
        emerald: { 50: v('--tint-emerald') },
        amber: { 50: v('--tint-amber') },
        violet: { 50: v('--tint-violet') },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        raised: '0 4px 6px -1px rgb(15 23 42 / 0.07), 0 2px 4px -2px rgb(15 23 42 / 0.05)',
        pop: '0 20px 25px -5px rgb(15 23 42 / 0.12), 0 8px 10px -6px rgb(15 23 42 / 0.08)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.24s ease-out',
        'scale-in': 'scale-in 0.18s ease-out',
      },
    },
  },
  plugins: [],
};
