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

        // ── #194 component-kit neutrals ──────────────────────────────────────
        // New neutral ramp used throughout the app-shell redesign. The kit's
        // "line-2" (inner card dividers) is #f1f3f6 — but the repo already has a
        // CSS var --line-2 (#e5e8ee) driving the landing trust strip (#143).
        // To avoid changing the landing's rendered look we do NOT redefine that
        // var; these Tailwind tokens are namespaced under `line`/`tint`/`muted`/
        // `faint` and are additive. See PR notes.
        line: {
          DEFAULT: '#e5e8ee', // the existing --line hairline
          2: '#f1f3f6',       // inner card dividers, sub-hairlines
          3: '#f7f8fa',       // table row dividers
        },
        tint: {
          DEFAULT: '#f4f6f9', // tinted card headers, idle chip bg
          cell: '#eef1f5',    // 1px-gap grid bg between stat cells, seg-control track
        },
        'rail-active': '#f4f8fc', // active rail item bg
        muted: {
          1: '#5b6673', // body → secondary text
          2: '#8792a0', // secondary → labels
          3: '#9aa3b0', // labels
        },
        faint: {
          DEFAULT: '#b3bcc7', // idle numbers, dividers
          2: '#c2cad4',
        },

        // ── #194 semantic state colors ───────────────────────────────────────
        // Replaces raw Tailwind green/amber/red/blue status classes. Each state
        // has text/bg (+ border/solid/hover where the kit specifies).
        ok: {
          DEFAULT: '#1f8a5b', // text
          bg: '#eaf5ef',
        },
        warn: {
          DEFAULT: '#b26205',   // text
          bg: '#fdf3e2',        // chip/pill bg
          'row-tint': '#fdf9f0', // untagged row tint
          'banner-bg': '#fdf6e7',
          'banner-border': '#f3ddb0',
          'banner-text': '#8a5a04',
        },
        danger: {
          DEFAULT: '#b3403a',        // text + solid button
          bg: '#fbeeee',
          'hover-border': '#e8b4b4', // destructive-quiet hover border
          solid: '#b3403a',
          'solid-hover': '#93332e',
        },
        info: {
          DEFAULT: '#0d3e7a', // text (== brand)
          bg: '#e8f0f9',      // == brand-50
          border: '#ccdcf0',  // == brand-100
        },
      },
    },
  },
  plugins: [],
}
