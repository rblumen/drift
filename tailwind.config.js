// tailwind.config.js — Drift foundation
// Adds Schibsted Grotesk / IBM Plex Mono and brand tokens.
// Your existing `indigo-*` and `amber-*` classes already match the brand,
// so nothing needs a mass find/replace — these tokens are for new code.
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // `font-sans` (the default for everything) becomes Schibsted Grotesk
        sans: ['"Schibsted Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // brand — Regatta Anchor blue
        brand: {
          DEFAULT: '#0d3e7a',
          ink: '#082855',
          50: '#e8f0f9', 100: '#ccdcf0', 200: '#99bae0', 300: '#5b96cc',
          400: '#2e72b4', 500: '#1a5fa0', 600: '#0d3e7a', 700: '#082855',
          800: '#051c3e', 900: '#030f22',
        },
        // accent — burnt orange
        accent: {
          DEFAULT: '#e8600a',
          ink: '#b84a06',
          50: '#fff0e8', 100: '#fde0c8', 200: '#fbb480',
        },
        ink: '#2a3441',
        paper: '#fbfcfd',
      },
    },
  },
  plugins: [],
}
