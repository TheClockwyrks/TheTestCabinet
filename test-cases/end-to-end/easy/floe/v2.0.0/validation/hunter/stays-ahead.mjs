// Automated validation for the Hunter item `stays-ahead`.
//
// Steady forward hopping down a clear column reaches the far shore without being
// caught — the bear is a touch slower than a cleanly-played critter. A safe
// corridor is built at a bay column and the critter climbs it with a held key while
// a bear trails; the real pursuit never catches it before it completes the
// crossing. See validation/_helpers.mjs.

import { startCrossing, buildSafeColumn, BAY_COL } from "../_helpers.mjs";

// The bay this crossing climbs to, and the column its opening straddles under either
// reading of specs/playfield.md's layout (see `BAY_COL`).
//
// The corridor used to be built at one reading's LEFT column, which is solid shore on a
// build that read the sentence the other way: its critter climbed the whole strait
// cleanly, was correctly refused at the wall, and the item reported that the bear had
// caught it. That is a verdict about the bay layout wearing the hunter's name — and the
// layout has an item of its own.
const BAY_INDEX = 2;
const COL = BAY_COL[BAY_INDEX];

// How far the bear must actually travel during the climb for "it never caught the
// critter" to mean anything, in px. THIS ITEM'S CLAIM IS NEGATIVE — the bear does not
// catch a cleanly-played critter — and a negative claim is satisfied trivially by a
// bear that cannot move at all. Without this, a build whose pursuit is completely
// broken passes an item about pursuit being FAIR, and reads to a reviewer as a
// balanced chase that was never driven.
//
// The reference covers ~140 px of the climb, so a tile is a wide margin for a build
// that pursues at all, while a bear stuck in place (jittering a fraction of a pixel
// and being dragged back) falls far short.
const MIN_BEAR_PATH_PX = 32;

export default function item() {
  // Whether the climb ended in a death, the sweep that watched it, the lives left at
  // the end, and how far the bear actually covered while trailing.
  let dead;
  let r;
  let finalLives;
  let bearPath;

  return {
    id: "hunter.stays-ahead",

    // Build the clean corridor at a bay column and stand the critter at its foot, so
    // the climb meets no traffic and the only thing that could stop it is the bear.
    async arrange(api) {
      await startCrossing(api);
      await buildSafeColumn(api, COL);
      await api.call("placeCritter", COL, 19);
    },

    // Hold Up and let the real climb race the real pursuit all the way to the bay —
    // the whole point of the item, and the clip.
    async act(api) {
      dead = false;
      bearPath = 0;
      // The bear's position at the previous sample, for accumulating its path.
      let prevBear = null;
      await api.call("keyDown", "ArrowUp");
      r = await api.until(
        (s) => {
          // Accumulate the trailing bear's real travel as the sweep polls, so the
          // "never caught" verdict is only credited to a bear that was chasing.
          const bear = s.bears[0];
          if (bear?.present) {
            if (prevBear) {
              bearPath += Math.hypot(bear.x - prevBear.x, bear.y - prevBear.y);
            }
            prevBear = bear;
          }
          if (s.phase === "dying") {
            dead = true;
            return true;
          }
          return s.bays[BAY_INDEX] === true || s.phase === "clearing";
        },
        { max: 720, poll: 6 }, // 6 s at a 0.05 s cadence
      );
      await api.call("keyUp", "ArrowUp");
      finalLives = (await api.snapshot()).lives;
    },

    async assert(api, check) {
      check.expectOk("a cleanly-hopped crossing is completed", r.hit && !dead);
      check.expectOk("the bear never caught the fast critter", !dead);
      check.expectGt(
        "the bear was actually chasing (not stuck in place)",
        bearPath,
        MIN_BEAR_PATH_PX,
      );
      check.expectEq("the crossing kept all lives", finalLives, 3);
    },
  };
}
