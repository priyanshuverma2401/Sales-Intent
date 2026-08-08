// Every neutral and every pale tint resolves through a CSS variable, so the
// dark theme is one block of variable overrides in index.css rather than a
// `dark:` class on several hundred elements. Saturated brand shades stay
// literal: they are used as button backgrounds, where the colour must not move.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  // Button and badge variants are composed at runtime - `btn-${variant}`,
  // `badge-${tone}` - so the class name never appears whole in the source and
  // the scanner cannot see it. Without this the base `.btn` survives and every
  // size, colour and state is stripped, which is exactly how a designed button
  // ends up rendering as unstyled text.
  safelist: [
    'btn-sm',
    'btn-md',
    'btn-lg',
    'btn-primary',
    'btn-secondary',
    'btn-ghost',
    'btn-danger',
    'badge-neutral',
    'badge-brand',
    'badge-green',
    'badge-amber',
    'badge-red',
  ],
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
        // Second gradient stop. Buttons, the logo mark and the auth rail blend
        // brand -> accent so the product reads as one family rather than a
        // single flat blue.
        accent: {
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
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
        // One step above `surface`: hovered rows, sunken wells, table headers.
        'surface-2': v('--surface-2'),
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
          'Inter var',
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
      letterSpacing: {
        tighter: '-0.022em',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        // A three-part ramp: `card` at rest, `raised` on hover, `pop` for
        // anything that floats over the page. Each keeps a hairline top edge so
        // surfaces read as physical rather than as flat rectangles.
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.05), 0 0 0 1px rgb(15 23 42 / 0.02)',
        raised:
          '0 2px 4px -2px rgb(15 23 42 / 0.06), 0 8px 16px -4px rgb(15 23 42 / 0.10), 0 0 0 1px rgb(15 23 42 / 0.03)',
        pop: '0 8px 12px -6px rgb(15 23 42 / 0.10), 0 24px 40px -12px rgb(15 23 42 / 0.18)',
        // Coloured lift for primary buttons - the blue shadow is what separates
        // a "designed" CTA from a plain filled rectangle.
        brand: '0 1px 2px 0 rgb(37 99 235 / 0.30), 0 6px 14px -4px rgb(37 99 235 / 0.42)',
        'brand-lg': '0 2px 4px 0 rgb(37 99 235 / 0.28), 0 12px 24px -6px rgb(37 99 235 / 0.48)',
        inset: 'inset 0 1px 2px 0 rgb(15 23 42 / 0.06)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
        'brand-gradient-hover': 'linear-gradient(135deg, #1d4ed8 0%, #4338ca 100%)',
        'sheen': 'linear-gradient(100deg, transparent 20%, rgb(255 255 255 / 0.28) 50%, transparent 80%)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96) translateY(6px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Skeleton loading sweep - a moving highlight reads as "working on it"
        // where a static grey block reads as "broken".
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        // Indeterminate progress for report generation, which has no reliable
        // percentage until the server reports one.
        'progress-sweep': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        // Expanding halo behind live status dots
        'pulse-ring': {
          '0%': { transform: 'scale(0.85)', opacity: '0.7' },
          '70%, 100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'gradient-pan': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out both',
        'fade-in-up': 'fade-in-up 0.42s cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-down': 'slide-down 0.2s cubic-bezier(0.16, 1, 0.3, 1) both',
        shimmer: 'shimmer 1.6s infinite',
        'progress-sweep': 'progress-sweep 1.4s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.24, 0, 0.38, 1) infinite',
        float: 'float 7s ease-in-out infinite',
        'gradient-pan': 'gradient-pan 12s ease infinite',
      },
      transitionTimingFunction: {
        // The "settle" curve used for anything that moves on hover or mount
        swift: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
