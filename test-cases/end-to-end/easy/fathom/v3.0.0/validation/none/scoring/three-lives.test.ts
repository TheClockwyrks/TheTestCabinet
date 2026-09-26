// scoring/three-lives — three lives in reserve, and the fourth catch ends the run.
//
// `specs/progression.md`: "A dive opens with `START_LIVES` (`3`) lives, reported
// as `lives`. That count is the lives held in reserve: the life being played is
// not one of them." So four catches fit in a dive, not three: the first three drop
// the reserve to `2`, `1` and `0` with play resuming each time, and "Contact with
// no life in reserve ends the dive instead: `lives` is already `0`, and `screen`
// becomes `"gameover"`."
//
// FOUR CATCHES, EACH ONE POSED ON AN EMPTY BOARD. The roster comes off the board
// and one hunter is stood on the forager's own tile, which is the contact
// condition specs/gameplay.md states — so nothing here waits on a chase closing a
// gap, and no second hunter can take one of the lives this point is counting.
// Each attempt lays the depth's roster out afresh (specs/progression.md), so the
// staging is done again every time round.
//
// THE COUNTDOWN BETWEEN LIVES IS ENDED RATHER THAN WAITED OUT, by posing the
// screen straight to `"playing"` (`specs/instrumentation.md`). How long the
// countdown holds, and that it gives
// way on its own, is `states/countdown`'s verdict; this check asks only that live
// play is reachable again after each catch, which it reads as the screen being
// `"playing"` once that operation has run. A dive that has already ended by then
// is not a scenario that could not be staged — it is this check's finding, and it
// is reported as one.
//
// ONLY THE LAST CATCH IS FILMED. The clip this point ships is the run ending, so
// the three lives before it are spent through `skip`, which runs the same real
// ticks and closes no frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { START_LIVES } from "../constants";
import { stageCatch } from "../fixtures";
import {
  captureReplay,
  createHarness,
  ticks,
  type FathomSnapshot,
  type Harness,
  startPlaying,
} from "../harness";

/**
 * How long a catch may take once the hunter stands on the forager's tile.
 *
 * The condition holds the moment the pose lands, so this is a HARD ceiling on the
 * step the build resolves contact in.
 */
const CATCH_BUDGET = ticks(1);

/**
 * Ticks between a catch and the reading of what it left behind.
 *
 * `specs/progression.md` fixes what contact costs without fixing the step it
 * lands on, so the reading is taken a beat later — well inside the `1 s` the dive
 * countdown holds for at the very least (`specs/ui.md`), so a resumed attempt is
 * still on its countdown when it is read.
 */
const SETTLE_TICKS = ticks(0.1);

/** Ticks past the last reading, purely so the clip closes on the game-over screen. */
const TAIL_TICKS = ticks(0.75);

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
 *
 * The whole roster is held still first: contact is the rule this point counts
 * lives against, and a den emptying behind the staged catch would be a second
 * hunter able to take the same life. It is held again on every attempt, because a
 * roster the previous catch rebuilt would arrive travelling.
 *
 * `filmed` chooses between the recorded `advance`/`until` and the unfilmed
 * `skip`/`skipUntil`: the same real ticks either way, and only the last catch is
 * worth a reviewer's frames.
 */
async function takeALife(h: Harness, filmed: boolean): Promise<Catch> {
  if ((await h.snapshot()).screen === "countdown") {
    await h.debug.setScreen("playing");
  }
  const before = await h.snapshot();
  if (before.screen !== "playing") {
    // Deliberately NOT a precondition. Which catch the run ends on is exactly
    // what this check decides, so a dive that is already over by the time the
    // next life is taken is this check's finding rather than a scenario that
    // could not be staged.
    return { before, after: before, hit: false, resumed: false };
  }
  await stageCatch(h, {
    tx: before.forager.tx,
    ty: before.forager.ty,
  });
  const gone = (s: FathomSnapshot): boolean =>
    s.lives < before.lives || s.screen === "gameover";
  const options = { maxTicks: CATCH_BUDGET, poll: 1 };
  const contact = filmed
    ? await h.until(gone, options)
    : await h.skipUntil(gone, options);
  if (filmed) await h.advance(SETTLE_TICKS);
  else await h.skip(SETTLE_TICKS);
  return { before, after: await h.snapshot(), hit: contact.hit, resumed: true };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds three lives in reserve and ends the run on the fourth catch", async () => {
  const opened = await startPlaying(h);
  assertGreaterThan(
    opened.predators.length,
    0,
    "predators on the roster for one of them to make contact with; " +
      "specs/predators.md puts one of each of the three kinds in the den at " +
      "depth 1",
  );
  // The three lives held in reserve, spent off camera.
  const spent: Catch[] = [];
  for (let life = 0; life < START_LIVES; life += 1) {
    spent.push(await takeALife(h, false));
  }
  // And the catch taken with none left, which is the clip.
  const last = await captureReplay(h, "over", async () => {
    const taken = await takeALife(h, true);
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
