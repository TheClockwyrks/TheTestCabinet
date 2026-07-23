**Platformer Hero Run Cycle** is a general-purpose character-animation case: a model
draws a side-view platformer mascot — a rounded body, a big friendly head, and
boots — as a **sprite sheet** of six separate 48×48 frames, one drawing operation at
a time, that play back as one looping **run cycle** facing right. Over the six poses
(contact, recoil, passing, high point, and the return) the legs and arms swing
through a full stride and the body bobs slightly, so weight reads through each step.
It is a character on full transparency, composited onto a level. The recorded
operations are regenerated into each frame, which a reviewer judges against the
brief: whether the frames read as a believable run when played, whether it stays the
same on-model character with a clear silhouette and bold outline across all six
frames, and whether it holds to the given palette. The `run` sequence plays back as
a live animation in the review UI.
