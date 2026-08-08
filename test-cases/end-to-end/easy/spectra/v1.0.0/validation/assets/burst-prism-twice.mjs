// Automated validation for the Provided-art sub-item `burst-prism-twice`.
//
// A Prism plays the drone-burst twice — once when its shell breaks and once when
// its core is destroyed. A Prism is posed and broken in two real hits; the live
// burst count (snapshot.bursts) is read to confirm a pop spawns for each break.
//
// Both hits fly up from the ship's lane with a beat between them, so a reviewer can
// watch each break happen and each pop play out. The old script resolved both breaks
// within a handful of ticks of each other, so the two pops overlapped into one flash
// and only the core's was legible (see `LEAD_IN_TICKS`).

import {
  startClean,
  holdDrones,
  spawnDrone,
  spawnBystander,
  findDrone,
  readsAs,
  shootFromLane,
  LEAD_IN_TICKS,
} from "../_helpers.mjs";

// Room for a shot to cross the ~280 px up to the Prism (0.37 s at the specified
// bullet speed), with slack for a build whose bullets travel more slowly.
const RESOLVE_MAX_TICKS = 150;

// A beat between the two breaks, so each pop is a distinct event on screen rather
// than the two overlapping into one flash. The swarm is held for this item, so the
// beat can be as long as it needs to be to read: it no longer has to fit inside the
// window a live assault leaves a posed drone standing in its slot.
const BETWEEN_TICKS = 72;

export default function item() {
  // The Prism under test, and the live burst count at each point that matters.
  let prismId;
  let bursts0;
  let beforeShell;
  let afterShell;
  let beforeCore;
  let snap;

  return {
    id: "assets.burst-prism-twice",

    // A clean stage-1 wave holding exactly one Prism, shell and core both intact,
    // with the swarm held (`holdDrones`) so the Prism stands still to be broken
    // twice — it neither flies around under the two shots nor dives to the bottom
    // and inverts the field between them. The burst count is read here, instantly,
    // before anything can have popped.
    async arrange(api) {
      await startClean(api);
      await holdDrones(api);
      await spawnBystander(api);
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

    // Each break is counted as a RISE in the live burst count across it, measured
    // against the LOWEST count seen while that break's shot was in flight — not as
    // an absolute total, and not against a reading taken before the shot.
    //
    // A burst is a finite effect that expires. With a readable beat between the two
    // breaks, the shell's pop may still be alive when the core dies (1 -> 2) or may
    // have faded during the core shot's flight (1 -> 0 -> 1); an absolute "two
    // bursts alive at once" only ever held because the old script fired both hits
    // within a few ticks of each other, and a plain before/after reading misses the
    // second case. A rise from the in-flight minimum catches both.
    async act(api) {
      // A beat on the intact Prism, so the clip opens on the scene.
      await api.advance(LEAD_IN_TICKS);

      // Break the shell (its band): the first pop.
      beforeShell = (await api.snapshot()).bursts.length;
      // Aimed by what the Prism currently reads as, not a hardcoded band (see
      // `readsAs`).
      await shootFromLane(api, prismId, readsAs(await api.snapshot(), prismId));
      const shell = await api.until(
        (s) => {
          beforeShell = Math.min(beforeShell, s.bursts.length);
          const d = findDrone(s, prismId);
          return d !== null && d.shellAlive === false;
        },
        { max: RESOLVE_MAX_TICKS },
      );
      afterShell = shell.snap.bursts.length;

      // Let the shell's pop play out, and the exposed core be seen, before the
      // second hit.
      await api.advance(BETWEEN_TICKS);

      // Break the core (the opposite band): the second pop.
      beforeCore = (await api.snapshot()).bursts.length;
      await shootFromLane(api, prismId, readsAs(await api.snapshot(), prismId));
      snap = (
        await api.until(
          (s) => {
            beforeCore = Math.min(beforeCore, s.bursts.length);
            return findDrone(s, prismId) === null;
          },
          { max: RESOLVE_MAX_TICKS },
        )
      ).snap;

      // Hold on the second pop so the clip ends on the detonation.
      await api.advance(72);
    },

    async assert(api, check) {
      check.expectEq("no burst before any pop", bursts0, 0);
      check.expectGt(
        "breaking the shell plays a burst",
        afterShell,
        beforeShell,
      );
      check.expectGt(
        "destroying the core plays a second burst",
        snap.bursts.length,
        beforeCore,
      );
      check.expectEq(
        "the Prism is gone after the core kill",
        findDrone(snap, prismId),
        null,
      );
    },
  };
}
