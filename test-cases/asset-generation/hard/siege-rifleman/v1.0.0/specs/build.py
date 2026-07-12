"""build.py — authoring script for the Siege Warden Rifleman.

This is the ONE script that builds the character. `tcab-blend` runs it inside
headless Blender:

    tcab-blend                # execs: blender --background --python build.py -- <config.json>

It builds a skinned mesh + an armature + skin weights + one Action per required
animation, then hands the scene to the bundled export helper, which emits
`character.glb` (a skinned, animated glTF 2.0) and renders the preview `model.png`.

Fill in the TODO sections. Everything is yours to invent EXCEPT: fit the seeded
bounding box, use only the brief's palette, keep the `weapon_socket` empty (no
vertex influence), and author every required animation by name. `build.py` is your
recorded authoring trace and is re-run for provenance, so keep it self-contained
and deterministic — it must rebuild the Rifleman from the config alone.
"""

import json
import os
import sys

import bpy


# --- Load the seeded config -------------------------------------------------
# `tcab-blend` passes the config path after a literal `--`; if it is absent we
# fall back to `blender.config.json` in the current working directory. The config
# carries the bounding box (`bounds`), the Blender-native authoring axes (+Z up, the
# character facing -Y — the export converts to the family's +Y-up/+Z-forward glTF),
# the output paths (`character.glb`, `model.png`), and the REQUIRED animation names.
def load_config():
    argv = sys.argv
    if "--" in argv:
        cfg_path = argv[argv.index("--") + 1]
    else:
        cfg_path = "blender.config.json"
    with open(cfg_path) as f:
        return json.load(f)


config = load_config()
BOUNDS = config["bounds"]                       # {"width": x, "height": y, "depth": z}
REQUIRED_ANIMATIONS = config["animations"]      # [{"name": "idle", "loop": true, ...}, ...]
REQUIRED_JOINTS = config["joints"]              # [{"name": "aim_pitch", "axis": "x", ...}, ...]


# --- Start from an empty scene ----------------------------------------------
# Clear Blender's default cube/camera/light so the export contains only what we
# build below.
def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions):
        for datablock in list(block):
            block.remove(datablock)


# --- 1. The body mesh -------------------------------------------------------
def build_body_mesh():
    """Build the Rifleman's continuous body + baked-in gear as ONE mesh.

    TODO: model the upright soldier — head, torso, two arms, two legs — with the
    permanently-worn kit (combat helmet, light vest/body armor, ammo pouches)
    baked into the SAME mesh. Fit within BOUNDS, built in Blender-native space (+Z
    up, facing -Y — the export converts to the family's +Y-up/+Z-forward glTF),
    roughly symmetric at rest. Color it from the brief's palette using vertex colors or
    materials. Do NOT model the rifle — that is a separate asset hung on the
    socket (see build_armature). Return the mesh Object.
    """
    raise NotImplementedError("TODO: build the Rifleman body mesh")


# --- 2. The armature (skeleton) ---------------------------------------------
def build_armature():
    """Build the skeleton as an Armature object with edit-bones.

    TODO: lay out the bone hierarchy an upright, running, firing soldier needs
    (pelvis/spine, head, arms, legs...). You invent the bones, joints, and pivots.
    You MUST also add:
      * an empty `weapon_socket` bone parented to the right hand — it gets NO vertex
        influence and marks where the game hangs the rifle; and
      * an **aim** bone in the upper spine/chest that the head, arms, and weapon socket
        descend from, so a game can pitch the soldier's aim up and down by rotating it
        (the `aim_pitch` caller DOF — see tag_interface).
    Return the armature Object.
    """
    raise NotImplementedError("TODO: build the armature, including weapon_socket + aim bone")


# --- 3. Skin weights --------------------------------------------------------
def bind_skin_weights(mesh_obj, armature_obj):
    """Bind the mesh to the armature with per-vertex weights.

    TODO: create the vertex groups / weights that skin the body to the bones
    (automatic / bone-heat weights are fine), capped and normalized. Ensure the
    `weapon_socket` bone influences NO vertices. After this the mesh should deform
    when the pose bones move.
    """
    raise NotImplementedError("TODO: bind skin weights")


# --- 4. The game-facing procedural interface --------------------------------
def tag_interface(armature_obj):
    """Expose the runtime-drivable interface so a GAME can use the character.

    A game plays the six clips by name (that already works — see author_animation),
    but it also needs to (a) AIM the soldier and (b) MOUNT a weapon. Both travel in the
    emitted glTF as node `extras` (via Blender custom properties + `export_extras`):

      * For each caller DOF in REQUIRED_JOINTS (here, `aim_pitch`), tag the bone the game
        drives — the upper-spine/chest **aim** bone — with a `tcab_joint` custom property
        so a game finds it by name and clamps its rotation to [min, max]:

            aim_bone["tcab_joint"] = {
                "name": joint["name"], "kind": joint["kind"], "axis": joint["axis"],
                "min": joint["min"], "max": joint["max"], "rest": joint["rest"],  # radians
            }

        Axis is in the EMITTED Y-up glTF frame (pitch is about "x"). Build the bone so
        the head, arms, and weapon socket ride it and its rest pose is the DOF's `rest`.
      * Tag the `weapon_socket` bone so a game discovers the attach point by name:

            socket_bone["tcab_socket"] = "weapon_socket"

    TODO: set these custom properties on the relevant bones. (Set them on the Bone /
    PoseBone data so `export_extras` writes them into the bone node's glTF `extras`.)
    """
    raise NotImplementedError("TODO: tag aim_pitch + weapon_socket into the glTF extras")


# --- 5. Animations ----------------------------------------------------------
def author_animation(name):
    """Author ONE required animation CLIP as a Blender Action of F-curve keyframes.

    TODO: create an Action named `name` and key the pose bones to realize it, in
    place (the run cycle strides on the spot). See specs/brief.md for what each of
    idle / run / fire / reload / hit / death must read as. Ease the keys so the
    soldier carries weight. Set loop/hold semantics per the brief. These are the clips
    a game PLAYS by name; do NOT bake the `aim_pitch` DOF into them (the game drives it).
    """
    raise NotImplementedError(f"TODO: author animation {name!r}")


# --- Drive the pipeline -----------------------------------------------------
clear_scene()
mesh_obj = build_body_mesh()
armature_obj = build_armature()
bind_skin_weights(mesh_obj, armature_obj)
tag_interface(armature_obj)
for anim in REQUIRED_ANIMATIONS:
    author_animation(anim["name"])


# --- Export -----------------------------------------------------------------
# The container provides `tcab_blend_export`: it runs bpy.ops.export_scene.gltf
# (GLB, export_skins + export_animations + export_extras) to write character.glb and
# renders the model.png preview, using the output paths from the config. Your skin and
# clips travel in the glTF, and your `tcab_joint` / `tcab_socket` custom properties export
# into node `extras` as the game-facing interface. You must reach this call to emit anything.
import tcab_blend_export

tcab_blend_export.export(config)
