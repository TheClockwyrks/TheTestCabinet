**Wireworm** is the segmented data-worm that descends the board of the Wireworm
circuit-board arcade game — the enemy the player splits and clears. Because the
game builds a worm of any length by tiling parts, it is its own asset-generation
case: a model draws it as a **sprite sheet** of 6 separate 32×32 frames, one
operation at a time, producing the worm's tileable parts — a right-facing head
that chomps, body segments that undulate, and a tapering tail that swishes — each
as a two-pose wiggle. It is an armored, magenta-seamed creature on full
transparency, composited onto the dark board by the game. The recorded operations
are regenerated into each frame, which a reviewer judges against the brief: the
consistent segment that tiles edge-to-edge, the readable head/body/tail parts, the
smooth wiggle, and the tight worm palette are what they weigh, and the named
sequences play back as live animations in the review UI.
