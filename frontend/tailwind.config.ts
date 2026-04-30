import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── EY Brand ──────────────────────────────────────────────────────────
        'ey-yellow':  '#FFE600',
        'ey-black':   '#2E2E38',
        'ey-white':   '#F6F6FA',

        // ── Yellow interactive states ─────────────────────────────────────────
        'yellow-hover':  '#E6CF00',
        'yellow-active': '#CCBA00',

        // ── Gray scale ────────────────────────────────────────────────────────
        gray: {
          900: '#1A1A24',
          800: '#2E2E38',
          700: '#3D3D47',
          600: '#555563',
          500: '#747480',
          400: '#9E9EA8',
          300: '#C4C4CD',
          200: '#E0E0E6',
          100: '#F0F0F4',
          50:  '#F6F6FA',
        },

        // ── Semantic ─────────────────────────────────────────────────────────
        success:       '#2D8C3C',
        'success-light': '#E8F5E9',
        warning:       '#D4880F',
        'warning-light': '#FFF8E1',
        error:         '#C4314B',
        'error-light': '#FDEDEF',
        info:          '#2E6ED9',
        'info-light':  '#E3F2FD',
      },

      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },

      fontSize: {
        'page-title':    ['20px', { lineHeight: '1.3', fontWeight: '700' }],
        'section-header':['16px', { lineHeight: '1.3', fontWeight: '600' }],
        'card-title':    ['15px', { lineHeight: '1.3', fontWeight: '600' }],
        'body':          ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        'body-sm':       ['13px', { lineHeight: '1.5', fontWeight: '400' }],
        'label':         ['12px', { lineHeight: '1.4', fontWeight: '500', letterSpacing: '0.5px' }],
        'stat-lg':       ['24px', { lineHeight: '1.2', fontWeight: '700' }],
        'stat-sm':       ['18px', { lineHeight: '1.2', fontWeight: '600' }],
        'badge':         ['11px', { lineHeight: '1.4', fontWeight: '500' }],
      },

      borderRadius: {
        sm: '4px',
        DEFAULT: '8px',
        lg: '12px',
      },

      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
        dropdown: '0 8px 24px rgba(0,0,0,0.12)',
      },

      transitionDuration: {
        DEFAULT: '150ms',
        hover: '200ms',
      },

      spacing: {
        '4.5': '18px',
      },
    },
  },
  plugins: [],
}

export default config
