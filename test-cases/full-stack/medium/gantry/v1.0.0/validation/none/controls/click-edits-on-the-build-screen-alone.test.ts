// controls/click-edits-on-the-build-screen-alone — a click on the run screen
// edits nothing.
//
// `specs/controls.md` § Clicks and drags: "A drag edits nothing, and a click
// edits the structure on the build screen alone: a press that starts on one of
// the program screen's tape widgets works that widget rather than the camera, and
// a press on the run screen turns the camera and nothing else." § The run screen
// says it again from the screen's side: "The run screen takes the camera actions,
// a pointer drag on the camera, `speed`, `mute`, and `back` alone."
//
// SO THE SAME CLICK IS MADE IN THE WRONG PLACE. `clearAll` empties the world, one
// strut goes back, and the delete tool is selected — the arrangement in which a
// click on that member's projected segment removes it on the build screen
// ("Delete: a click removes what it picks, the nearest in screen distance of a
// member within `MEMBER_PICK_PX`"). The click is then made on the RUN screen, at
// the same stage point, and the member must still be standing.
//
// THE CANDIDATE IS READ ON THE BUILD SCREEN FIRST, where `pick` is answered, so
// the check knows the stage point it presses is one a click would act on. The
// screen is then taken to `run` through `setScreen`, which "shows a named screen
// and sets nothing else" (`specs/instrumentation.md`) — the camera does not move,
// so the member is still drawn under that point.
//
// The click never moves between its press and its release, so it stays a click
// rather than becoming an orbit drag (`specs/controls.md`), which is what makes
// the reading about the screen rather than about the slop.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Projected,
} from "../harness";

/** The one member the world holds: a strut up from a ground anchor. */
const MEMBER = { a: [0, 0, 0], b: [0, 2, 0] } as const;

/** The id `clearStructure` leaves for the first member placed after it. */
const MEMBER_ID = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The middle of a projected segment: a point a click would take it by. */
function midpoint(a: Projected, b: Projected): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

it("leaves the structure alone under a delete click on the run screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.addMember(...MEMBER.a, ...MEMBER.b, "strut");
  await h.debug.setTool("delete");

  const a = await h.project(...MEMBER.a);
  const b = await h.project(...MEMBER.b);
  const on = midpoint(a, b);

  // The stage point, read back through the build's own pick on the screen that
  // answers one: a click there is a click on the member.
  await h.pointerMove(on.x, on.y);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).pick.member,
    MEMBER_ID,
    "the member candidate at the stage point the click is made at " +
      "(specs/controls.md)",
  );

  await h.debug.setScreen("run");
  await h.click(on.x, on.y);

  const s = await h.snapshot();
  assertEqual(s.screen, "run", "the screen the click was made on");
  assertLength(
    s.structure.members,
    1,
    "the members standing after a delete click on the run screen, which " +
      "turns the camera and nothing else: a click edits the structure on the " +
      "build screen alone (specs/controls.md)",
  );

  await h.capture("state", "the run screen after a click on the member");
});
