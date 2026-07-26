The **Lattice source** is the test-fixture item emitter the renderer for
**Lattice** — a deterministic top-down factory simulation — draws wherever a
scenario injects items into the factory. A source is not a real factory entity
but a measurement rig: it emits one item onto its output belt every fixed period,
the deterministic way items enter the world.

This asset-generation case asks a model to draw it as a **sprite sheet** using
only the drawing tool, one operation at a time: six separate 32×32 frames of one
East-emitting source tile — a flat grey-blue housing with a green status indicator
and an East-facing output aperture that pulses green as the fixture fires and loops
seamlessly. No item is drawn into the sprite — the renderer draws the actual item
being emitted, so a fixed item would wrongly show the same cargo every frame.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: that it reads as a test fixture rather than a belt or machine,
that no fixed item is baked in, the green source accent that sets it apart from
the red sink, and the seamless emit pulse are what they weigh, and the named
`emit` sequence plays back as a live animation in the review UI.
