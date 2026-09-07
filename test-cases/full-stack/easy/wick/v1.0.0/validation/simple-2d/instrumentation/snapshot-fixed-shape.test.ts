// instrumentation/snapshot-fixed-shape — the snapshot carries every documented
// field on each of the nine screens, `almanacTab`, `almanacScroll`, and
// `run.hurtFlash` among them, `run` reporting the idle run on title, howto, and
// almanac and the run that just ended on fallen and dawn, `pool` empty on every
// screen but levelup, and `menuIndex` at rest where there is no menu.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "Snapshot shape":
// "The shape is fixed, and every field is present whatever the screen. `run`
// reports the idle run of `specs/state.md` on `title`, `howto`, and `almanac`,
// and the run that just ended on `fallen` and `dawn`"; "`almanacTab` and
// `almanacScroll` sit beside `menuIndex`, outside `run`, and are `0` on every
// screen but `almanac`"; `pool` is "on every other screen an empty list".
// specs/controls.md: "`menuIndex` is `0` on entering every screen, and on a
// screen with no highlight it stays `0`", the screens with no menu being howto,
// playing, and chest.
//
// EACH SCREEN IS REACHED THROUGH THE SURFACE ALONE, so a build whose menus
// cannot be walked still answers for its shape, and a broken shape names its
// screen. `title` is the reset; `howto`, `almanac`, and `paused` are the
// atomic `setScreen`; `playing` is the composed fresh run; `levelup`, `chest`,
// `fallen`, and `dawn` are opened by the ticks that open them, with a queued
// level-up, a chest under the lamplighter, `hp` at `0`, and the clock at the
// tick before dawn. Whether a value is RIGHT on a screen belongs to the points
// about that screen's transition.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertHasProperty, assertLength } from "../assert";
import { DAWN_TICK } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertIdleRun,
  FALLEN_TICK,
  MENU_FREE_SCREENS,
  RUN_FIELDS,
  SCREEN_ROUTES,
  SNAPSHOT_FIELDS,
} from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries the whole documented shape on every screen", async () => {
  for (const [screen, reach] of SCREEN_ROUTES) {
    await reach(h);
    const s = h.snapshot();
    assertEqual(s.screen, screen, `the ${screen} screen, reached`);

    for (const field of SNAPSHOT_FIELDS) {
      assertHasProperty(s, field, `snapshot() on ${screen}`);
    }
    for (const field of RUN_FIELDS) {
      assertHasProperty(s.run, field, `snapshot().run on ${screen}`);
    }
    assertEqual(typeof s.menuIndex, "number", `menuIndex on ${screen}`);
    assertEqual(typeof s.almanacTab, "number", `almanacTab on ${screen}`);
    assertEqual(typeof s.almanacScroll, "number", `almanacScroll on ${screen}`);
    assertEqual(typeof s.run.tick, "number", `run.tick on ${screen}`);
    assertEqual(typeof s.run.hurtFlash, "number", `run.hurtFlash on ${screen}`);
    assertEqual(typeof s.accumulator, "number", `accumulator on ${screen}`);
    assertEqual(typeof s.simTime, "number", `simTime on ${screen}`);
    assertEqual(typeof s.muted, "boolean", `muted on ${screen}`);

    if (screen === "title" || screen === "howto" || screen === "almanac") {
      assertIdleRun(s.run, `run on ${screen}: the idle run`);
    }
    if (screen === "fallen" || screen === "dawn") {
      assertEqual(
        s.run.tick,
        screen === "fallen" ? FALLEN_TICK : DAWN_TICK,
        `run.tick on ${screen}: the run that just ended`,
      );
      assertLength(s.run.weapons, 1, `run.weapons on ${screen}: the run kept`);
    }
    if (screen !== "levelup") {
      assertLength(s.run.pool, 0, `pool on ${screen}: empty off levelup`);
    }
    if (screen !== "almanac") {
      assertEqual(s.almanacTab, 0, `almanacTab resting at 0 on ${screen}`);
      assertEqual(
        s.almanacScroll,
        0,
        `almanacScroll resting at 0 on ${screen}`,
      );
    }
    if ((MENU_FREE_SCREENS as readonly string[]).includes(screen)) {
      assertEqual(s.menuIndex, 0, `menuIndex resting at 0 on ${screen}`);
    }
  }

  await h.tick(1);
  captureStill(h, "screens");
});
