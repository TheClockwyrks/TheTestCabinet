// controls/arrow-down-steers — ArrowDown requests a turn to down.
//
// specs/controls.md binds `ArrowDown` to the `down` action and, on the `playing`
// screen, makes `down` "Request a turn to `down`".
// specs/movement.md then has step 1 of the next tick take that request and apply
// it, "only when it is perpendicular to the direction the snake is travelling in
// on this tick" — so the chain is posed on a horizontal heading, where `down`
// is perpendicular and the turn is one the rules accept.
//
// `ArrowDown` is one of the two keys `specs/controls.md` binds to `down`; the
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
const KEY = BINDINGS.down[0];

/** The heading the chain is posed on, which `down` is perpendicular to. */
const FROM = "right";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the snake down on the tick after ArrowDown is pressed", async () => {
  const drive = await steerOnce(h, KEY, FROM, "down");

  assertEqual(drive.posed.dir, FROM, "the heading the request is made on");
  assertEqual(drive.after.dir, "down", "the direction the tick applied");
});
