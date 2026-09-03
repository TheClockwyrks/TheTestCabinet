// screens/results-site-select — SITE SELECT returns to the select screen and
// opens no site.
//
// specs/ui.md § Results gives the entry its destination — `SITE SELECT`:
// "Returns to `select`, opening no site" — and the paragraph under the table says
// what "opening no site" is worth: "Opening a site is the operation
// `specs/state.md` fixes, so `NEXT SITE` and `REPLAY` both return the camera to
// its start pose, empty the undo history, and put the run back to its idle
// placeholder". The two entries beside this one carry those effects; this one
// carries none of them, and that is the requirement this check decides.
//
// So the run is cleared from a state that would SHOW a site opening if one
// happened: the camera stands where it was orbited to rather than at its start
// pose, the undo history holds the edits that built the crane, the run is a
// finished one rather than the idle placeholder, and the yard has been emptied of
// the loads specs/sites.md gives the site. A site opening would put all four
// back (specs/state.md § What a site opening does); this entry leaves all four as
// they stand.
//
// The entry is taken the way a player takes it — the highlight put on its row and
// `confirm` pressed — because which entry `confirm` takes is the requirement.
// Everything before that is posed through the surface.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  BINDINGS,
  HOIST_MAX_RATE,
  HOIST_START,
  RESULTS_ITEMS,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Site 1, which is neither the last site nor locked, so all three entries show. */
const SITE = 0;

/** The entry under test, and where it sits in the results menu. */
const ENTRY = RESULTS_ITEMS.indexOf("SITE SELECT");

/** A camera pose that is not the start pose, inside the orbit's own limits. */
const ORBITED = { yaw: 123, pitch: 40, dist: 25 };

/** One short move: enough for a run to have something to do and to end. */
const A_SHORT_HOIST: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "hoist", target: HOIST_START + 1, rate: HOIST_MAX_RATE }],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to select without opening a site", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [A_SHORT_HOIST]);
  await h.debug.setCamera(ORBITED.yaw, ORBITED.pitch, ORBITED.dist);

  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    200,
    "the run to end",
  );
  assertEqual(ended.run.phase, "cleared", "the run this check reads after");

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "results",
    "the screen a cleared run moves to (specs/ui.md § Run)",
  );
  assertGreaterThan(
    before.historyDepth,
    0,
    "the undo history the crane's edits left, which a site opening would empty",
  );
  assertEqual(
    before.camera.yaw,
    ORBITED.yaw,
    "the camera the check orbited, which a site opening would return",
  );
  assertLength(
    before.site.loads,
    0,
    "the emptied yard, which a site opening would refill (specs/state.md)",
  );

  await h.debug.setMenuIndex(ENTRY);
  await h.press(BINDINGS.confirm[0]!);
  await h.advance(1);
  await h.capture(
    "site-select",
    "the select screen reached without opening a site",
  );

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "select",
    "the screen SITE SELECT returns to (specs/ui.md § Results)",
  );
  assertEqual(
    JSON.stringify(after.camera),
    JSON.stringify(before.camera),
    "the camera SITE SELECT leaves where it stands, since it opens no site",
  );
  assertEqual(
    after.historyDepth,
    before.historyDepth,
    "the undo history SITE SELECT leaves as it stands, since it opens no site",
  );
  assertEqual(
    after.run.phase,
    before.run.phase,
    "the run SITE SELECT leaves as it stands, since it opens no site",
  );
  assertEqual(
    after.run.tick,
    before.run.tick,
    "the tick the finished run ended on, still readable after SITE SELECT",
  );
  assertLength(
    after.site.loads,
    before.site.loads.length,
    "the yard SITE SELECT leaves as it stands, since it opens no site",
  );
});
