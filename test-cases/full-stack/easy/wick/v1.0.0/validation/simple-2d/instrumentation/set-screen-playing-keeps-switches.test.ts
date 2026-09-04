// instrumentation/set-screen-playing-keeps-switches — with spawning and
// weaponFire posed off, `setScreen('playing')` leaves both off, because the
// switches are held outside the run.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The driver
// switches": each "is left as it stands by `setScreen`"; `setScreen`: "the
// driver switches all stand exactly as they were"; "Snapshot shape": "The nine
// switches sit beside `muted`, outside `run`, and a fresh run leaves them as
// they stand".
//
// THE POSE. A reset (every switch on), two switches off through their own
// operations, then the pose from the title. The two read false and the other
// seven true, so a pose that restored the switches fails and one that dropped
// the rest with them fails too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  disable,
  SWITCH_NAMES,
  switchesOf,
  type Harness,
} from "../harness";

const OFF = ["spawning", "weaponFire"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries the posed switches across the pose", async () => {
  h.reset();
  disable(h, ...OFF);

  h.debug.setScreen("playing");
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "switches");

  assertEqual(s.screen, "playing", "the screen after the pose");
  const switches = switchesOf(s);
  for (const name of SWITCH_NAMES) {
    const expected = !(OFF as readonly string[]).includes(name);
    assertEqual(switches[name], expected, `${name} across the pose`);
  }
});
