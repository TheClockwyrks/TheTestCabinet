# Thunderhead — Proof of implementation

Alongside the game, the build must **capture a small set of proof artifacts** — from
the **built, running game**, using the project-local Playwright — and write them to
the fixed paths below under a `proof/` directory at the project root. They are
evidence that the game's key features work; frame them like the reference images
(`specs/overview.md`), at the logical viewport. Capture each from actual play, not a
mock-up.

Write exactly these files:

- **`proof/title.png`** — the **title** screen on load, showing `THUNDERHEAD` and the
  **PLAY** / **HOW TO PLAY** options.
- **`proof/world.png`** — the **generated world** from the tactical camera: mountainous
  **islands breaking the cloud sea**, with at least one **floating island** and the
  murk-filled low ground visible, demonstrating the procedural terrain and cloud sea
  (`specs/world.md`).
- **`proof/tactical.png`** — the **tactical HUD** in a live battle: the fleet roster,
  the flagship health bars, requisition/reinforcement, a selection under an order, and
  the minimap/contacts over the 3D battlespace (`specs/flow.md`, `specs/command.md`).
- **`proof/control.png`** — a **possessed unit** in direct control at a **ship weapon
  class**, showing the **per-turret status read-out** around the crosshair (green
  ready / yellow reloading / red unavailable) and the direct-control HUD
  (`specs/combat.md`, `specs/flow.md`).
- **`proof/wireframe.png`** — the same scene (or any battle scene) with the
  **wireframe** toggle on, showing the generated **terrain** and the provided **unit
  models** as wireframe (`specs/overview.md`, `specs/assets.md`).
- **`proof/engagement.mp4`** — a short (roughly 10–20 second) clip of a **live
  engagement**: both fleets in action across the terrain, weapons firing, aircraft
  aloft, and at least one **possession** (dropping into a unit and firing a station),
  with the **performance overlay** visible so the frame rate is on screen
  (`specs/flow.md`).

The set of files here and the manifest's proof list are one contract: write each file
at exactly the path above.
