**Wireworm** is the segmented data-worm that descends the board of the Wireworm
circuit-board arcade game, the enemy the player splits and clears. The game
builds a worm of any length by tiling parts.

This asset-generation case asks a model to draw it as a sprite sheet of 6
separate 32×32 frames, one operation at a time, producing those tileable parts:
a right-facing head that chomps, body segments that undulate, and a tapering
tail that swishes, each as a two-pose wiggle. It is an armored, magenta-seamed
creature on full transparency, which the game composites onto the dark board.

The recorded operations are regenerated into each frame, and the named sequences
play back as live animations in the review UI. A reviewer judges the frames
against the brief, weighing the consistent segment that tiles edge-to-edge, the
readable head/body/tail parts, the smooth wiggle, and the tight worm palette.
