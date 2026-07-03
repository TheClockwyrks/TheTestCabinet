**Aegis** is a colossal, standing six-legged war-fortress. This
asset-generation case asks a model to sculpt it as a 3D mesh using only the `mc`
Marching Cubes tool, one operation at a time: rather than placing cubes, the
model composites a continuous signed-distance field — unioning in armor masses,
legs, turrets, and a sensor vane, carving detail — and `mc`
extracts a bold, chunky, **faceted low-poly** surface from it inside an
88×80×104 volume. There is no target model and no rig; the model sculpts a
static fortress toward a written brief and the algorithm's blocky character is
the aesthetic. The emitted `mesh.json` is the authoritative output: the frontend
renders it rotating and a reviewer judges it against the brief — the six-legged
fortress silhouette, the bilateral symmetry, the clean well-composited surface,
the disciplined Duneforged palette, and how boldly it embraces the Marching
Cubes low-poly look while filling the volume.
