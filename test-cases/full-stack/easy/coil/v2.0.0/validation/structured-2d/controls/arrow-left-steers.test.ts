// controls/arrow-left-steers — ArrowLeft requests a turn to left.
//
// specs/controls.md binds `ArrowLeft` to the `left` action and, on the `playing`
// screen, makes `left` "Request a turn to `left`".
// specs/movement.md then has step 1 of the next tick take that request and apply
// it, "only when it is perpendicular to the direction the snake is travelling in
// on this tick" — so the chain is posed on a vertical heading, where `left`
// is perpendicular and the turn is one the rules accept.
//
// `ArrowLeft` is one of the two keys `specs/controls.md` binds to `left`; the
// other set is its own point, because a build that bound only one of them is
// still playable on that one.
//
// `steering.ts` states what is posed and why the snake's travel is held still.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";
import { steerOnce } from "./steering";

/** The key this point is about, as `specs/controls.md` binds it. */
const KEY = BINDINGS.left[0];

/** The heading the chain is posed on, which `left` is perpendicular to. */
const FROM = "up";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the snake left on the tick after ArrowLeft is pressed", async () => {
  const drive = await steerOnce(h, KEY, FROM, "left");

  assertEqual(drive.posed.dir, FROM, "the heading the request is made on");
  assertEqual(drive.after.dir, "left", "the direction the tick applied");
});
