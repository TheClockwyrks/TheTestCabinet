**Trench Walls** is the maze tileset of *Fathom*, a bioluminescent deep-sea maze
chase played on a tile-locked maze of flooded rock corridors. This
asset-generation case asks a model to draw the maze in the classic rounded
pac-man style — re-themed as raised deep-sea rock — as a **sprite sheet** of
nineteen 32×32 tiles, one drawing operation at a time.

Those tiles are the sixteen 4-neighbor autotile pieces (the frame index is the
N/E/S/W connection bitmask the renderer selects on), the dark open-water corridor
floor, the flat unrevealed fog, and the den gate — all in the cold trench palette
and drawn as seamless edge-to-edge tiles rather than centered sprites. The case
adapts the pac-man maze look to Fathom's 32-pixel grid, dropping the two-colony
boundary seam of the ant-colony tileset it is based on and adding the fog and
den-gate tiles the dark trench needs.

The recorded operations are regenerated into each tile, and a reviewer judges
them against the brief: a correct, consistent autotile set whose connected edges
merge into unbroken corridors, the rounded raised-rock look, clean rotating
corners and junctions, the floor and fog tiles, and the den gate are what they
weigh.
