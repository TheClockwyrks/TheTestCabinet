**Wireworm Node** is the capacitor node that tiles the board of the Wireworm
circuit-board arcade game — the terrain a segmented data-worm winds down
through, charging each node it bumps until a fully-charged one can be shot to set
off a discharge. Because the node's charge level is the heart of that mechanic,
it is its own asset-generation case: a model draws it as a **sprite sheet** of 5
separate 32×32 frames, one operation at a time, animating a small electronic
component from inert and dark through a charge-up ramp to a white-hot **critical**
state with a glow halo and amber overcharge sparks, plus a pulse peak. It is an
opaque component on full transparency, composited onto the dark board by the game.
The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: the monotonic charge ramp, the unmistakable critical "loaded"
read, and the tight component palette are what they weigh, and the named
sequences play back as live animations in the review UI.
