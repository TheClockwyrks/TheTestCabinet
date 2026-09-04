// Meltdown — controls/rotate-key: KeyR advances the held rotation one step, and
// wraps.
//
// specs/controls.md binds `rotate` to `KeyR` and gives it the effect "Turns the
// held preview one step." specs/building.md fixes what a step is: "While a preview
// is held, rotating advances the held rotation one step through `0`, `1`, `2`, `3`
// and back to `0`". specs/instrumentation.md reports the held rotation as
// `build.rotation`.
//
// ALL FOUR STARTING STEPS, BECAUSE THE WRAP IS PART OF THE SAME RULE. The item's
// own description names both halves — "advances the held rotation one step and
// wraps from 3 to 0" — and the two are one arithmetic: `(rotation + 1) mod 4`. A
// build that added one without the modulus is correct on three of the four starts
// and wrong on the fourth, so reading only one start would leave that build
// passing. Each start is posed outright and read on its own, and a failure names
// the step it came from.
//
// WHAT THE HELD ROTATION IS *FOR* IS NOT READ HERE. specs/towers.md turns a
// tower's radiator faces with its placement rotation, and
// `building.placed-at-the-held-rotation` is the item that reads a placed tower's
// world faces. This point reads the held number and nothing else, so a build with
// a working key and a broken face rotation fails there and not here.
//
// THE ROTATION IS POSED, NOT WALKED. `setPreviewRotation` sets the held rotation
// outright (specs/instrumentation.md), so the reading for start `3` does not rest
// on the three presses that would otherwise have reached it. A build whose key
// fires twice, or not at all, therefore fails on the step it broke rather than on
// every step after it.
//
// AN ARC IS HELD, because a rotation is only meaningful on a tower that has
// faces to turn: specs/towers.md gives movers no rotation. The Arc is the first
// emitter in the shop and the cheapest, and the money posed clears its build cost
// so nothing here brushes against specs/hud.md's disabled entry.
//
// THE WORLD IS AN EMPTY, QUIET, LIVE RUN. `startRun` empties both rosters and
// shuts the world gate, so nothing on the floor and no arriving unit can touch
// the held preview while the four presses are read.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, TOWER_DEFS, type Rotation } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { FREE_SITE } from "../fixtures";

/** The key specs/controls.md binds `rotate` to, and the only one. */
const KEY = BINDINGS.rotate;

/** The type held: the first emitter in the shop, which has faces to turn. */
const TYPE = "arc";

/** The four rotations specs/building.md steps through, each a starting point. */
const STARTS: readonly Rotation[] = [0, 1, 2, 3];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("advances the held rotation one step from each of the four, wrapping at three", async () => {
  await startRun(h);
  await h.debug.setMoney(TOWER_DEFS[TYPE].cost);
  await h.debug.setArmed(TYPE);
  await h.debug.setPreview(FREE_SITE.col, FREE_SITE.row);
  await h.advance(1);

  for (const start of STARTS) {
    await h.debug.setPreviewRotation(start);
    await h.advance(1);

    await h.tap(KEY);
    await h.advance(1);
    const after = await h.snapshot();
    // Overwritten by each pass, so the picture kept is the last step driven.
    await captureStill(h, "rotated");

    assertEqual(
      after.build?.rotation ?? null,
      (start + 1) % 4,
      `${KEY}: the held rotation after one press from ${start}`,
    );
  }
});
