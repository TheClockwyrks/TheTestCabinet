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
  holdDrones,
  spawnDrone,
  findDrone,
  enemyBullets,
  friendlyBullets,
} from "../_helpers.mjs";

// The witnesses are posed with ZERO velocity, so they hang on the field for the
// whole of the inversion instead of crossing it in a few frames.
//
// This is what made the old clip unreadable. The three witnesses were posed at
// their default speeds — the enemy bullet falling at 320 px/s and the player bullet
// climbing at 760 — so they were on screen for well under a second, appearing and
// leaving while the inversion overlay was still arriving. What a reviewer saw was a
// magenta drone popping into existence, a magenta streak going down and a cyan one
// going up, with no way to tell which of those was the swap and which was simply a
// magenta thing. Held still, all three sit there through the whole five seconds and
// the reviewer can read each one's color at leisure.
//
// It changes nothing the item asserts: the swap is read from `effectiveBand`, which
// is a property of the entity's band and the live inversion, not of its motion.
const STILL = { vx: 0, vy: 0 };

// Long enough for the 5 s inversion to run out, with room for the overlay to clear.
const INVERSION_END_MAX_TICKS = 780; // 6.5 s

// A beat on the restored field afterwards.
const RESTORED_HOLD_TICKS = 90;

export default function item() {
  // The inversion drive's outcome, and the field read under the live inversion.
  let r;
  let snap;
  let cyanDrone;

  return {
    // The record pass must actually reach the inversion, and the drive that triggers
    // it is a real dive with an RNG roll behind it: an attempt that loops back
    // instead of exiting can burn up to 5 s, so the default 8 s budget could stop
    // filming before the swap this item is about ever happens. The clip then has to
    // outlast the inversion itself — the whole point is watching the field swap and
    // swap back — so this covers a retried drive plus the full 5 s and a beat.
    // Verdicts are decided by the uncapped validate pass and are untouched by this.
    clipMs: 18000,

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
      // ops, so they consume no time and are legal mid-phase. The swarm is held so
      // the drone stands where it is put, alongside the two motionless bullets.
      await holdDrones(api);
      cyanDrone = await spawnDrone(api, {
        kind: "shard",
        band: "cyan",
        x: 300,
        y: 200,
        phase: "formation",
      });
      await api.call("spawnEnemyBullet", {
        x: 400,
        y: 300,
        band: "cyan",
        ...STILL,
      });
      await api.call("spawnPlayerBullet", {
        x: 500,
        y: 400,
        band: "cyan",
        ...STILL,
      });

      snap = await api.snapshot();

      // Now let the inversion RUN OUT with the three witnesses still standing there.
      //
      // This is what makes the clip legible, and it is the only way a still field
      // can show a SWAP rather than just a color. All three entities are stored
      // cyan; while the inversion holds, the drone and the enemy bullet are drawn
      // magenta and the player bullet stays cyan; when it lapses, the first two turn
      // back to cyan and the player bullet does not change at all. The reviewer sees
      // the same three objects before and after, so which of them the inversion
      // touches — and which it pointedly does not — reads off the screen instead of
      // having to be taken on trust from the verdict.
      await api.until((s) => !s.inversionActive, {
        max: INVERSION_END_MAX_TICKS,
        poll: 12,
      });
      await api.advance(RESTORED_HOLD_TICKS);
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
