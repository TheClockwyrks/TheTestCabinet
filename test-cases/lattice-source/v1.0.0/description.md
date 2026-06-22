The **Lattice source** is the test-fixture item emitter the renderer for
**Lattice** — a deterministic Factorio-style factory simulation — draws wherever
a scenario injects items into the factory. A source is not a real factory entity
but a measurement rig: it emits one item onto its output belt every fixed period,
the deterministic way items enter the world. This asset-generation case asks a
model to draw it as a **sprite sheet** using only the drawing tool, one operation
at a time:
six separate 32×32 frames of one East-emitting source tile — a grey-blue housing
with a green status indicator and an East-facing output aperture that pulses a
single steel plate out and loops seamlessly. The recorded operations are
regenerated into each frame, which a reviewer judges against the brief: that it
reads as a test fixture rather than a belt or machine, the green source accent
that sets it apart from the red sink, and the seamless emit pulse are what they
weigh,
and the named `emit` sequence plays back as a live animation in the review UI.
