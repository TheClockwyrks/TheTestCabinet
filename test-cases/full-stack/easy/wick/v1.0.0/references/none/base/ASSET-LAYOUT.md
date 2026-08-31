# Wick — asset layout

The map of every produced file the game loads: where each lands under
`assets/`, its canvas and count, and what draws it. It is the companion to the
contract in `specs/assets.md`, which says what to produce; this file records
where it landed and how it is wired in.

Everything here was produced once with the tools on the `PATH` and committed.
`npm ci` and `npm run build` bundle the committed files and invoke no tool.
`node scripts/gen-sprites.mjs` regenerates the whole image set; the sound is
produced separately and mapped below when it lands.

## How the files are loaded

`src/assets.ts` gathers every PNG under `assets/` through Vite's import glob,
decodes each before the first frame, and keys it by its path under `assets/`,
so `sprites/ground.png` is `assets.image("sprites/ground.png")`. Every URL
resolves against the page, never the origin root, so the built site runs from
a sub-path. A file that fails to load leaves the game on its code-drawn
stand-in of the same size; `producedImages()` lists every path with its
canvas, and `src/assets.test.ts` checks each file is committed at that size.

## Sprites, `scripts/gen-sprites.mjs`

All transparent, straight alpha, drawn at one unit per pixel and centered on
the thing they depict, and drawn by the game with image smoothing off.

| Files | Canvas | Count | Drawn by | Notes |
| --- | --- | --- | --- | --- |
| `sprites/lamplighter/idle.png` | 24 x 32 | 1 | `src/render/world.ts` | Faces right; mirrored in code for `facing = "left"`. The lamp hangs from a pole on the facing side. |
| `sprites/lamplighter/walk/{0..5}.png` | 24 x 32 | 6 | `src/render/world.ts` | Two strides with a passing pose between, the body dipping on contact and the lamp swinging a pixel behind. Frame `floor(m × TICK_DT / WALK_FRAME_TIME) mod 6` over the moved ticks `m`. |
| `sprites/enemies/<id>/{0..3}.png` | twice the radius, square | 52 | `src/render/world.ts` | One four-frame cycle per enemy, the poses up, mid, down, mid. Fliers face the camera; walkers face right and are mirrored when the heading points left. Frame `floor(age / WALK_FRAME_TIME) mod 4`. |
| `sprites/puff/{0..3}.png` | 24 x 24 | 4 | `src/render/world.ts` | A flash, a cloud, a ring of wisps, and stray motes, over `PUFF_TIME`. |
| `sprites/gems/{small,medium,large}.png` | 8, 12, 16 | 3 | `src/render/world.ts` | A cyan diamond, a green hexagon, a gold faceted stone: each tier a different size and form. |
| `sprites/pickups/{chest,bread,draft}.png` | 24 x 24 | 3 | `src/render/world.ts` | A banded chest with a brass clasp, a scored loaf, and three pale gusts. |
| `sprites/ground.png` | 64 x 64 | 1 | `src/render/world.ts` | Cobbles in a running bond that wrap on every edge, with lit and shadowed edges and a little moss. Repeated in world space. |

### The enemy cycles

| Id | Canvas | Form |
| --- | --- | --- |
| `moth` | 20 | Dust-pale wings on a slip of a body; the wings fold toward the body across the cycle. |
| `bat` | 20 | A violet scalloped membrane with ears; the wings sweep up and down. |
| `rat` | 24 | Long and low, a pink tail and snout; legs and tail swing. |
| `gnat` | 16 | A green speck in a translucent blur of wings. |
| `beetle` | 28 | A domed teal shell with a seam, on six legs that alternate. |
| `wisp` | 20 | A pale blue flame with two dark eyes; the tip leans. |
| `spider` | 28 | Eight long legs about a small body with a red mark. |
| `crow` | 24 | Black, a gold beak, one spread wing that beats. |
| `shade` | 32 | A hooded robe with no legs, glowing eyes in a void; the hem sways. |
| `hound` | 36 | A running grey dog with a red eye; the legs stretch and gather. |
| `mothwing` | 56 | A giant cream moth with eyespots; the wings fold. |
| `owl` | 72 | A broad tawny owl with huge eyes; each wing is a `draw-sheet` layer rotated at the shoulder. |
| `dark` | 80 | A lumpy black mass rimmed in violet, with eight eyes that blink on the third frame; its five tendrils are a layer turned a fifth of a revolution over the cycle. |

## The weapon effects, `scripts/gen-sprites.mjs`

Each is produced on its canvas and scaled in code to the live hitbox by
`src/render/effects.ts`: a slash over its `width x height`, everything else
over its circle. A sheet's frame comes from the ticks since the shape appeared.

| Files | Canvas | Count | Drawn over | Form |
| --- | --- | --- | --- | --- |
| `sprites/effects/taper.png` | 120 x 40 | 1 | the slash rectangle, mirrored to its side | A lens of flame, cream core in orange. |
| `sprites/effects/pyre.png` | 120 x 40 | 1 | the slash rectangle | The lens white-hot, in red, with licks above and below and embers. |
| `sprites/effects/ember.png` | 16 x 16 | 1 | the bolt's circle, turned to its velocity | An orange orb with a tail. |
| `sprites/effects/beacon.png` | 16 x 16 | 1 | the bolt's circle, turned | A white-blue orb with four rays. |
| `sprites/effects/pin.png` | 12 x 12 | 1 | the dart's circle, turned | A steel dart. |
| `sprites/effects/hail.png` | 12 x 12 | 1 | the dart's circle, turned | An ice dart in a cold glow. |
| `sprites/effects/lantern.png` | 28 x 28 | 1 | each lantern's circle | A hanging brass lantern. |
| `sprites/effects/chandelier.png` | 28 x 28 | 1 | each lantern's circle | A gold hoop with three candles and crystal drops. |
| `sprites/effects/halo.png` | 160 x 160 | 1 | the aura's circle | A gold ring with twelve small flames; the code brightens it on the pulse tick. |
| `sprites/effects/corona.png` | 160 x 160 | 1 | the aura's circle | A double ring with rays and a white inner line. |
| `sprites/effects/oil-splash.png` | 100 x 100 | 1 | the puddle's circle | A dark oily blot with a sheen; brightened on each pulse. |
| `sprites/effects/blaze.png` | 100 x 100 | 1 | the puddle's circle | The blot charred and rimmed in fire, flames all round. |
| `sprites/effects/spark/{0..3}.png` | 80 x 80 | 4 | the strike's `area` circle | A bolt strikes, flashes, rings out, and fades, over `SPARK_FLASH`. |
| `sprites/effects/shard.png` | 16 x 16 | 1 | the shard's circle, turned | A cyan crystal. |
| `sprites/effects/sconce/{0..3}.png` | 24 x 24 | 4 | the sconce's circle | An iron bracket with a flame, a layer turned a quarter per frame so it spins. |
| `sprites/effects/flare/{0..5}.png` | 128 x 128 | 6 | the burst's circle | A flash and a ring expanding and fading over `FLARE_FLASH`. |

## The icons, `scripts/gen-sprites.mjs`

Twenty-seven 24 x 24 plates at `icons/<id>.png`, drawn by `src/render/hud.ts`
in the slots and by `src/render/screens.ts` in the level-up and chest
overlays. The rim says what a thing is: slate for a base weapon, gold for an
evolved one, brown for a passive, green for lamp oil. An evolved weapon's
symbol is its base's burning hotter.

| Ids | Symbols |
| --- | --- |
| `taper`, `pyre` | A candle; a candle in a tall red flame with embers. |
| `ember`, `beacon` | An orange orb with sparks; a white-blue orb with rays. |
| `pin`, `hail` | One needle; three icy needles. |
| `lantern`, `chandelier` | A lantern; a hoop of candles with drops. |
| `halo`, `corona` | A gold ring; a ring with rays. |
| `oil-splash`, `blaze` | A dark droplet with splashes; the droplet on fire. |
| `spark`, `shard`, `sconce`, `flare` | A lightning bolt, a cyan crystal, a wall bracket with a flame, a starburst. |
| `wick`, `oil`, `glass`, `brass`, `mirror` | A coiled wick alight, an amber bottle, a lens, a shield, a hand mirror. |
| `bellows`, `tallow`, `tinder`, `soot`, `lure` | A bellows, a heart, twigs with sparks, a black smudge, a magnet. |
| `lamp-oil` | An oil can with a green cross. |

## Audio

The fourteen cues and the music bed of `specs/assets.md` land under
`assets/audio/` and are mapped here when produced.
