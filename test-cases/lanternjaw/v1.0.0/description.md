**Lanternjaw** is the Lure — an anglerfish-style deep-sea predator that hunts
by light with a dangling lure-light, one of the chasers in a lightless
maze-chase game. This asset-generation case asks a model to draw it as a
128×128 **sprite sheet** using only the drawing tool, one operation at a time:
a 4×4 grid of 32×32 frames holding four-direction swim cycles and a lure-bob
animation. The recorded operations are regenerated into the scored sheet and
compared against the target; the glowing lure, the four readable directions,
and the lure-bob tell are what a reviewer weighs, and the named sequences play
back as live animations in the review UI.
