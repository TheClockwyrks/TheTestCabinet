// Automated validation for the Hunter item `stays-ahead`.
//
// Steady forward hopping down a clear column reaches the far shore without being
// caught — the bear is a touch slower than a cleanly-played critter. A safe
// corridor is built at a bay column and the critter climbs it with a held key while
// a bear trails; the real pursuit never catches it before it completes the
// crossing. See validation/_helpers.mjs.

import { startCrossing, buildSafeColumn } from "../_helpers.mjs";

export default function item() {
  // Whether the climb ended in a death, the sweep that watched it, and the lives left
  // at the end.
  let dead;
  let r;
  let finalLives;

  return {
    id: "hunter.stays-ahead",

    // Build the clean corridor at a bay column and stand the critter at its foot, so
    // the climb meets no traffic and the only thing that could stop it is the bear.
    async arrange(api) {
      await startCrossing(api);
      await buildSafeColumn(api, 19); // col 19 is bay 2's left tile
      await api.call("placeCritter", 19, 19);
    },

    // Hold Up and let the real climb race the real pursuit all the way to the bay —
    // the whole point of the item, and the clip.
    async act(api) {
      dead = false;
      await api.call("keyDown", "ArrowUp");
      r = await api.until(
        (s) => {
          if (s.phase === "dying") {
            dead = true;
            return true;
          }
          return s.bays[2] === true || s.phase === "clearing";
        },
        { max: 720, poll: 6 }, // 6 s at a 0.05 s cadence
      );
      await api.call("keyUp", "ArrowUp");
      finalLives = (await api.snapshot()).lives;
    },

    async assert(api, check) {
      check.expectOk("a cleanly-hopped crossing is completed", r.hit && !dead);
      check.expectOk("the bear never caught the fast critter", !dead);
      check.expectEq("the crossing kept all lives", finalLives, 3);
    },
  };
}
