The **Lattice transport belt** is the animated conveyor surface the renderer for
Lattice, a deterministic grid-based factory simulation, draws under every belt
tile. It exists in two forms: the straight segment that runs across a tile, and
the curve where the same belt turns 90 degrees.

This asset-generation case asks a model to draw both as one sprite sheet using
only the drawing tool, one operation at a time: eight separate 32×32 frames of
a straight, East-flowing belt tile, and eight more of a corner tile whose flow
enters at the West edge and leaves at the South edge. In each form the whole
surface scrolls downstream by a fixed step each frame, so the belt itself reads
as moving and not as a static floor with sliding arrows. That surface is dark
metal with rails, tread blades patterned across it, and a central row of amber
chevrons painted on it. It is one belt whose full width carries two items side
by side, not two belts.

The two forms have to join. A factory puts a straight belt against a corner and
expects a single conveyor changing direction, so the case weighs consistency
between the two sprites as heavily as either sprite on its own:

- both are built from one construction language: the same palette, the same
  rails, the same tread-blade and chevron pitch, the same tone assignments
- the curve's West entry and South exit present the straight belt's
  cross-section edge for edge, so the tiles butt with no seam
- both scroll in phase, so a blade or chevron crossing the junction is never
  cut, doubled, or jumped

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief. The joining properties carry the heaviest weight, alongside
the seamless scrolling loops, the belt surface itself moving with its tread
blades scrolling and not just the arrows, the clean 90-degree turn, the chevrons
pointing along travel in both forms, the single continuous surface, and the
horizontal tileability of the straight segment. The named `belt-flow` and
`curve-flow` sequences play back as live animations in the review UI.
