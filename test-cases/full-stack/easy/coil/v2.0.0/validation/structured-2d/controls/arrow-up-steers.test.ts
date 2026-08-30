// controls/arrow-up-steers — ArrowUp requests a turn to up.
//
// specs/controls.md binds `ArrowUp` to the `up` action and, on the `playing`
// screen, makes `up` "Request a turn to `up`".
// specs/movement.md then has step 1 of the next tick take that request and apply
// it, "only when it is perpendicular to the direction the snake is travelling in
// on this tick" — so the chain is posed on a horizontal heading, where `up`
// is perpendicular and the turn is one the rules accept.
//
// `ArrowUp` is one of the two keys `specs/controls.md` binds to `up`; the
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
const KEY = BINDINGS.up[0];

/** The heading the chain is posed on, which `up` is perpendicular to. */
const FROM = "right";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the snake up on the tick after ArrowUp is pressed", async () => {
  const drive = await steerOnce(h, KEY, FROM, "up");

  assertEqual(drive.posed.dir, FROM, "the heading the request is made on");
  assertEqual(drive.after.dir, "up", "the direction the tick applied");
});
