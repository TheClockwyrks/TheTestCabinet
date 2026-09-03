// check/check-result-survives-a-non-edit — the shown check result survives
// everything that is not an edit.
//
// specs/structure.md § The static check: "The result the action leaves stands
// until the structure or the tape changes, when it goes back to none." Until
// then, so an act that changes neither leaves it showing — the other direction of
// the same sentence, and the one a build that cleared the result on any state
// change at all would fail.
//
// FOUR ACTS THAT TOUCH NEITHER THE STRUCTURE NOR THE TAPE, each one a thing a
// player does with a result on screen:
//
//   - `setTool("cable")` "Selects a build tool, as the tool actions do"; a tool
//     is a selection and not an edit (specs/instrumentation.md § The structure).
//   - `setCamera` moves the orbit camera, which "persists across the three yard
//     screens" (specs/state.md) and builds nothing.
//   - `setScreen("program")` then `setScreen("build")` shows a screen "and sets
//     nothing else" (specs/instrumentation.md).
//   - Frames run, which move nothing outside a run.
//
// The result is compared whole rather than merely for being present: the
// requirement is that the SAME result is still showing, so a build that cleared
// it and quietly recomputed a different one fails too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { BINDINGS, HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  type Harness,
} from "../harness";

const SITE = 0;

const CHECK_KEY = BINDINGS.check[0]!;

/** A camera pose inside the limits specs/controls.md fixes, and not the start. */
const CAMERA = { yaw: 120, pitch: 55, dist: 30 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the same result showing across a tool, the camera and a screen", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [
        { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
      ],
    },
  ]);

  await h.press(CHECK_KEY);
  const shown = (await h.snapshot()).checkResult;
  assertNotNull(
    shown,
    "the result the `check` action leaves the build screen showing " +
      "(specs/structure.md § The static check)",
  );

  await h.debug.setTool("cable");
  await h.debug.setCamera(CAMERA.yaw, CAMERA.pitch, CAMERA.dist);
  await h.debug.setScreen("program");
  await h.debug.setScreen("build");
  await h.advance(3);

  const after = await h.snapshot();
  await h.capture(
    "checkresult-before-and-after",
    "checkResult before and after.",
  );

  assertEqual(
    JSON.stringify(after.checkResult),
    JSON.stringify(shown),
    "the check result the build screen is still showing, unchanged by a tool " +
      "selection, an orbit, a screen switch and three frames — none of which " +
      "changes the structure or the tape (specs/structure.md § The static check)",
  );
});
