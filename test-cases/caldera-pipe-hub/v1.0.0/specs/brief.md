# Caldera Pipe Hub — sculpting brief

You are sculpting the Caldera Pipe Hub, one pipe junction of the Holdfast network — a
squat, bolted drum where up to six pipe runs meet — as a small 3D voxel model. There
is no target model to copy: build something that reads unmistakably as a heavy, bolted
junction box from the description below.

On the Caldera map each cell has six neighbors, so this hub sits at a pipe cell and
accepts a span reaching in from any neighbor it connects to. The build chooses **at
run time** which of the six directions a span plugs into, so every one of the six
sockets must be **identical and interchangeable** — a span must bolt into any of them
the same way.

## The volume and coordinate system

- The volume is **16 wide (x) × 16 tall (y) × 16 deep (z)**, in opaque voxels. It
  starts empty.
- **x** runs left-to-right, `0`–`15`. **y** runs up, `0` (bottom) to `15` (top).
  **z** runs front-to-back, `0`–`15`.
- The junction sits **centered in the volume**, and its six sockets face **outward
  symmetrically**, each aimed at one of the six directions a span can arrive from.
  Up is +y.
- Build it symmetric: the six sockets are spaced evenly around the drum and are all
  the same, so the model reads the same whichever way it is turned to face an
  incoming span.

## Palette

Use only these opaque colors:

| Role | Hex |
| --- | --- |
| Pipe body — neutral base (the accent region) | `#808890` |
| Iron — flanges, collars, bolts | `#3a3836` |

Do **not** use the water color `#3d9bd6` or the steam color `#7fcabc` anywhere on the
model. The build paints the pipe body to one of those at run time (see *The pipe body
is the accent region*); baking either in defeats it.

## The form

The hub reads, at a glance, as one squat, bolted pipe junction:

- **The drum:** a squat central body — the junction box the pipes meet inside — sat in
  the middle of the volume. It is a real, heavy drum with weight to it, not a thin
  shell or a smooth ball.
- **Six flange sockets:** a raised socket on each of the six sides of the drum, facing
  outward, where a span bolts in — a short stub of pipe ending in a **collar** that
  meets a span's collar. All **six are identical**: same size, same collar, same bolt
  pattern, spaced evenly around the drum so each faces one of the six directions a
  neighbor can lie in. This interchangeability is the whole point — the build picks
  which sockets a span plugs into, and any span must seat in any socket the same way.
- **Bolts:** a course of **bolt heads** ringing each socket collar, the fasteners that
  clamp a span's flange to the socket. They are what make each joint read as bolted.
- **A cap plate on top:** a bolted plate closing the top of the drum (toward
  `y = 15`), its own ring of bolt heads around it.
- **Kept heavy:** the junction must read as a **real bolted junction box** — riveted,
  bolted, physical — not a sphere or a featureless blob.

## The pipe body is the accent region

A game recolors this model at run time to show which network the junction serves, by
finding every voxel of one reserved color and repainting it. For the pipe kit that
reserved color is the **pipe body** color `#808890`, and the whole body of the drum
is it:

- Sculpt the **pipe body** — the drum and the socket stubs — **entirely** in
  `#808890`. The build finds every voxel of it and repaints the body to the network's
  fluid color (blue for a water junction, teal for a steam junction), so one hub
  serves both networks.
- Sculpt the **flanges, socket collars, bolt heads, and the cap plate** in iron
  `#3a3836`. The ironwork is **never** repainted — it stays iron whichever fluid the
  junction carries, and it is what keeps the piece reading as a physical, bolted
  junction rather than a plain colored lump.
- Use `#808890` **nowhere except the pipe body**. Not on a bolt, not on a collar, not
  on the cap plate, not as a stray voxel. Every voxel of it is treated as pipe body
  and repainted.

## Working the tool

The `voxel` binary is the only way to place a voxel. Run `voxel --help` for the
available operations (setting and clearing single voxels, filling and stroking boxes,
3D lines, spheres, ellipsoids, cylinders, and a mirror plane) and `voxel <operation>
--help` for each one's exact flags — a cylinder op suits the drum and the socket stubs
well, and a mirror plane can help keep opposite sockets matched. Call `voxel` once per
operation; each call only records to the log and renders nothing, so run `voxel
render` (it meshes to `mesh.glb` and draws `model.png`) when you want to judge your
progress against this brief, and once more before you finish so the geometry is
emitted — an unrendered model is scored as empty.
