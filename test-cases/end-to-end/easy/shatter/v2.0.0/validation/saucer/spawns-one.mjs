// Automated validation for the Saucer item `spawns-one`: a saucer appears on demand and
// at most one exists at a time. A saucer is spawned and confirmed present; a second spawn
// request must not replace or add another (the same saucer stays), and removing it clears
// the field.
//
// Only the clean session is a precondition (`arrange`). The spawn requests and the removal are
// the behavior under test — and they are control ops, which are legal in `act` — so they live
// there, which is also what makes the clip show the saucer arrive, stay put through a second
// request, and leave.
//
// The two spawn reads are taken back to back with NO time between them: the comparison is that
// the saucer is the same one, to within 0.001 px, and letting it fly between the reads would
// move it and break exactly the comparison being made.

import { newGame } from "../_helpers.mjs";

export default function item() {
  // The saucer after the first spawn, after the redundant second, and after removal.
  let first;
  let second;
  let removed;

  return {
    id: "saucer.spawns-one",

    async arrange(api) {
      await newGame(api);
    },

    async act(api) {
      await api.call("spawnSaucer");
      first = (await api.snapshot()).saucer;

      await api.call("spawnSaucer"); // a second request while one is already present
      second = (await api.snapshot()).saucer;

      // Let it fly so the clip shows one saucer, not a frozen frame: 1 s = 120 ticks.
      await api.advance(120);

      await api.call("removeSaucer");
      removed = (await api.snapshot()).saucer;
      await api.advance(36); // 0.3 s — hold on the cleared field
    },

    async assert(api, check) {
      check.expectOk("a saucer appears on demand", Boolean(first));
      check.expectOk("there is still a saucer", Boolean(second));
      check.expectClose(
        "no second saucer is spawned — the first is unchanged",
        second.x,
        first.x,
        0.001,
      );
      check.expectEq("the saucer can leave the field", removed, null);
    },
  };
}
