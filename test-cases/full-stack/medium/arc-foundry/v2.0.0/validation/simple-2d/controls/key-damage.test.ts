// controls/key-damage — `KeyL` toggles the damage leaderboard.
//
// THE REQUIREMENT. `specs/controls.md` binds `damage` to `KeyL`: "Toggles the
// damage leaderboard." `specs/hud.md` makes the leaderboard one of the two
// read-only overlays, and `specs/instrumentation.md` reports both of them as
// `overlays: { combos, damage }`, so the toggle is read there.
//
// HOW IT IS DECIDED. A run is opened on an empty yard with both overlays closed,
// and the key is pressed as a player presses it, a real key event dispatched at
// the engine's own surface. The leaderboard opens; the key is pressed again and it
// dismisses. The OTHER overlay is read at the same time, because a build that
// toggles both on one key has bound the wrong thing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  pressAction,
} from "../harness";
import { keyFor } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens the damage leaderboard and dismisses it again on KeyL", async () => {
  openYard(h);
  assertEqual(
    h.snapshot().overlays.damage,
    false,
    "the damage leaderboard closed before the key is touched " +
      "(specs/instrumentation.md)",
  );

  await pressAction(h, "damage");
  captureStill(h, "board");

  const opened = h.snapshot();
  assertEqual(
    opened.overlays.damage,
    true,
    `pressing ${keyFor("damage")} to open the damage leaderboard ` +
      "(specs/controls.md)",
  );
  assertEqual(
    opened.overlays.combos,
    false,
    "the recipe book, which the leaderboard's key does not touch " +
      "(specs/controls.md)",
  );

  await pressAction(h, "damage");
  assertEqual(
    h.snapshot().overlays.damage,
    false,
    `pressing ${keyFor("damage")} a second time to dismiss the damage ` +
      "leaderboard (specs/controls.md)",
  );
});
