// Automated validation for the Drones sub-item `inversion-swap`.
//
// While an inversion is active the two bands are swapped across the whole field:
// every drone and enemy bullet reads as the opposite band, while a player bullet is
// never inverted. A real inversion is triggered (arrangeInversion/actInversion);
// then a stored-cyan drone, a cyan enemy bullet, and a cyan player bullet are posed
// and their EFFECTIVE bands read back — the swap is computed by the real systems,
// not fabricated.

import {
  arrangeInversion,
  actInversion,
  spawnDrone,
  findDrone,
  enemyBullets,
  friendlyBullets,
} from "../_helpers.mjs";

export default function item() {
  // The inversion drive's outcome, and the field read under the live inversion.
  let r;
  let snap;
  let cyanDrone;

  return {
    // The record pass must actually reach the inversion, and the drive that triggers
    // it is a real dive with an RNG roll behind it: an attempt that loops back
    // instead of exiting can burn up to 5 s, so the default 8 s budget could stop
    // filming before the swap this item is about ever happens. 10 s leaves room for
    // a second attempt. Verdicts are decided by the uncapped validate pass and are
    // untouched by this.
    clipMs: 10000,

    id: "drones.inversion-swap",

    // A clean, seeded stage-1 wave with an empty field, ready for the drive.
    async arrange(api) {
      await arrangeInversion(api);
    },

    async act(api) {
      // Drive a real Prism dive out through the bottom of the field until one
      // triggers a genuine inversion. This is the whole scenario and the whole clip.
      r = await actInversion(api);

      // Pose a stored-cyan drone and cyan bullets of each kind (no advance: read the
      // field-wide swap the active inversion computes right now). These are control
      // ops, so they consume no time and are legal mid-phase.
      cyanDrone = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 300,
        y: 200,
        phase: "formation",
      });
      await api.call("spawnEnemyBullet", { x: 400, y: 300, band: "cyan" });
      await api.call("spawnPlayerBullet", { x: 500, y: 400, band: "cyan" });

      snap = await api.snapshot();

      // Hold on the inverted field so the reviewer can see the swap on screen
      // rather than only in the verdict. Everything above is already captured.
      await api.advance(120); // 120 ticks (1 s) of the field reading inverted
    },

    async assert(api, check) {
      check.expectOk("an inversion is active", r.hit && r.snap.inversionActive);

      const d = findDrone(snap, cyanDrone);
      check.expectEq("a stored-cyan drone still stores cyan", d.band, "cyan");
      check.expectEq(
        "a stored-cyan drone reads as magenta under inversion",
        d.effectiveBand,
        "magenta",
      );

      const eb = enemyBullets(snap).find((b) => b.band === "cyan");
      check.expectOk("a cyan enemy bullet is on the field", eb !== undefined);
      if (eb)
        check.expectEq(
          "a cyan enemy bullet reads as magenta under inversion",
          eb.effectiveBand,
          "magenta",
        );

      const pb = friendlyBullets(snap).find((b) => b.band === "cyan");
      check.expectOk("a cyan player bullet is on the field", pb !== undefined);
      if (pb)
        check.expectEq(
          "a player bullet is never inverted",
          pb.effectiveBand,
          "cyan",
        );
    },
  };
}
