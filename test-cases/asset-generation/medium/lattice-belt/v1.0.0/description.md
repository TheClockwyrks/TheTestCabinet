The **Lattice transport belt** is the animated conveyor surface the renderer for
**Lattice** — a deterministic grid-based factory simulation — draws for every
belt tile. This asset-generation case asks a model to draw it as a **sprite
sheet** using only the drawing tool, one operation at a time: eight separate
32×32 frames of one straight, East-flowing belt tile — a dark single continuous
metal surface with side rails, tread blades patterned across it, and a central row
of amber chevrons painted on it. The whole surface — blades and chevrons together —
scrolls right by a fixed step each frame, so the belt itself reads as moving rather
than a static floor with sliding arrows. It is one belt whose full width carries two
items side by side, not two belts.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: the seamless scrolling loop, the belt surface itself moving
(tread blades scrolling, not just the arrows), the East-pointing chevrons, the
single continuous surface (one belt, chevrons painted on it — not split into
lanes), and the horizontal tileability are what they weigh, and the
named `belt-flow` sequence plays back as a live animation in the review UI.
