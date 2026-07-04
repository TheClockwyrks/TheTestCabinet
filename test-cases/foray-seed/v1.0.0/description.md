**Foray Seed Cache** is the scorable resource of *Foray*, a top-down ant-colony
raiding game — the little pile of golden seeds a raider grabs, carries home, and
banks for points. Seeds belong to neither colony, so the sprite uses a fixed
shared gold palette and is never recolored.

This asset-generation case asks a model to draw it as a 16×16 sprite using only
the drawing tool, one operation at a time: a centered cluster of two or three
rounded golden seeds, outlined so they read apart, with a bright glint on top.
The recorded operations are regenerated into the image, which a reviewer judges
against the brief: a cache that reads as a valuable little heap of gold seeds
rather than a single dot.
