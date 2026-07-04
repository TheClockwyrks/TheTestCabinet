**Aegis (Surface Nets)** is a colossal six-legged *walking fortress* — a
heavily armored citadel that dwarfs every buildable unit, bristling with guns
and riding raised on six heavy legs. This asset-generation case asks a model to
sculpt it as a static 120×110×150 model using only the `sn` meshing tool, one
operation at a time.

Where a voxel tool paints discrete cubes, `sn` builds a continuous
signed-distance field by compositing primitives — spheres, boxes, ellipsoids,
and cylinders added and carved with optional smooth blends — and extracts a
surface with **Surface Nets**, whose fixed character is a *smooth, rounded,
watertight, mid-fidelity* mesh with uniform triangle density and no sharp edges.
So the brief leans into rounded, softly beveled cast armor blended into one
continuous solid skin, with the forms themselves left to the model.

There is no target model and no rig — the model sculpts a single static surface
toward a written brief, extracted once as `mesh.glb` (positions, normals, colors,
indices). The frontend renders that mesh rotating in 3D and a reviewer judges it
against the brief: that it reads as a giant six-legged fortress, stands on six
thick articulated legs, carries its main turret and cannon and two side turrets,
holds the disciplined Duneforged palette with its solar-amber accent, is cleanly
symmetric, and fills the volume.
