// instrumentation/snapshot-fixed-shape — the snapshot carries every documented
// field on each of the eight screens, `run` reporting the idle run on title
// and howto and the run that just ended on fallen and dawn, `pool` empty on
// every screen but levelup, and `menuIndex` at rest where there is no menu.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "Snapshot shape":
// "The shape is fixed, and every field is present whatever the screen. `run`
// reports the idle run of `specs/state.md` on `title` and `howto`, and the run
// that just ended on `fallen` and `dawn`"; `pool` is "on every other screen an
// empty list". specs/ui.md, "Menu navigation": "`menuIndex` is `0` on entering
// every screen, and on a screen with no menu it stays `0`", the screens with
// no menu being howto, playing, chest, and paused.
//
// EACH SCREEN IS REACHED THROUGH THE SURFACE ALONE, so a build whose menus
// cannot be walked still answers for its shape, and a broken shape names its
// screen. `title` is the reset; `howto`, `playing`, `paused`, `fallen`, and
// `dawn` are `setScreen` rows; `levelup` and `chest` have no row of their own
// and are opened by the tick that opens them, with a queued level-up and a
// chest under the lamplighter. Whether a value is RIGHT on a screen belongs to
// the points about that screen's transition.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertHasProperty, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openChest,
  openLevelUp,
  poseScene,
  type Harness,
  type Screen,
} from "../harness";
import {
  assertIdleRun,
  MENU_FREE_SCREENS,
  RUN_FIELDS,
  SNAPSHOT_FIELDS,
} from "./helpers";

/** The eight screens, each reached through the surface. */
const SCREEN_ROUTES: readonly [Screen, (h: Harness) => Promise<void>][] = [
  ["title", async (on) => on.reset()],
  ["howto", async (on) => void poseScene(on, "howto")],
  ["playing", async (on) => void poseScene(on, "playing")],
  [
    "levelup",
    async (on) => {
      poseScene(on, "playing");
      await openLevelUp(on, 1);
    },
  ],
  [
    "chest",
    async (on) => {
      poseScene(on, "playing");
      await openChest(on);
    },
  ],
  ["paused", async (on) => void poseScene(on, "paused")],
  [
    "fallen",
    async (on) => {
      poseScene(on, "playing");
      await on.tick(3);
      on.debug.setScreen("fallen");
    },
  ],
  [
    "dawn",
    async (on) => {
      poseScene(on, "playing");
      await on.tick(3);
      on.debug.setScreen("dawn");
    },
  ],
];

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
    assertEqual(typeof s.run.tick, "number", `run.tick on ${screen}`);
    assertEqual(typeof s.accumulator, "number", `accumulator on ${screen}`);
    assertEqual(typeof s.simTime, "number", `simTime on ${screen}`);
    assertEqual(typeof s.rngState, "number", `rngState on ${screen}`);
    assertEqual(typeof s.muted, "boolean", `muted on ${screen}`);

    if (screen === "title" || screen === "howto") {
      assertIdleRun(s.run, `run on ${screen}: the idle run`);
    }
    if (screen === "fallen" || screen === "dawn") {
      assertEqual(
        s.run.tick,
        3,
        `run.tick on ${screen}: the run that just ended`,
      );
      assertLength(s.run.weapons, 1, `run.weapons on ${screen}: the run kept`);
    }
    if (screen !== "levelup") {
      assertLength(s.run.pool, 0, `pool on ${screen}: empty off levelup`);
    }
    if ((MENU_FREE_SCREENS as readonly string[]).includes(screen)) {
      assertEqual(s.menuIndex, 0, `menuIndex resting at 0 on ${screen}`);
    }
  }

  await h.tick(1);
  captureStill(h, "screens");
});
