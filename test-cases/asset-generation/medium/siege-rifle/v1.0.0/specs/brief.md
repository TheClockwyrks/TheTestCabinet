# Siege Warden Rifle — modeling brief

Build the **Warden service rifle**, the standard-issue weapon a *Siege* Warden
rifleman carries, as a **static hard-surface prop** in **Blender**. You write one
Blender Python script (`build.py`) that constructs the whole rifle as clean
geometry and runs it headless through `tcab-blend`, which exports a native
**`model.glb`** (a standard glTF 2.0) and renders a preview. There is **no rig and
no animation** — a prop is a static model.

This measures **creativity and hard-surface craft**, not instruction-following: the
brief says *what the rifle is*; the exact shapes, proportions, and construction are
**yours to invent**. There is no target image — build toward this description.

## What it is

A believable modern **service rifle** — the weapon that hangs on a rifleman's hand.
It must read unmistakably as a firearm from more than one angle, with the parts a
rifle has, assembled into one coherent weapon:

- a **receiver** — the central body the other parts attach to;
- a **barrel** running out the front to a clearly-defined **muzzle**;
- a **handguard / foregrip** wrapping the barrel forward of the receiver;
- a **shoulder stock** at the rear;
- a **magazine** below the receiver (a curved or straight box);
- an **iron sight or optic** on top;
- a **pistol grip** and **trigger guard** under the receiver.

Keep it grounded and functional — a soldier's tool, not a sci-fi fantasy gun.

## Orientation, scale, and axes

Author in **Blender-native space**: **+Z up**, the weapon **facing -Y** (Blender's
front view). The bundled export converts this to the family's +Y-up / +Z-forward
glTF — **do not** pre-rotate. Build the rifle in a natural **held orientation**: the
barrel running front-to-back (along **Y**, muzzle toward -Y), the sight on **top**
(+Z), the magazine **below**, the stock at the **back** (+Y). A game hangs the
finished weapon on a hand socket, so an unambiguous forward/up matters.

Fit the whole weapon within the seeded bounding box (`config["bounds"]`, in world
units: `width` across, `height` top-to-bottom, `depth` the barrel run). Sit it at a
sensible scale — a held weapon that mostly fills the box's length, not a sliver and
not overflowing.

## Palette

Use only the Warden palette. The rifle is a **gunmetal / dark-iron** weapon with
small **Cobalt** unit accents:

- gunmetal `#565c64` — the receiver, barrel, and bulk of the body;
- dark iron `#2b2f36` — the grip, magazine, and recessed / darker fittings;
- charcoal-slate `#3a4048` — the handguard and stock;
- Warden Cobalt `#3d7bd6` — a small unit accent (a marking, a sling loop, a panel);
- pale-cobalt `#bfe0ff` — a tiny optic-lens glint, used sparingly.

Carry color with **vertex colors or materials** so it survives the glTF export. No
out-of-palette colors.

## Deliver

Fill in `build.py` so it constructs the whole rifle and reaches the export call.
Run `tcab-blend` to build and read `model.png` to check your progress; **you must
run it before you finish** so `model.glb` is emitted (an un-exported run scores as
empty). The emitted glTF is your submission; your `build.py` is re-run afterward to
confirm it reproduces the same model.
