import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── shadcn CSS-variable system ────────────────────────────────────────
        border:      'hsl(var(--border))',
        input:       'hsl(var(--input))',
        ring:        'hsl(var(--ring))',
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // ── Light reference palette ───────────────────────────────────────────
        navy:         '#0F1E3D',
        'navy-mid':   '#1B2E52',
        'gold-light': '#FFF3CC',
        'gold-muted': '#E8C84D',

        // ── Surfaces ──────────────────────────────────────────────────────────
        'surface-page':  '#F7F6F3',
        'surface-panel': '#F0EFE9',

        // ── EY brand (gold = goldBright from reference) ───────────────────────
        'ey-yellow':       '#FFD100',
        'ey-yellow-hover': '#E8A900',

        // ── Semantic — actual light colors ────────────────────────────────────
        success:      '#16A34A',
        'success-bg': '#DCFCE7',
        warning:      '#D97706',
        'warning-bg': '#FEF3C7',
        error:        '#DC2626',
        'error-bg':   '#FEE2E2',
        info:         '#2563EB',
        'info-bg':    '#DBEAFE',
      },

      fontFamily: {
        sans:  ['DM Sans', 'system-ui', 'sans-serif'],
        serif: ['Lora', 'Georgia', 'serif'],
        mono:  ['DM Sans', 'Consolas', 'monospace'],
      },

      fontSize: {
        'display':    ['28px', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '-0.01em' }],
        'page-title': ['22px', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '-0.01em' }],
        'section':    ['16px', { lineHeight: '1.4', fontWeight: '600' }],
        'card-title': ['14px', { lineHeight: '1.4', fontWeight: '600', letterSpacing: '-0.01em' }],
        'body':       ['13px', { lineHeight: '1.5', fontWeight: '400' }],
        'body-sm':    ['12px', { lineHeight: '1.5', fontWeight: '400' }],
        'label':      ['11px', { lineHeight: '1.4', fontWeight: '600', letterSpacing: '0.08em' }],
        'stat-lg':    ['36px', { lineHeight: '1.1', fontWeight: '600', letterSpacing: '-0.01em' }],
        'stat-sm':    ['22px', { lineHeight: '1.2', fontWeight: '600' }],
        'badge':      ['10.5px', { lineHeight: '1.4', fontWeight: '600', letterSpacing: '0.04em' }],
      },

      borderRadius: {
        sm:      '6px',
        DEFAULT: '8px',
        md:      '8px',
        lg:      '12px',
        xl:      '16px',
      },

      boxShadow: {
        sm:           '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        md:           '0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06)',
        lg:           '0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.05)',
        xl:           '0 20px 25px rgba(0,0,0,0.10), 0 10px 10px rgba(0,0,0,0.04)',
        card:         '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)',
        dropdown:     '0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.05)',
      },

      transitionDuration: {
        DEFAULT: '150ms',
        hover:   '200ms',
      },

      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-800px 0' },
          '100%': { backgroundPosition: '800px 0' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer:   'shimmer 1.6s infinite',
        'fade-up': 'fadeUp 0.25s cubic-bezier(0.4,0,0.2,1) both',
      },
    },
  },
  plugins: [animate],
}

export default config
