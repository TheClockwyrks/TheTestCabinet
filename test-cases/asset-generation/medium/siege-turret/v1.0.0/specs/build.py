"""build.py — authoring script for the Siege Warden Turret (a RIGID mechanism).

This is the ONE script that builds the turret. `tcab-blend` runs it inside
headless Blender:

    tcab-blend                # execs: blender --background --python build.py -- <config.json>

It builds the turret as SEPARATE parented parts, authors one Action per required
animation CLIP, and TAGS the runtime-drivable caller DOFs into the nodes' custom
properties, then hands the scene to the bundled export helper, which emits `model.glb`
(a native glTF 2.0 whose clips are baked as glTF node animations and whose DOF tags
travel in node `extras`) and renders the preview `model.png`.

A mechanism is RIGID: articulate as separate parts pivoting about their joints — do
NOT use an armature and skin weights, and do NOT deform any part. There are TWO
game-facing contracts (see specs/brief.md):

  * ANIMATION CLIPS the game plays by name (deploy/fire/stow), authored as Actions on
    OBJECT transforms; and
  * CALLER DOFs the game drives to AIM the turret (turret_yaw, barrel_pitch), tagged
    into the driven nodes' `extras` so the interface travels in the emitted glTF.

Fill in the TODO sections. Everything is yours to invent EXCEPT: fit the seeded
bounding box, use only the brief's palette, build the parts as a parented hierarchy,
author every required animation by name as object motion, and expose every required
caller DOF as a tagged node. `build.py` is your recorded authoring trace and is re-run
for provenance, so keep it self-contained and deterministic.
"""

import json
import os
import sys

import bpy


# --- Load the seeded config -------------------------------------------------
# `tcab-blend` passes the config path after a literal `--`; if it is absent we
# fall back to `blender.config.json` in the current working directory. The config
# carries the bounding box (`bounds`), the Blender-native authoring axes (+Z up, the
# turret facing -Y — the export converts to the family's +Y-up/+Z-forward glTF), the
# output paths (`model.glb`, `model.png`), the REQUIRED animation clips (`animations`,
# each a `{"name","loop","auto_play"}` record), and the REQUIRED caller DOFs (`joints`,
# each a `{"name","kind","axis","min","max","rest"}` record — rotation limits in radians,
# axis named in the EMITTED Y-up glTF frame: yaw about "y", pitch about "x").
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
REQUIRED_ANIMATIONS = config["animations"]      # [{"name": "deploy", ...}, ...]
REQUIRED_JOINTS = config["joints"]              # [{"name": "turret_yaw", "axis": "y", ...}, ...]


# --- Start from an empty scene ----------------------------------------------
def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.actions):
        for datablock in list(block):
            block.remove(datablock)


# --- Build the parented hierarchy -------------------------------------------
def build_turret():
    """Build the turret as SEPARATE parented parts and return them.

    TODO: model the turret as distinct mesh objects — a fixed base/mount, a yaw
    housing parented to the base, an elevating gun parented to the housing, and the
    barrels parented to the gun — plus any sensor, ammo, or greebles. PARENT each
    moving part to its carrier so posing a parent carries its children, and set each
    object's ORIGIN at the pivot it turns about. Build in Blender-native space (+Z up,
    facing -Y), fit BOUNDS with the base on the ground, and color from the brief's
    palette.

    IMPORTANT: the caller DOFs aim the turret, so build the hierarchy so that the
    `turret_yaw` node carries the whole gun assembly (traversing it aims), and the
    `barrel_pitch` node carries the gun/barrels (elevating it aims). Return a dict of
    the nodes you will drive/animate, e.g.
    `{"yaw": yaw_obj, "gun": gun_obj, "barrels": barrels_obj}`.
    """
    raise NotImplementedError("TODO: build the parented turret hierarchy")


# --- Caller DOFs (runtime aiming) -------------------------------------------
def tag_caller_dofs(parts):
    """Tag each required caller DOF onto the node the game drives to aim the turret.

    A caller DOF travels IN the emitted glTF: set a Blender custom property named
    `tcab_joint` on the driven node, and the export writes it into that node's glTF
    `extras` (three.js reads it as `userData`). The game finds the node by the DOF name
    and clamps its rotation to [min, max].

    TODO: for each entry in REQUIRED_JOINTS, pick the node that realizes it (the
    `turret_yaw` housing node, the `barrel_pitch` gun node) and tag it, e.g.:

        node["tcab_joint"] = {
            "name": joint["name"], "kind": joint["kind"], "axis": joint["axis"],
            "min": joint["min"], "max": joint["max"], "rest": joint["rest"],
        }

    Build the node so its authored pose IS the DOF's `rest`, and so rotating it about
    the tagged axis (in the EMITTED glTF frame — yaw "y", pitch "x") aims the turret.
    Do NOT let any animation clip drive these nodes — the game owns them.
    """
    raise NotImplementedError("TODO: tag the caller DOFs (turret_yaw, barrel_pitch)")


# --- Animation clips --------------------------------------------------------
def author_animation(anim, parts):
    """Author ONE required animation CLIP as a Blender Action of OBJECT-transform keys.

    `anim` is a `{"name","loop","auto_play"}` record. TODO: create an Action named
    `anim["name"]` and key the PART OBJECTS' transforms (rotation_euler / location) to
    realize deploy / fire / stow (see specs/brief.md) — RIGIDLY, never deforming a part,
    authored in place, eased so the motion carries weight. Do NOT key the caller-DOF
    nodes (`turret_yaw` / `barrel_pitch`); the clips move the housing rise, the barrel
    recoil, and the packing — not the aim.
    """
    raise NotImplementedError(f"TODO: author animation {anim['name']!r}")


# --- Drive the pipeline -----------------------------------------------------
clear_scene()
parts = build_turret()
tag_caller_dofs(parts)
for anim in REQUIRED_ANIMATIONS:
    author_animation(anim, parts)


# --- Export -----------------------------------------------------------------
# The container provides `tcab_blend_export`: it runs bpy.ops.export_scene.gltf
# (GLB, export_animations + export_extras) to write `model.glb` and renders the
# model.png preview. Your parented parts export as a native glTF node hierarchy with
# baked clips (no skin), and your `tcab_joint` custom properties export into node
# `extras` as the game-facing caller-DOF interface. You must reach this call.
import tcab_blend_export

tcab_blend_export.export(config)
