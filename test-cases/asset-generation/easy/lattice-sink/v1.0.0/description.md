The **Lattice sink** is the test-fixture drain the renderer draws for every sink
tile in Lattice, a deterministic top-down factory simulation. A sink is
measurement equipment: it consumes every item reaching it, by belt or inserter,
and counts it per type, so it is the place a layout's throughput is read.

This asset-generation case asks a model to draw it as a sprite sheet using only
the drawing tool, one operation at a time: six separate 32×32 frames of one
West-receiving sink tile. The tile is a flat top-down grey-blue housing with a
West intake aperture and a red drain indicator, playing a consume pulse where
the intake flashes red and the indicator pulses as an item is consumed, then
dims back to idle. The sprite holds no item of its own, because the renderer
draws the item being swallowed.

The recorded operations are regenerated into each frame, and the named `consume`
sequence plays back as a live animation in the review UI. A reviewer judges the
frames against the brief: that the tile reads as a drain fixture rather than a
belt or machine, the West-facing intake, that no fixed item is baked in, the red
drain accent that distinguishes it from the green source emitter, and the
seamless consume pulse.
