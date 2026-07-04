# Skyshard Interceptor — sculpting brief

You are sculpting the Skyshard Interceptor, a single-seat forward-swept fighter jet,
as a small 3D voxel model. There is no target model to copy: build something that
reads unmistakably as this interceptor from the description below.

## The volume and coordinate system

- The volume is **50 wide (x) × 20 tall (y) × 76 deep (z)**, in opaque voxels. It
  starts empty.
- **x** runs across the wingspan, `0`–`49`. **y** runs up, `0` (bottom) to `19`
  (top). **z** runs front-to-back, `0`–`75`.
- **Forward is +z:** the nose points toward `z = 75` (the front) and the tail sits
  toward `z = 0` (the rear). Up is +y.
- Build the jet symmetric about the lengthwise vertical centerplane between `x = 24`
  and `x = 25` — the left and right halves mirror each other.
- The jet is long and low: the fuselage should run nearly the full depth, the wingtips
  should reach close to the left and right faces, and it should fill most of the
  volume — leaving only a couple of voxels of margin, never clipped where it runs past
  a face.

## Palette

Use only these opaque colors (the model is regenerated from your operations, so
off-palette colors and stray voxels count against you):

| Role | Hex |
| --- | --- |
| Hull (steel) | `#8a94a6` |
| Underside (dark steel) | `#4a5160` |
| Canopy (cyan glass) | `#4fd8ff` |
| Nose & tail accent (warm) | `#ff6b3d` |
| Afterburner glow | `#ffd24a` |

## The form

The Skyshard reads, at a glance, as a sleek forward-swept interceptor pointing along
+z:

- Fuselage: a long central body in the hull color running most of the depth along
  `z`, about the centerplane and sitting in the middle of the height. Its underside is
  the dark-steel color.
- Nose: the fuselage tapers to a pointed nose at the front (toward `z = 75`),
  narrowing in both width and height so the silhouette clearly leads with a point. A
  band of the warm accent wraps the nose tip.
- Canopy: a small cyan-glass canopy set into the top of the fuselage just behind the
  nose, reading as a cockpit.
- Wings: a pair of thin forward-swept wings low on the fuselage, one each side,
  spreading out toward the left and right faces. They are forward-swept: each wing's
  tip sits ahead (larger z) of its root, the leading edge sweeping toward the nose.
  This forward sweep is the interceptor's signature.
- Tail: at the rear (toward `z = 0`), a pair of small vertical tail fins rising above
  the fuselage, mirrored about the centerplane, with the warm accent marking their
  tips.
- Afterburner: the exhaust at the very back face glows in the afterburner color,
  centered on the fuselage.

## Working the tool

The `voxel` binary is the only way to place a voxel. Run `voxel --help` for the
available operations (setting and clearing single voxels, filling and stroking boxes,
3D lines, spheres, and a mirror plane) and `voxel <operation> --help` for each one's
exact flags. Because the jet is symmetric, a mirror plane at `x = 25` can complete the
right half from the left. Call `voxel` once per operation; each call only records to
the log and renders nothing, so run `voxel render` (it meshes to `mesh.glb` and draws
`model.png`) when you want to judge your progress against this brief, and once more
before you finish so the geometry is emitted.
