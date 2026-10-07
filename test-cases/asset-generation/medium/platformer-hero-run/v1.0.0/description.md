**Platformer Hero Run Cycle** is a general-purpose character-animation case. A
model draws a side-view platformer mascot with a rounded body, a big friendly
head, and boots as a sprite sheet of six separate 48×48 frames, one drawing
operation at a time, and the frames play back as one looping run cycle facing
right.

The six poses are contact, recoil, passing, high point, and the return. Across
them the legs and arms swing through a full stride and the body bobs slightly,
so weight reads through each step. The character is drawn on full transparency
and composited onto a level.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: whether the frames read as a believable run when played,
whether the same on-model character holds across all six frames with a clear
silhouette and bold outline, and whether it keeps to the given palette. The
`run` sequence plays back as a live animation in the review UI.
