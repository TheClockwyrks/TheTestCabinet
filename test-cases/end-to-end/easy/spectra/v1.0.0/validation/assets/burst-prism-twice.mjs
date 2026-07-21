// Automated validation for the Provided-art sub-item `burst-prism-twice`.
//
// A Prism plays the drone-burst twice — once when its shell breaks and once when
// its core is destroyed. A Prism is posed and broken in two real hits; the live
// burst count (snapshot.bursts) is read to confirm a pop spawns for each break.

import { startClean, spawnDrone, findDrone, shootDrone } from "../_helpers.mjs";

// The old script stepped 0.03 s to let a hit resolve and its burst register. At
// 120 Hz that is 3.6 ticks, which the tick contract refuses rather than rounds.
// Round UP to 4: this is a settle waiting for an event to APPEAR, so it must never
// be shortened — reading a tick early could miss the very pop being counted.
const RESOLVE_TICKS = 4;

export default function item() {
  // The Prism under test, and what each phase observed.
  let prismId;
  let bursts0;
  let afterShell;
  let snap;

  return {
    id: "assets.burst-prism-twice",

    // A clean stage-1 wave holding exactly one Prism, shell and core both intact.
    // The burst count is read here, instantly, before anything can have popped.
    async arrange(api) {
      await startClean(api);
      prismId = await spawnDrone(api, {
        kind: "prism",
        band: "cyan",
        shellBand: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
      });
      bursts0 = (await api.snapshot()).bursts.length;
    },

    async act(api) {
      // Break the shell (its band): the first pop.
      await shootDrone(api, prismId, "cyan");
      await api.advance(RESOLVE_TICKS);
      afterShell = (await api.snapshot()).bursts.length;

      // Break the core (the opposite band): the second pop, coexisting with the first.
      await shootDrone(api, prismId, "magenta");
      await api.advance(RESOLVE_TICKS);
      snap = await api.snapshot();

      // Both breaks resolve in a handful of ticks, because `shootDrone` poses the
      // bullet directly on the drone — exact for the check, but only a few frames
      // of film. Restate the SAME two pops watchably: a fresh Prism with a real
      // bullet rising into it from the ship's lane. Posed with control ops only
      // (`clearField` + spawns); `reset` would take the clock back and freeze the
      // recording. Every operand above is already captured, so this cannot move the
      // verdict — it only gives the reviewer something to actually see.
      await api.call("clearField");
      const id2 = await spawnDrone(api, {
        kind: "prism",
        band: "cyan",
        shellBand: "cyan",
        x: 640,
        y: 300,
        phase: "formation",
      });
      await api.call("spawnPlayerBullet", { x: 640, y: 540, band: "cyan" });
      await api.advance(84); // 84 ticks = the old 700 ms: the shot rises and breaks the shell
      await shootDrone(api, id2, "magenta");
      await api.advance(84); // 84 ticks = the old 700 ms: the core pop plays out
    },

    async assert(api, check) {
      check.expectEq("no burst before any pop", bursts0, 0);
      check.expectGe("breaking the shell plays a burst", afterShell, 1);
      check.expectGe(
        "destroying the core plays a second burst",
        snap.bursts.length,
        2,
      );
      check.expectEq(
        "the Prism is gone after the core kill",
        findDrone(snap, prismId),
        null,
      );
    },
  };
}
