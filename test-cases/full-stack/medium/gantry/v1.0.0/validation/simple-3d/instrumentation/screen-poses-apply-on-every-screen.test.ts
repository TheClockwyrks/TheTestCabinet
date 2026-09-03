// instrumentation/screen-poses-apply-on-every-screen — the screen and score poses
// apply from wherever the game stands.
//
// `specs/instrumentation.md` § The run and the screens, of the ten operations in
// its table: "The first eight of these apply on every screen, `setMenuIndex`
// aside: it applies on the three screens that show a menu". So `setCleared`,
// `setBest`, `clearBest` and `setCamera` are answered from any screen at all, and
// a scenario may pose them from wherever it happens to be standing.
//
// THE SCREEN THEY ARE POSED FROM IS THE RUN SCREEN, WITH A RUN IN PROGRESS. That
// is the one screen none of these four has anything to do with — the site select
// shows the clears and the scores, the results screen records them, the yard
// screens carry the camera — so a build that gated any of them on the screen
// showing fails here and passes everywhere else. It is reached the way the game
// reaches it: `startRun` "poses the `run` action: … and the same move to the run
// screen", with no menu key pressed on the way.
//
// The four are posed and read one after another rather than together, because
// what is being decided is that each is answered from this screen; the figures
// themselves are each another item's requirement. `reset`, `setScreen` and
// `openSite` are the other three of the eight and cannot be shown this way: each
// of them leaves the run screen by definition, so what a reading after one of
// them proves is that the pose happened, not that it happened from here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertTrue } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One short hoist move: enough for a run to legally start. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

/** A site the run is not being watched on, so a pose cannot be a coincidence. */
const OTHER_SITE = 2;

/** Inside every camera limit, and off the pose `openSite` left. */
const CAMERA = { yaw: 90, pitch: 40, dist: 30 };

/** Two figures that cannot be confused for one another. */
const SCORE = { cost: 1000, time: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("answers the screen and score poses from the run screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);
  assertEqual(
    (await h.snapshot()).screen,
    "run",
    "the screen the poses are made from",
  );

  await h.debug.setCamera(CAMERA.yaw, CAMERA.pitch, CAMERA.dist);
  const camera = (await h.snapshot()).camera;
  assertEqual(
    camera.yaw,
    CAMERA.yaw,
    "the yaw setCamera posed from the run screen",
  );
  assertEqual(
    camera.pitch,
    CAMERA.pitch,
    "the pitch setCamera posed from the run screen",
  );
  assertEqual(
    camera.dist,
    CAMERA.dist,
    "the distance setCamera posed from the run screen",
  );

  await h.debug.setBest(OTHER_SITE, SCORE.cost, SCORE.time);
  const best = (await h.snapshot()).best[OTHER_SITE];
  assertEqual(
    best?.cost,
    SCORE.cost,
    `the cost setBest posed on site ${OTHER_SITE} from the run screen`,
  );
  assertEqual(
    best?.time,
    SCORE.time,
    `the time setBest posed on site ${OTHER_SITE} from the run screen`,
  );

  await h.debug.setCleared(OTHER_SITE, true);
  assertTrue(
    (await h.snapshot()).cleared[OTHER_SITE] === true,
    `the clear setCleared posed on site ${OTHER_SITE} from the run screen`,
  );

  await h.debug.clearBest(OTHER_SITE);
  const cleared = (await h.snapshot()).best[OTHER_SITE];
  await h.capture("posed", "The run screen the four poses were answered from");
  assertNull(
    cleared,
    `the score clearBest removed from site ${OTHER_SITE} from the run screen`,
  );
});
