# Hexlume — visual system v3 «Instrument»

The game is a precise logic instrument with one warm source of light. Adult, calm and confident,
pleasant without being childish. References in spirit: a well-made watch face, a night
observatory, an editorial magazine layout, Linear/Things-level UI restraint. Not a kids' app,
not neon gaming, not grim.

## Principles
1. **One light.** The only saturated, glowing thing on screen is a lit cell (огонёк). Everything else
   is graphite, ink, paper and hairlines. Colour means information.
2. **Precision over softness.** Hairline (1px) strokes, small radii, tabular numerals, exact alignment,
   a strict 4/8 px spacing grid. No chunky 3D bottoms, no bubbly pills, no candy gradients.
3. **Quiet motion.** Short (120–240 ms), ease-out (`cubic-bezier(.2,.7,.1,1)`), no bounce/overshoot
   except one restrained moment: the light igniting. Respect reduced motion.
4. **Typography carries the brand**, not illustrations.

## Theme
- **Default: dark** (setting values: Тёмная (default) / Светлая / Как в системе).
- Dark «Ночь»:
  - `--bg` #0B0C0F, `--bg-2` #111318 (sheets), `--surface` #15181E, `--line` rgba(255,255,255,.08),
    `--line-strong` rgba(255,255,255,.16)
  - `--ink` #ECEDEF, `--ink-2` #A3A8B3, `--ink-3` #6B7180
  - Light (accent): `--lume` #F4C77A (warm white-gold), `--lume-core` #FFF4DC,
    `--lume-glow` rgba(244,199,122,.35). Used ONLY for lit cells, the counter value, the primary
    action and win moments.
  - UI accent for selection/focus/links: `--accent` #8FA8FF (cool, low-key), used sparingly.
  - Danger: `--bad` #FF6B6B (mistakes only).
- Light «Бумага»: `--bg` #F4F2ED, `--surface` #FFFFFF, `--ink` #15171C, `--ink-2` #555B66,
  `--line` rgba(20,23,28,.10); lume #C8891E core on paper with a subtle warm ring (no big glow).

## Type
- Display & UI: **Onest** (variable, Cyrillic-first grotesk). Headings 600, tight tracking (−0.02em).
  Wordmark "Hexlume" in Onest 500, large, letter-spacing −0.04em, no gradient — plain ink with the
  "o"-less trick: a tiny lit hex as the tittle/accent only.
- Numbers on the board: Onest 600, `font-variant-numeric: tabular-nums`, optical size tuned per cell size.
- Meta / labels / counters / timers: **JetBrains Mono** 500, 11–13 px, uppercase only for tiny labels,
  letter-spacing +0.04em (e.g. `МИР 04 · 06/12`, `00:42`, `×2`).
- Remove Unbounded and Manrope.

## Board
- Hex cells: flat-top, inset 2px gap, corner radius ≤ 3px (crisp), no extruded bottom.
- Hidden: `--surface` with a hairline border and a very faint top inner highlight (machined look).
- Opened: recessed — slightly darker than hidden (dark theme) with no border, number in ink;
  "done" clues fade number to `--ink-3`.
- Fog: no fill, a dotted hairline outline at 6–8% opacity.
- Lit cell (огонёк): dark glass hex whose centre holds a small bright core (`--lume-core`) inside a
  thin `--lume` ring; a soft radial light (`--lume-glow`) spills just past the edges onto neighbours
  (one blurred layer, precomputed, no per-frame filters). Ignition: core scales 0→1 with a brief
  flash ring expanding outward (220 ms). Idle: barely perceptible breathing (opacity 0.9↔1, 4 s),
  off under reduced motion. Never a solid orange fill.
- Walls: 3px ink-2 strokes with square caps. Portals: thin cool-accent arcs.
- Clue glyphs: monochrome line icons in `--ink-2` (not candy colours), 1.25px strokes, sitting
  around the number; each kind must stay distinct by SHAPE (line arrow tick on the edge, wedge for
  cone, open wedge for triangle, disc for radius, ring, double ring for donut, dot, spiral for swirl,
  contour for island, link for chain, eye, two/one pip for parity, braces/dashes for together/apart,
  padlock for lock in ink with mono count). One subtle hue family allowed per category if needed for
  legibility, but desaturated (≤ 35% saturation).
- Highlights: covered cells get a thin accent outline + 6% accent fill; pinned highlights use up to 4
  desaturated hues. Hint target: accent ring pulse (not orange).
- Mistake: cell edge flashes `--bad` + tiny horizontal shake (120 ms); a mono toast "×2".

## Chrome
- Top bar: back chevron (no boxed button), level title in Onest 600 + mono meta line
  (`МИР 04 · УРОВЕНЬ 06`), right: counter as `◉ 7` in mono with the lume dot, mistakes `×0` in ink-3.
  No card backgrounds — just a hairline under the bar when content scrolls.
- Bottom bar: a single segmented control "Открыть | Огонёк" (rectangular, 12px radius, hairline,
  the active segment filled with `--surface` + lume dot for Огонёк), and 3–4 plain icon buttons
  (hint, restart, rotate, ?) with 1.5px line icons. Thumb-reachable, 48px targets.
- Sheets: `--bg-2`, top radius 16px, hairline border, generous padding; primary button = solid
  `--lume` with dark ink text, 12px radius, no gradient; secondary = hairline.
- Toasts: compact mono or Onest 14px on `--surface` with hairline.

## Menu
- Editorial layout, not tiles: large wordmark + one-line tagline in ink-2, then a short vertical list
  of modes as rows (title in Onest 500 20–22px, right-aligned mono meta, hairline separators,
  hover/press = surface fill): «Продолжить — Мир 4 · 06», «Кампания — 24/168», «Задача дня №1 —
  🔥 3»(use a mono "streak 03" not emoji), «Бесконечный», «Вдвоём», «Статистика», then small text
  links Как играть · Настройки.
- Background: a slow, sparse hex lattice drawn in hairlines that fades to the edges, with 2–3 lights
  slowly igniting/dimming (very subtle; static under reduced motion).
- World map: list/grid of worlds as cards with a mono index (01–14), name, progress bar hairline,
  stars as small mono counts; levels as small crisp hexes with state (open/lit/locked), current level
  marked with the lume ring.

## Icons, favicon, OG
- App icon: dark graphite hex with a single lit core; no gradients other than the light.

## Copy tone
- Short, calm, adult, informal «ты». No exclamation marks except the win headline.
  Win: «Готово.» + mono stats; stars as three small hexes (lit = earned).
