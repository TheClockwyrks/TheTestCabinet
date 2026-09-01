// Wick — screens/paused-back-abandons: `back` on `paused` abandons the run and
// returns to the title.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`paused`": "`back`
// abandons the run and returns to `title` with `menuIndex = 0`."
// `specs/controls.md` gives the `paused` row "`back` abandons the run and
// returns to `title`", with `back` bound to `Escape`. `specs/state.md`, "The
// idle run", says `run` holds the idle values "whenever `screen` is `title` or
// `howto` ... and leaving a run for the title restores them", the table this
// suite spells as `IDLE_RUN`.
//
// THE DRIVE. An isolated `playing` world with a moth, a gem, a clock posed off
// `0` and the lamplighter posed away from the origin, so a title screen still
// carrying any of it fails; the pause posed through `setScreen("paused")` —
// which `specs/instrumentation.md` says enters it "exactly as `pause` does" —
// then the `Escape` this point is about.
//
// THE TOLERANCE. None: a screen name, an index, and a run compared field for
// field against the idle run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  IDLE_RUN,
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placeGem,
  poseScreen,
  tap,
  type Harness,
} from "../harness";

const PLAYER_X = 120;
const PLAYER_Y = -60;
const TICK = 1800;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads title with menuIndex 0 and the idle run after Escape", async () => {
  isolate(h);
  h.debug.setTick(TICK);
  h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  placeEnemy(h, "moth", PLAYER_X + 300, PLAYER_Y);
  placeGem(h, "large", PLAYER_X + 300, PLAYER_Y);

  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the press is made on");

  const after = await tap(h, "Escape");
  captureStill(h, "abandoned");

  assertEqual(after.screen, "title", "the screen after Escape on paused");
  assertEqual(after.menuIndex, 0, "menuIndex on arriving at the title");
  assertDeepEqual(
    after.run,
    IDLE_RUN,
    "the run after abandoning (specs/state.md, The idle run)",
  );
});
