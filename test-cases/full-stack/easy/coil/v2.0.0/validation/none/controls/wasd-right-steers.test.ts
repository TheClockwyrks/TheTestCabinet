// controls/wasd-right-steers — KeyD requests a turn to right.
//
// specs/controls.md binds `KeyD` to the `right` action and, on the `playing`
// screen, makes `right` "Request a turn to `right`".
// specs/movement.md then has step 1 of the next tick take that request and apply
// it, "only when it is perpendicular to the direction the snake is travelling in
// on this tick" — so the chain is posed on a vertical heading, where `right`
// is perpendicular and the turn is one the rules accept.
//
// `KeyD` is the SECOND key `specs/controls.md` binds to `right`, and the file
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

/** The heading the chain is posed on, which `right` is perpendicular to. */
const FROM = "up";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the snake right on the tick after KeyD is pressed", async () => {
  const drive = await steerOnce(h, WASD.right, FROM, "right");

  assertEqual(drive.posed.dir, FROM, "the heading the request is made on");
  assertEqual(drive.after.dir, "right", "the direction the tick applied");
});
