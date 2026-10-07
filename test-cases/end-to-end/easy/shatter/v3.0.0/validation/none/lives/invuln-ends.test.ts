// lives/invuln-ends — the contact the grace suspended lands once the grace is gone.
//
// THE RULE. `specs/progression.md`: "lethal contact resumes on the tick the grace
// reaches `0`". `invuln-ignores-a-rock` reads the direction inside the window;
// this reads the direction outside it, and the pair together is what makes the
// window a WINDOW rather than a permanent immunity or a permanent one-way switch.
//
// ONE ROCK, ONE APPROACH, AND THE GRACE RUNS OUT UNDER IT. The Small is posed
// `LAPSE_GAP` above the ship and set drifting at `ROCK_DRIFT`, so it reaches
// touching distance `LAPSE_MARGIN` seconds after the `SHORT_GRACE` posed on the
// ship has run down to zero. Nothing is re-posed part way through: the same rock,
// on the same course, crosses from a stretch where it costs nothing into one where
// it is lethal, which is exactly the sentence above. That is also what makes the
// clip worth watching — the grace visibly running out, and then the contact.
//
// EVERY WRONG MODEL FAILS FOR ITS OWN REASON. A build whose grace never ends loses
// no life and fails on the life count. A build that ends the grace but never
// resolves the contact fails the same way. A build that killed the ship the moment
// the rock was posed — before the grace had run down at all — fails on the tick
// the loss landed, which is asserted to be at or after the tick the grace was
// posed to reach zero on.
//
// WHY A QUARTER SECOND OF GRACE. It is a real window rather than a formality —
// thirty ticks of the `TICK_HZ` (`120`) clock, over which a build that runs its
// timer down at the wrong rate is well clear of zero — and short enough that the
// rock's whole flight is under half a second, over which the well moves it about
// two units against a `28`-unit contact circle. `INVULN_TIME` itself is not used:
// the figure the grace OPENS at is `invuln-window`'s point, and `setShipInvuln`
// exists precisely so a check can pose the window it needs
// (`specs/instrumentation.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  ROCK_DRIFT,
  SHIP_TOUCHES_SMALL,
  arrangeDoomedShip,
  contactNeeded,
  untilLifeLost,
} from "./scene";

/** The seconds of grace the ship is posed with, which run out under the approach. */
const SHORT_GRACE = 0.25;

/** The seconds between the grace reaching zero and the rock reaching the ship. */
const LAPSE_MARGIN = 0.2;

/**
 * How far above the ship the rock is posed, centre to centre.
 *
 * Touching distance plus the travel of `SHORT_GRACE + LAPSE_MARGIN` at
 * `ROCK_DRIFT`: `118` units, so the pair touches at `0.45` s of game time and the
 * grace was gone at `0.25`.
 */
const LAPSE_GAP =
  SHIP_TOUCHES_SMALL + ROCK_DRIFT * (SHORT_GRACE + LAPSE_MARGIN);

/** The ticks of aftermath the replay keeps once the contact has landed. */
const AFTERMATH_TICKS = ticksFor(0.4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("loses a ship to the rock that reaches it after the grace has run out", async () => {
  await startPlaying(h);
  const before = (await h.snapshot()).lives;
  await arrangeDoomedShip(h, { grace: SHORT_GRACE, gap: LAPSE_GAP });

  const lost = await captureReplay(h, "grace", async () => {
    const outcome = await untilLifeLost(h, before);
    await h.advance(AFTERMATH_TICKS);
    return outcome;
  });

  assertEqual(
    lost.hit,
    true,
    contactNeeded(
      `a drifting Small reaching a ship whose ${SHORT_GRACE} s of grace ran out ` +
        `${LAPSE_MARGIN} s earlier`,
      LAPSE_GAP,
      SHIP_TOUCHES_SMALL,
      ROCK_DRIFT,
    ),
  );
  assertGreaterThanOrEqual(
    lost.ticks,
    ticksFor(SHORT_GRACE),
    `the tick the ship was lost on, which has to be at or past the ` +
      `${ticksFor(SHORT_GRACE)} the posed grace runs for — a loss before that is ` +
      `a build ignoring the grace rather than one resuming contact when it ends ` +
      `(specs/progression.md)`,
  );
  assertEqual(
    lost.snapshot.lives,
    before - 1,
    `the ships left after the contact that landed once the grace was gone, from ` +
      `the ${before} it stood at — lethal contact resumes on the tick the grace ` +
      `reaches 0 (specs/progression.md)`,
  );
});
