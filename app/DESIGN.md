# GigaBags — Design system

## Aesthetic: dither / 1-bit forensic monochrome
Ordered (Bayer) dithering is the surface voice — grayscale rendered as dot/threshold patterns, like an e-ink surveillance readout or an oscilloscope. Dither is texture, not decoration: it appears in the hero shader, chart fills, dividers, hover states. Dark theme (a dim room, 2am, watching the tape).

## Color (OKLCH, committed monochrome)
- `--bg`: oklch(0.15 0.006 265)  (near-black, faint cool tint)
- `--surface`: oklch(0.19 0.007 265)
- `--line`: oklch(0.30 0.008 265)
- `--ink`: oklch(0.94 0.004 265)  (bone white)
- `--muted`: oklch(0.62 0.006 265)
- `--faint`: oklch(0.45 0.006 265)
- Semantic ONLY for money: `--loss` oklch(0.60 0.17 25) (desaturated red), `--gain` oklch(0.72 0.15 150) (desaturated green)
- Single signal accent (interactive/brand): `--signal` oklch(0.86 0.10 90) (a pale phosphor amber, used sparingly on focus/active/key CTA — NOT neon)
Never #000/#fff. Dither carries the grayscale; red/green carry the P&L; signal is <5% of surface.

## Type
- Display: "Bricolage Grotesque" (characterful grotesque, heavy weights for hero) — off the reflex list.
- Mono/data: "Spline Sans Mono" — all data, labels, tickers, numbers (tabular-nums). This is a literal terminal, so mono is earned.
- Pixel accent: "Pixelify Sans" for the wordmark + key dither moments only.
- Scale: fluid clamp for headings, ≥1.25 ratio. Light-on-dark: +0.08 line-height.

## Motion
- ease-out-expo / quart. No bounce. Staggered load reveals on the landing.
- Signature interactions: the hero dither shader reacts to the cursor; numbers tick; hover reveals dither texture; dithered dissolve transitions.
- Never animate layout props.

## Layout
- Generous, varied whitespace; a visible technical grid as structure (Swiss/tech-spec), not centered-stack template.
- Mono uppercase micro-labels as terminal grammar (used deliberately, part of the system).
