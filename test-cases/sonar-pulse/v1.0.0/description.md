**Sonar Pulse** is the expanding-ring effect a deep-sea forager and the eyeless
Listener predator both emit in a lightless maze-chase game — the ping that reveals
the dark trench. Because it is an area effect that spreads across many tiles, far
larger than the 32×32 creature sprites, it is its own asset-generation case: a
model draws it as a **sprite sheet** of 8 separate 128×128 frames, one operation
at a time, animating a single ring that grows outward from the center and fades
into a wide faint wavefront.

It is drawn **purely in grayscale on transparency** — the game multiplies it by
the sonar color at runtime — so the case measures the shape and timing of the
wavefront, not its hue. The recorded operations are regenerated into each frame,
which a reviewer judges against the brief: the expanding wavefront, the clean
concentric rings, the outward fade, and the colorless tintable palette are what
they weigh, and the pulse sequence plays back live in the review UI.
