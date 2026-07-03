# Drift UI Design Review (2026-07-02)

Design review of the Drift UI at commit `af8e2ac` (main).

**Scope:** branding, copy, clarity, and general aesthetics — landing page, app shell
(header/nav/banners/footer), and all six in-app tabs (Overview, Accounts, Import,
Classify, Strategy, Results).

**Method:** every UI source file was read in full (`src/App.tsx`, `src/ui/*.tsx`,
`src/ui/LandingPage.css`, `src/index.css`, `tailwind.config.js`). The app was run
locally and inspected via the accessibility tree, computed styles, and DOM/layout
measurements at desktop (1280px) and mobile (375px) widths — screenshot capture was
unavailable in this session, so visual findings below were confirmed via computed
styles and layout metrics rather than pixel comparison.

---

> **Note:** This report was annotated with issue-tracking status on 2026-07-03. The
> original review text below is unchanged; `> **Status (2026-07-03):**` blockquotes were
> added under each finding to record the filed issue and resolution state.

---

## Executive summary

The brand system — Anchor Blue + burnt orange, Schibsted Grotesk + IBM Plex Mono, the
paddle wordmark — is well-executed, and the landing page is the strongest surface in
the product. The issues found are mostly an *incomplete rollout* of that system inside
the app, a handful of concrete visible defects, and a mobile experience that breaks
down in several places. Findings are grouped by severity below.

**Fix first (visible defects):**

1. Literal `↓` escape sequences render as text in the Results "Next steps" buttons.
2. The share feature points every channel (X, Reddit, Facebook, email, SMS, copy-link)
   at `https://drift.app` — a domain the project does not appear to own.
3. The landing "trust strip" border uses an undefined CSS variable and renders as a
   heavy ink line instead of a hairline.
4. Mobile (375px) is broken in several places: the tab nav overflows and causes
   horizontal page scroll, Results tables overflow, the "Next steps" grid is too
   cramped for its three cards, and **"How it works" is completely unreachable on
   mobile** (`hidden sm:flex` with no alternate trigger).

---

## A. Visible defects

### A1 — Literal `↓` escape sequences render in Results buttons

> **Status (2026-07-03):** Filed as [#141](https://github.com/rblumen/drift/issues/141) — **closed** by [PR #153](https://github.com/rblumen/drift/pull/153).

[`src/ui/ResultsPanel.tsx:638`](../src/ui/ResultsPanel.tsx#L638) and
[`:643`](../src/ui/ResultsPanel.tsx#L643) write `↓ Trade report` / `↓
Portfolio file` as plain JSX text, where escape sequences are not interpreted.
Confirmed live: the buttons literally display `↓ Trade report`. The header
Save/Load buttons already use real `↓`/`↑` characters — apply the same fix here, or
use `{'↓'}` as an expression.

### A2 — Share links point at an unowned domain

> **Status (2026-07-03):** Filed as [#116](https://github.com/rblumen/drift/issues/116) — **closed** by [PR #139](https://github.com/rblumen/drift/pull/139). This finding was independently raised as m2 in the 2026-07-01 codebase audit; a single canonical URL constant now drives all share/reminder links.

[`src/ui/ResultsPanel.tsx:376`](../src/ui/ResultsPanel.tsx#L376) hardcodes
`SHARE_URL = 'https://drift.app'`. Every share channel and the copy-link button
broadcasts this URL. If a user actually shares the app, their contacts are sent to
someone else's domain (or a dead link). Point this at the real hosted URL, or disable
sharing until hosting exists.

### A3 — Landing "trust strip" border renders as a heavy ink line

> **Status (2026-07-03):** Filed as [#143](https://github.com/rblumen/drift/issues/143) — **closed** by [PR #157](https://github.com/rblumen/drift/pull/157).

[`src/ui/LandingPage.css:157`](../src/ui/LandingPage.css#L157) uses
`border-top: 1px solid var(--line-2)` with no fallback value, and `--line-2` is never
defined anywhere (`src/index.css` only defines `--brand`, `--brand-ink`, `--accent`,
`--ink`, `--paper`, and the `--dv-*` data-viz tokens). Confirmed live: the computed
border color is `rgb(42, 52, 65)` (`--ink`, via inheritance) — a dark 1px line around
what should be a near-invisible hairline. Define `--line`/`--line-2` in `:root`, or
hardcode `#e5e8ee` as `ResultsPanel.tsx` already does elsewhere with its own fallbacks.

### A4 — Mobile layout breaks in multiple places

> **Status (2026-07-03):** Filed as [#142](https://github.com/rblumen/drift/issues/142) — **closed** by [PR #156](https://github.com/rblumen/drift/pull/156).

At a 375px viewport, confirmed live via DOM measurement:

- **Tab nav overflows its container** (`src/App.tsx:342`) — 546px of content in a
  343px container, no `overflow-x-auto`. The Strategy/Results tabs are clipped and the
  whole page pans sideways (`document.documentElement.scrollWidth` > `clientWidth`).
- **"How it works" is unreachable on mobile.** Its only trigger
  (`src/App.tsx:271`) is `hidden sm:flex` with no mobile alternative. The
  transparency story is a stated brand pillar (it has its own landing-page section)
  and phone users cannot access it at all in-app.
- **Results tables overflow** (allocation table, cash-deployment table) — up to
  516px wide in a 375px viewport, no horizontal-scroll wrapper.
- **"Next steps" is a hard `grid-cols-3`** (`src/ui/ResultsPanel.tsx:624`) — three
  ~110px-wide cards with action buttons that don't fit at this width.

---

## B. Branding consistency

### B1 — Indigo remnants break the brand-blue rollout

> **Status (2026-07-03):** Filed as [#144](https://github.com/rblumen/drift/issues/144) — **closed** by [PR #157](https://github.com/rblumen/drift/pull/157).

`src/ui/HelpBox.tsx:19-31` — the HelpBox component, used on **every single tab**, is
still styled `indigo-50/100/300/400/700` throughout. `App.tsx`'s own header comment
documents that indigo was replaced by brand blue elsewhere, but the most frequently
repeated UI element in the app never received the treatment. The "Primary objectives"
pill in the How It Works drawer (`src/ui/HowItWorksDrawer.tsx:47`,
`bg-indigo-100 text-indigo-700`) has the same gap. This is the single highest-leverage
branding fix available — one component, every screen.

### B2 — Data-viz palette doesn't match the brand identity

> **Status (2026-07-03):** Tracked in [#150](https://github.com/rblumen/drift/issues/150) — **open**. Folded into the grouped design-system polish issue (with B3); awaiting a maintainer decision on palette/icon direction.
> **Update (2026-07-03, later):** [#150](https://github.com/rblumen/drift/issues/150) **closed** in two parts — [PR #188](https://github.com/rblumen/drift/pull/188) (brand-tuned two-tier data-viz palette: family-level landing ramp via `FAMILY_COLOR`/`--dv-*`, distinct brand-tuned hues per class in `AC_COLOR`; plus brand-toned status badges) and [PR #192](https://github.com/rblumen/drift/pull/192) (shared 13-icon drawn SVG set replacing all UI-chrome emoji and text glyphs). See also [PR #189](https://github.com/rblumen/drift/pull/189), which adopted the family ramp for the new allocation chart views (#98).

The landing page charts use brand navy tones + burnt orange
(`src/ui/LandingPage.tsx:16`); the in-app charts use bright, unrelated Tailwind
defaults (`src/ui/fmt.ts:95`, `AC_COLOR` — indigo/sky/amber/red/teal/violet). The
`--dv-*` family-anchor variables already defined in `src/index.css` gesture at a
brand-aligned palette but are unused by the actual chart color maps. First impression
after the navy/orange landing page is a much brighter, disconnected rainbow.
Related: status-badge colors in `AccountsPanel.tsx` (e.g. "Required" withdrawal state
uses `blue-*` rather than `brand-*`) show the same brand/Tailwind-default split at the
semantic-color level.

### B3 — Icon language mixes drawn SVG and emoji

> **Status (2026-07-03):** Tracked in [#150](https://github.com/rblumen/drift/issues/150) — **open**. Folded into the grouped design-system polish issue (with B2); awaiting a maintainer decision on palette/icon direction.
> **Update (2026-07-03, later):** [#150](https://github.com/rblumen/drift/issues/150) **closed** in two parts — [PR #188](https://github.com/rblumen/drift/pull/188) (brand-tuned two-tier data-viz palette: family-level landing ramp via `FAMILY_COLOR`/`--dv-*`, distinct brand-tuned hues per class in `AC_COLOR`; plus brand-toned status badges) and [PR #192](https://github.com/rblumen/drift/pull/192) (shared 13-icon drawn SVG set replacing all UI-chrome emoji and text glyphs). See also [PR #189](https://github.com/rblumen/drift/pull/189), which adopted the family ramp for the new allocation chart views (#98).

The landing page and Overview panel use crisp custom SVGs; the app shell mixes in text
glyphs (`↓ Save`, `↑ Load`, `✕ Reset`, `▾`/`▸` chevrons) and raw emoji (`🔒`/`🔓` lock
toggles, `⏰` reminder banner, `☕` Ko-fi links, `✎` edited-row indicator, `ℹ` help
icon). Emoji render inconsistently across OS/browser and read as informal against an
otherwise precision-instrument brand voice. A small shared icon set (the existing
inline 14–18px SVGs are already good) would tighten this considerably.

---

## C. Copy

### C1 — Landing page copy: grammar, accuracy, and internal consistency

> **Status (2026-07-03):** Filed as [#145](https://github.com/rblumen/drift/issues/145) — **closed** by [PR #164](https://github.com/rblumen/drift/pull/164).

- **Grammar artifact** (`src/ui/LandingPage.tsx:151-153`): *"Your aggregator — great
  at the picture. None of them will look across all your accounts…"* mixes singular
  "your aggregator" with plural "none of them" — reads like two drafts merged.
- **Inaccurate trust claim** (`src/ui/LandingPage.tsx:105`): *"No account · nothing
  stored"* is not true — the app autosaves every change to `localStorage` plus a
  3-slot backup ring, which is the actual (good) feature. The accurate claim used
  elsewhere in the product is "nothing leaves your browser" — recommend swapping to
  that phrasing here too. Given the target audience (privacy-conscious DIY investors),
  an inaccurate trust claim is a real cost.
- **Over-promise** (`src/ui/LandingPage.tsx:261`): the *"Direct connect · soon"* pill
  promises functionality the project's own guardrails currently prohibit (no
  credential automation, no undocumented broker APIs — see `CLAUDE.md` /
  `PRINCIPLES.md`). Unless there's a concrete plan, "CSV-first, by design" would
  reinforce the trust story instead of setting an expectation that may not be met.
- **Data inconsistency** (`src/ui/LandingPage.tsx:9-15` vs. `:136`): the demo
  allocation legend shows 4 classes with a nonzero drift (+4, −4, −2, +2) but the
  donut footer says *"3 classes out of band"*. The audience this product targets
  (Bogleheads-style DIY rebalancers) will notice a math mismatch on the hero visual.
- **Step-count mismatch**: the landing page's "How it works" section shows 4 steps and
  omits Classify (`src/ui/LandingPage.tsx:203-214`); the in-app Overview stepper shows
  5 steps including Classify (`src/ui/OverviewPanel.tsx:111-143`). The marketing
  promise contradicts the actual first-run flow within two clicks. Either fold
  Classify into the "Import positions" step copy, or show 5 steps on the landing page.
- **CTA label drift**: "Enter app →" (nav, hero) vs. "Enter the app →" (finale);
  "Try the demo portfolio" (hero) vs. "Try the demo" (finale). Pick one form of each
  and use it consistently.

### C2 — App-shell banner copy

> **Status (2026-07-03):** Filed as [#146](https://github.com/rblumen/drift/issues/146) — **closed** by [PR #176](https://github.com/rblumen/drift/pull/176).

- The demo-mode banner narrates its own UI in glyphs (`src/App.tsx:302`): *"Dismiss
  (✕) to return to your saved portfolio, or use ↑ Load / Reset."* This is clear to
  someone who already knows the icons and cryptic to a first-time user. A plain "Exit
  demo" text button/link would be clearer than describing the ✕ glyph.
- *"Not investment advice"* appears twice on the same screen — once in the Overview
  footnote (`src/ui/OverviewPanel.tsx:271`) and once in the global footer
  (`src/App.tsx:457`). Once, in the persistent footer, is sufficient; repeating it
  reads as nervous rather than careful.

---

## D. Clarity & UX

### D1 — Landing page shows on every visit, even for returning users

> **Status (2026-07-03):** Filed as [#147](https://github.com/rblumen/drift/issues/147) — **closed** by [PR #164](https://github.com/rblumen/drift/pull/164).

`showLanding` initializes to `true` unconditionally (`src/App.tsx:68`). A returning
user with an existing saved portfolio has to click through the marketing page every
session before reaching their data. Recommend skipping the landing page when saved
state already exists (first-run only), keeping the wordmark-click affordance as the
way back to it.

### D2 — Keyboard/screen-reader accessibility gaps

> **Status (2026-07-03):** Filed as [#148](https://github.com/rblumen/drift/issues/148) — **closed** by [PR #163](https://github.com/rblumen/drift/pull/163). Fixed together with the audit accessibility finding ([#123](https://github.com/rblumen/drift/issues/123)).

- Overview step cards are `div`s with `onClick` handlers rather than `<button>`
  elements (`src/ui/OverviewPanel.tsx:236-238`), despite already having hover/cursor
  affordances — not reachable or activatable by keyboard.
- The closed "How it works" drawer stays in the accessibility tree: it's hidden via
  `translate-x-full` only (`src/ui/HowItWorksDrawer.tsx:109`), while keeping
  `aria-modal="true"` and a tabbable Close button. Confirmed live: `aria-hidden` is
  `null` and the drawer's Close button remains focusable while the panel is off-screen.
  Screen-reader and keyboard users can land inside an invisible dialog.
- These overlap with the existing backlog item on accessibility (issue #123); noting
  them here as concrete, file-anchored instances found during this pass.

### D3 — Native `confirm()` dialogs

> **Status (2026-07-03):** Filed as [#151](https://github.com/rblumen/drift/issues/151) — **closed** by [PR #180](https://github.com/rblumen/drift/pull/180).

Reset (`src/App.tsx:172`) and account removal (`src/ui/AccountsPanel.tsx:781`) use the
browser's native `confirm()`. Functional, but visually jarring against an otherwise
carefully styled product. Low priority for beta; worth a styled confirmation modal
before a 1.0 polish pass.

### D4 — No social preview metadata

> **Status (2026-07-03):** Filed as [#149](https://github.com/rblumen/drift/issues/149) — **closed** by [PR #164](https://github.com/rblumen/drift/pull/164).

`index.html` has no `<meta name="description">` or Open Graph / Twitter card tags,
yet the product has a whole share-and-feedback flow built around getting shared. A
link shared today unfurls bare and imageless. The landing page's allocation-card mock
would make a strong OG image.

---

## E. Smaller aesthetic notes

### E1 — App-shell banner layout

> **Status (2026-07-03):** Filed as [#152](https://github.com/rblumen/drift/issues/152) — **closed** by [PR #183](https://github.com/rblumen/drift/pull/183).

- The beta banner (`src/App.tsx:284`) uses `-mx-4 border-b` to read as full-width, but
  it stops at the container's max-width edge on wider viewports — looks cropped rather
  than intentional. Either make it truly full-bleed (move outside the `max-w-5xl`
  container) or style it as a contained pill like the demo/backup banners.
- Up to three banners (beta + demo + restored-from-backup) can stack simultaneously
  between the wordmark and the tab nav, pushing page content down significantly.
  Consider making the beta banner dismissible-and-remembered per session.

---

## Suggested priority order

| Priority | Items |
|---|---|
| Now (visible bugs) | A1 `↓` literals, A2 share URL, A3 trust-strip border, C1 "3 vs 4 classes" data mismatch |
| Next | A4 mobile layout + D2 drawer accessibility, B1 indigo → brand sweep, C1/C2 copy pass |
| Soon | D1 landing skip for returning users, D2 keyboard access, D4 OG tags |
| Eventually | B2 data-viz palette, B3 icon set, D3 styled confirms, E1 banner polish |

---

*This report was generated by a design-review pass over `main` @ `af8e2ac`. Findings
above are tracked as individual/grouped issues in the GitHub backlog — see issues
tagged `ui` for this review's follow-up work.*
