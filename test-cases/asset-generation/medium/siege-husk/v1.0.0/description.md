**Siege Husk** is a decrepit, low-poly shambling humanoid enemy for the Siege
first-person voxel last-stand game, a gaunt figure of ashen grey-green flesh,
tattered dark cloth, and exposed bone.

This asset-generation case asks a model to sculpt and rig it in a 24×48×20
volume using only the `mc-skin` tool, one operation at a time, as a skinned
character. The model composites one continuous whole-body signed-distance field,
extracted into a single Marching Cubes skin and bound to a skeleton it invents,
that deforms across its joints by per-vertex weights.

The case fixes only the three animations the model must author: a looping `walk`
shamble, a one-shot `lunge` attack, and a one-shot `collapse` death crumple. The
bones, joints, and skin binding that realize them are the model's to invent, and
the per-vertex weights are derived automatically at render by bone-heat
diffusion. The case therefore measures whether a model can work out the bones a
walking, lunging, collapsing humanoid needs, pivot them where they belong, and
make one continuous skin deform convincingly across them, an elbow that bends, a
spine that hunches, and knees that buckle, with no seam opening and nothing
tearing away.

The husk must read unmistakably as a shambling enemy, a gaunt, hunched body with
a head, torso, two arms, and two legs, in the disciplined husk palette. There is
no target model; the model sculpts and rigs toward a written brief. The emitted
skinned `mesh.glb` and `rig.json` are regenerated into a rigged 3D character the
frontend renders and poses by linear-blend skinning, and a reviewer judges it
against the brief: that it reads as a husk, that it is one skin that deforms
across its joints, and that the walk, lunge, and collapse each read
convincingly.
