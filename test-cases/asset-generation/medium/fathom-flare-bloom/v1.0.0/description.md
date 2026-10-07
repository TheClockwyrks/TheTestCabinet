**Fathom Flare Bloom** is the bright radial burst the Flarefish predator sets
off to hunt in a lightless maze-chase game. Blind between flares, the Flarefish
floods a wide circle of the dark trench with warm light. The bloom lights a
radius far larger than the 32×32 Flarefish sprite, so it is its own
asset-generation case.

A model draws it as a sprite sheet of 8 separate 128×128 frames, one operation
at a time, animating a flare in three beats: a charge-up glow swelling toward a
white core, a radial bloom expanding to a peak, and a fade back toward dark. It
is warm light on full transparency, composited over the trench by the game.

The recorded operations are regenerated into each frame, and the named sequences
play back as live animations in the review UI. A reviewer judges the frames
against the brief, weighing the charge-to-bloom-to-fade timing, the white-cored
radial burst, and the warm flare palette.
