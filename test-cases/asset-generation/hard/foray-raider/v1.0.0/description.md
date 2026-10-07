**Foray Raider** is the forager caste of Foray, a top-down ant-colony raiding
game. It is the lean, fast ant that crosses into enemy ground, grabs a seed, and
hauls it home.

This asset-generation case asks a model to draw it as an animated sprite sheet
using only the drawing tool, one operation at a time. The sheet holds a
four-step walk cycle in each of four facings, drawn twice across thirty-two
16×16 frames: empty in frames 0–15, and the same cycles laden with a gold seed
in frames 16–31. The body is drawn in a neutral grey ramp so the renderer can
recolor it red or blue per colony by palette swap.

The recorded operations are regenerated into each frame, and a reviewer judges
them against the brief. They weigh the lean, mandible-less silhouette that
distinguishes the raider from the soldier, a believable scuttling walk cycle,
the four readable facings, and the carry-weight tell of a laden raider that
reads slow and heavy under its gold seed.
