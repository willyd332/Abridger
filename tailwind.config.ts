import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        parchment: {
          50: '#fbf6e7',
          100: '#f5ecd6',
          200: '#ecdfb8',
          300: '#e0cf99',
          400: '#d2bd7c',
          500: '#bfa75e',
          600: '#9a8447',
          700: '#766435',
          800: '#544624',
          900: '#332a14',
        },
        ink: {
          50: '#e8e1d4',
          100: '#cfc4ad',
          200: '#a89478',
          300: '#7d6650',
          400: '#5a4634',
          500: '#43321f',
          600: '#3a2a18',
          700: '#322415',
          800: '#2c1d12',
          900: '#2a1810',
        },
        gilt: {
          50: '#fbf1c7',
          100: '#f4e08a',
          200: '#eac84b',
          300: '#d8aa28',
          400: '#c69715',
          500: '#b8860b',
          600: '#946c09',
          700: '#705208',
          800: '#4d3905',
          900: '#2a2003',
        },
      },
      fontFamily: {
        serif: [
          'EB Garamond',
          'Garamond',
          'Adobe Garamond Pro',
          'Sabon',
          'Cormorant Garamond',
          'Georgia',
          'Times New Roman',
          'serif',
        ],
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}

export default config
