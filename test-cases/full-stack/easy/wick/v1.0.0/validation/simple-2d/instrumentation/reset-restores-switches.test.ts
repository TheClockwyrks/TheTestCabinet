// instrumentation/reset-restores-switches — with all nine driver switches
// posed off, `reset()` leaves every one true.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The driver
// switches": each "is restored to on by `reset`"; and `reset`: "every driver
// switch on". The nine are named by SWITCH_NAMES and read off the snapshot
// under the same names.
//
// THE POSE. `isolate` is exactly the disturbance: an empty run with every
// switch turned off through its own operation. The reset follows and the
// snapshot is read without a frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  SWITCH_NAMES,
  switchesOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns every switch back on", async () => {
  const off = isolate(h);
  for (const name of SWITCH_NAMES) {
    assertEqual(off[name], false, `${name} posed off before the reset`);
  }

  h.reset();
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "switches");

  const switches = switchesOf(s);
  for (const name of SWITCH_NAMES) {
    assertEqual(switches[name], true, `${name} after the reset`);
  }
});
