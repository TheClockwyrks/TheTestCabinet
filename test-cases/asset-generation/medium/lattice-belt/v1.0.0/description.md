The **Lattice transport belt** is the animated conveyor surface the renderer for
**Lattice** — a deterministic Factorio-style factory simulation — draws for every
belt tile. This asset-generation case asks a model to draw it as a **sprite
sheet** using only the drawing tool, one operation at a time: eight separate
32×32 frames of one straight, East-flowing belt tile — a dark single-belt metal
body with side rails and a central row of amber chevrons that scroll right by a
fixed step each frame. It is one belt wide enough to carry two rows of items side
by side, not two belts.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: the seamless scrolling loop, the East-pointing chevrons, the
single-belt reading (one belt, two item rows), and the horizontal tileability are
what they weigh, and the
named `belt-flow` sequence plays back as a live animation in the review UI.
