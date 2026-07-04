**Foray Royal Jelly** is a bonus resource in *Foray*, a top-down ant-colony
raiding game — a glowing node that colonies race to eat, leaving a dimmed husk
behind. It belongs to neither colony, so it uses a fixed shared palette and is
never recolored.

This asset-generation case asks a model to draw it as a **sprite sheet** using
only the drawing tool, one operation at a time: two 16×16 frames of the same
node — active (a luminous green blob with a bright core) and spent (the dull
drained husk it becomes once consumed). The recorded operations are regenerated
into each frame, which a reviewer judges against the brief: the luminous active
node, and the spent husk reading clearly as its drained before/after — played
back as a deplete animation in the review UI.
