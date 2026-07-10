# Caldera Pipe Span — sculpting brief

You are sculpting the Caldera Pipe Span, one straight run of heavy Holdfast pipework
— a single riveted, bolted tube that carries water or steam from one cell to the next
— as a small 3D voxel model. There is no target model to copy: build something that
reads unmistakably as one length of heavy industrial pipe from the description below.

This piece is **modular**. On the Caldera map the build orients this span, stretches
it between two adjacent cell centers, and repeats it hundreds of times to lay a
pipeline across the field, so it must read right end-to-end and **tile against
itself** — two copies laid nose-to-tail must butt together into one continuous pipe.

## The volume and coordinate system

- The volume is **12 wide (x) × 12 tall (y) × 34 deep (z)**, in opaque voxels. It
  starts empty.
- **x** runs across the pipe, `0`–`11`. **y** runs up, `0` (bottom) to `11` (top).
  **z** runs front-to-back, `0`–`33`.
- **The pipe runs front-to-back along +z:** it lies down the long axis of the volume,
  **centered in x and y**, with a flange collar at each end (toward `z = 0` and
  `z = 33`). Up is +y.
- Build the span symmetric about its length: it is a straight run with **no bend and
  no taper** — the tube is the same all the way through, and the two ends are the
  same, so either end can meet another span.

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

The span reads, at a glance, as one length of heavy, bolted industrial pipe running
along +z:

- **The tube:** a cylindrical run of pipe down the middle of the volume, centered in
  x and y, running the full depth along z. It is a real, weighty pipe with a hollow
  look to its bore, not a thin rod.
- **A flange collar at each end:** where this span bolts to its neighbor, the pipe
  ends in a **raised collar** — a ring stepped out proud of the tube — flush with the
  front and back faces of the volume, so the collar of one span meets the collar of
  the next. Both collars are the same.
- **Bolts:** a course of **bolt heads** set around each collar, the fasteners that
  clamp one flange to the next. They are what makes the joint read as bolted rather
  than welded.
- **Kept heavy:** the span must read as **heavy industrial pipework** — riveted,
  bolted, physical — not a smooth, featureless cylinder. Rivet lines, a seam along
  the tube, or ribs are all fair game as long as they read as ironwork on a real
  pipe.

## The pipe body is the accent region

A game recolors this model at run time to show which network the pipe serves, by
finding every voxel of one reserved color and repainting it. For the pipe kit that
reserved color is the **pipe body** color `#808890`, and the whole tube is it:

- Sculpt the **pipe body** — the tube itself — **entirely** in `#808890`. The build
  finds every voxel of it and repaints the whole tube to the network's fluid color
  (blue for a water pipe, teal for a steam pipe), so one span serves both networks.
- Sculpt the **flanges, collars, and bolt heads** in iron `#3a3836`. The ironwork is
  **never** repainted — it stays iron whichever fluid the pipe carries, and it is
  what keeps the piece reading as a physical, bolted pipe rather than a plain colored
  tube.
- Use `#808890` **nowhere except the pipe body**. Not on a bolt, not on a collar, not
  as a stray voxel. Every voxel of it is treated as pipe body and repainted.

## Working the tool

The `voxel` binary is the only way to place a voxel. Run `voxel --help` for the
available operations (setting and clearing single voxels, filling and stroking boxes,
3D lines, spheres, ellipsoids, cylinders, and a mirror plane) and `voxel <operation>
--help` for each one's exact flags — a cylinder op suits the tube and its collars
well. Call `voxel` once per operation; each call only records to the log and renders
nothing, so run `voxel render` (it meshes to `mesh.glb` and draws `model.png`) when
you want to judge your progress against this brief, and once more before you finish
so the geometry is emitted — an unrendered model is scored as empty.
