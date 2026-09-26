**Aegis** is a colossal, standing six-legged war-fortress. This
asset-generation case asks a model to sculpt it as a 3D mesh inside a
120×110×150 volume using only the `mc` Marching Cubes tool, one operation at a
time, and `mc` extracts a bold, chunky, faceted low-poly surface from that
sculpt.

The model composites a continuous signed-distance field, unioning in armor
masses, legs, turrets, and a sensor vane, then carving detail, so the
algorithm's blocky character becomes the aesthetic. There is no target model and
no rig; the model sculpts a static fortress toward a written brief.

The recorded operations are the authoritative output, and the mesh is extracted
to `mesh.glb`. The frontend renders that mesh rotating and a reviewer judges it
against the brief: the six-legged fortress silhouette, the bilateral symmetry,
the clean well-composited surface, the disciplined Duneforged palette, and how
boldly it embraces the Marching Cubes low-poly look while filling the volume.
