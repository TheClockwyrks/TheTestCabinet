// Automated validation for the Targeting sub-item `inert-priority`.
//
// With detection present, a tower's inert-priority toggle makes it fire at revealed
// inert matter first; toggling it on must NEVER make an undetected inert unit
// targetable. The check poses a revealed noble (via a Catalyst) alongside an ordinary
// atom: default targeting takes the atom, inert-priority flips it to the noble. Then a
// second scene with NO detector confirms inert-priority never targets the hidden noble.
//
// TWO runs: the detector scene is arranged, the no-detector scene posed inside `act` with
// `poseRun` (control ops only — `api.reset` throws there).

import {
  startRun,
  poseRun,
  pathGeom,
  placeCovering,
  spawnAt,
  TICK,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let em;
  let noble;
  let atom;
  let defaultTarget;
  let priorityTarget;
  let hiddenTarget;
  let hiddenNoble;
  let hiddenAtom;

  return {
    id: "targeting.inert-priority",

    // Detector present: a Catalyst and an Emitter over the same point, with a noble just
    // behind an ordinary atom so FIRST and inert-priority resolve to different units.
    async arrange(api) {
      const snap = await startRun(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.2;
      await placeCovering(api, "catalyst", g, s0);
      em = await placeCovering(api, "emitter", g, s0);
      noble = await spawnAt(api, { type: "noble", pathId: 0, s: s0 - 40 });
      atom = await spawnAt(api, {
        type: "atom",
        electrons: 3,
        pathId: 0,
        s: s0 + 40,
      });
    },

    // The toggle flipping the tower's choice, then the same toggle failing to reach a
    // hidden noble in a detector-free scene. `setInertPriority` is a control op, so both
    // scenes are legal here.
    async act(api) {
      await api.advance(TICK); // the Catalyst reveals the noble; the emitter picks a target
      defaultTarget = (await api.snapshot()).towers.find(
        (x) => x.id === em.id,
      ).targetId;

      await api.call("setInertPriority", em.id, true);
      await api.advance(TICK);
      priorityTarget = (await api.snapshot()).towers.find(
        (x) => x.id === em.id,
      ).targetId;

      // No detector: inert-priority must not make an undetected inert unit targetable.
      const snap = await poseRun(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.2;
      const em2 = await placeCovering(api, "emitter", g, s0);
      hiddenNoble = await spawnAt(api, {
        type: "noble",
        pathId: 0,
        s: s0 - 40,
      });
      hiddenAtom = await spawnAt(api, {
        type: "atom",
        electrons: 3,
        pathId: 0,
        s: s0 + 40,
      });
      await api.call("setInertPriority", em2.id, true);
      await api.advance(TICK);
      hiddenTarget = (await api.snapshot()).towers.find(
        (x) => x.id === em2.id,
      ).targetId;
    },

    async assert(api, check) {
      check.expectEq(
        "without inert-priority the tower takes the FIRST atom",
        defaultTarget,
        atom,
      );
      check.expectEq(
        "with inert-priority it prefers the revealed inert unit",
        priorityTarget,
        noble,
      );

      check.expectNe(
        "an undetected inert unit is never targeted",
        hiddenTarget,
        hiddenNoble,
      );
      check.expectEq(
        "the tower takes the visible atom instead",
        hiddenTarget,
        hiddenAtom,
      );
    },
  };
}
