// Automated validation for the Building sub-item `place-stays-armed`.
//
// After placing a tower the shop stays armed with the same type, so a run of copies
// can be laid down in a row (specs/controls.md). We arm a tower, place it, and confirm
// it is built and still armed with the same type.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let s;

  return {
    id: "building.place-stays-armed",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // The placement itself is what this item shows: arm, move the preview, place —
    // and read the shop's state straight after, while it is still armed.
    async act(api) {
      await api.call("armTower", "arc");
      await api.call("movePreview", 10, 10);
      await api.call("place");
      s = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("the tower was built", s.towers.length, 1);
      check.expectOk("the shop is still armed after placing", s.build !== null);
      check.expectEq(
        "still armed with the same type",
        s.build ? s.build.type : null,
        "arc",
      );
    },
  };
}
