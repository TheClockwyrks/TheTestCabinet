// Automated validation for towers.arcnode-splash: the Arc-Node's shot detonates a discharge
// that damages every unit within its splash radius of the impact point.
//
// Arming the Arc-Node and releasing the cluster are control ops (the arrange); waiting for the
// discharge that hurts two of them at once is the behavior under test and is the act.
//
// WHAT THE CLIP SHOWS. This item is about ONE shot touching SEVERAL units, so the cluster has to
// be on screen as several units. It was not: the cluster was released with `spawnUnit`'s `count`,
// which puts every unit at the Entry on the same tick, so all four walked the corridor exactly
// superimposed — one Mote as far as the recording is concerned. That made the still worse than
// uninformative and the check hollow: "two units lost HP" is trivially true of two units at the
// same coordinates, which is not what splashing an AREA means. `arrangeSpreadPack` releases them a
// walk apart instead, at 24 px — inside a T1 Arc-Node's 42 px splash radius (`specs/towers.md`)
// and far enough apart to read as separate units, so the discharge is visibly area damage.
//
// The act then runs on well past the measurement, so a reviewer sees the discharge catch the
// cluster repeatedly rather than catching it once on the closing frame.

import { arrangeSpreadPack, hurtCount, TICK, SECOND } from "../_helpers.mjs";

// Several Arc-Node cadences (0.85 shots/s), so a build that opens on a full cooldown resolves.
const SPLASH_TICKS = 6 * SECOND;
// A beat after the detonation, so the clip carries the discharge rather than cutting on it.
const TAIL_TICKS = 3 * SECOND;

export default function item() {
  // The units followed, their pre-shot HP, whether the splash caught two, and how many.
  let ids;
  let initHp;
  let splashed;
  let hurt;

  return {
    id: "towers.arcnode-splash",

    async arrange(api) {
      ({ ids, initHp } = await arrangeSpreadPack(api, "arcnode"));
    },

    async act(api) {
      // Read every tick: a splash hurts its victims on ONE tick, and a coarser poll could land
      // after a unit had already died and left the snapshot.
      splashed = await api.until((s) => hurtCount(s, ids, initHp) >= 2, {
        max: SPLASH_TICKS,
        poll: TICK,
      });
      hurt = hurtCount(splashed.snap, ids, initHp);

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk(
        "the Arc-Node's discharge damaged at least two SEPARATED units in the cluster (splash)",
        splashed.hit,
      );
      check.expectGt("...how many of the spread cluster one discharge reached", hurt, 1);
    },
  };
}
