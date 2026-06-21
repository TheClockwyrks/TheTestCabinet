# Spectra Prism — drawing brief

You are drawing the **Prism**, the **two-band boss drone** for *Spectra*, a
two-band formation shooter. The Prism is the large anchor of a wave: a layered
drone with an **outer shell of one band over an inner core of the opposite
band**. Everything below describes the *enemy* — never the player's ship.

## The canvas

- **64×64 pixels**, transparent background. Origin is the top-left; `x`
  increases to the right, `y` increases downward.
- The Prism is large — draw it **roughly centered**, filling more of the frame
  than a basic drone would.
- Fill most of the frame: the boss should span roughly 48–56 px, centered with
  a few pixels of margin, never clipped at an edge.

## Palette

Use only these colors (the drawing is regenerated pixel-for-pixel, so stray or
off-palette colors and anti-aliased fringes count against you):

| Role | Hex |
| --- | --- |
| Cyan band (shell) | `#34e2ff` |
| Magenta band (core) | `#ff4ec7` |
| Shell gap (dark panel) | `#0b1020` |
| Highlight / glyphs | `#ffffff` |

## The form

The Prism reads, at a glance, as a **two-band boss — a shell around a core**:

- **Shell:** a thick outer **cyan** ring — the shell band — with a narrow dark
  gap (the panel color) separating it from the core, so the two layers read as
  distinct.
- **Core:** an inner **magenta** disc — the opposite band — filling the
  center.
- **Band glyphs:** the two bands read by **shape as well as color** — the cyan
  shell carries the **ring motif** (small ring ticks) and the magenta core
  carries the **diamond glyph** (a white diamond outline). This is the
  colorblind-safe convention the game uses everywhere a band appears.

## Working the tool

Build the sprite up in sensible layers — lay down the outer cyan disc, carve
the dark gap to leave a thick cyan ring, fill the magenta core, then add the
white rim highlights, the core's diamond glyph, and the shell's ring ticks.
Consult `schemas/operations.json` for the available operations (filling and
stroking circles and rectangles, lines, single pixels, flood fill, and a
horizontal mirror) and their exact parameters. Call `draw` once per operation
and read `canvas.png` between calls to judge your progress against this brief
and the target.
