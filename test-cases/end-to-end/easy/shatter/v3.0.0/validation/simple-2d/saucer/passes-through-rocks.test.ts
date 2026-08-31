// saucer/passes-through-rocks — a rock and the saucer do not touch.
//
// THE RULE. `specs/collision.md` pairs "The saucer and a rock" with "Nothing.
// They pass through each other", and `specs/saucer.md` says the same in its own
// words: "A rock passes through the saucer and neither is harmed."
//
// SO THE READING IS AT A REAL OVERLAP. A rock driven across the saucer's centre
// gets the two circles well inside each other — a Large's `46` and the saucer's
// `18` leave `64` units of overlap available and the pass goes clean through the
// middle of it — and the check reads the far side: the saucer still up under the
// same id, and the rock still on the field under the same id and at the same
// size. A build that resolves this pair with the bullet-and-saucer rule loses the
// saucer; one that resolves it with the bullet-and-rock rule finds two Mediums
// where a Large stood.
//
// THE SAUCER IS HELD STILL AND THE ROCK IS DRIVEN, which is the isolation this
// requirement wants: `specs/collision.md` decides a PAIR, and a pair is easiest
// to read when only one of the two is moving. Its mind and gun are off as well,
// so neither the weave nor a round can take it out of the rock's way or add a
// body to the reading. The rock keeps its own faculties: it is the rock's own
// travel and the game's own collision pass that carry it through.
//
// WHERE IT IS FLOWN. `(320, 620)` is `412` units from the star, where the well
// pulls at about `26` units per second squared — so over the two thirds of a
// second the pass takes, gravity bends the rock's course by about six units,
// against the `64` of overlap the pass has to play with. Far enough out that the
// environment cannot decide the verdict, and `startPlaying` has emptied the
// field, shut both world gates and switched the ship's contact test off.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, SAUCER_R } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import { distance } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  rockById,
  startPlaying,
  theSaucer,
  ticksFor,
  type Harness,
} from "../harness";
import { poseVisit } from "./visit";

/** Where the saucer stands: quiet ground, far from the star. See the header. */
const STAND = { x: 320, y: 620 };

/** How far to the left of it the rock begins. */
const RUN_UP = 130;

/** The speed the rock is driven across at, in units per second. */
const ROCK_DRIFT = 400;

/** The size the rock is: the largest, so the overlap is the widest. */
const ROCK_SIZE = "large" as const;

/** How long the pass is driven for: enough to carry the rock right across and out. */
const PASS_TICKS = ticksFor((2 * RUN_UP) / ROCK_DRIFT);

/** The separation at which the two circles are certainly inside each other. */
const OVERLAP = ROCK_RADIUS[ROCK_SIZE] + SAUCER_R;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves both the saucer and the rock standing after a rock crosses it", async () => {
  startPlaying(h);
  const saucer = poseVisit(h, STAND.x, STAND.y, {
    vx: 0,
    vy: 0,
    mind: false,
    gun: false,
    travel: false,
  });
  const rockId = poseRock(
    h,
    ROCK_SIZE,
    STAND.x - RUN_UP,
    STAND.y,
    ROCK_DRIFT,
    0,
  );

  const met = await h.until(
    (snapshot) => {
      const rock = snapshot.rocks.find((entry) => entry.id === rockId);
      const up = snapshot.saucer;
      if (rock === undefined || up === null) return false;
      return distance(rock, up) < OVERLAP;
    },
    { maxFrames: PASS_TICKS },
  );
  captureStill(h, "overlap");
  assertTrue(
    met.hit,
    "a rock driven across the saucer reaching an overlap of the two circles",
  );

  await h.advance(PASS_TICKS);
  const after = h.snapshot();

  assertEqual(
    theSaucer(after, "passes-through-rocks").id,
    saucer.id,
    "the saucer the rock passed through, still the same visit " +
      "(specs/collision.md)",
  );
  assertEqual(
    rockById(after, rockId, "passes-through-rocks").size,
    ROCK_SIZE,
    "the rock that passed through the saucer, whole and unsplit " +
      "(specs/collision.md)",
  );
});
