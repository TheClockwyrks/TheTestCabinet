The **Lattice furnace** is the smelter the renderer for **Lattice** — a
deterministic top-down factory simulation — draws wherever a scenario places one. It
is the machine that turns raw ore into metal plates: fed ore and burning **coal** for
fuel, it melts the ore down. Without coal it cannot burn, so it sits cold.

This asset-generation case asks a model to draw it as a **sprite sheet** using only
the drawing tool, one operation at a time: twelve separate 64×64 frames of a compact,
non-directional **2×2 smelter** seen from straight above. The frames form two loops —
an **off** idle (frames 0–3) with a cold, dark firebox, and a **smelting** loop
(frames 4–11) whose firebox blazes with a roiling glow around a pulsing white-hot
core. The furnace's own **coal fuel** is drawn, but the ore it smelts is not — the
renderer draws the items flowing in and out, so a fixed ore baked into the sprite
would wrongly show the same cargo every frame.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: that the two states read unmistakably apart (a cold idle versus a
plainly burning firebox), that it reads as a small top-down smelting furnace rather
than a belt or the assembler, that the coal fuel is shown while the ore is not, that
the heat ramp is used only inside the firebox so the furnace sits in the Lattice
steel-chassis family, and that both loops are seamless. The named `off` and
`smelting` sequences play back as live animations in the review UI.
