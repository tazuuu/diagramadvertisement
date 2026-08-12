# Liquid hero — what changed

This folder is a full copy of `../website` with the hero converted to a
cursor-driven WebGL fluid canvas. **Nothing in `../website` was modified.**

## Files added

| File | Purpose |
|------|---------|
| `js/liquid-hover.js` | Vanilla-JS port of `LiquidHoverStandalone.tsx` — same shaders, no React |
| `css/liquid-hero.css` | Hero layout, scrim and fallback rules (loaded after `style.css`) |
| `assets/hero-liquid.jpg` | The molten red/gold portrait, 1376×768 |

## Files edited

`index.html`, in five places:

1. `<link rel="stylesheet" href="css/liquid-hero.css">` after `style.css`
2. `.hero-img-wrap` (the floating square portrait) replaced by `.hero-liquid` + `.hero-scrim`
3. A `.hero-nav-fade` ceiling added, so the now-transparent nav stays legible
4. A `.hero-liquid-hint` line added at the end of the hero
5. `<script src="js/liquid-hover.js"></script>` before `js/main.js`

The headline, eyebrow, lede, CTAs and their reveal animations are untouched.

Plus the design pass below, which touches `css/style.css` and three JS files.

## Design pass

Three delimited blocks appended to `css/style.css`, each self-contained and
removable. They override the rules above by source order, so the originals stay
readable in place.

| Block | What it does |
|-------|--------------|
| `MOTION POLISH` | Pins bare `transition:<time>` shorthands (which mean `all`) to explicit properties, adds press feedback, gates hover behind `@media (hover:hover)`, staggers the hero, adds site-wide reduced-motion handling |
| `STATE BRIDGES` | Entrance/exit for the four places state changed by teleporting: portfolio lightbox, mobile menu, contact success view, filtered card grid |
| `DESIGN PASS` | Focus rings, film grain, `100dvh`, `text-wrap`, tabular figures, utility classes replacing inline styles |

The state bridges are CSS-only, via `transition-behavior: allow-discrete` plus
`@starting-style`. That lets `display` participate in a transition, so the
existing `hidden` toggles in JS keep working untouched — and browsers without
support degrade to exactly the previous instant behaviour.

Two JS changes:

- `js/services.js` — `setActive()` set `opacity:0` and back to `1` inside one
  frame pair, so the panel fade-out never played and the image hard-cut on every
  service click. Now routed through `fadeTo()`, with the text swap at the
  midpoint so copy and image change together. `FADE_MS` must stay in sync with
  the `opacity` transition on `.svc-panel img`.
- Nav transparency needed no JS: `main.js` already toggled `.scrolled`.

### Deliberately not changed

- **All-caps labels and buttons.** That is the agency's voice, not a tic.
- **The bone-white `.work-preview` and solid-red `.values` sections.** Editorial
  contrast in a brand site, not a stray dark-section-in-a-light-page accident.
- **`--accent: #EA1D2C`** (82% saturation, marginally "too hot" by the usual
  guideline). It is the company's real brand red.
- **The 3-up `.work-grid`.** A generic layout, but restructuring it is a rewrite,
  not a polish pass. Noted for a future call.

### Known gap

The footer has no privacy policy or terms links. Adding them would mean linking
to pages that do not exist, so this is flagged rather than fabricated.

## How it works

A GPU Navier–Stokes solver (splat → divergence → Jacobi pressure → gradient
subtract → advection) runs on a low-res velocity field. Pointer movement injects
velocity and "ink"; the display pass offsets the image UVs along the flow.

The canvas is drawn at 120% of the hero so ripples travel past the edge instead
of clipping — `.hero` already has `overflow:hidden`, which trims the bleed.

## Tuning

All knobs are data attributes on `.hero-liquid` in `index.html`:

```html
<div class="hero-liquid" data-liquid-hover
     data-src="assets/hero-liquid.jpg"
     data-resolution="5"      <!-- sim grid, 1 cheapest – 10 sharpest -->
     data-cursor-size="0.45"  <!-- splat radius, 0.1 – 1 -->
     data-cursor-power="0.7"  <!-- ink strength, 0.1 – 1 -->
     data-distortion="0.4">   <!-- how far UVs are pushed, 0.1 – 1 -->
```

## Behaviour notes

- **Fallback.** The `<img>` inside `.hero-liquid` stays visible until the GPU has
  the texture, and forever if WebGL or `OES_texture_float` is missing, the image
  fails to load, or `texImage2D` throws. Every one of those paths calls
  `abort()`, which **removes the canvas from the DOM** — the canvas is painted on
  top of the fallback, so merely stopping the render loop would leave an empty
  black rectangle covering a perfectly good still. `abort()` also adds
  `.is-static`, which hides the "move your cursor" hint.

  > **Opening `index.html` directly (`file://`) is one of these paths.** Browsers
  > treat `file://` as origin `null`, so the texture upload is refused and the
  > hero falls back to the still image. This is expected and not a bug — the
  > fluid effect needs the page served over `http://`. Any static server works,
  > e.g. `npx http-server -p 5188` from this folder.
- **Reduced motion.** `prefers-reduced-motion: reduce` skips the solver entirely
  and leaves the still image.
- **Off-screen.** An `IntersectionObserver` plus `visibilitychange` park the
  render loop when the hero scrolls away or the tab is hidden.
- **Touch.** Listeners are passive and never call `preventDefault`, so the hero
  does not swallow vertical scrolling on phones — ripples just follow the finger.
- **Pointer input** is tracked on `.hero`, not the canvas, so the nav and CTA
  buttons keep working normally.

## Previewing locally

**Double-click `serve.cmd`.** It serves this folder at `http://127.0.0.1:5188`
and opens your browser. Leave the window open while you browse.

Opening `index.html` directly does not work for the fluid effect — see the
Fallback note above.

## The asset

`assets/hero-liquid.jpg` is **1376×768** (1.79:1), full-bleed with no baked-in
bars. It replaced the earlier 1898×839 crop.

If you replace this asset, check it for baked-in bars before dropping it in, and
keep the `width`/`height` attributes on the `<img>` in sync with the real pixel
dimensions.
