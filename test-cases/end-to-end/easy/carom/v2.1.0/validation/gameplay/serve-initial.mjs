// Automated validation for the Gameplay sub-item `serve-initial`.
//
// The very first serve of every match always travels toward player one (vx < 0),
// whichever player would otherwise be the receiver. Two fresh matches are started
// and each first serve's horizontal direction is read back. base and gyre both serve
// toward the receiver and drive this same shared script; multi (random-angle
// launches) declares no such point. See validation/_helpers.mjs.

import { arrangeFirstServe, actFirstServeVx } from "../_helpers.mjs";

export default function item() {
  let first1;
  let first2;

  return {
    id: "gameplay.serve-initial",

    // The first fresh match, served and waiting to fly.
    async arrange(api) {
      await arrangeFirstServe(api);
    },

    // Both first serves, so the clip shows the direction twice over. The second fresh
    // match is opened here with `startMatch`/`serve` rather than `arrangeFirstServe`:
    // that helper leads with `reset`, and a `reset` mid-`act` would take the build off
    // the clock the runtime just handed it (specs/instrumentation.md: reset and step
    // both switch to manual stepping), freezing the recording. `startMatch` alone
    // opens a match exactly as choosing it from the menu does, which is all "a second
    // fresh match" needs.
    async act(api) {
      first1 = await actFirstServeVx(api);

      await api.call("startMatch", "versus");
      await api.call("serve");
      first2 = await actFirstServeVx(api);
    },

    async assert(api, check) {
      check.expectLt(
        "the very first serve of a match travels toward player one (vx)",
        first1,
        0,
      );
      check.expectLt(
        "a second fresh match's first serve also travels toward player one (vx)",
        first2,
        0,
      );
    },
  };
}
