The **Lattice curved transport belt** is the corner piece of the belt system the
renderer for **Lattice** — a deterministic grid-based factory simulation — draws
wherever a belt turns 90 degrees. It is the same belt as the straight transport
belt, only bent through a quarter turn so it stays **one continuous belt** around
the corner.

This asset-generation case asks a model to draw it as a **sprite sheet** using
only the drawing tool, one operation at a time: eight separate 32×32 frames of one
corner tile whose flow enters at the West edge (travelling East) and leaves at the
South edge (travelling South), a dark single continuous metal surface with rails
along the inner and outer edges of the curve and a central row of amber chevrons —
painted on the surface, following the arc — that scroll around the bend by a fixed
step each frame. It is one belt whose full width carries two items side by side,
not two lanes. The renderer rotates and mirrors this one canonical curve for the
other seven corners.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: the seamless scroll around the curve, the clean 90-degree turn,
the chevrons following the arc, the single continuous surface (one belt, chevrons
painted on it — not split into lanes), the full-width faces at both connected edges,
and how faithfully it reads as the same belt as the straight one are what they
weigh, and the named `curve-flow` sequence plays back as a live animation in the
review UI.
