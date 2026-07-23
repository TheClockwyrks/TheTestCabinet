**Top-Down City Street Tileset** is a reusable asset-generation case: a model draws a
whole overhead city-street tileset into a **single 96×96 sprite**, one drawing
operation at a time. The image is a **3×3 grid of nine 32×32 tiles** a top-down game
slices apart and repeats — plain asphalt, a road with a dashed center line, a zebra
crosswalk, concrete sidewalk, a grass verge, a flat rooftop with a small AC unit, a
parking-lot patch with a painted stall line, a manhole-cover road tile, and a curb /
sidewalk-to-road transition. The hard parts are what make it a tileset rather than nine
loose pictures: everything is **strictly top-down** (flat markings on flat ground, no
perspective or height) and the tiles must **align edge-to-edge and repeat seamlessly**,
with the dashed line and crosswalk stripes continuing across a shared edge. The recorded
operations are regenerated into the sheet, which a reviewer judges against the brief:
the read as one cohesive city-street tileset, the clean 3×3 grid and seamless tiling,
whether all nine tiles are identifiable, and discipline to the street palette are what
they weigh.
