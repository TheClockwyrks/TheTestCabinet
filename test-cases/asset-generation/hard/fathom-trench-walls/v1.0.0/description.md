**Fathom Trench Walls** is the maze tileset of Fathom, a bioluminescent deep-sea
maze chase played on a tile-locked maze of flooded rock corridors. This
asset-generation case asks a model to draw the maze in the classic rounded
pac-man style, re-themed as raised deep-sea rock, as a sprite sheet of nineteen
32×32 tiles, one drawing operation at a time.

Those tiles are the sixteen 4-neighbor autotile pieces, the dark open-water
corridor floor, the flat unrevealed fog, and the den gate. A wall piece's frame
index is the N/E/S/W connection bitmask the renderer selects on. All nineteen
use the cold trench palette and fill their whole cell edge to edge, so they butt
seamlessly against their neighbors.

The recorded operations are regenerated into each tile. A reviewer judges them
against the brief, weighing a correct, consistent autotile set whose connected
edges merge into unbroken corridors, the rounded raised-rock look, clean
rotating corners and junctions, the floor and fog tiles, and the den gate.
