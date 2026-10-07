// progression/starts-three-lives — a new run opens with three lives.
//
// `specs/progression.md`, Starting a run: "A new run opens on the `playing`
// screen with" a table whose first row is Lives, `START_LIVES` (`3`). The run is
// opened the one way a run is opened — `DESCEND` confirmed on the title
// (`specs/ui.md`) — because there is no operation that starts one and nothing a
// pose can do produces the opening.
//
// The title is left carrying ONE life before the confirm. `reset` already
// restores lives to `START_LIVES` (`specs/instrumentation.md`), so a run opened
// off a bare reset reports `3` whether or not the build's run-opening lays a
// single figure of its own; posing the stale life first is the position a title
// screen really stands in after a run has ended, and it separates the models. A
// build that lays the starting figures answers `3`; one that carries the old
// run's lives into the new one answers `1`; one that opens a run on no lives at
// all answers `0`.
//
// The level and the score the same opening lays are the two points next door.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { START_LIVES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openRunFrom } from "./run";

/** The lives the title is left carrying, so `START_LIVES` cannot be a leftover. */
const STALE_LIVES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens a run reporting three lives", async () => {
  await openRunFrom(h, (debug) => debug.setLives(STALE_LIVES));

  await captureStill(h, "opening");
  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "playing",
    "precondition: DESCEND opened a run (specs/ui.md)",
  );
  assertEqual(opened.lives, START_LIVES, "the lives the new run reports");
});
