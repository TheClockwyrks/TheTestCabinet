**Caldera Basalt** is the weathered volcanic-rock material that dresses the
terraced hex terrain of *Caldera*, a volcanic tower-defense case.

This asset-generation case asks a model to author it as a tileable, seamless PBR
material using only the `texture` and `pbr` tools, one operation at a time:
near-black cooled basalt cut by a hairline network of ashen, faintly glowing
fissures, with mineral crust and grit and shallow vesicle pitting. It emits a
**base-color** map plus **normal**, **roughness**, and **ambient-occlusion**
maps — the relief maps baked from a painted grayscale height field. The emitted
maps, applied to the terrain by triplanar projection, are what a reviewer judges
against the brief — how faithfully they read as weathered volcanic rock at the
stated ~2 m tile scale, how cleanly the material tiles, and how coherently the
relief, roughness, and occlusion agree with the color.
