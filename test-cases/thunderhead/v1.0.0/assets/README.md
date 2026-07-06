# Thunderhead — Provided unit models (assets)

This folder holds the **provided unit models** the build loads and renders — the
only art the case supplies (the world is generated in code; see
[`../specs/assets.md`](../specs/assets.md) and
[`../specs/overview.md`](../specs/overview.md)). Every model is a **rigid,
articulated assembly** authored to the rigid-body contract: a hierarchy of rigid
parts joined by named joints (turret yaw, barrel elevation, rotor/propeller spin,
and control-surface hinges), with no skeletal or soft-body deformation.

When a run seeds this case, the model files here (and their manifest of parts and
joints) are seeded into the run workspace, and the case manifest's `assets` key lists
them so they land in the run root; `../specs/assets.md` tells the build to load them,
drive their joints from the simulation, and load them by **page-relative** URL.

**Status:** the model files are authored separately, via the dual-contouring
asset-generation cases, and are added here once ready. Until they are in place this
case is not run; the specification is written to their contract so the game can be
built against them.
