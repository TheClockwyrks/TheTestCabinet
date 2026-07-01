# Spectra — Art assets (provided; use them)

Spectra ships with a **fixed set of pre-drawn sprites**, seeded into your project
under **`assets/`**. They are the canonical art for the player ship and the three
drones and are the **same for every build** — your job is to build the game
*around* them, not to redraw them.

**You must render the ship and the drones using these provided sprites.** Do
**not** substitute your own fighter or drone art, and do not restyle the
silhouettes. What you *do* derive at runtime is the **band** each sprite is drawn
in — see *One sprite per entity, both bands at runtime* below — because Spectra's
whole point is that these things change band. Everything else the game
draws — bullets, effects, the HUD, menus — has **no** sprite and you draw it in
code as the other specs describe. Every measurement, color, and glyph here is
consistent with `specs/overview.md`, `specs/playfield.md`, `specs/polarity.md`,
and `specs/enemies.md`; when this file gives a value it matches them.

## Loading the assets — they must work under any base path

The built site is **not guaranteed to be served from the root of its origin.**
When the finished build is played back it is mounted under a **per-run sub-path**
(a path like `/runs/<id>/build/`), not at the domain root. Your build must
therefore run **unchanged at any base path** — every URL it requests has to
resolve relative to the page, not to the origin root. This is the single most
common way this build breaks, so get it right:

- **Never reference an asset by a root-absolute URL** — anything with a leading
  `/`, such as `/assets/fighter.png`. A root-absolute URL ignores the page's
  location and resolves against the origin root, so under a sub-path it points
  outside the build and 404s. A sprite loader that sets an image source to a
  string like `/assets/<name>.png` works when served from a root and fails the
  instant it is served from a sub-path.
- **Reference assets relative to the document or module instead**, so each URL
  resolves against wherever the page actually lives. Prefer letting your bundler
  resolve them: import each PNG, or use a bundler directory glob (for example
  Vite's `import.meta.glob('../assets/*.png', { eager: true, query: '?url' })`)
  and use the URLs it returns. A runtime `new URL('./assets/fighter.png',
  import.meta.url)` also works, but only if your bundler can statically resolve
  it.
- **Configure your bundler's base path to be relative.** If it has a
  base/public-path setting, set it so the emitted JS, CSS, and asset URLs are all
  page-relative (for Vite, `base: './'`). The default of an absolute `/` base
  produces exactly the root-absolute references that break under a sub-path — for
  the entry script and stylesheet as well as the art.
- **Nothing fixes a bad URL for you at serve time.** When the build is served
  under a sub-path the host injects a `<base>` tag and rewrites root-absolute
  references in the **static HTML** — but that reaches only the markup it serves.
  It **cannot** touch a URL your JavaScript builds at runtime, and a `<base>` tag
  does not affect a root-absolute (`/…`) URL at all. Any path your code constructs
  is your responsibility.

This applies to **every** runtime request — the bundled JS and CSS and these art
assets alike — not just the art. The quickest self-check: serve your `dist/` from
a non-root sub-path (e.g. `http://localhost:8080/sub/path/`) and confirm the game
still loads with no 404s, not only from the server root.

## How the assets are organized

Each asset is a **single PNG**, not a sprite sheet: one file per entity, drawn on
a **64×64** transparent canvas (straight alpha — only the drawn pixels are opaque,
so each composites cleanly over the void). There is no animation frame data; these
are single stills you position, scale, and recolor yourself.

| Sprite | File | Canvas | What it is | Depicted band |
| --- | --- | --- | --- | --- |
| Fighter | `assets/fighter.png` | 64×64 | The player's resonator-fighter, hull pointing up | **Cyan** (ring core) |
| Shard | `assets/shard.png` | 64×64 | The fixed-band crystalline drone | **Magenta** (diamond) |
| Flux | `assets/flux.png` | 64×64 | The oscillating drone, caught **mid-shimmer** | **Both** (shimmer) |
| Prism | `assets/prism.png` | 64×64 | The two-band boss drone, shell around core | **Cyan** shell, **magenta** core |

These are **pixel art**. The in-game footprints are smaller than the canvas (the
ship is about `40×28`, a Shard about `28 px`, a Flux about `30 px`, a Prism about
`56 px` — see `specs/playfield.md` and `specs/enemies.md`), so each sprite is
**scaled down** to its entity's footprint, centered on the entity's position, and
sampled with **nearest-neighbor** (`image-rendering: pixelated` for DOM/CSS,
`imageSmoothingEnabled = false` for Canvas) so it stays crisp and never blurs. The
soft neon **glow** around ship, drones, and bullets is a runtime effect you draw
around the sprite, not baked into the art.

## One sprite per entity, both bands at runtime

Spectra runs on two bands — **Cyan** (`#34e2ff`, the **ring** glyph) and
**Magenta** (`#ff4ec7`, the **diamond** glyph) — and the ship, the Shards, the
Fluxes, and the Prisms all appear in **both** bands over a game. Each sprite is
provided in **one** representative band-state (the *Depicted band* column above).
The other band-state is the **same silhouette** re-tinted to the other band's
color with its glyph swapped to match — this is exactly the colorblind-safe
band convention `specs/overview.md` defines (ring for cyan, diamond for magenta),
applied to the art. So:

- Treat each sprite as the **canonical shape and shading** for its entity. Derive
  the band you need to show by recoloring the band-carrying parts to that band's
  color and drawing that band's glyph (ring for cyan, diamond for magenta) in
  place of the depicted one. The hull/crystal/shell **form never changes** — only
  its band color and glyph do.
- Whether you re-tint the provided PNG at runtime (a tint/multiply pass plus a
  glyph swap) or pre-bake a per-band copy of each sprite at build time is your
  choice; the requirement is that the **on-screen shape is the provided art** and
  the **band always reads correctly** (right color *and* right glyph), never a
  cyan diamond or a magenta ring.

The per-entity notes below say exactly which band-states each sprite must cover.

## The Fighter — `assets/fighter.png` (the player ship)

An arrowhead hull (`#eaf0fb`) pointing **up**, with a glowing **cyan** core
carrying the **ring** glyph, symmetric about its vertical centerline. It is drawn
at the ship's footprint (about `40×28`) centered on the ship's lane position
(`specs/playfield.md`).

- The provided sprite is the ship **tuned to cyan**. When the player flips to
  **magenta** (`specs/controls.md`), draw the **same hull** with its core recolored
  magenta and the ring glyph replaced by the **diamond** glyph. The core color and
  the polarity indicator must always agree with the ship's current band
  (`specs/playfield.md`).
- The small **lives** icons in the bottom HUD may reuse the fighter sprite at a
  small size.

## The Shard — `assets/shard.png` (fixed-band drone)

A small faceted crystal drawn in **magenta** with the **diamond** glyph — the
basic drone and the bulk of a formation (`specs/enemies.md`). Drawn at about
`28 px`.

- A Shard's band is **fixed for its life**, but a formation is seeded with Shards
  of **both** bands. The provided sprite is the **magenta** Shard; render a
  **cyan** Shard as the **same crystal** re-tinted cyan with the **ring** glyph.
- A one-hit destroy to a **matching** shot; the sprite does not otherwise change
  during play.

## The Flux — `assets/flux.png` (oscillating-band drone)

A drone caught **mid-shimmer**, showing **both** bands at once (cyan and magenta,
both glyphs, white shimmer flecks) — this is the Flux's `0.4 s` **shimmer**
telegraph, when it is settled on neither band (`specs/enemies.md`). Drawn at about
`30 px`.

- Use the provided sprite for the **shimmer window** only. During a **held**
  window the Flux is settled on **one** band, so draw it as the **same body** in
  that held band's single color and glyph (cyan+ring or magenta+diamond) — i.e.
  the held-state art is the shimmer silhouette collapsed to one band, matching how
  the Shard reads in a single band.
- The shimmer is the tell that a flip is coming and that **every** shot is wasted
  during it; the held single-band states are the only windows in which a matching
  shot destroys it.

## The Prism — `assets/prism.png` (two-band boss drone)

The large boss (about `56 px`): an **outer shell** in one band around an **inner
core** in the **opposite** band. The provided sprite is a **cyan shell** (ring)
around a **magenta core** (diamond) (`specs/enemies.md`).

- A Prism's two layers are **always opposite bands**, but which band is on the
  outside varies. Render the **magenta-shell / cyan-core** Prism as the **same
  two-layer construction** with the shell and core colors and glyphs swapped.
- **When the shell is destroyed**, draw only the **exposed core** — the inner
  layer of the sprite (the diamond core in the provided art, or the swapped-band
  core) shown alone, without its shell. The core is then destroyed by a shot of
  the **core's** band.
- The Prism enters escorted by two Shards (one cyan, one magenta), each drawn from
  the Shard sprite as above.

## What has no asset — draw these in code

These are **not** provided; render them yourself, exactly as the other specs
describe, in the palette in `specs/overview.md`:

- **Bullets** — player and enemy alike — each a small mark in its band's color and
  **glyph** (`specs/playfield.md`, `specs/controls.md`).
- The soft neon **glow** around the ship, drones, and bullets, and the faint
  **starfield** behind the play field (`specs/overview.md`).
- The **discharge** screen-clearing burst, and the **spectral-inversion** overlay
  (the field-wide tint and indicator) (`specs/polarity.md`, `specs/enemies.md`).
- The entire **HUD** — score, stage, the lives readout, the resonance meter, and
  the polarity indicator — and **all text, menus, panels, overlays, and state
  screens** (`specs/playfield.md`, `specs/flow.md`).
