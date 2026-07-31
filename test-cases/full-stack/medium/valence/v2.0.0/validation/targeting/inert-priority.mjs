// Automated validation for the Targeting sub-item `inert-priority`.
//
// With detection present, a tower's inert-priority toggle makes it fire at revealed
// inert matter first; toggling it on must NEVER make an undetected inert unit
// targetable. The check poses a revealed noble (via a Catalyst) alongside an ordinary
// atom: default targeting takes the atom, inert-priority flips it to the noble. Then a
// second scene with NO detector confirms inert-priority never targets the hidden noble.
//
// Each choice is read off the SHOT the tower takes, not off `targetId` a tick after the
// toggle. specs/towers.md pins the observable as what the tower fires at — "the tower fires
// on inert matter it can currently see ... before any other valid target", and "Changing
// priority is free and takes effect immediately" — and leaves it open when a build refreshes
// the target it reports between shots. A tower has just fired when the toggle is flipped, so
// it is mid-reload for most of a second; a build that re-picks its target only when it
// actually fires (rather than every tick, as the reference does) still reports the previous
// choice in `targetId` for that whole window, and the item failed it even though its very
// next shot went to the noble. The projectile's `targetId` is the unambiguous reading of
// "which unit did it fire at".
//
// TWO runs: the detector scene is arranged, the no-detector scene posed inside `act` with
// `poseScenario` (control ops only — `api.reset` throws there).

import {
  startScenario,
  poseScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  TICK,
  MAP,
} from "../_helpers.mjs";

// 300 ticks = 5 s, comfortably longer than the slowest damage tower's reload (the Reactor's
// 0.6/s), so waiting for "the next shot" never times out on a conformant build.
const MAX_SHOT_TICKS = 300;
// Both posed units are given enough electrons to be SLOW (an atom's speed falls with its
// electron count, specs/matter.md: 6 electrons = 44 px/s, 4 = 72 px/s) and to survive a
// 1-damage shot. The toggle is read off the tower's SECOND shot, half a second in, and that
// only isolates the toggle while both units are still valid targets and still in the same
// order — a light, fast atom would have outrun its lead or walked out of the tower's radius by
// then, and the tower would then shoot the noble for want of anything else, whatever the
// toggle said. The premise is asserted below rather than assumed.
const NOBLE_ELECTRONS = 4;
const ATOM_ELECTRONS = 6;
const NOBLE_AT = -40; // arc length either side of the tower's covering point
const ATOM_AT = 30;

/**
 * Run on until the board's damage tower launches its next shot; report which unit that shot
 * was aimed at, and the snapshot it was taken in. Each scene has exactly one damage tower (a
 * Catalyst is an aura and fires nothing), so a projectile that was not in flight before is
 * that tower's.
 */
async function nextShot(api) {
  const before = new Set((await api.snapshot()).projectiles.map((p) => p.id));
  const r = await api.until(
    (s) => s.projectiles.some((p) => !before.has(p.id)),
    { max: MAX_SHOT_TICKS, poll: TICK },
  );
  const shot = r.hit ? r.snap.projectiles.find((p) => !before.has(p.id)) : null;
  return { targetId: shot ? shot.targetId : null, snap: r.snap };
}

/** Whether `unitId` was inside `towerId`'s radius, and how far along the conduit it was. */
function standing(snap, towerId, unitId) {
  const t = snap.towers.find((x) => x.id === towerId);
  const u = snap.matter.find((x) => x.id === unitId);
  if (!t || !u) return { inRange: false, progress: -1 };
  return {
    inRange: Math.hypot(u.x - t.x, u.y - t.y) <= t.range,
    progress: u.progress,
  };
}

export default function item() {
  let em;
  let noble;
  let atom;
  let defaultTarget;
  let priorityTarget;
  let hiddenTarget;
  let hiddenNoble;
  let hiddenAtom;
  let premise;

  return {
    id: "targeting.inert-priority",

    // Detector present: a Catalyst and an Emitter over the same point, with a noble just
    // behind an ordinary atom so FIRST and inert-priority resolve to different units.
    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.2;
      await placeCovering(api, "catalyst", g, s0);
      em = await placeCovering(api, "emitter", g, s0);
      noble = await spawnAt(api, {
        type: "noble",
        electrons: NOBLE_ELECTRONS,
        pathId: 0,
        s: s0 + NOBLE_AT,
      });
      atom = await spawnAt(api, {
        type: "atom",
        electrons: ATOM_ELECTRONS,
        pathId: 0,
        s: s0 + ATOM_AT,
      });
    },

    // The toggle flipping which unit the tower shoots, then the same toggle failing to reach
    // a hidden noble in a detector-free scene. `setInertPriority` is a control op, so both
    // scenes are legal here.
    async act(api) {
      // The Catalyst reveals the noble on the first tick; the Emitter's opening shot shows
      // what it picks with the toggle still off.
      defaultTarget = (await nextShot(api)).targetId;

      await api.call("setInertPriority", em.id, true);
      const shot = await nextShot(api);
      priorityTarget = shot.targetId;
      // Read the scenario's premise out of the very snapshot the shot was taken in: the
      // ordinary atom still reachable, and still the unit FIRST along the conduit, so the only
      // thing that can have moved the tower off it is the toggle.
      premise = {
        atom: standing(shot.snap, em.id, atom),
        noble: standing(shot.snap, em.id, noble),
      };

      // No detector: inert-priority must not make an undetected inert unit targetable.
      const snap = await poseScenario(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.2;
      const em2 = await placeCovering(api, "emitter", g, s0);
      hiddenNoble = await spawnAt(api, {
        type: "noble",
        electrons: NOBLE_ELECTRONS,
        pathId: 0,
        s: s0 + NOBLE_AT,
      });
      hiddenAtom = await spawnAt(api, {
        type: "atom",
        electrons: ATOM_ELECTRONS,
        pathId: 0,
        s: s0 + ATOM_AT,
      });
      await api.call("setInertPriority", em2.id, true);
      hiddenTarget = (await nextShot(api)).targetId;
    },

    async assert(api, check) {
      check.expectEq(
        "without inert-priority the tower shoots the FIRST atom",
        defaultTarget,
        atom,
      );
      // The premise, so a pass can never come from the ordinary atom having simply stopped
      // being available: at the instant the shot was taken it was still in range and still
      // the unit furthest along, i.e. exactly what FIRST would have picked.
      check.expectOk(
        "the ordinary atom was still in range when that shot was taken",
        premise?.atom.inRange === true,
      );
      check.expectOk(
        "...and still the unit FIRST along the conduit",
        premise != null && premise.atom.progress > premise.noble.progress,
      );
      check.expectEq(
        "with inert-priority its next shot goes to the revealed inert unit",
        priorityTarget,
        noble,
      );

      check.expectNe(
        "an undetected inert unit is never shot at",
        hiddenTarget,
        hiddenNoble,
      );
      check.expectEq(
        "the tower shoots the visible atom instead",
        hiddenTarget,
        hiddenAtom,
      );
    },
  };
}
