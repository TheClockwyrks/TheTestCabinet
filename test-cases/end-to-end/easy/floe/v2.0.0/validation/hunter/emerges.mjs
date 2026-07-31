// Automated validation for the Hunter item `emerges`.
//
// No bear is present at the start of a crossing; one emerges from the near shore
// only once the critter has advanced a few rows. A fresh crossing shows no bear;
// after the critter is advanced (onto a cleared, safe row) the real emerge logic
// brings a bear out, which the snapshot reads back. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // Whether a bear was present at the very start of the crossing (read instantly in
  // `arrange`, before the critter is advanced), and the sweep that waited for one.
  let bearAtStart;
  let r;

  return {
    id: "hunter.emerges",

    // A fresh crossing shows no bear; then advance the critter a few rows onto a
    // cleared, safe tile, which is the precondition the emerge logic is waiting on.
    async arrange(api) {
      await startCrossing(api);
      bearAtStart = (await api.snapshot()).bears[0].present;
      await api.call("setLane", 15, { cols: [] }); // a safe tile for the advanced critter
      await api.call("placeCritter", 20, 15); // advance a few rows
    },

    // Wait for the real emerge logic to bring a bear out of the near shore — the
    // moment the clip should show. (The old clip drove a held-key climb instead;
    // the assertions drove the posed advance, so that is what is filmed.)
    // The window is deliberately generous. specs/hunter.md fixes only that the bear
    // emerges "after a short delay", once the critter "has advanced a few tiles" — it
    // pins no number, so the delay is the build's own call and a window sized to one
    // particular build's constant would fail another build that is equally correct,
    // just slower off the mark. What is under test is that the bear DOES emerge, so
    // the sweep allows several seconds; a build that never emerges still fails.
    async act(api) {
      r = await api.until((s) => s.bears[0].present, { max: 600, poll: 6 }); // 5 s at 0.05 s
    },

    async assert(api, check) {
      check.expectEq("no bear at the start of a crossing", bearAtStart, false);
      check.expectOk("the bear emerges once the critter has advanced", r.hit);
      check.expectEq("the bear is now present", r.snap.bears[0].present, true);
    },
  };
}
