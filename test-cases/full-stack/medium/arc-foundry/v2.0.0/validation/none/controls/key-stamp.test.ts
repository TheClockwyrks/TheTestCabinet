// controls/key-stamp — `KeyB` pulls the press and arms a rock.
//
// THE REQUIREMENT. `specs/controls.md` binds the `stamp` action to `KeyB` and
// says what it does: "Pulls the press and arms a rock." `specs/scrap-press.md`
// adds what an armed rock is — blank, held on the cursor, with no type and no
// quality until it lands — and that arming costs nothing, because "the roll
// happens only on a successful drop". `specs/instrumentation.md` has the snapshot
// report the cursor as `held`, so the arming is read there.
//
// HOW IT IS DECIDED. A run is opened on an empty yard at a build phase, which is
// where `specs/controls.md` makes `stamp` available, and the key is pressed as a
// player presses it: a real browser key event on the page, delivered through the
// build's own keyboard layer, which is the layer this point is about. The held
// state is read before and after, and the stamp allowance with it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { keyFor, STAMPS_PER_LEVEL } from "../constants";
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

it("arms a blank rock on the cursor when KeyB is pressed", async () => {
  await openYard(h);

  const before = await h.snapshot();
  assertEqual(
    before.held.active,
    false,
    "nothing held on the cursor before the press key is touched " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    before.phase,
    "build",
    "a build phase, which is where `stamp` is available (specs/controls.md)",
  );

  await h.tap(keyFor("stamp"));
  await captureStill(h, "armed");

  const armed = await h.snapshot();
  assertEqual(
    armed.held.active,
    true,
    `pressing ${keyFor("stamp")} in a build phase to arm a rock on the cursor ` +
      "(specs/controls.md)",
  );
  // The rock is BLANK: it has no type and no quality until it lands, and pulling
  // the press spends nothing, because the roll happens only on a successful drop
  // (specs/scrap-press.md).
  assertNull(
    armed.nextRoll,
    "an armed rock to carry no rolled component yet (specs/scrap-press.md)",
  );
  assertEqual(
    armed.stampsLeft,
    STAMPS_PER_LEVEL,
    "the stamp allowance after arming but before dropping " +
      "(specs/scrap-press.md)",
  );
});
