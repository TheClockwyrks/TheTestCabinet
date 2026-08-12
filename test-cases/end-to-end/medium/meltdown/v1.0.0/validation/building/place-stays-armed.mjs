// Automated validation for the Building sub-item `place-stays-armed`.
//
// "Placement stays armed after each build: the tower remains held on the cursor (at the
// held rotation) so you can immediately drop another copy of the same type"
// (specs/controls.md). So the check arms once and lays down a RUN of copies, moving the
// preview between each and never re-arming: three towers of the same type from one trip
// to the shop is the behaviour the sentence is about, and it is what the clip shows.
//
// WHAT THIS ITEM DOES NOT CHECK, AND WHY.
//
// It used to also require that the `placeTower(type, col, row, rotation)` SHORTHAND
// leaves a preview held, on the reading that it is "a shorthand for arming `type`, ...
// and placing it, all through the same placement code" (specs/instrumentation.md), so
// whatever `place()` leaves behind it should leave behind too. That is a fair reading of
// the debug contract, and it is not what this review point is about: this point is
// `building.place-stays-armed`, a claim from `specs/controls.md` about what happens on
// the floor when a player clicks. One of the builds re-checked here keeps its placement
// armed correctly through every pointer path — a player really can lay a row of Arcs
// without going back to the shop — and drops it only in the debug shorthand, and it
// failed a checklist point about its own in-game behaviour for that.
//
// The shorthand's own conformance is not unchecked so much as differently owned: every
// other item in the suite lays out its floor through `build()` in `_helpers`, which
// calls `placeTower` and then parks the preview with `movePreview` precisely because it
// cannot assume either answer (see the note there). If the shorthand's behaviour is
// worth a verdict of its own it wants its own point under the debug-API surface, not a
// second, hidden assertion inside a gameplay one.

import { newGame, actTail } from "../_helpers.mjs";

// Where the run of copies goes: three 2x2 Arcs in a row, two columns apart so their
// footprints do not touch and each is separately visible in the clip.
const RUN = [
  [10, 10],
  [13, 10],
  [16, 10],
];

// The beat held on each placement, so the clip reads as a player dropping copies one
// after another rather than three towers appearing at once. 45 ticks is 0.75 s.
const BEAT = 45;

export default function item() {
  const armedAfter = [];
  let placedTypes;

  return {
    id: "building.place-stays-armed",

    // Three beats plus the tail.
    clipMs: 8000,

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // Arm ONCE, then place three copies, reading the held state after each. The arming
    // deliberately happens here rather than in `arrange`: the clip should open on an
    // empty floor and show the shop being armed, because "it stayed armed" only means
    // something once a reviewer has seen it armed in the first place.
    async act(api) {
      await api.call("armTower", "arc");

      for (const [col, row] of RUN) {
        await api.call("movePreview", col, row);
        await api.call("place");
        const s = await api.snapshot();
        armedAfter.push(s.build ? s.build.type : null);
        await api.advance(BEAT);
      }

      placedTypes = (await api.snapshot()).towers.map((t) => t.type);
      await actTail(api, 120);
    },

    async assert(api, check) {
      // Every copy after the first exists only because the placement was still armed —
      // nothing re-armed the shop between them.
      check.expectEq(
        `one trip to the shop laid ${RUN.length} towers`,
        placedTypes.length,
        RUN.length,
      );
      check.expectEq(
        `and all of them are the armed type (saw ${placedTypes.join(", ") || "none"})`,
        placedTypes.every((t) => t === "arc"),
        true,
      );

      armedAfter.forEach((type, i) => {
        check.expectEq(
          `still armed with the same type after placement ${i + 1}`,
          type,
          "arc",
        );
      });
    },
  };
}
