# Sunfront Monolith Forge — sculpting and rigging brief

You are sculpting and rigging the Sunfront Monolith Forge, a towering great forge with a
massive pounding hammer and a turning gear crown, as a 3D voxel model with a rig a game
can pose at runtime. There is no target model to copy: build something that reads
unmistakably as this working forge building and runs correctly from the description
below.

This brief fixes what the forge is and how it must move. It deliberately does not give
you a parts list, joint placements, or pivot coordinates — working out the pieces a
pounding, spinning forge needs, where they attach, and how they articulate is the test.
Invent the rig.

## The volume and coordinate system

- The volume is **90 wide (x) × 110 tall (y) × 90 deep (z)**, in opaque voxels. It starts
  empty.
- **x** runs across the forge, `0`–`89`. **y** runs up, `0` (bottom, the ground) to `109`
  (top). **z** runs front-to-back, `0`–`89`.
- **Forward is +z:** the forge's mouth and hammer throat face toward `z = 89` (the
  front). Up is +y.
- Build the forge symmetric about the lengthwise vertical centerplane (mirror across
  `x = 45`, between `x = 44` and `x = 45`) where the form allows, with the hammer centered
  in its throat and the gear crown centered on top.
- The forge is deliberately huge and blocky — one of the largest structures in the
  roster, a massive masonry forge rooted to the ground, filling most of the width and
  depth at its base and rising most of the height.
- Each part is sculpted separately with `voxel-anim --part <name>`, in this same volume's
  coordinates, positioned where the part sits on the assembled forge (the hammer already
  up in its throat, the gear crown already on top).

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Masonry — primary plating (brass) | `#c69a4b` |
| Masonry — dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels / lighter structure (sandstone) | `#d9c48c` |
| Hammer, gear, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Energy accent (solar amber) | `#ff9d2e` |

The solar-amber accent is the team-tint region: give the forge a clear amber energy
accent — a glowing forge-mouth or vent at the hammer throat — so the accent reads from
multiple angles.

## What the forge is (and what is yours to invent)

Fixed — the forge must read unmistakably as all of these:

- A huge, blocky masonry forge tower — the fixed base of the structure — sitting on the
  ground from `y = 0`, filling most of the width and depth at its foundation and rising
  most of the height. Build it in the brass and bronze plating (bronze on its underside
  and in the shadowed seams, sandstone panels for lighter structure), not a plain box but
  a working forge building.
- A throat opened up its center for the hammer to pound in, with the solar-amber energy
  accent — a glowing forge-mouth or vent — at the throat.
- A massive stamping hammer riding in that throat, up near the top of the tower, sized to
  pound straight down deep and back up without touching the throat walls, meeting the
  tower at its mount with no gap.
- A broad toothed gear crown (a disc with teeth around its rim) mounted atop the forge,
  standing proud of the crest so its teeth read, meeting the tower at its hub with no gap.
- A clear solar-amber accent and the palette above.

Everything else is yours to invent — the exact silhouette and proportions, how the tower
is massed and tiered, how the throat is cut, how the hammer head and the gear crown are
shaped, and how you break the forge into rig parts and place its joints. Nothing here
prescribes a shape or a pivot; the test rewards a bold, characterful design that is
unmistakably the Sunfront Monolith Forge and animates convincingly. Leave the children
something to seat against — a throat for the hammer to ride in, and a crest for the gear
crown to hub against — so they meet the tower with no gap.

## The required animations — the fixed contract

`rig.json` is pre-seeded with two required animation declarations by name (you author the
motion). Author each with `voxel-anim define-animation` then `add-keyframe`, choosing the
period and setting each key's `--interp` (`constant`, `linear`, `bezier`, `ease-in`,
`ease-out`, or `ease-in-out`, with optional `--out-handle`/`--in-handle`) so the motion
carries weight — an eased curve, never a flat linear slide. Both are decorative,
self-playing idles (`auto_play`): they run continuously so the forge cycles on its own,
with no caller, and the forge tower stays fixed throughout.

- **`hammer_stamp`** — the great hammer drops deep straight down its throat and rises
  back to rest, pounding on its own each loop; the drop lands with weight, an eased thud
  rather than a weightless slide, with no part of it tearing away or clipping the throat
  walls.
- **`crown_spin`** — the toothed gear crown turns one steady full revolution on its own
  each loop, looping seamlessly at a constant pace with no cell tearing away from the
  crest.

You may add extra parts, joints, and animations of your own (for example a second gear, a
puff vent, or extra pipework); you must produce these two animations, by these names, and
must not contradict them (never move the forge tower under either one).

## Working the tool

Sculpt each part up in sensible layers, selecting it with `--part <name>` — finish the
forge tower and its throat, then the hammer, then the gear crown, checking each part's
preview as you go. Define your parts with `define-part`, set pivots with `set-pivot`,
place joints with `define-joint`, and author the two animations' keyframes with
`define-animation`/`add-keyframe` — running `voxel-anim render` and reading
`parts/<part>.png` and the `scene/*.png` previews between calls to confirm the parts fit,
the hammer rides centered in the throat, the crown seats on the crest, and the animations
read with weight. Run `voxel-anim
--help` for the available operations (setting and clearing single voxels, filling and
stroking boxes, 3D lines, spheres, and a mirror plane) and the rig subcommands, and
`voxel-anim <operation> --help` for each one's exact flags. Run `voxel-anim render`
before you finish so it emits the per-part `.glb` geometry your result is built from — an
unrendered part scores as empty (`voxel-anim render --component <part>` renders one part;
`voxel-anim render --time <ms> --animation <name>` renders the model posed at that instant
to check the motion). The recorded per-part logs and `rig.json` are your scored
submission.
