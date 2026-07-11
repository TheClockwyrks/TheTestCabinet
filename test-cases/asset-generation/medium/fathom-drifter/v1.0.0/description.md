**Fathom Drifter** is the bonus pickup of *Fathom*, a bioluminescent deep-sea maze
chase — a harmless amber jellyfish that wanders the corridors of a pitch-dark
trench, worth a burst of points when the player grazes it. This asset-generation
case asks a model to draw it as a **sprite sheet** using only the drawing tool, one
operation at a time: 8 separate 32×32 frames holding a single directionless sway
loop of a glowing amber bell over a frilled skirt and drifting tendrils.

The drifter is more than a pickup: its frames double as the **Lanternjaw's
disguise** — a wandering Lanternjaw predator wears this exact jellyfish so a lurking
hunter cannot be told from harmless bait at a glance, which is why the sprite must be
a clean, generic amber jellyfish with nothing predatory in it. The always-visible
amber bulb-point the game shows in the dark is a runtime glow, not baked into these
frames. The recorded operations are regenerated into each frame, which a reviewer
judges against the brief: the glowing amber bell, the gentle drift loop, and the
unmistakably jellyfish (not fish) form are what they weigh, and the named sequence
plays back as a live animation in the review UI.
