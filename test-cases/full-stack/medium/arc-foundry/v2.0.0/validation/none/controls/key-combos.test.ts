// controls/key-combos — `KeyV` toggles the recipe book.
//
// THE REQUIREMENT. `specs/controls.md` binds `combos` to `KeyV`: "Toggles the
// recipe book", available "on `playing`, in every phase".
// `specs/instrumentation.md` reports the two read-only overlays as
// `overlays: { combos, damage }`, so the toggle is read there.
//
// HOW IT IS DECIDED. A run is opened on an empty yard, the overlays are read
// closed, and `KeyV` is pressed as a player presses it — a real browser key event
// through the build's own keyboard layer. The recipe book reads open; a second
// press and it reads closed again. The damage leaderboard is read alongside it
// each time, because a build that toggles both on one key has bound the key to
// the wrong thing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { keyFor } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the recipe book and dismisses it again on KeyV", async () => {
  await openYard(h);
  assertEqual(
    (await h.snapshot()).overlays.combos,
    false,
    "the recipe book closed before the key is touched " +
      "(specs/instrumentation.md)",
  );

  await h.tap(keyFor("combos"));
  await captureStill(h, "book");

  const opened = await h.snapshot();
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

  await h.tap(keyFor("combos"));
  assertEqual(
    (await h.snapshot()).overlays.combos,
    false,
    `pressing ${keyFor("combos")} a second time to dismiss the recipe book ` +
      "(specs/controls.md)",
  );
});
