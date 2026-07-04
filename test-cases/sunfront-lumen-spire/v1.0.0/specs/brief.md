# Sunfront Lumen Spire — sculpting and rigging brief

You are sculpting and rigging the Sunfront Lumen Spire, a slim beacon spire with a
spinning halo ring and a pulsing solar lens, as a 3D voxel model with a small rig a game
runs at runtime. There is no target model to copy: build something that reads
unmistakably as this beacon spire and runs correctly from the description below.

This brief fixes what the Spire is and how it must move. It deliberately does not give
you a parts list, joint placements, or pose angles — working out the pieces a spinning,
pulsing beacon needs, where they attach, and how they articulate is the test. Invent the
rig.

## How the tool works

`voxel-anim` places discrete opaque cells. You paint solid material:

- Lay down cells with `set-voxel`/`fill-box` and the other cell operations (single
  voxels, filled and stroked boxes, 3D lines, spheres, and a mirror plane), each an
  opaque `#rrggbb` color; there is no transparency and no smoothing.
- Global `--part <name>` selects the part an op sculpts; each part is its own volume of
  cells, previewed on its own. Create a part with `define-part` before you sculpt into
  it.

Build one operation at a time. A call **records only** and renders nothing; run
`voxel-anim render` to (re)draw `parts/<part>.png` and the assembled `scene/*.png`, then
read them between calls. `voxel-anim --help` is the contract.

## The volume and coordinate system

- The volume is **46 wide (x) × 90 tall (y) × 46 deep (z)**, in opaque voxels. It starts
  empty.
- **x** runs across the spire, `0`–`45`. **y** runs up, `0` (bottom, the ground) to `89`
  (top). **z** runs front-to-back, `0`–`45`.
- **Forward is +z:** the spire faces toward `z = 45` (the front). Up is +y.
- Build the spire symmetric about the lengthwise vertical centerplane (mirror across
  `x = 23`, between `x = 22` and `x = 23`) where the form allows, with the halo ring and
  lens centered on the spire's vertical axis.
- The spire is deliberately slim and tall — a slender masonry beacon tower rooted to the
  ground, narrow in width and depth, rising most of the height.
- Each part is composited in these shared coordinates, where it sits on the assembled
  spire.

## What the Spire is (and what is yours to invent)

Fixed — the spire must read unmistakably as all of these:

- A slim, tall masonry tower — a slender signalling spire rooted to the ground, with a
  broader footing that tapers up into a narrow shaft rising most of the height, fleshed
  out into a crown near its top and brought to a tip above it. Not a plain box, and not
  an abstract stack of boxes.
- A halo ring — an open loop, wider than the shaft — encircling the crown, standing
  clear of the shaft so the loop reads. It turns on its own.
- A solar lens — a compact, bright solar-hot core in an iron housing — seated atop the
  spire's tip. It bobs up and down on its own.
- A clear, strong solar-hot energy accent and the palette below.

Everything else is yours to invent — the exact silhouette and proportions, how the tower
is tiered and tapered, how the crown and tip are shaped, how the ring and lens are
styled, and how you break the spire into rig parts and place its joints. Nothing here
prescribes a shape; the test rewards a bold, characterful design that is unmistakably
the Lumen Spire and animates convincingly. Leave the children something to seat against
— a crown for the ring to encircle and a tip for the lens to sit on — so they meet the
spire with no gap.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Ring, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |
| Glowing core highlight (solar hot) | `#ffd76b` |

The solar-amber accent is the team-tint region: give the spire a strong solar energy
accent — a bright solar-hot lens core, with solar-amber glow bleeding down the halo ring
and crown — so the accent reads boldly from multiple angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with two required animation declarations by name (you author the
motion). Both are self-playing idles — they loop continuously on their own, with no
caller — and the spire's tower and foundation stay put throughout. Author each with
`voxel-anim define-animation` then `add-keyframe`, choosing the period and setting each
key's interpolation so the motion carries an eased, weighted cadence rather than sliding
at constant speed.

- **`halo_ring_spin`** — the halo ring turns one full, continuous revolution about the
  spire's vertical axis each loop, wrapping seamlessly with no cell tearing away from the
  crown.
- **`lens_pulse`** — the solar lens lifts off its seat and settles back down within one
  period, hanging at the top and settling with weight, never leaving the tip.

You may add extra parts, joints, and animations of your own (a second ring, a light
halo, extra finials); you must produce both these animations, by these names, both
self-playing, and must not contradict them (the tower stays fixed, and neither element's
motion drags the other).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots with
`set-pivot`, place joints with `define-joint`, and author the two animations' keyframes —
running `voxel-anim render` and reading `parts/<part>.png` and the `scene/*.png` previews
between calls to confirm the parts fit (the ring encircling the crown, the lens seated on
the tip) and that the animations read with weight. Run `voxel-anim render` before you
finish so it emits the per-part `.glb` geometry your result is built from — an unrendered
part scores as empty (`voxel-anim render --component <part>` renders one part; `voxel-anim
render --time <ms> --animation <name>` renders the model posed at that instant to check
the motion). The recorded per-part logs and `rig.json` are your scored submission.
