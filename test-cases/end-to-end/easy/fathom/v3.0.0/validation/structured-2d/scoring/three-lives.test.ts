// scoring/three-lives — three lives in reserve, and the fourth catch ends the run.
//
// specs/progression.md: "A dive opens with `START_LIVES` (`3`) lives, reported as
// `lives`. That count is the lives held in reserve: the life being played is not
// one of them." So four catches fit in a dive, not three: the first three drop the
// reserve to `2`, `1` and `0` with play resuming each time, and "Contact with no
// life in reserve ends the dive instead: `lives` is already `0`, and `screen`
// becomes `"gameover"`."
//
// FOUR CATCHES, EACH ONE POSED. The hunter is put on the forager's own tile, which
// is the contact condition specs/gameplay.md states, so nothing here waits on a
// chase closing a gap — that is `gloamfin/*`'s to grade. And because no catch
// here is travelled to, every hunter's body is held: the four catches this counts
// are the four it staged, and no fifth arrives on its own.
//
// THE COUNTDOWN BETWEEN LIVES IS ENDED RATHER THAN WAITED OUT.
// `setScreen("playing")` puts the game straight into live play
// (specs/instrumentation.md). How long the countdown holds, and that it gives way
// on its own, is `states/countdown`'s verdict; this point asks only that live play
// is reachable again after each catch, which it reads as the screen being
// `"playing"` once that operation has run. A dive that has already ended by then
// is not a scenario that could not be staged — it is this point's finding, and it
// is reported as one.
//
// ONLY THE LAST CATCH IS RECORDED. The clip this point ships is the run ending, so
// the three lives before it are spent outside the capture.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES } from "../constants";
import { assertEqual, fail } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import type { FathomSnapshot } from "../surface";

/**
 * How long a catch may take once the hunter stands on the forager's tile.
 *
 * The condition holds the moment the pose lands, so this is a HARD ceiling on the
 * step the build resolves contact in.
 */
const CATCH_BUDGET = ticksFor(1);

/**
 * Ticks between a catch and the reading of what it left behind.
 *
 * specs/progression.md fixes what contact costs without fixing the step it lands
 * on, so the reading is taken a beat later — well inside the `1 s` the dive
 * countdown holds for at the very least (specs/ui.md), so a resumed attempt is
 * still on its countdown when it is read.
 */
const SETTLE_TICKS = ticksFor(0.1);

/** Ticks past the last reading, purely so the clip closes on the game-over screen. */
const TAIL_TICKS = ticksFor(0.75);

/** What one catch cost: the state either side of it. */
interface Catch {
  before: FathomSnapshot;
  after: FathomSnapshot;
  hit: boolean;
  /** Live play was reached before the hunter was posed. */
  resumed: boolean;
}

/**
 * Resume play if the previous catch left a countdown, put the first predator of
 * the roster on the forager, and let the game resolve the contact.
 */
/**
 * Hold every hunter of the roster where it stands, minds running.
 *
 * This point runs on the build's OWN board, so it cannot empty the roster the way
 * a posed fixture does — the arrangement it reads is the one a catch sets up, and
 * that arrangement is about the whole roster. What it can do is exercise none of
 * their bodies: every catch below is POSED onto the forager's own tile, and a
 * hunter whose travel is off still makes contact (`specs/instrumentation.md`), so
 * no hunter can take a life this point did not stage. Called again after each
 * catch, in case the attempt it set up handed the den fresh bodies.
 */
function holdRoster(h: Harness): void {
  const roster = h.snapshot().predators;
  for (let index = 0; index < roster.length; index += 1) {
    h.debug.setPredatorTravel(index, false);
  }
}

async function takeALife(h: Harness): Promise<Catch> {
  if (h.snapshot().screen === "countdown") h.debug.setScreen("playing");
  holdRoster(h);
  const before = h.snapshot();
  if (before.screen !== "playing") {
    // Deliberately NOT a precondition. Which catch the run ends on is exactly
    // what this point decides, so a dive that is already over by the time the
    // next life is taken is this point's finding rather than a scenario that
    // could not be staged.
    return { before, after: before, hit: false, resumed: false };
  }
  h.debug.setPredatorTile(0, before.forager.tx, before.forager.ty);
  h.debug.setPredatorState(0, "chase");
  const contact = await h.until(
    (s) => s.lives < before.lives || s.screen === "gameover",
    { maxFrames: CATCH_BUDGET, poll: 1 },
  );
  await h.advance(SETTLE_TICKS);
  return { before, after: h.snapshot(), hit: contact.hit, resumed: true };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Three lives, then game over", async () => {
  const opened = startPlaying(h);
  if (opened.predators.length === 0) {
    fail(
      "the roster to carry a predator for the forager to make contact with; " +
        "specs/predators.md gives depth 1 one of each kind",
      opened.predators.length,
    );
  }

  // The three lives held in reserve, spent off camera.
  const spent: Catch[] = [];
  for (let life = 0; life < START_LIVES; life += 1) {
    spent.push(await takeALife(h));
  }
  // And the catch taken with none left, which is the clip.
  const last = await captureReplay(h, "over", async () => {
    const taken = await takeALife(h);
    await h.advance(TAIL_TICKS);
    return taken;
  });

  assertEqual(
    opened.lives,
    START_LIVES,
    "the lives a dive opens with, held in reserve",
  );

  for (const [index, taken] of spent.entries()) {
    assertEqual(
      taken.resumed,
      true,
      `play resumed for catch ${index + 1} of ${START_LIVES}, which found the ` +
        `dive on ${taken.before.screen}`,
    );
    assertEqual(
      taken.hit,
      true,
      `catch ${index + 1} of ${START_LIVES} landed inside ${CATCH_BUDGET} ` +
        "ticks of a predator standing on the forager's own tile",
    );
    assertEqual(
      taken.after.lives,
      START_LIVES - index - 1,
      `the lives in reserve after catch ${index + 1}`,
    );
    assertEqual(
      taken.after.screen,
      "countdown",
      `the screen after catch ${index + 1}, with a life still in reserve`,
    );
  }

  assertEqual(
    last.resumed,
    true,
    `play resumed for the last catch, which found the dive on ` +
      `${last.before.screen}`,
  );
  assertEqual(
    last.before.lives,
    0,
    "the lives in reserve when the last catch was taken",
  );
  assertEqual(
    last.hit,
    true,
    `the last catch landed inside ${CATCH_BUDGET} ticks of a predator standing ` +
      "on the forager's own tile",
  );
  assertEqual(
    last.after.screen,
    "gameover",
    "the screen after the catch taken with no life in reserve",
  );
});
