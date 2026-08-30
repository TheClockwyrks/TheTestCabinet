// Automated validation for core-run.jettison-survive.
//
// Jettisoning the Sample and fleeing beyond the blast radius survives its ground detonation; the
// Sample is destroyed but the miner lives. We extract, jettison, flee far, run past the timer, and
// confirm the miner is still alive with the Sample gone.

import {
  teleportInto,
  newRun,
  solid,
  SPAWN_COL,
  DEEPSTONE_ROW,
} from "../_helpers.mjs";

/** How far the miner retreats before the jettisoned Sample goes off, in columns. Two blast radii:
 *  `specs/items.md` puts the lethal radius at `3` tiles. Kept under 8 so the abandoned Sample stays
 *  inside the viewport's 640 px half-width and the clip shows the blast and the survivor together. */
const FLEE_TILES = 6;

/** How much of the 90-second countdown (`specs/hazards.md`) to skip before filming, in ticks:
 *  5280 ticks is 88 s, landing two seconds short of the ground detonation. One exact skip rather
 *  than a polled sweep, because the record pass films `arrange` too and each polled step is a
 *  driver round trip the build renders through — see the fuller note in `detonation-death.mjs`. */
const SKIP_TICKS = 5280;

export default function item() {
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;
  let dropped;
  let snap;

  return {
    id: "core-run.jettison-survive",

    // Extract the Sample, drop it here, retreat clear of the blast, and SKIP the countdown down to
    // its last couple of seconds — all instantly, in both passes, so the clip opens on the brink.
    //
    // The retreat is `FLEE_TILES` columns, which is two blast radii: `specs/items.md` puts the
    // jettisoned Sample's lethal radius at `3` tiles, so 6 is unambiguously clear while still
    // leaving the abandoned Sample inside the 1280-wide viewport (6 tiles is 480 px against a
    // 640 px half-width, the camera being centred on the miner). A reviewer therefore sees BOTH
    // things the item is about in one frame: the Sample going off over there, and the miner
    // standing here, alive.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await solid(api, col, row + 1);
      await teleportInto(api, col, row);
      await api.call("spawnCoreSample");
      await api.call("jettison"); // drop it on this tile; timer keeps running
      dropped = await api.snapshot();

      // Retreat. Control ops only, so this costs no time in either pass.
      await teleportInto(api, col + FLEE_TILES, row);
      await solid(api, col + FLEE_TILES, row + 1);
      await teleportInto(api, col + FLEE_TILES, row);

      await api.skip(SKIP_TICKS);
    },

    // Film the last seconds of the countdown and the detonation going off at a safe distance.
    //
    // This used to be a single `api.advance(5520)` — 92 s — after the retreat. The record pass
    // charges a call against its filming budget BEFORE it waits, so asking for 92 s of real time
    // overran the 8 s budget immediately and unwound out of `act` without pausing at all: the
    // committed baseline was a still frame of the miner standing at a 1:30 timer, and the
    // detonation this item is named for was never filmed. Skipping the wait in `arrange` and
    // advancing only the ending here is what puts the event in the clip.
    async act(api) {
      // 600 ticks = 10 s: the last seconds of the countdown, then the blast and its VFX playing
      // out. The sweep ends on the tile clearing rather than a fixed guess at the timer's zero.
      const r = await api.until((s) => s.coreTimer === null, {
        max: 600,
        poll: 6,
      });
      snap = r.snap;
      await api.advance(90); // 90 ticks = 1.5 s on the aftermath: the miner still standing
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectOk(
        "the Sample is a ground item after jettison",
        !!dropped.coreGround,
      );
      check.expectEq(
        "it is no longer carried",
        dropped.satchel.coreSample,
        false,
      );
      check.expectEq(
        "the miner survives the distant detonation",
        snap.screen,
        "in-mine",
      );
      check.expectEq("the Sample is destroyed", snap.coreGround, null);
      check.expectEq("the timer has ended", snap.coreTimer, null);
    },
  };
}
