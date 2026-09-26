**Foray Maze Walls** is the wall tileset of Foray, a top-down ant-colony raiding
game played on a tile-locked maze of dug soil tunnels.

This asset-generation case asks a model to draw the maze in the classic rounded
pac-man style, re-themed as raised earthwork tunnel walls, as a sprite sheet of
twenty 16×16 tiles, one drawing operation at a time. The sheet holds sixteen
4-neighbor autotile pieces whose frame index is the N/E/S/W connection bitmask
the renderer selects on, the central territory-boundary seam, and the dug floor,
all in a shared earth palette and drawn as seamless edge-to-edge tiles.

The recorded operations are regenerated into each tile, and a reviewer judges
them against the brief. They weigh a correct, consistent autotile set whose
connected edges merge into unbroken corridors, the rounded raised-wall look,
clean rotating corners and junctions, the neutral boundary seam, and the
seamless floor.
