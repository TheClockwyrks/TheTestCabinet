// Automated validation for towers.coil-chain: the Coil's bolt leaps from the struck unit to
// nearby extra units, so one shot damages several units in a pack.
//
// Arming the Coil and releasing the pack are control ops (the arrange); waiting for the bolt
// that forks through two of them is the behavior under test and is the act.
//
// WHAT THE CLIP SHOWS. This item is about ONE shot touching SEVERAL units, so the pack has to be
// on screen as several units. It was not: the pack was released with `spawnUnit`'s `count`, which
// puts every unit at the Entry on the same tick, so all four walked the corridor exactly
// superimposed — one Mote as far as the recording is concerned, with the fork invisible and the
// check satisfied by two units standing in the same spot. `arrangeSpreadPack` releases them a
// walk apart instead, so the bolt is seen leaping ACROSS a gap to a unit that is plainly a
// different unit. See `_helpers.mjs` for the spacing and why it is 24 px.
//
// The act then runs on well past the measurement, so a reviewer sees the fork happen repeatedly
// across the pack rather than catching it once on the closing frame.

import { arrangeSpreadPack, hurtCount, TICK, SECOND } from "../_helpers.mjs";

// Several Coil cadences (1.0 shots/s), so a build that opens on a full cooldown still resolves.
const CHAIN_TICKS = 6 * SECOND;
// A beat after the fork, so the clip carries the leap rather than cutting on it.
const TAIL_TICKS = 3 * SECOND;

export default function item() {
  // The units followed, their pre-shot HP, whether the bolt caught two of them, and how many.
  let ids;
  let initHp;
  let chained;
  let hurt;

  return {
    id: "towers.coil-chain",

    async arrange(api) {
      ({ ids, initHp } = await arrangeSpreadPack(api, "coil"));
    },

    async act(api) {
      // Read every tick: a chain lands on ONE tick, and a coarser poll could land after a unit
      // had already died and left the snapshot.
      chained = await api.until((s) => hurtCount(s, ids, initHp) >= 2, {
        max: CHAIN_TICKS,
        poll: TICK,
      });
      hurt = hurtCount(chained.snap, ids, initHp);

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk(
        "the Coil's bolt chained, damaging at least two SEPARATED units in the pack",
        chained.hit,
      );
      check.expectGt("...how many of the spread pack one volley reached", hurt, 1);
    },
  };
}
