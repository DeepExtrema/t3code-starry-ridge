# Starry Ridge design rules

The rules this theme follows, each with its reason. Keep them when you change the theme.

## Surfaces

- **Background art sits at about half brightness with smaller dots, and all text sits on a backing at least 90% opaque.**
  In `build.mjs`: `SKY_TONE` near `[0.55, 0.4, 0.55]`, `DOT_SCALE` near `0.65`, `SCRIM_ALPHA` 0.9 or more.
  Why: at the original artwork's brightness the sky is overwhelming and text over it cannot be read.

- **A message bubble's tail corner is at least 0.55rem: smaller than the other corners, never sharp.**
  Why: a near-square corner looks like a mistake beside rounded ones.

## Color

- **Panels and surfaces are neutral near-blacks stepped up from the canvas `#09090b`. Never tint them with a palette hue.**
  Why: they must match the black of the sky behind them.

- **Accent controls use deep saturated plum (`#a8309f` to `#741f86`). Never pastel pink or a cream-to-pink fade.**
  Why: pale pink reads as bubblegum.

## Motion

- **Glows and ambient animation start barely visible: ambient layers peak at 0.2 opacity or less, glow shadows at 0.45 alpha or less.**
  Why: every first draft of a glow in this theme was too strong and had to be cut, some to a quarter.

- **Ambient motion never runs in fixed groups or in unison; which elements move together changes each time.**
  Why: repeating bunches look mechanical.

- **All animation sits inside `prefers-reduced-motion: no-preference`.**
  Why: people who ask for reduced motion get a still sky. `check.mjs` enforces it.

## Interaction

- **A glow marks a state that needs the user (ready to send, a result waiting). Idle and selected elements stay matte.**
  Why: a glow on everything stops meaning anything.
