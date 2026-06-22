**Glimmerfin** is the player's bioluminescent forager in a lightless deep-sea
maze chase — the small glowing hero that threads a pitch-dark trench grazing
plankton while predators hunt it. This asset-generation case asks a model to
draw it as a **sprite sheet** using only the drawing tool, one operation at a
time: 8 separate 32×32 frames holding a four-direction swim, each direction a
mouth-closed and a mouth-open frame that play back as a chomp cycle. The
forager's signature brightness glow flares up at any moment from the player's
actions, so it is left to the game as a runtime effect — the sprite carries no
baked-in halo. The recorded operations are regenerated into each frame, which a
reviewer judges against the brief: the four readable directions, the chomp
cycle, and the clean cyan palette are what they weigh, and the named sequences
play back as live animations in the review UI.
