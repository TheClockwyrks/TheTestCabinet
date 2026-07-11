# Siege Warden Rifleman — modeling and rigging brief

You are modeling and rigging the **Warden Rifleman**, the standard-issue infantry
soldier of the Warden squad in *Siege* — an upright humanoid you build, skin, and
animate in **Blender**, exported as a rigged, animated character a game poses at
runtime. There is no target model to copy: it must read unmistakably as a Warden
Rifleman and satisfy the animation contract below.

The Rifleman is the **base body of the squad** — the plain-Cobalt, balanced
damage dealer that holds the line beside the redoubt. The machine gunner, medic,
and engineer are variations on this same soldier; get the Rifleman right and the
squad follows from it.

This brief fixes what the Rifleman is and how it must move. It deliberately does
**not** give you a bone list, joint placements, weight maps, or pose angles —
working out the skeleton an upright, running, firing soldier needs, where the
joints go, and how the skin binds to it is the challenge. Invent the rig.

## What you are building

One **skinned mesh** bound to one **armature**, exported as a single skinned,
animated **glTF 2.0** file. The soldier is a whole continuous body — head, torso,
two arms, two legs — that deforms across its joints as the armature poses it: an
elbow bends, a knee drives, a shoulder rolls, with no seam tearing open.

**The gear is part of the body.** The Rifleman's permanently-worn kit — a combat
**helmet**, light **body armor / vest**, and **ammo pouches** — is *baked into the
same mesh* and skinned to the same skeleton, so it rides and deforms with the
soldier rather than floating. It is not a separate object; it is the soldier's
silhouette.

**The weapon is NOT part of the mesh.** The Rifleman carries a rifle in the game,
but you do **not** model it. Instead you build an **empty `weapon_socket` bone**
parented to the right hand, with **no vertex influence** — an attach point where
the game hangs a separate rifle asset. Your `fire` and `reload` animations move
the hands *and this socket*; the game supplies the gun. Do not sculpt, box out, or
imply a rifle in the mesh. (This is the repo's standard skinned-character socket
convention.)

## The bounding box and coordinate system

The character must fit within the **bounding box given to you** in
`blender.config.json` (its `width` along x, `height` along z, `depth` along y, in
world units) — a standing humanoid filling most of that height, torso and helmeted
head stacked above the hips. Do not overflow it.

You author in **Blender's native orientation** and let the bundled export helper
convert your scene to the glTF the game consumes — so build the way Blender itself
works, not the way the finished model ends up oriented:

- **+Z is up** (Blender's own up axis). The soldier stands on the ground plane
  (`z = 0` at the boots) and rises along +Z to the top of the helmet.
- **The Rifleman faces -Y**, toward Blender's **front view** (`Numpad 1`): its chest,
  its visor, and the shouldered weapon point down -Y, and the run cycle strides that
  way (authored in place — see below).
- Build the soldier roughly symmetric left-to-right about its vertical centerplane
  (the `x = 0` plane) at rest (the animations break that symmetry).

Author in this Blender-native space and let the export finish the job: it emits the
character standing **+Y-up and facing +Z** — the convention the rest of the 3D family
and the game runtime consume. **Do not pre-rotate the character to +Y-up yourself.**
The export applies that conversion for you; rotating first double-applies it and
lands the soldier flat on its back.

## What the Warden Rifleman is (and what is yours to invent)

Fixed — the character must read unmistakably as all of these:

- An **upright humanoid infantry soldier** standing on two legs, balanced and
  standard-issue — not heavy, not a specialist. Ordinary combat proportions.
- A **combat helmet** on the head with a clear **visor** that catches the light.
- **Light body armor / a vest** over the torso, and **ammo pouches** at the belt
  or chest — the worn kit that says "line infantry", baked into the body.
- Two arms and two hands, the right hand ready to hold the socketed weapon.
- The disciplined **Warden Cobalt** palette below — this is a Warden, told from
  the enemy by its color.

Everything else is yours to invent — the exact silhouette and proportions, how the
armor plates and the vest are shaped, how the helmet and visor are formed, how the
pouches sit, where you break the body into a skeleton, and where the joints go.
Nothing here prescribes topology; the brief rewards a clean, convincing soldier that
is unmistakably a Warden Rifleman and deforms believably.

## Palette

Use only these opaque colors, carried on the mesh as vertex colors or materials:

| Role | Hex |
| --- | --- |
| Uniform / armor — primary (Warden Cobalt) | `#3d7bd6` |
| Trim, edges, insignia (Cobalt light) | `#7fb0f0` |
| Helmet rim, vest fittings, buckles, pouch clasps (gunmetal) | `#565c64` |
| Straps, recesses, deep shadow, boot soles (dark iron) | `#2b2f36` |
| Boots and gloves (charcoal slate) | `#3a4048` |
| Visor / eye glow (pale cobalt) | `#bfe0ff` |

Cobalt is the body of the read; keep the gunmetal, iron, and charcoal for
fittings and recesses, and let the pale-cobalt visor glow so the head reads from
several angles. Do not introduce colors outside this set.

## The required animations — the fixed contract

The animations you must author, by name, are listed in `blender.config.json` and
fixed here. Author each as a Blender **Action** with F-curve keyframes on the pose
bones, **in place** — the run cycle strides on the spot; a consuming game supplies
world travel. Every animation must read as **one continuous skin deforming across
the joints** — the armor and vest ride the deforming body, no seam tears at a
joint. Ease the keyframes so a soldier carrying weight settles into each extreme
rather than sliding linearly.

- **`idle`** (loops, plays automatically) — a settled, breathing **ready stance**:
  weight on both feet, weapon hand near the socket, a slow rise-and-fall of the
  chest and a small weight shift so the soldier reads as alive and alert while
  standing.

- **`run`** (loops) — a **real run cycle** authored in place: planted feet, the
  two legs in **opposite phase** (one drives while the other recovers), the arms
  **counter-swinging** to the legs, the torso leaning slightly into the run and
  bobbing with the stride. The skin folds across the hips, knees, ankles, and
  shoulders through the cycle. The body stays centered — the leg cycle alone
  carries the stride; do not translate the whole model across the scene.

- **`fire`** (plays once) — the Rifleman **shoulders the socketed weapon**, braces,
  and takes a **single shot**: a sharp **recoil kick** back through the shoulder
  and torso that ripples through the upper body as one continuous surface, then
  settles back to the braced aim. The legs hold planted; the arms and shoulders
  carry the recoil.

- **`reload`** (plays once) — the hands **work at the weapon and socket**: drop the
  spent magazine, bring the support hand across to swap in a fresh one, seat it,
  chamber the round with a pull, and return to the ready aim. Read it in the hands,
  wrists, and elbows; the socket moves with the working hand so the game's rifle
  follows.

- **`hit`** (plays once) — a **sharp flinch / stagger** from an impact: the torso
  jerks, a shoulder drops, the soldier rocks back a step's worth of weight, then
  **recovers** to the stance. A brief, snappy reaction, not a long one.

- **`death`** (plays once, **holds the last pose**) — the soldier **collapses**:
  the legs buckle, the spine folds, the body goes down, and it **holds** the final
  slumped pose limp on the ground (the game does not loop it).

The six animations are the fixed contract — produce them, by exactly these names,
and do not contradict them (keep the legs planted under `fire`, keep `run` in
place, hold the last pose under `death`). You may add extra bones, joints, and
animations of your own on top; you must not drop or contradict these six.

## How the tool behaves

You author **everything by writing a single Blender Python script, `build.py`**,
and running it through **`tcab-blend`** — a thin runner already on your `PATH` that
launches Blender headless on your script (`blender --background --python build.py`)
with the seeded config. `tcab-blend` is the only sanctioned build path; there is no
operation log and no separate rig format — **`build.py` is the recorded authoring
trace.**

Inside `build.py`, using Blender's `bpy` module, you:

1. **Build the body mesh** — the soldier and all baked-in gear (helmet, vest,
   pouches), colored from the palette above with vertex colors or materials.
2. **Build the armature** — the skeleton's edit-bones in a hierarchy, **including
   the empty `weapon_socket` bone** parented to the right hand.
3. **Bind the skin weights** — vertex groups per bone (automatic/bone-heat weights
   are fine), capped and normalized, with the `weapon_socket` given **no**
   influence.
4. **Author one Action per required animation** — F-curve keyframes on the pose
   bones for `idle`, `run`, `fire`, `reload`, `hit`, and `death`.
5. **Export** — call the bundled export helper, which runs
   `bpy.ops.export_scene.gltf(...)` with skins and animations enabled to emit
   **`character.glb`** (the skinned, animated glTF 2.0) and renders the preview
   **`model.png`**. The helper converts your Blender-native scene to the glTF's
   +Y-up/+Z-forward orientation and **frames and renders `model.png` for you** from a
   fixed front view, lighting your materials — you do **not** need to add a camera or
   lights or fight the preview framing. Spend your effort on the mesh, rig, and
   animations; the preview is a convenience for the viewer, and the `character.glb`
   is what is judged.

A starter `build.py` is seeded for you with the pipeline stubbed out and the config
loading wired up; fill in the geometry, the rig, the weights, and the animations.

**You must run `tcab-blend` before you finish** so the glTF is emitted — an
un-exported model scores as empty. **The emitted `character.glb` is what is
judged**, not the steps your script took to build it; after your run, `build.py` is
re-run in a clean environment to confirm it reproduces the same character (mesh,
skin, and the required animations). So keep `build.py` self-contained and
deterministic: it must rebuild your Rifleman from the seeded config alone.
