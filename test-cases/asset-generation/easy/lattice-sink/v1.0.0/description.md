The **Lattice sink** is the test-fixture drain the renderer for **Lattice** — a
deterministic Factorio-style factory simulation — draws for every sink tile. A
sink is not a real factory entity: it is measurement equipment that consumes
every item reaching it (by belt or inserter) and counts it per type, the place a
layout's throughput is read.

This asset-generation case asks a model to draw it as a **sprite sheet** using
only the drawing tool, one operation at a time: six separate 32×32 frames of one
West-receiving sink tile — a top-down grey-blue housing with a West intake
aperture and a red drain indicator, playing a consume pulse where a single
steel-grey item arrives from the West and is swallowed in with a red intake
flash, then dims back to idle.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: that it reads as a drain fixture rather than a belt or machine,
the West-facing intake, the red drain accent that distinguishes it from the green
source emitter, and the seamless consume pulse are what they weigh, and the named
`consume` sequence plays back as a live animation in the review UI.
