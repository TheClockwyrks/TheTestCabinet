**Wireworm Node** is the capacitor node that tiles the board of the Wireworm
circuit-board arcade game, the terrain a segmented data-worm winds down through,
charging each node it bumps until a fully-charged one can be shot to set off a
discharge.

This asset-generation case asks a model to draw it as a sprite sheet of 5
separate 32×32 frames, one operation at a time. The frames animate a small
electronic component from inert and dark through a charge-up ramp to a white-hot
critical state with a glow halo and amber overcharge sparks, plus a pulse peak.
It is an opaque component on full transparency, which the game composites onto
the dark board.

The recorded operations are regenerated into each frame, and the named sequences
play back as live animations in the review UI. A reviewer judges the frames
against the brief, weighing the monotonic charge ramp, the unmistakable critical
"loaded" read, and the tight component palette.
