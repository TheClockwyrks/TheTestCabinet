// lives/gameover-at-zero — the loss that spends the last life ends the
// session.
//
// specs/field.md, closing the life-loss check: "At zero lives the game moves
// to the `gameover` screen." Lives are posed to 1 through the surface —
// specs/instrumentation.md: "a life loss at posed lives `1` ends the game" —
// and the last ball burns, so the watch reads the screen leaving `playing` and
// lands on `gameover` with the lives figure at 0.
//
// THE WORLD IS THE ONE DOOMED BALL. No targets or pods; what the game-over
// screen shows belongs to the screens checks.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { DOOM_TICKS, spawnDoomedBall } from "./loss";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves to gameover on the loss that reaches zero lives", async () => {
  isolate(h);
  h.debug.setLives(1);
  spawnDoomedBall(h);

  const run = await captureReplay(h, "game-over", () =>
    h.until((s) => s.screen !== "playing", { maxTicks: DOOM_TICKS }),
  );

  assertTrue(run.hit, "the screen left playing within the fall's ticks");
  assertEqual(run.snapshot.screen, "gameover", "the screen the loss moved to");
  assertEqual(run.snapshot.lives, 0, "the lives the session ended on");
});
