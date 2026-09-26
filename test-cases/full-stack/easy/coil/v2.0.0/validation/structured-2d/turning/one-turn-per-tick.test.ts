// turning/one-turn-per-tick — at most one buffered request resolves per tick.
//
// specs/movement.md: step 1 "takes the oldest buffered turn" — one of them — and
// the file works the case out in full: "A pair of requests made inside one tick
// resolves across two ticks. Travelling `right`, a player who requests `down` and
// then `left` gets the `down` on the next tick, and the `left` on the tick after
// that, where it is now a valid perpendicular turn."
//
// That is exactly the scenario driven here, and it is the reason the rule exists:
// a build that drained the whole buffer in one step would apply `down` and then
// `left` to the same tick, and the head would arrive on a cell diagonally away
// from where it started, folding the chain onto itself.
//
// The `left` is deliberately not perpendicular to the heading the requests were
// made under, and becomes perpendicular only once the `down` has landed. So the
// second tick also reads whether the buffered request was judged against the
// direction in force ON THAT TICK rather than against the one it was made under.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  ahead,
  arrangeStep,
  captureReplay,
  createHarness,
  type Cell,
  type Harness,
} from "../harness";

/** Where the chain is posed: clear board below it and to its left. */
const HEAD: Cell = { col: 10, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("applies the older request on one tick and the newer on the next", async () => {
  arrangeStep(h, { head: HEAD, dir: "right", length: 3 });

  const run = await captureReplay(h, "double", async () => {
    await h.tap(BINDINGS.down[0]);
    await h.tap(BINDINGS.left[0]);
    const buffered = h.snapshot();
    const first = await h.tick();
    const second = await h.tick();
    return { buffered, first, second };
  });

  assertDeepEqual(
    run.buffered.turns,
    ["down", "left"],
    "the two requests, oldest first",
  );
  assertEqual(run.buffered.dir, "right", "dir before either tick");

  const down = ahead(HEAD, "down");
  assertEqual(run.first.dir, "down", "dir after the first tick");
  assertDeepEqual(run.first.snake[0], down, "the head after the first tick");

  assertEqual(run.second.dir, "left", "dir after the second tick");
  assertDeepEqual(
    run.second.snake[0],
    ahead(down, "left"),
    "the head after the second tick",
  );
});
