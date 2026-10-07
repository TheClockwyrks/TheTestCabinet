// controls/key-damage — `KeyL` toggles the damage leaderboard.
//
// THE REQUIREMENT. `specs/controls.md` binds `damage` to `KeyL`: "Toggles the
// damage leaderboard", available "on `playing`, in every phase".
// `specs/instrumentation.md` reports the two read-only overlays as
// `overlays: { combos, damage }`, so the toggle is read there.
//
// HOW IT IS DECIDED. A run is opened on an empty yard, the overlays are read
// closed, and `KeyL` is pressed as a player presses it — a real browser key event
// through the build's own keyboard layer. The leaderboard reads open; a second
// press and it reads closed again. The recipe book is read alongside it each time,
// because a build that toggles both on one key has bound the key to the wrong
// thing.

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

it("opens the damage leaderboard and dismisses it again on KeyL", async () => {
  await openYard(h);
  assertEqual(
    (await h.snapshot()).overlays.damage,
    false,
    "the damage leaderboard closed before the key is touched " +
      "(specs/instrumentation.md)",
  );

  await h.tap(keyFor("damage"));
  await captureStill(h, "board");

  const opened = await h.snapshot();
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

  await h.tap(keyFor("damage"));
  assertEqual(
    (await h.snapshot()).overlays.damage,
    false,
    `pressing ${keyFor("damage")} a second time to dismiss the damage ` +
      "leaderboard (specs/controls.md)",
  );
});
