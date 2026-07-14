# Siege Warden Turret — modeling-and-rigging brief

Build the **Warden automated defense turret**, a *Siege* emplacement, as a
**rigidly-articulated mechanism** in **Blender**. You write one Blender Python
script (`build.py`) that constructs the turret as **separate parented parts** and
authors its animations as **object motion**, then runs it headless through
`tcab-blend`, which exports a native **`model.glb`** (a standard glTF 2.0 with baked
**node-hierarchy animations**) and renders a preview.

This measures **creativity and mechanical craft**, not instruction-following: the
brief says *what the turret is* and *how it must move*; the parts you build, where
you place their pivots, and how you shape everything are **yours to invent**. There
is no target image.

## Rigid, not skinned

This is a **mechanism**, not a character. It must articulate as **separate rigid
parts pivoting about their joints** — the housing yaws, the gun elevates, the
barrels recoil — with **nothing bending, squashing, or deforming** the way a skinned
body would. Build each moving part as its **own object**, **parent** it into a
hierarchy (so posing a parent carries its children), and animate by keying **object
transforms** (rotation / location), **not** an armature and skin weights. The export
bakes these into standard **glTF node animations** a game plays natively.

A sensible hierarchy (invent your own):

- a **base / mount** — fixed to the ground, the root everything hangs off;
- a **yaw housing** — parented to the base, rotating about the vertical (**+Z**)
  axis: this is what pans left and right;
- an **elevating gun** — parented to the housing, rotating about a horizontal
  (**+X**) pivot to raise and lower;
- the **barrels** — parented to the gun, able to slide back along their axis for
  recoil (and whatever sensor, ammo box, or greebles you add).

## Orientation, scale, and axes

Author in **Blender-native space**: **+Z up**, the turret **facing -Y** (Blender's
front view). The bundled export converts this to the family's +Y-up / +Z-forward
glTF — **do not** pre-rotate. The base sits on the ground plane; fit the whole
emplacement within the seeded bounding box (`config["bounds"]`, in world units:
`width` across, `height` up, `depth` front-to-back) at a sensible emplacement scale.

## Two game-facing contracts: clips the game plays, DOFs the game drives

A real turret gives the game two things, and you must author both:

1. **Baked animation clips** the game *plays* by name (deploy, fire, stow).
2. **Caller DOFs** the game *drives* every frame from its own state to *aim* the
   turret (yaw and pitch). These are **not** clips — the game sets them directly.

### Animation clips

Author **one Blender Action per required animation**, named exactly, keying the part
objects' transforms with F-curve keyframes (ease them so the motion carries weight —
a recoil snaps and settles). Author them **in place**. The required clips
(`config["animations"]`):

- **`deploy`** (plays once) — the turret comes **online** from a stowed rest: the
  housing rises / unfolds and the gun elevates from packed to a ready, level firing
  attitude.
- **`fire`** (plays once) — the twin barrels **recoil** sharply back along their
  axis and return, with a small muzzle rise through the elevation joint that
  settles; the base and housing hold their aim.
- **`stow`** (plays once, **holds** its last pose) — the reverse of `deploy`: the
  gun packs down and the housing folds back to the stowed rest, and **holds** the
  packed pose.

The clips must **not** drive the caller DOFs below (deploy/fire/stow move the
housing, barrels, and packing — not the aim).

### Caller DOFs (runtime aiming) — REQUIRED

Expose the DOFs the game aims with, so the turret is actually usable and not just a
bag of clips. For each, build the driven node and **tag it** with a Blender custom
property named **`tcab_joint`** — a dict the export writes into that node's glTF
`extras` (via `export_extras`), so the interface travels **inside the emitted glTF**
(no sidecar), and a game (or the review viewer) finds the node by name and clamps it:

```python
yaw_obj["tcab_joint"] = {
    "name": "turret_yaw", "kind": "rotation", "axis": "y",
    "min": -2.967, "max": 2.967, "rest": 0.0,   # radians
}
```

The two required DOFs (`config["joints"]`):

- **`turret_yaw`** — rotation about the vertical axis (**`y`** in the emitted Y-up
  glTF), range ±170°, the housing (and the gun it carries) traversing to aim.
- **`barrel_pitch`** — rotation about a horizontal axis (**`x`** in the emitted
  glTF), range −10°…60°, the gun elevating to aim up/down.

Notes:

- **Axis is named in the emitted glTF frame (Y-up).** You author in Blender Z-up, but
  the export converts to Y-up; yaw about world-up is **`y`**, pitch is **`x`**. Tag
  the axis the game will see.
- **Limits in the extras are in radians** (Blender-native for rotation); the case
  fixes the ranges in degrees, shown above.
- Build the node so the DOF's `rest` value is its authored pose, and so rotating that
  node about the tagged axis aims the turret (yaw drives the housing + everything it
  carries; pitch drives the gun + barrels).

## Palette

Use only the Warden palette:

- Warden Cobalt `#3d7bd6` — the housing and primary panels;
- Cobalt light `#7fb0f0` — a lighter accent / trim;
- gunmetal `#565c64` — the gun, barrels, and mount;
- dark iron `#2b2f36` — the base, recesses, and darker fittings;
- charcoal-slate `#3a4048` — bracing and shadowed structure;
- pale-cobalt `#bfe0ff` — a small sensor / optic glow, used sparingly.

Carry color with **vertex colors or materials** so it survives the glTF export. No
out-of-palette colors.

## Deliver

Fill in `build.py` so it builds the parented parts, authors the three animation clips
(deploy/fire/stow), tags the two caller DOFs (turret_yaw/barrel_pitch), and reaches
the export call. Run `tcab-blend` to build and read `model.png` to check your
progress; **you must run it before you finish** so `model.glb` is emitted (an
un-exported run scores as empty). The emitted glTF — geometry plus its baked node
animations **and its caller-DOF tags** — is your submission; your `build.py` is re-run
afterward to confirm it reproduces the same turret.
