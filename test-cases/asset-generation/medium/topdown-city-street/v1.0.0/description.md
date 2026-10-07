**Top-Down City Street Tileset** is a reusable asset-generation case. A model
draws a whole overhead city-street tileset into a single 96×96 sprite, one
drawing operation at a time.

The image is a 3×3 grid of nine 32×32 tiles a top-down game slices apart and
repeats:

- Plain asphalt.
- A road with a dashed center line.
- A zebra crosswalk.
- Concrete sidewalk.
- A grass verge.
- A flat rooftop with a small AC unit.
- A parking-lot patch with a painted stall line.
- A manhole-cover road tile.
- A curb / sidewalk-to-road transition.

Two demands make it a tileset. Everything is strictly top-down, flat markings on
flat ground with no perspective or height. The tiles also align edge-to-edge and
repeat seamlessly, with the dashed line and crosswalk stripes continuing across
a shared edge.

The recorded operations are regenerated into the sprite, which a reviewer judges
against the brief. Its read as one cohesive city-street tileset, the clean 3×3
grid and seamless tiling, whether all nine tiles are identifiable, and its
discipline to the street palette are what they weigh.
