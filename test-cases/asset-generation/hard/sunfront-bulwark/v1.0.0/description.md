**Sunfront Bulwark** is a heavy bipedal Duneforged war-mech that braces a broad
tower shield on its left arm and swings a heavy siege maul in its right,
striding forward on two legs.

This asset-generation case asks a model to sculpt and rig it as a 40×60×30
opaque-voxel model using only the `voxel-anim` tool, one operation at a time.
The model paints discrete opaque cells into whatever parts it invents: a broad,
armored body and head with two shoulders, the braced left shield arm, two legs
on bent knees, and a right arm gripping the maul.

The case fixes only the two animations the model must author: a walking `walk`
and a weapon `smash`. The parts, joints, and articulation that realize them are
the model's to invent, so the case measures whether a model can work out the
pieces a walking, smashing mech needs, attach them where they belong, and
animate them convincingly. That means legs that plant a flat foot and push the
body forward, and a maul arm that winds up and smashes without detaching. There
is no target model: the model sculpts and rigs toward a written brief, and may
add its own extra parts, joints, and animations on top.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the play-back animations. A reviewer judges it against
the brief: that it reads as a two-armed heavy mech with a shield and a maul,
the maul arm smashes on the correct hinge without detaching, the legs stride
with a planted stance, the body stays put, and every limb stays attached as it
moves.
