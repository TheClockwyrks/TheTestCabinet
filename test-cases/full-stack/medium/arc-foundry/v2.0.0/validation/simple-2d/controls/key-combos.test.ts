// controls/key-combos — `KeyV` toggles the recipe book.
//
// THE REQUIREMENT. `specs/controls.md` binds `combos` to `KeyV`: "Toggles the
// recipe book." `specs/hud.md` makes the book one of the two read-only overlays,
// and `specs/instrumentation.md` reports both of them as
// `overlays: { combos, damage }`, so the toggle is read there.
//
// HOW IT IS DECIDED. A run is opened on an empty yard with both overlays closed,
// and the key is pressed as a player presses it, a real key event dispatched at
// the engine's own surface. The book opens; the key is pressed again and it
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

it("opens the recipe book and dismisses it again on KeyV", async () => {
  openYard(h);
  assertEqual(
    h.snapshot().overlays.combos,
    false,
    "the recipe book closed before the key is touched " +
      "(specs/instrumentation.md)",
  );

  await pressAction(h, "combos");
  captureStill(h, "book");

  const opened = h.snapshot();
  assertEqual(
    opened.overlays.combos,
    true,
    `pressing ${keyFor("combos")} to open the recipe book (specs/controls.md)`,
  );
  assertEqual(
    opened.overlays.damage,
    false,
    "the damage leaderboard, which the recipe book's key does not touch " +
      "(specs/controls.md)",
  );

  await pressAction(h, "combos");
  assertEqual(
    h.snapshot().overlays.combos,
    false,
    `pressing ${keyFor("combos")} a second time to dismiss the recipe book ` +
      "(specs/controls.md)",
  );
});
