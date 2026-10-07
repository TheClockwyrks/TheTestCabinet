// screens/fresh-run-state — a fresh run starts from the specified state.
//
// WHAT THIS DECIDES. One thing: the run `LIGHT THE LAMP` starts holds exactly
// the values specs/ui.md's fresh run fixes, field for field. That the title's
// first item is the door to `playing` at all is its own point; this one is
// about what is behind the door.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("A fresh run"): "A fresh run has the run clock at `0:00`, the
//   lamplighter at the world origin `(0, 0)` with `hp = BASE_MAX_HP` (`100`)
//   and `facing = "right"`, level `1` with `xp = 0` and `kills = 0`, Taper at
//   level `1` alone in the first weapon slot and no passive held, no enemy,
//   projectile, zone, gem, or pickup in the world, no level-up queued, and the
//   spawn timer at `0`".
//   specs/state.md ("The idle run"): the table this builds on, with `offers`
//   empty, `nextOffers` `null`, `chestResult` `null`, `firedEvents` empty, and
//   `nextId` `0`; "A fresh run is the idle run with Taper at level `1` and
//   cooldown `0` in the first weapon slot." Both are restated as `FRESH_RUN`.
//   specs/state.md (`WeaponSlot`): a weapon's cooldown "is `0` on acquisition
//   ... so a weapon fires on the first `playing` tick it is held".
//
// THE DRIVE, AND WHY THE FRAME IS SHORT. A reset to the title leaves the
// highlight on `LIGHT THE LAMP`, and one `Enter` is delivered on a frame of
// half a tick. A frame whose press enters `playing` "runs that frame's ticks"
// (specs/controls.md), and the run's first tick spawns the director's first
// window, since "`spawnTimer` ... is `0` when a run starts"
// (specs/state.md), so a full frame would read a world the fresh run does not
// describe. Half a tick delivers the same edge and consumes none, since "A tick
// is consumed while the accumulator is at least `TICK_DT − TICK_EPSILON`"
// (specs/instrumentation.md), so what is read is the run the transition built.
//
// THE TOLERANCE. None: every field of the fresh run is a whole figure the
// specification states, compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { FRESH_RUN } from "../constants";
import {
  captureStill,
  createHarness,
  runFields,
  tapWithoutTick,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("starts the run from the state specs/ui.md fixes", async () => {
  h.reset();
  assertEqual(h.snapshot().screen, "title", "the screen Enter is pressed on");

  const after = await tapWithoutTick(h, "Enter");
  captureStill(h, "fresh");

  assertEqual(after.screen, "playing", "the screen the fresh run opened on");
  assertDeepEqual(
    runFields(after.run),
    FRESH_RUN,
    "the fresh run specs/ui.md fixes, field for field",
  );
});
