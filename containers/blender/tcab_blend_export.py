"""tcab_blend_export — the bundled export step for The Test Cabinet Blender kind.

A model's ``build.py`` builds the character in the Blender scene, then calls
``tcab_blend_export.export(config)`` to finish the run. This helper does the two things
every Blender character run must do the same way, so a case does not have to:

1. **Export ``character.glb``** — the whole scene as a single **binary glTF 2.0** with
   the skin (bones, per-vertex weights, inverse-bind matrices) and every Action baked as
   a glTF animation. This is the authoritative, judged output; the validator decodes it.
2. **Render ``model.png``** — a preview the reviewer sees, drawn with the CPU Workbench
   engine so it works headless with no GPU (best-effort; a failed render never fails the
   export).

The paths come from the seeded ``blender.config.json`` (``mesh`` / ``preview``), so a
model never hard-codes them.
"""

import os

import bpy


def export(config):
    """Emit ``character.glb`` and render ``model.png`` from the current scene."""
    mesh_path = os.path.abspath(config.get("mesh", "character.glb"))
    preview_path = os.path.abspath(config.get("preview", "model.png"))

    _ensure_gltf_addon()

    # A standard skinned + animated binary glTF. `use_selection=False` exports the whole
    # scene; the skin and animations travel with it so a game gets a ready-to-play,
    # riggable character.
    bpy.ops.export_scene.gltf(
        filepath=mesh_path,
        export_format="GLB",
        export_skins=True,
        export_animations=True,
        export_yup=True,
        use_selection=False,
    )
    print(f"tcab_blend_export: wrote {mesh_path}")

    try:
        _render_preview(preview_path)
        print(f"tcab_blend_export: wrote {preview_path}")
    except Exception as err:  # pragma: no cover - preview is best-effort
        print(f"tcab_blend_export: preview render skipped ({err})")


def _ensure_gltf_addon():
    """Enable the bundled glTF exporter if `--factory-startup` left it off."""
    try:
        bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    except Exception:  # pragma: no cover - already enabled in most builds
        pass


def _render_preview(preview_path):
    """Render a headless CPU preview of the character, framed by an auto camera.

    Uses the **Workbench** engine, which renders on the CPU with no GPU or Vulkan — the
    same headless constraint the voxel family's Mesa/lavapipe previews honor.
    """
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = preview_path
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.film_transparent = True

    # Draw the character in its own material colors, lit like a turntable. Workbench
    # defaults to a flat single "object" color, which renders every palette as one grey
    # mass; keying the shading to MATERIAL means a model's palette shows in the preview
    # without the model having to configure the viewport shading itself.
    shading = scene.display.shading
    shading.color_type = "MATERIAL"
    shading.light = "STUDIO"

    # A light so the surface reads, if the scene has none.
    if not any(obj.type == "LIGHT" for obj in scene.objects):
        light_data = bpy.data.lights.new(name="tcab_key", type="SUN")
        light = bpy.data.objects.new(name="tcab_key", object_data=light_data)
        light.rotation_euler = (0.9, 0.0, 0.6)
        scene.collection.objects.link(light)

    # A camera framing the whole scene, added only if the case did not author one — so a
    # model can rely on the export to render a sensible preview and never has to place a
    # camera itself (a common time sink otherwise).
    camera = next((obj for obj in scene.objects if obj.type == "CAMERA"), None)
    if camera is None:
        cam_data = bpy.data.cameras.new(name="tcab_cam")
        camera = bpy.data.objects.new(name="tcab_cam", object_data=cam_data)
        scene.collection.objects.link(camera)
        _aim_camera_front(camera)
    scene.camera = camera

    bpy.ops.render.render(write_still=True)


def _aim_camera_front(camera):
    """Place ``camera`` at a fixed front-3/4 view of the mesh, in Blender-native axes.

    A Blender character is authored **+Z up** and **facing -Y** (Blender's front view),
    so the front-3/4 camera sits on the -Y (front) side, offset to +X and lifted along
    +Z, and aims at the mesh's bounding-box center with +Z up — Blender's own
    ``to_track_quat`` convention, which is why building in the native space (rather than
    a pre-rotated +Y-up scene) keeps this framing upright with no per-case camera work.
    """
    from mathutils import Vector

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        camera.location = (0.0, -10.0, 5.0)
        camera.rotation_euler = (1.2, 0.0, 0.0)
        return

    # World-space AABB over every mesh's corners.
    lo = Vector((float("inf"),) * 3)
    hi = Vector((float("-inf"),) * 3)
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], world[i]) for i in range(3)))
            hi = Vector((max(hi[i], world[i]) for i in range(3)))
    center = (lo + hi) / 2
    size = max((hi - lo)[i] for i in range(3)) or 1.0

    # Front (-Y), right (+X), raised (+Z); distance scaled to the largest extent.
    offset = Vector((0.6, -1.0, 0.5))
    offset.normalize()
    camera.location = center + offset * size * 1.6
    direction = center - camera.location
    # Look down the camera's -Z at the center, keeping local Y toward world up (+Z).
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
