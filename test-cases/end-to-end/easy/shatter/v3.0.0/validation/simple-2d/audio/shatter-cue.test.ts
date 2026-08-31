// audio/shatter-cue — the cue a rock breaking plays.
//
// `specs/audio.md` fixes `shatter` (`CUES.shatter`) as the cue played when "A rock
// is destroyed", on the tick its event happens and at most once on that tick.
//
// THE ROCK IS SHOT DOWN, NOT TAKEN OFF THE FIELD. `specs/instrumentation.md` is
// explicit that `clearRocks()` "destroys nothing and scores nothing", and
// `removeRock(id)` is a removal rather than a destruction, so neither is the event
// this cue is on. A real round is placed on the rock's doorstep and the build's own
// collision pass resolves it (`specs/collision.md`: "A bullet and a rock — the
// bullet is removed and the rock is destroyed"), so the tick the rock leaves the
// roster is the tick its destruction happened on.
//
// A SMALL, SO ONE ROUND SETTLES IT UNDER EITHER VARIANT. `specs/rocks.md` gives a
// Small one hit under `warhead` as well as under `base`, and destroying one leaves
// no fragments, so the event is a single destruction with nothing else on the field
// to sound for.
//
// THE WHOLE WINDOW BEFORE THE KILL IS ASSERTED SILENT of this cue — the quiet lead
// on a posed rock, and the round's approach, which is a flight `specs/audio.md`
// names no cue for. So a build that blips as a round is created, or as one travels,
// is caught.
//
// WHAT THIS DOES NOT DECIDE. The split, which is `rocks/split-*`'s; the score,
// which is `scoring/small-scores-100`'s; and whether the six cues are told apart by
// ear, which is the reviewer's.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, MUZZLE_SPEED, ROCK_RADIUS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  aimedRound,
  captureStill,
  createHarness,
  poseBullet,
  poseRock,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { playedBeforeEvent, playedOnEvent, watchForEvent } from "./cues";

/**
 * Where the rock is posed, in logical field units.
 *
 * Far out from the star — about 420 units from `(STAR_X, STAR_Y)`, where the well
 * pulls at `MU / d^2`, some 25 units per second squared (`specs/gravity.md`) — so
 * the round's flight is a straight line to within hundredths of a unit and the
 * destruction is the build's collision pass rather than anything the environment
 * arranged. It is also clear of the ship at the safe point, which `startPlaying`
 * leaves at rest.
 */
const ROCK_X = 250;
const ROCK_Y = 200;

/** The quiet window driven on the posed rock before the round is placed. */
const QUIET_LEAD_TICKS = ticksFor(0.25);

/**
 * The ticks the round is given to land.
 *
 * `aimedRound` places it `ROCK_RADIUS.small + ROUND_STANDOFF` (`26`) units outside
 * the rock's centre, closing at `MUZZLE_SPEED` (`520` — `specs/weapons.md`), so a
 * conformant build resolves the hit inside six ticks. A quarter second is five
 * times that, so a build whose swept contact lands late still reaches its verdict
 * here rather than timing out.
 */
const FLIGHT_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.shatter on the tick the rock is destroyed, once, and not on the approach", async () => {
  startPlaying(h);
  const rock = poseRock(h, "small", ROCK_X, ROCK_Y);

  const kill = await watchForEvent(
    h,
    (s) => !s.rocks.some((one) => one.id === rock),
    QUIET_LEAD_TICKS + FLIGHT_TICKS,
    {
      quietLead: QUIET_LEAD_TICKS,
      arm: () => {
        const target = rockById(
          h.snapshot(),
          rock,
          "the Small this point destroys (specs/instrumentation.md: addRock " +
            "appends one rock of the size named)",
        );
        const round = aimedRound(target);
        poseBullet(h, round.x, round.y, round.vx, round.vy);
      },
    },
  );
  captureStill(h, "kill");

  assertEqual(
    kill.hit,
    true,
    `the posed Small was destroyed inside ${String(FLIGHT_TICKS)} ticks by a ` +
      `round placed on its doorstep and closing at ${String(MUZZLE_SPEED)} units ` +
      `per second, against its ${String(ROCK_RADIUS.small)}-unit collision radius ` +
      "(specs/collision.md)",
  );
  assertEqual(
    playedBeforeEvent(kill, CUES.shatter),
    0,
    `times CUES.shatter played over the ${String(kill.at - 1)} ticks before the ` +
      "rock came apart — a rock sitting on an emptied field and a round crossing " +
      "the gap to it, neither of which specs/audio.md names a cue for",
  );
  assertEqual(
    playedOnEvent(kill, CUES.shatter),
    1,
    "times CUES.shatter played on the tick the rock was destroyed — a cue is " +
      "played on the tick its event happens and at most once on that tick " +
      "(specs/audio.md)",
  );
});
