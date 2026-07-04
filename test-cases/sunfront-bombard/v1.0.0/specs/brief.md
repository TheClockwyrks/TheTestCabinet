# Sunfront Bombard — sculpting and rigging brief

You are sculpting and rigging the Sunfront Bombard, a four-legged siege mortar walker
with a swiveling turret and a long, high-lobbing barrel — a striding artillery machine
that walks on legs, aims its turret, and lobs mortar fire high. Build it with
`voxel-anim` (painting discrete opaque cells) as a rigged 3D voxel model a game poses
at runtime. There is no target model to copy: it must read unmistakably as the Bombard
and satisfy the animation contract below.

This brief fixes what the Bombard is and how it must move. It deliberately does not
give you a parts list, joint placements, or pose angles — working out the pieces a
walking, firing artillery walker needs, where they attach, and how they articulate is
the test. Invent the rig.

## How the tool works (paint opaque cells)

`voxel-anim` places discrete opaque voxels — you build each part by painting cells:

- Set and clear single voxels, fill and stroke boxes, draw 3D lines and spheres, and
  use a mirror plane — each in an opaque `#rrggbb` color (there is no transparency).
- Global `--part <name>` selects the part an op sculpts; each part is its own volume,
  previewed on its own. Create a part with `define-part` before you sculpt into it.

Build one operation at a time. `voxel-anim` re-renders `parts/<part>.png` and the
assembled `scene/*.png` — read them between calls. `voxel-anim --help` is the contract.

## The volume and coordinate system

- The volume is **40 wide (x) × 40 tall (y) × 60 deep (z)**, in opaque voxels. It
  starts empty; each part is sculpted in these shared coordinates, positioned where it
  sits on the assembled walker.
- x runs across the walker, `0`–`39`. y runs up, `0` (the ground) to `39`. z runs
  front-to-back, `0`–`59`. Forward is +z: the walker faces toward `z = 59`, and the
  barrel points that way when the turret is at rest.
- Build it roughly symmetric left-to-right about the lengthwise centerplane (between
  `x = 19` and `x = 20`) — the left and right legs mirror, and the hull, turret, and
  barrel are centered on it.
- It is a walker: keep the hull low and long, riding raised off the ground on its legs,
  with clearance under the hull and the legs reaching down to the ground.

## What the Bombard is (and what is yours to invent)

Fixed — the walker must read unmistakably as all of these:

- A low, boxy armored hull — the fixed core of the machine — riding raised on legs,
  running most of the depth and width.
- Four legs, one at each corner, that carry the hull and walk (see the animations).
- A turret on top of the hull that swivels to aim left and right.
- A long mortar barrel projecting forward from the turret that elevates to lob high.
- A clear solar-amber muzzle glow at the mouth of the barrel, and the palette below.

Everything else is yours to invent — the exact silhouette, proportions, number of
segments and design of the legs, how the hull is massed, how the turret and barrel are
shaped, and how you break the walker into rig parts and place its joints. Nothing here
prescribes a shape; the test rewards a bold, characterful design that is unmistakably
the Bombard and animates convincingly.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Hull — primary plating (brass) | `#c69a4b` |
| Hull — dark plating, underside, shadow (bronze) | `#7a5527` |
| Legs, gun barrel, mechanisms (iron) | `#565c64` |
| Deep recesses, shadow (dark iron) | `#31353b` |
| Muzzle-glow accent (solar amber) | `#ff9d2e` |

Give the Bombard a clear amber muzzle glow at the mouth of the barrel, so the
solar-amber accent reads from multiple angles.

## The required animations — the fixed contract

`rig.json` is pre-seeded with two required animation declarations by name (you author
the motion). Author each with `voxel-anim define-animation` then `add-keyframe`,
choosing the period and each key's `--interp` (`constant`/`linear`/`bezier` or
`ease-in`/`ease-out`/`ease-in-out`, with optional `--in-handle`/`--out-handle`) so the
motion carries weight — legs and the barrel are heavy, so ease them rather than sliding
linearly.

- **`walk`** — the walk (a game-triggered playable). The feet plant flat on the ground
  and the Bombard advances over them so it reads as a heavy machine pushing itself
  forward, not flailing. Authored in place: the body does not translate across the
  scene — the leg cycle alone carries the stride (played on its own the planted foot
  slides straight back under the body, treadmill-style, then swings forward), and a
  game supplies the real travel. The legs move; the turret and barrel hold.
- **`bombard_fire`** — the weapon showcase (a game-triggered playable). The mortar
  barrel kicks up in a quick recoil-lob off its rest elevation, then eases back down
  and holds, so a reviewer can watch the mortar fire. It touches no leg — the legs hold
  planted while the barrel fires.

You may add extra parts, joints, and animations of your own (for example an ammo feed,
spent-casing chutes, or a decorative detail); you must produce these two animations, by
these names, and must not contradict them (e.g. don't move the legs under
`bombard_fire` or fire the barrel under `walk`).

## Working the tool

Define your parts with `define-part`, sculpt each with `--part <name>`, set pivots with
`set-pivot`, place joints with `define-joint`, and author the two animations' keyframes
— reading `parts/<part>.png` and the `scene/*.png` previews between calls to confirm
the parts fit, the legs seat and reach the ground, the turret sits on the hull, the
barrel meets the turret's front, and the animations read with weight. Run `voxel-anim
--help` for the available operations (setting and clearing single voxels, filling and
stroking boxes, 3D lines, spheres, and a mirror plane), the rig subcommands, and the
animation subcommands, and `voxel-anim <operation> --help` for each one's exact flags.
The recorded per-part logs and `rig.json` are your scored submission.
