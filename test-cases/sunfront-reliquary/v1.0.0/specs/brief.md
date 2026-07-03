# Sunfront Reliquary — sculpting and rigging brief

You are sculpting and rigging the **Sunfront Reliquary**, a tall, precious
monument that cradles a **glowing solar core**, encircled by a **turning orbital
ring** and crowned by **counter-rotating guardian fins**, as a **3D voxel model**
with a **rig** a game runs at runtime. There is no target model to copy: build
something that reads unmistakably as this revered, holy monument and satisfies the
animation contract below.

This brief fixes **what the Reliquary is** and **how it must move**. It
deliberately does **not** give you a parts list, joint placements, or pivots —
**working out how to split the monument into a fixed body and its moving pieces,
where they attach, and how they turn and rise is the test.** Invent the rig.

## The volume and coordinate system

- The volume is **60 wide (x) x 96 tall (y) x 60 deep (z)**, in opaque voxels. It
  starts **empty**.
- **x** runs across the monument, `0`-`59`. **y** runs up, `0` (bottom, the
  ground) to `95` (top). **z** runs front-to-back, `0`-`59`.
- **Forward is +z:** the face of the plinth and the open front of the core cradle
  face toward `z = 59` (the front). Up is +y.
- Build the monument **symmetric about the lengthwise vertical centerplane between
  `x = 29` and `x = 30`** where the form allows, with the core, ring, and fins
  centered on that axis.
- The reliquary is deliberately **tall and reverent** — a heavy masonry plinth
  rooted to the ground rising into a cradle that holds the glowing core aloft, so
  the whole form reads as precious and holy.
- Each part is sculpted **separately** with `voxel-anim --part <name>`, in this
  same volume's coordinates, positioned where the part sits on the assembled
  monument (the core cradled at its heart, the ring encircling it, the fins
  crowning it).

## What the Reliquary is (and what is yours to invent)

Fixed — the monument must read unmistakably as **all** of these:

- A **tall, blocky masonry plinth and cradle** — the fixed body of the monument —
  rooted to the ground and rising into a cradle that holds the core aloft near
  mid-height. Sculpt it in the brass and bronze plating (bronze on its underside
  and in the shadowed seams, sandstone panels for lighter structure), opening the
  cradle around the core so the core reads as **enshrined**, and flesh out the
  structure where the ring encircles it and where the fins crown it so those pieces
  have something to seat against.
- A **glowing solar core** cradled at the heart of the monument — a bright, rounded
  mass built up in the **solar-amber** and **solar-hot** accents so it reads as
  precious and radiant, cradled with no gap and sized to rise and settle without
  touching the cradle walls.
- An **orbital ring** standing proud around the core — a toothless iron band,
  centered on the vertical axis so it reads as an orbiting halo and turns cleanly
  about its center.
- A set of **guardian fins** crowning the monument above the core — iron blades
  radiating outward from a hub on the vertical axis, standing proud above the core
  so they read as a protective crown and turn cleanly about their hub.
- A clear **solar-amber** accent and the palette below.

**Everything else is yours to invent** — the exact silhouette, proportions, how
the plinth is tiered and prowed, how the core, ring, and fins are shaped, and — the
heart of the test — **how you break the monument into rig parts and place its
joints**: which piece is the fixed body, which three pieces move, and where each
turns or rises. Nothing here prescribes a shape or a skeleton; the test rewards a
bold, characterful design that is unmistakably the Reliquary and animates
convincingly.

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

The **solar-amber** accent is the team-tint region: give the reliquary a heavy,
clear amber **energy accent** with a **solar-hot** highlight at the core — a
brilliant, glowing solar core at its heart — so the accent reads as precious from
multiple angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with **three required animation declarations** by name
(you author the motion). Each is **self-playing** (a decorative idle that plays
continuously on its own) and **loops**, so the monument cycles with no caller.
Author each with `voxel-anim define-animation` then `add-keyframe`, choosing the
period and setting each keyframe's interpolation (`--interp
constant|linear|bezier|ease-in|ease-out|ease-in-out`, with optional
`--out-handle`/`--in-handle` bezier handles) so motion **carries weight** rather
than sliding linearly:

- **`ring_spin`** — the orbital ring's continuous spin. One smooth, steady full
  revolution of the ring about the vertical axis; a constant-speed orbit reads best
  with even, near-linear pacing. The ring moves; the plinth and fins hold.
- **`core_pulse`** — the solar core's breathing rise-and-fall. A slow rise-and-settle
  of the core: lift it up, hold near the top, and ease it back down — use eased
  curves so the breath feels weighted, not a mechanical sawtooth. The core moves; the
  plinth, ring, and fins hold.
- **`fins_spin`** — the guardian fins' continuous counter-spin. One smooth full
  revolution of the fins about the vertical axis in the **opposite direction to the
  ring**, so they visibly counter-rotate. The fins move; the plinth and core hold.

You **may add** extra parts, joints, and self-playing animations of your own (for
example a second inner ring, glinting facets, or extra masonry buttresses); you
must produce these three animations, by these names, and must not contradict them
(e.g. don't turn the ring the same way as the fins, or move the plinth under any of
them).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots
with `set-pivot`, place joints with `define-joint`, and author the three animations'
keyframes — reading `parts/<part>.png` and the `scene/*.png` previews between calls
to confirm the parts fit, the core sits cradled with room to rise, the ring
encircles it, the fins crown it, and the animations read with weight. Run
`voxel-anim --help` for the available voxel operations (setting and clearing single
voxels, filling and stroking boxes, 3D lines, spheres, and a mirror plane), the rig
subcommands, and the animation subcommands, and `voxel-anim <operation> --help` for
each one's exact flags. Call `voxel-anim` once per operation. The recorded per-part
logs and `rig.json` are your scored submission.
