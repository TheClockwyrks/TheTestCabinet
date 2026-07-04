# Sunfront Monolith — sculpting and rigging brief

You are sculpting and rigging the Sunfront Monolith, a towering super-heavy bipedal
war-mech carrying a giant cannon on its right arm, as a 3D voxel model with a rig a
game poses and animates at runtime. There is no target model to copy: build
something that reads unmistakably as this hulking walking mech and satisfies the
animation contract below.

This brief fixes what the Monolith is and how it must move. It does not give you a
parts list, joint placements, or pose angles — working out the pieces a walking,
firing mech needs, where they attach, and how they articulate is the test. Invent
the rig.

## How the tool works

`voxel-anim` places discrete opaque voxels (cells), one recorded operation at a
time. You paint each part's geometry with the tool's voxel operations — setting and
clearing single cells, filling and stroking boxes, 3D lines, and spheres, with a
mirror plane — each in an opaque `#rrggbb` color (there is no transparency). Global
`--part <name>` selects the part an op sculpts; each part is its own model, previewed
on its own. Create a part with `define-part` before you sculpt into it.

Build one operation at a time. A call **records only** and renders nothing; run
`voxel-anim render` to (re)draw `parts/<part>.png` and the assembled `scene/*.png`,
then read them between calls. `voxel-anim --help` is the contract.

## The volume and coordinate system

- The volume is **50 wide (x) × 80 tall (y) × 50 deep (z)**, in opaque voxels. It
  starts empty.
- x runs across the mech, `0`–`49`. y runs up, `0` (bottom, the ground) to `79`
  (top of the head). z runs front-to-back, `0`–`49`.
- **Forward is +z:** the mech faces toward `z = 49` (the front), and the cannon
  points that way when it is level. Up is +y.
- Build the mech symmetric about the lengthwise vertical centerplane at `x = 25`
  (between `x = 24` and `x = 25`) — the two legs mirror each other, and the torso and
  head are centered on it (the right-arm cannon deliberately breaks that symmetry).
- The Monolith is deliberately huge and imposing — an expensive capstone bruiser,
  broad and heavily armored, filling most of the height and width. It stands planted
  on the ground, with the massive torso and head stacked above the hips.
- Each part is sculpted in this same volume's coordinates, positioned where the part
  sits on the assembled mech.

## What the Monolith is (and what is yours to invent)

The mech must read unmistakably as all of these:

- A massive armored torso with a head on top — a broad-shouldered upper body, not a
  plain box — the fixed core the whole machine hangs from.
- Two thick legs that carry it and walk (see the animations), planted beneath the
  hips.
- A giant cannon carried on the right arm, projecting forward (+z) when level, that
  can aim up and down and recoil.
- A clear solar-amber core set into the chest and amber shoulder lights, so the
  accent reads from many angles.

Everything else is yours to invent — the exact silhouette, proportions, how the
torso is massed and the head shaped, how the cannon is built, and how you break the
mech into rig parts and place its joints. Nothing here prescribes a shape; the test
rewards a bold, characterful design that is unmistakably the Monolith and animates
convincingly.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Plating — primary armor (brass) | `#c69a4b` |
| Dark plating, underside, shadow (bronze) | `#7a5527` |
| Secondary panels (sandstone) | `#d9c48c` |
| Cannon, legs, joints, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Core and shoulder-light accent (solar amber) | `#ff9d2e` |

The solar-amber accent is the team-tint region: give the mech a clear amber core set
into the chest, plus amber shoulder lights, so the accent reads from multiple angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with two required animation declarations by name; you author
the motion with `voxel-anim define-animation` then `add-keyframe`, choosing the
period and each key's `--interp` (`constant`/`linear`/`bezier` or
`ease-in`/`ease-out`/`ease-in-out`) so the motion carries weight — legs and the
cannon are heavy, so ease it rather than sliding linearly, and give a foot-plant or a
gun recoil a sharp `ease-in` for a satisfying thump.

- **`walk`** — a game-triggered playable. The mech strides forward on its two legs as
  a slow, super-heavy bruiser and reads as a machine pushing itself forward, not
  flailing: the feet plant firmly on the ground and the body rolls forward over them.
  Author it in place — the body stays centered in the volume and the clip must not
  translate the whole model across the scene; the leg cycle alone carries the stride,
  and a consuming game supplies the real forward travel. The legs move; the cannon
  holds.
- **`fire`** — a game-triggered playable. The giant arm-cannon snaps into a quick
  recoil nod, overshoots back, and settles, while the mech stands its ground and the
  legs stay planted.

You may add extra parts, joints, and animations of your own (for example a live
weapon-aim control, a subtle head turn, or a left-arm detail); you must produce these
two animations, by these names, and must not contradict them (don't move the legs
under `fire` or the cannon under `walk`).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots
with `set-pivot`, place joints with `define-joint`, and author the two animations'
keyframes — running `voxel-anim render` and reading `parts/<part>.png` and the
`scene/*.png` previews between calls to confirm the parts fit, the legs seat under the
body and reach the ground, and the animations read with weight. Run `voxel-anim --help` for the available operations
(setting and clearing single voxels, filling and stroking boxes, 3D lines, spheres,
and a mirror plane) and the rig and animation subcommands, and `voxel-anim
<operation> --help` for each one's exact flags. Run `voxel-anim render` before you
finish so it emits the per-part `.glb` geometry your result is built from — an
unrendered part scores as empty (`voxel-anim render --component <part>` renders one
part; `voxel-anim render --time <ms> --animation <name>` renders the model posed at
that instant to check the motion). The recorded per-part logs and `rig.json` are your
scored submission.
