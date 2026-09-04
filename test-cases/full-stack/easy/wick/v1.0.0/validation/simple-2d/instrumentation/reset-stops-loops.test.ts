// instrumentation/reset-stops-loops — with music and hum both looping,
// `reset()` followed by one frame leaves neither cue looping.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `reset`: "Any
// looping cue stops on the next `update`, since the state it restores holds no
// run". specs/ui.md, "The loops": `music` "is looping on every frame exactly
// when `screen` is `playing`, `levelup`, `chest`, or `paused`", `hum` "exactly
// when `screen` is `playing` and a held weapon is `halo` or `corona`", and
// "Both loops are reconciled from the state on every frame".
//
// THE POSE. An isolated run holding Halo, and one frame: the reconciliation
// starts both loops. Then the reset and one frame more, and the engine's cue
// bus, which announces every loop start and stop, reports neither looping.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stops both loops on the frame after the reset", async () => {
  isolate(h);
  holdWeapon(h, "halo", 1);
  await h.tick(1);
  assertEqual(h.looping("music"), true, "music looping on the posed run");
  assertEqual(h.looping("hum"), true, "hum looping with Halo held");

  h.reset();
  await h.tick(1);
  captureStill(h, "silenced");

  assertEqual(
    h.looping("music"),
    false,
    "music looping after the reset's frame",
  );
  assertEqual(h.looping("hum"), false, "hum looping after the reset's frame");
});
