**Aegis** is a colossal, hard-edged six-legged walking fortress: a heavily
armored citadel riding raised on six articulated legs, with a central forward
cannon, a rotating turret out on each side sponson, and a sensor vane, cleanly
symmetric about its centerplane. This asset-generation case asks a model to
sculpt it as a static 120×110×150 mesh using only the Dual Contouring tool
(`dc`), one operation at a time.

The model composites a signed-distance field from `add`/`subtract` primitives.
`dc` preserves sharp edges and corners through hard unions and the `--sharp`
tag, so the fortress reads as crisp, hard-surfaced war machinery: beveled armor
plates, clean panel seams, and angular facets. That character is what
distinguishes Dual Contouring from the smoother extractors. There is no target
model; the model sculpts toward a written brief.

The extracted mesh is rendered rotating in the frontend and a reviewer judges it
against the brief. They weigh the fortress silhouette, the crisp hard-surface
detailing, the bilateral symmetry, the palette discipline, and how well it fills
the volume.
