// audio/shatter-cue — the cue a rock breaking plays.
//
// `specs/audio.md` fixes `shatter` (`CUES.shatter`) as the cue played when "A rock
// is destroyed", on the tick its event happens.
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
// to sound for. Placing it far out from the star keeps the well off the reading:
// at this distance the pull is about 25 units per second squared, which bends the
// round by three hundredths of a unit over its flight.
//
// THE WHOLE WINDOW BEFORE THE KILL IS ASSERTED SILENT — the quiet lead on a posed
// rock, and the round's approach, which is a flight `specs/audio.md` names no cue
// for. So a build that blips as a round is created, or as one travels, is caught
// even though a cue's NAME is not observable from outside an engineless build
// (`./cues.ts`).
//
// WHAT THIS DOES NOT DECIDE. The split, which is `rocks/split-*`'s; the score,
// which is `scoring/*`'s; and whether the six cues are told apart by ear, which is
// the reviewer's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { MUZZLE_SPEED, ROCK_RADIUS } from "../constants";
import {
  armAudio,
  captureStill,
  createHarness,
  fireAt,
  poseRock,
  requireRock,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { soundsBeforeEvent, soundsOnEvent, watchForEvent } from "./cues";

/**
 * Where the rock is posed, in logical field units.
 *
 * Far out from the star — about 420 units from `(STAR_X, STAR_Y)`, where the well
 * pulls at `MU / d^2`, some 25 units per second squared — so the round's flight is
 * a straight line to within hundredths of a unit and the destruction is the
 * build's collision pass rather than anything the environment arranged. It is also
 * clear of the ship at the safe point, which `startPlaying` leaves at rest.
 */
const ROCK_X = 250;
const ROCK_Y = 200;

/** The quiet window driven on the posed rock before the round is placed. */
const QUIET_LEAD_TICKS = ticksFor(0.25);

/**
 * The ticks the round is given to land.
 *
 * `aimedRound` places it `ROCK_RADIUS.small + BULLET_R + ROUND_STANDOFF` (21
 * units) outside the rock's centre, closing at `MUZZLE_SPEED` (`520` —
 * `specs/weapons.md`), so a conformant build resolves the hit inside five ticks.
 * A quarter second is six times that, so a build whose swept contact lands late
 * still reaches its verdict here rather than timing out.
 */
const FLIGHT_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the tick the rock is destroyed, and not on the approach", async () => {
  await startPlaying(h);
  // A genuine, browser-trusted gesture: an engineless build's audio does not start
  // until the player has interacted with the page (`specs/audio.md`), and the key
  // is bound to nothing (`specs/controls.md`).
  await armAudio(h);
  const rock = await poseRock(h, "small", ROCK_X, ROCK_Y);

  const kill = await watchForEvent(
    h,
    (s) => rockById(s, rock) === undefined,
    QUIET_LEAD_TICKS + FLIGHT_TICKS,
    {
      quietLead: QUIET_LEAD_TICKS,
      arm: async () => {
        await fireAt(
          h,
          requireRock(await h.snapshot(), rock, "audio/shatter-cue"),
        );
      },
    },
  );
  await captureStill(h, "kill");

  assertEqual(
    kill.hit,
    true,
    `the posed Small was destroyed inside ${String(FLIGHT_TICKS)} ticks by a ` +
      `round placed on its doorstep and closing at ${String(MUZZLE_SPEED)} units ` +
      `per second, against its ${String(ROCK_RADIUS.small)}-unit collision radius ` +
      "(specs/collision.md)",
  );
  assertEqual(
    soundsBeforeEvent(kill),
    0,
    `sounds the build emitted over the ${String(kill.at - 1)} ticks before the ` +
      "rock came apart — a rock sitting on an emptied field and a round crossing " +
      "the gap to it, neither of which specs/audio.md names a cue for",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(kill),
    1,
    "sounds the build emitted on the tick the rock was destroyed — a rock being " +
      "destroyed plays CUES.shatter on that tick (specs/audio.md)",
  );
});
