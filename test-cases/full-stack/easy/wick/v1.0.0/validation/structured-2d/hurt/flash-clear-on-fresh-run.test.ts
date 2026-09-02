// hurt/flash-clear-on-fresh-run — a fresh run starts with no hurt flash, even
// when the run it replaced ended with one running.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "A fresh run":
// "`LIGHT THE LAMP`, `TRY AGAIN`, and the debug surface's
// `setScreen("playing")` each begin a fresh run, and whatever the previous run
// held is discarded. A fresh run has the run clock at `0:00`, the lamplighter
// at the world origin `(0, 0)` with `hp = BASE_MAX_HP` (`100`),
// `facing = "right"`, and `hurtFlash` at `0`". `specs/world.md`, Contact
// damage, says the same of the timer: "It is `0` on the idle run and on a
// fresh run." `specs/ui.md`, "`fallen` and `dawn`", makes `TRY AGAIN` the item
// the arrival highlights, and `specs/controls.md` binds `confirm` to `Enter`.
//
// WHAT IS READ, AND WHY. `run.hurtFlash` on the fresh run the confirmation
// began. The reading only decides anything if the run it replaced was carrying
// a flash, so the flash the ending run holds is read first: a build that
// carries the old timer into the new run is exactly what this point is about,
// and it is invisible unless the old timer was running.
//
// THE DRIVE. The shared pose lands one contact hit, so the flash is at
// `HURT_FLASH`; every enemy is then cleared, so nothing rearms it; `hp` is
// posed to `0` and one tick runs, which `specs/world.md` ends the run fallen
// at the end of. The flash has counted one tick down by then and is still well
// above `0`. Then one real `Enter` on `TRY AGAIN`.
//
// THE TOLERANCE. None: a fresh run's `hurtFlash` is stated as `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BASE_MAX_HP } from "../constants";
import {
  captureStill,
  createHarness,
  endFallen,
  tap,
  type Harness,
} from "../harness";
import { armFlash } from "./flash";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads hurtFlash 0 on the fresh run TRY AGAIN begins after a run that was hit", async () => {
  await armFlash(h);
  h.debug.clearEnemies();

  const ended = await endFallen(h);
  assertEqual(ended.screen, "fallen", "the screen the press is made on");
  assertEqual(ended.menuIndex, 0, "the highlighted item, TRY AGAIN");
  assertGreaterThan(
    ended.run.hurtFlash,
    0,
    "the flash the ended run was still carrying (specs/world.md, Contact damage)",
  );

  const fresh = await tap(h, "Enter");
  captureStill(h, "fresh");

  assertEqual(fresh.screen, "playing", "the screen after confirming TRY AGAIN");
  assertEqual(fresh.run.player.hp, BASE_MAX_HP, "hp on a fresh run");
  assertEqual(
    fresh.run.hurtFlash,
    0,
    "hurtFlash on the fresh run TRY AGAIN began (specs/ui.md, A fresh run)",
  );
});
