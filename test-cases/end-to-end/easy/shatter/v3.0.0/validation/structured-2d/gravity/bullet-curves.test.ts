// gravity/bullet-curves — the well bends the ship's round off its line.
//
// THE RULE. `specs/gravity.md`, "Which bodies are pulled", gives "a bullet the
// ship fired" a `Yes`. That row is the whole item: a round in flight is a
// ballistic body, so the law of the file above it acts on it every tick and the
// shot arrives somewhere other than where it was aimed.
//
// This is the item a player would call the game's signature, and it is graded on
// the OUTCOME — where the round ended up — rather than on the acceleration, which
// `gravity/pull-magnitude` and `gravity/pull-direction` already decide from a body
// at rest. A build can have the law exactly right and still fail here by never
// running its gravity pass over the bullet roster, and that is the fault this
// item names.
//
// THE SCENARIO is `crossing.ts`, shared with `gravity/enemy-bullet-curves` so the
// two grades are comparable; that file carries the derivation of the line, the
// flight, and the 40 units.
//
// WHAT IS ASSERTED, IN ONE DIRECTION. How far the round ended from the line it
// was posed on, measured TOWARD the star. Nothing but the well acts on a round in
// flight, so an unpulled round holds its launch velocity and ends on that line
// exactly — which makes this one reading both halves of what the review item
// asks: more than 40 units from where the same shot with no pull would have
// reached, and bent toward the star rather than away from it. A build that pushed
// its rounds AWAY from the star reads a negative displacement and fails, where a
// check on the unsigned distance alone would have passed it.
//
// THE ROUND IS HARD-ASSERTED before it is read, so a build whose `addBullet`
// placed nothing, or whose round was removed early, fails this item naming that,
// rather than crashing the suite and being misreported as a build with no debug
// surface at all.
//
// THE RECORDING RUNS PAST THE READING. The verdict is taken at 1.2 seconds; the
// replay carries on for another fifth of a second so a reviewer sees the curve
// continuing rather than a clip that cuts on the frame the measurement was taken.
// The round is still in flight at the end of it — 1.4 seconds against a
// `BULLET_LIFE` of 1.5 — and still inside the field.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  poseBullet,
  requireBullet,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  CROSSING,
  FLIGHT_TICKS,
  MIN_BEND,
  OFFSET,
  TOWARD_THE_STAR,
} from "./crossing";

/** How much of the flight the recording keeps after the reading is taken. */
const TAIL_TICKS = ticksFor(0.2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("bends the ship's round toward the star as it crosses the well", async () => {
  startPlaying(h);

  const id = poseBullet(h, CROSSING.x, CROSSING.y, CROSSING.vx, CROSSING.vy);

  const bent = await captureReplay(h, "curve", async () => {
    await h.advance(FLIGHT_TICKS);
    // The reading, at the instant the flight is measured at.
    const round = requireBullet(
      h.snapshot(),
      id,
      "the round posed across the well still in flight 1.2 seconds later, " +
        "well inside its BULLET_LIFE (specs/weapons.md)",
    );
    const displacement = TOWARD_THE_STAR * (round.y - CROSSING.y);
    // And the rest of the curve, for the reviewer.
    await h.advance(TAIL_TICKS);
    return displacement;
  });

  assertGreaterThan(
    bent,
    MIN_BEND,
    `how far toward the star the ship's round ended from the line it was fired ` +
      `along, in units, after 1.2 seconds: a round with no pull holds its ` +
      `launch velocity and ends on that line, ${OFFSET} units from the star, ` +
      "while the well pulls every bullet the ship fired (specs/gravity.md)",
  );
});
