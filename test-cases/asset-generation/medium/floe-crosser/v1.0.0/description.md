**Floe Crosser** is the player character of the Floe arctic-crossing game, the
small, round, fuzzy tundra critter that hops one tile at a time across the ice
and drifting floes toward the far shore, chased by the ice bear. It has to read
as small, warm prey and pop against the pale ice and dark water.

This asset-generation case asks a model to draw it as a sprite sheet of 8
separate 32×32 frames, one operation at a time: a warm, big-eyed critter
hopping in four directions, each a crouch-then-leap pair. It is a creature on
full transparency, composited onto the ice and water by the game.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: the read as a small endearing critter, the four distinct hop
facings, and the warm palette. The named sequences play back as live animations
in the review UI.
