// Automated validation for the Hunter item `pursues`.
//
// The bear pursues the critter's position: over time the distance between them
// shrinks. The critter is fixed on the median and a bear placed a few tiles away;
// the real pursuit brain closes the gap as the simulation steps, which the
// snapshots read back. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

const manhattan = (b, c) => Math.abs(b.col - c.col) + Math.abs(b.row - c.row);

export default function item() {
  // The starting distance (measured instantly in `arrange`, before anything moves),
  // and the state a second of pursuit later.
  let d0;
  let d1;
  let s1;

  return {
    id: "hunter.pursues",

    // Pose the pursuit: the critter fixed on the solid median and a bear fifteen
    // columns away, far enough that closing the gap is unmistakable but near enough
    // that a second of pursuit shows it.
    async arrange(api) {
      await startCrossing(api);
      await api.call("placeCritter", 20, 10); // median, solid
      await api.call("setBear", 0, { col: 5, row: 10 });
      const s0 = await api.snapshot();
      d0 = manhattan(s0.bears[0], s0.critter);
    },

    // A second of the real pursuit brain closing in — what is measured, and the clip.
    async act(api) {
      await api.advance(120); // 1 s
      s1 = await api.snapshot();
      d1 = manhattan(s1.bears[0], s1.critter);
    },

    async assert(api, check) {
      check.expectLt(
        "the bear closes on the critter (distance shrinks)",
        d1,
        d0,
      );
      check.expectNe("the critter is not yet caught", s1.phase, "dying");
    },
  };
}
