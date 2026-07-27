// Automated validation for the Building sub-item `place-stays-armed`.
//
// After placing a tower the shop stays armed with the same type, so a run of copies
// can be laid down in a row (specs/controls.md). We arm a tower, place it, and confirm
// it is built and still armed with the same type.
//
// Both ways of committing a placement are checked, because the debug API specifies
// them as one path: `place()` "stays armed afterward, as in normal play", and
// `placeTower` is "a shorthand for arming `type`, rotating it to `rotation`, moving
// the preview to `(col, row)`, and placing it, all through the same placement code"
// (specs/instrumentation.md). A build whose shorthand quietly drops the held
// placement has diverged from the contract on the operation every other item uses to
// lay out its floor.

import { newGame, restartGame } from "../_helpers.mjs";

export default function item() {
  let s;
  let viaShorthand;

  return {
    id: "building.place-stays-armed",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // The placement itself is what this item shows: arm, move the preview, place —
    // and read the shop's state straight after, while it is still armed.
    //
    // Then the same commit through the `placeTower` shorthand, from a FRESH match so
    // nothing is armed going in. That is the whole point of the second read: the
    // shorthand has to do the arming itself, and a build that merely preserves a
    // placement someone else armed would sail through this check if it ran on the
    // back of the sequence above.
    async act(api) {
      await api.call("armTower", "arc");
      await api.call("movePreview", 10, 10);
      await api.call("place");
      s = await api.snapshot();

      await restartGame(api, "containment", "medium", 100000);
      await api.call("placeTower", "arc", 14, 10, 0);
      viaShorthand = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("the tower was built", s.towers.length, 1);
      check.expectOk("the shop is still armed after placing", s.build !== null);
      check.expectEq(
        "still armed with the same type",
        s.build ? s.build.type : null,
        "arc",
      );
      check.expectEq(
        "the placeTower shorthand also builds",
        viaShorthand.towers.length,
        1,
      );
      check.expectEq(
        "the placeTower shorthand also leaves the type held",
        viaShorthand.build ? viaShorthand.build.type : null,
        "arc",
      );
    },
  };
}
