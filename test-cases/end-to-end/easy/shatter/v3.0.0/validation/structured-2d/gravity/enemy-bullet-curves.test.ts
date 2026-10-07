// gravity/enemy-bullet-curves — the well bends the saucer's round by the same law.
//
// THE RULE. `specs/gravity.md`, "Which bodies are pulled", gives "a saucer
// bullet" a `Yes`, on the row below the ship's own. `specs/saucer.md` says it
// again where it fixes the shot: "it is pulled by the well and wraps at the edges
// like any ballistic body." One law, two rosters.
//
// WHY IT IS ITS OWN ITEM. A build writes its gravity pass over the bodies it
// remembers to write it over, and the saucer's rounds are the roster most easily
// forgotten — they are added by the saucer rather than by the player, and a build
// can have curved every shot the player ever fired while sending the saucer's
// straight. Grading the two separately is what names that.
//
// THE SCENARIO IS `bullet-curves`' SCENARIO, exactly. `crossing.ts` holds the
// line, the flight and the 40 units, and both items fly it, because the review
// item is written as a comparison — "an enemy bullet posed on the same line as
// `bullet-curves` is bent by the same law" — and a comparison against a different
// pose would not be one. The only difference between the two files is which of
// the surface's two `add...Bullet` operations places the round and which roster
// it is read back from.
//
// THE FLIGHT FITS THE SHORTER LIFETIME. `SAUCER_BULLET_LIFE` is 1.4 seconds
// against the ship's 1.5, and the reading is taken at 1.2, so this item is
// grading the bend and not the lifetime — which is
// `saucer/bullet-life`'s item.
//
// WHAT IS ASSERTED, IN ONE DIRECTION: how far the round ended from the line it
// was posed on, measured TOWARD the star. `bullet-curves`' header carries the
// argument; the short of it is that an unpulled round ends on that line exactly,
// so the signed displacement is both "more than 40 units from where the same shot
// with no pull would have reached" and "bent toward the star" in one reading.
//
// THIS ITEM'S OUTPUT IS A STILL rather than a recording, because the frame at the
// reading already shows what it decides — a round well off the line it was posed
// on, with the star between it and where it came from.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseEnemyBullet,
  requireEnemyBullet,
  startPlaying,
  type Harness,
} from "../harness";
import {
  CROSSING,
  FLIGHT_TICKS,
  MIN_BEND,
  OFFSET,
  TOWARD_THE_STAR,
} from "./crossing";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("bends a saucer round toward the star as it crosses the well", async () => {
  startPlaying(h);

  const id = poseEnemyBullet(
    h,
    CROSSING.x,
    CROSSING.y,
    CROSSING.vx,
    CROSSING.vy,
  );

  await h.advance(FLIGHT_TICKS);

  // A saucer bullet bent by the well, at the instant the bend is read.
  captureStill(h, "curve");

  const round = requireEnemyBullet(
    h.snapshot(),
    id,
    "the saucer round posed across the well still in flight 1.2 seconds " +
      "later, inside its SAUCER_BULLET_LIFE (specs/saucer.md)",
  );

  assertGreaterThan(
    TOWARD_THE_STAR * (round.y - CROSSING.y),
    MIN_BEND,
    `how far toward the star a saucer round ended from the line it was posed ` +
      `along, in units, after 1.2 seconds: a round with no pull holds its ` +
      `velocity and ends on that line, ${OFFSET} units from the star, while the ` +
      "well pulls a saucer bullet exactly as it pulls the ship's " +
      "(specs/gravity.md, specs/saucer.md)",
  );
});
