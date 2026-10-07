// instrumentation/set-screen-takes-effect-at-the-call — a posed screen is showing
// in the very next reading, with no frame advanced.
//
// `specs/instrumentation.md` § The operations: a pose "establishes a precondition
// and never an outcome", and § Snapshot shape closes with "Every field is read
// straight off the game's own state or derived from it at the call, so what the
// snapshot reports is what the game holds." Together those fix the moment a
// `setScreen` lands: the call, not the frame after it. A build that queued the
// change for its next update, or that rode a transition to get there, would show
// the old screen in the reading this check takes.
//
// THE CHECK TAKES THAT READING WITH THE CLOCK STOPPED. The harness opens every
// page with `setAutoStep(false)`, so between the call and the reading no frame
// can have run — the reading is of the call alone. Nothing else is posed on the
// way: `title` is where a reset leaves the game, and `program` is a screen a
// reset never shows, so the reading tells the two apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";

/** A screen no reset and no arrival leaves showing, so the reading is the pose's. */
const POSED = "program";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows a posed screen in the next reading, with no frame advanced", async () => {
  const before = (await h.snapshot()).screen;

  await h.debug.setScreen(POSED);
  const atTheCall = (await h.snapshot()).screen;

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    before,
    "title",
    "the screen the game stands on before the pose, which a reset leaves",
  );
  assertEqual(
    atTheCall,
    POSED,
    `the screen setScreen("${POSED}") shows, read with no frame advanced ` +
      "(specs/instrumentation.md)",
  );
});
