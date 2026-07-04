# Sunfront Reliquary — sculpting and rigging brief

You are sculpting and rigging the Sunfront Reliquary, a tall, precious monument that
cradles a glowing solar core, encircled by a turning orbital ring and crowned by
counter-rotating guardian fins, as a 3D voxel model with a rig a game runs at runtime.
There is no target model to copy: build something that reads unmistakably as this
revered, holy monument and runs correctly from the description below. This is a tall,
imposing solar-core monument — spend the volume on it.

This brief fixes what the Reliquary is and how it must move. It deliberately does not
give you a parts list, joint placements, or pivots — working out how to split the
monument into a fixed body and its moving pieces, where they attach, and how they turn
and rise is the test. Invent the rig.

## How the tool works

`voxel-anim` places discrete opaque cells. You paint solid material:

- Lay down cells with `set-voxel`/`fill-box` and the other cell operations (single
  voxels, filled and stroked boxes, 3D lines, spheres, and a mirror plane), each an
  opaque `#rrggbb` color; there is no transparency and no smoothing.
- Global `--part <name>` selects the part an op sculpts; each part is its own volume of
  cells, previewed on its own. Create a part with `define-part` before you sculpt into it.

Build one operation at a time. `voxel-anim` re-renders `parts/<part>.png` and the
assembled `scene/*.png` — read them between calls. `voxel-anim --help` is the contract.

## The volume and coordinate system

- The volume is **60 wide (x) × 100 tall (y) × 60 deep (z)**, in opaque voxels. It
  starts empty.
- **x** runs across the monument, `0`–`59`. **y** runs up, `0` (bottom, the ground) to
  `99` (top). **z** runs front-to-back, `0`–`59`.
- **Forward is +z:** the face of the plinth and the open front of the core cradle face
  toward `z = 59` (the front). Up is +y.
- Build the monument symmetric about the lengthwise vertical centerplane between `x = 29`
  and `x = 30` where the form allows, with the core, ring, and fins centered on that axis.
- The reliquary is deliberately tall and reverent — a heavy masonry plinth rooted to the
  ground rising into a cradle that holds the glowing core aloft, so the whole form reads
  as precious and holy.
- Each part is composited in these shared coordinates, where it sits on the assembled
  monument (the core cradled at its heart, the ring encircling it, the fins crowning it).

## What the Reliquary is (and what is yours to invent)

Fixed — the monument must read unmistakably as all of these:

- A tall, blocky masonry plinth and cradle — the fixed body of the monument — rooted to
  the ground and rising into a cradle that holds the core aloft near mid-height, built in
  the brass and bronze plating (bronze on its underside and in the shadowed seams,
  sandstone panels for lighter structure), with the cradle opened around the core so the
  core reads as enshrined.
- A glowing solar core cradled at the heart of the monument — a bright, rounded mass in
  the solar-amber and solar-hot accents, cradled with no gap and sized to rise and settle
  without touching the cradle walls.
- An orbital ring standing proud around the core — a toothless iron band that reads as an
  orbiting halo.
- A set of guardian fins crowning the monument above the core — iron blades radiating
  outward from a hub, standing proud above the core so they read as a protective crown.
- A clear solar-amber energy accent and the palette below.

Everything else is yours to invent — the exact silhouette, proportions, how the plinth is
tiered and prowed, how the core, ring, and fins are shaped, and how you break the monument
into rig parts and place its joints. Nothing here prescribes a shape or a skeleton; the
test rewards a bold, characterful design that is unmistakably the Reliquary and animates
convincingly. Leave the moving pieces something to seat against — a cradle around the
core, a clear band-line for the ring, and a hub above the core for the fins — so they meet
the monument with no gap.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Ring, fins, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |
| Core glow highlight (solar hot) | `#ffd76b` |

The **solar-amber** accent is the team-tint region: give the reliquary a heavy, clear
amber energy accent with a solar-hot highlight at the core — a brilliant, glowing solar
core at its heart — so the accent reads as precious from multiple angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with three required animation declarations by name (you author
the motion). All three are self-playing idles — they loop continuously on their own, with
no caller — and the plinth itself stays fixed throughout. Author each with `voxel-anim
define-animation` then `add-keyframe`, giving the motion an eased, weighted cadence rather
than a mechanical linear slide.

- **`ring_spin`** — the orbital ring turns one full, smooth revolution on its own each
  loop, sweeping steadily and continuously. The ring moves; the plinth and fins hold.
- **`core_pulse`** — the solar core rises up, holds near the top, and settles back down
  each loop, breathing with weight. The core moves; the plinth, ring, and fins hold.
- **`fins_spin`** — the guardian fins turn one full revolution on their own each loop, in
  the opposite direction to the ring so they visibly counter-rotate. The fins move; the
  plinth and core hold.

You may add extra parts, joints, and self-playing animations of your own (a second inner
ring, glinting facets, extra masonry buttresses); you must produce these three animations,
by these names, all self-playing, and must not contradict them (the plinth stays fixed —
never carried along by the ring, core, or fins; the ring and fins turn opposite ways).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots with
`set-pivot`, place joints with `define-joint`, and author the three animations' keyframes
— reading `parts/<part>.png` and the `scene/*.png` previews between calls to confirm the
parts fit, the core sits cradled with room to rise, the ring encircles it, the fins crown
it, and the animations read with weight. The recorded per-part logs and `rig.json` are
your scored submission.
