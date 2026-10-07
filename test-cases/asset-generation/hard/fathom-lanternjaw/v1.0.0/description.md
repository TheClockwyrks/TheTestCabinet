**Fathom Lanternjaw** is an anglerfish-style deep-sea predator that hunts by
light, one of the chasers in a lightless maze-chase game. Until it fixes on the
player it hides as the harmless bonus drifter.

This asset-generation case asks a model to draw it as a sprite sheet using only
the drawing tool, one operation at a time: 16 separate 32×32 frames holding two
forms on one sheet. Frames 0–7 are a four-direction hunting swim, a glowing
amber bell over dark, gaping jaws that chomp. Frames 8–15 are an eight-frame
jellyfish disguise, the same bell with a frilled skirt and swaying tendrils,
drawn pixel-identical to the bonus drifter.

Both forms carry the same amber bell in the same place, so a reveal swaps jaws
for tendrils beneath an unchanging bulb. The recorded operations are regenerated
into each frame, and the named sequences play back as live animations in the
review UI. A reviewer judges the frames against the brief, weighing the shared
amber bell, the readable hunting directions with their gaping jaws, and the
drifter-perfect disguise loop.
