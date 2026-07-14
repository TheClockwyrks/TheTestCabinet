"""build.py — authoring script for the Siege Warden Rifle (a STATIC prop).

This is the ONE script that builds the weapon. `tcab-blend` runs it inside
headless Blender:

    tcab-blend                # execs: blender --background --python build.py -- <config.json>

It builds the rifle as clean hard-surface geometry, then hands the scene to the
bundled export helper, which emits `model.glb` (a native, UNRIGGED glTF 2.0) and
renders the preview `model.png`.

A prop is STATIC: there is NO armature, NO skin, and NO animations — just geometry.
Fill in the TODO sections. Everything is yours to invent EXCEPT: fit the seeded
bounding box, use only the brief's palette, and build the rifle in the held
orientation the brief describes. `build.py` is your recorded authoring trace and is
re-run for provenance, so keep it self-contained and deterministic — it must rebuild
the rifle from the config alone.
"""

import json
import os
import sys

import bpy


# --- Load the seeded config -------------------------------------------------
# `tcab-blend` passes the config path after a literal `--`; if it is absent we
# fall back to `blender.config.json` in the current working directory. The config
# carries the bounding box (`bounds`), the Blender-native authoring axes (+Z up, the
# weapon facing -Y — the export converts to the family's +Y-up/+Z-forward glTF), and
# the output paths (`model.glb`, `model.png`). `animations` is present but EMPTY for a
# static prop — you do not author any.
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


# --- Start from an empty scene ----------------------------------------------
# Clear Blender's default cube/camera/light so the export contains only what we
# build below.
def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials):
        for datablock in list(block):
            block.remove(datablock)


# --- Build the rifle --------------------------------------------------------
def build_rifle():
    """Build the whole Warden service rifle as clean hard-surface geometry.

    TODO: model the weapon — receiver, barrel out to a clear muzzle, handguard,
    shoulder stock, magazine, sight, pistol grip, and trigger guard — assembled
    into ONE coherent firearm. Use `bpy.data`/`bmesh` or primitive operators you
    edit. Build it in Blender-native space (+Z up, muzzle facing -Y — the barrel
    runs along Y, the sight on top, the magazine below, the stock at the back) and
    fit it within BOUNDS at a sensible held-weapon scale. Color it from the brief's
    palette using vertex colors or materials so the color survives the glTF export.

    A prop is STATIC — do NOT add an armature, skin weights, or any animation.
    """
    raise NotImplementedError("TODO: build the Warden service rifle")


# --- Drive the pipeline -----------------------------------------------------
clear_scene()
build_rifle()


# --- Export -----------------------------------------------------------------
# The container provides `tcab_blend_export`: it runs bpy.ops.export_scene.gltf
# (GLB) to write `model.glb` and renders the model.png preview, using the output
# paths from the config. For a static prop the scene has no skin and no animations,
# so the exported glTF is just geometry. You must reach this call for the run to emit
# anything.
import tcab_blend_export

tcab_blend_export.export(config)
