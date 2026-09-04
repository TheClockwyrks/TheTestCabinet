// controls/wasd-left-steers — KeyA requests a turn to left.
//
// specs/controls.md binds `KeyA` to the `left` action and, on the `playing`
// screen, makes `left` "Request a turn to `left`".
// specs/movement.md then has step 1 of the next tick take that request and apply
// it, "only when it is perpendicular to the direction the snake is travelling in
// on this tick" — so the chain is posed on a vertical heading, where `left`
// is perpendicular and the turn is one the rules accept.
//
// `KeyA` is the SECOND key `specs/controls.md` binds to `left`, and the file
// says the two sets "are interchangeable": "`KeyW` does exactly what `ArrowUp`
// does, wherever `up` is read." So this is its own point rather than a repeat of
// the arrow's: a build that bound only the arrows is fully playable and loses
// this alone.
//
// `steering.ts` states what is posed and why the snake's travel is held still.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { WASD } from "../constants";
import { createHarness, type Harness } from "../harness";
import { steerOnce } from "./steering";

/** The heading the chain is posed on, which `left` is perpendicular to. */
const FROM = "up";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the snake left on the tick after KeyA is pressed", async () => {
  const drive = await steerOnce(h, WASD.left, FROM, "left");

  assertEqual(drive.posed.dir, FROM, "the heading the request is made on");
  assertEqual(drive.after.dir, "left", "the direction the tick applied");
});
