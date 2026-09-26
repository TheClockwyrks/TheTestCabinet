// controls/wasd-down-steers — KeyS requests a turn to down.
//
// specs/controls.md binds `KeyS` to the `down` action and, on the `playing`
// screen, makes `down` "Request a turn to `down`".
// specs/movement.md then has step 1 of the next tick take that request and apply
// it, "only when it is perpendicular to the direction the snake is travelling in
// on this tick" — so the chain is posed on a horizontal heading, where `down`
// is perpendicular and the turn is one the rules accept.
//
// `KeyS` is the SECOND key `specs/controls.md` binds to `down`, and the file
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

/** The heading the chain is posed on, which `down` is perpendicular to. */
const FROM = "right";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the snake down on the tick after KeyS is pressed", async () => {
  const drive = await steerOnce(h, WASD.down, FROM, "down");

  assertEqual(drive.posed.dir, FROM, "the heading the request is made on");
  assertEqual(drive.after.dir, "down", "the direction the tick applied");
});
