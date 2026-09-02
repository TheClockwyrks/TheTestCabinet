// instrumentation/saucer-travel-gate — `setSaucerTravel(false)` shuts the saucer's
// locomotion, so its centre holds where it stands while its gun runs on.
//
// WHAT THE GATE COVERS. `specs/instrumentation.md`: it "Gates the saucer's
// locomotion alone: its centre holds where it stands. Its mind and its gun run on,
// so a held saucer still rerolls its weave and still fires." So the item has two
// halves and they pull against each other: the CENTRE must not move, and the gun
// must go on firing from it. A build that answered the gate by taking the saucer
// off the update entirely would hold the centre perfectly and fail the second half,
// which is exactly the wrong model worth naming — and it is the model that would
// silently disarm the held saucer every `saucer` and `lives` scenario in this
// project poses.
//
// THE MIND IS SHUT SO THE CENTRE IS THE ONLY VARIABLE. `specs/saucer.md` weaves by
// setting a vertical VELOCITY, which a held saucer would carry without moving —
// so leaving the mind on would put a changing velocity beside a fixed position and
// make the reading harder to state without making it stronger. The gun stays on,
// because the second half of the requirement is about it.
//
// AND THE HOLD IS PROVED AGAINST A CROSSING. A saucer that never travels at all
// holds its centre perfectly, so the OFF leg alone is passed by a build with no
// locomotion. The same pose is therefore flown a second time with the gate open,
// where `specs/saucer.md` carries the craft across the field at `SAUCER_SPEED`
// (140) — so what the OFF leg reports is a hold, and not a saucer that could never
// have moved.
//
// The window is one fire interval rather than the single second the item names, so
// both halves are decided on the same run: `specs/saucer.md` takes the first shot
// one `SAUCER_FIRE_INTERVAL` (1.6 seconds) after the craft arrives, and the centre
// is read at the one-second mark as well as at the end.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_FIRE_INTERVAL, SAUCER_SPEED } from "../constants";
import {
  assertCloseTo,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  startPlaying,
  theSaucer,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the saucer stands: the upper left, well clear of the star and the ship. */
const SAUCER_PLACE = { x: 300, y: 160 } as const;

/** The first reading, a second in, which is the moment the item names. */
const SECOND_FRAMES = ticksFor(1);

/** The whole window: one fire interval, by which a held saucer must have fired. */
const WINDOW_FRAMES = ticksFor(SAUCER_FIRE_INTERVAL);

/**
 * The decimal places a held centre is read to.
 *
 * Six, which is to say exactly. `specs/instrumentation.md` says the centre "holds
 * where it stands", and `specs/saucer.md` says the well never pulls the saucer, so
 * nothing in the game writes a position for it while the gate is shut.
 */
const HELD_DIGITS = 6;

/**
 * How far the crossing leg must have carried the saucer, in logical units.
 *
 * Half of the `SAUCER_SPEED` (140) `specs/saucer.md` fixes, over the one second
 * read at. Generous by design: what the contrast leg has to establish is that the
 * craft CAN move, so that the hold above is a hold; how fast it crosses is
 * `saucer/crosses-at-140`'s to decide.
 */
const CROSSING_FLOOR = SAUCER_SPEED / 2;

let h: Harness;

/** Stand a saucer with its mind shut, its gun running, and the travel gate set. */
function poseTheSaucer(travel: boolean): void {
  startPlaying(h);
  poseSaucer(h, SAUCER_PLACE.x, SAUCER_PLACE.y);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(true);
  h.debug.setSaucerTravel(travel);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the saucer's centre with travel off, while its gun goes on firing", async () => {
  poseTheSaucer(false);

  // A second in, which is the reading the item names.
  await h.advance(SECOND_FRAMES);
  const second = theSaucer(h.snapshot(), "the held saucer, a second in");
  assertCloseTo(
    second.x,
    SAUCER_PLACE.x,
    HELD_DIGITS,
    "the centre x a saucer with setSaucerTravel(false) reported a second on",
  );
  assertCloseTo(second.y, SAUCER_PLACE.y, HELD_DIGITS, "and its centre y");

  // And out to the fire interval, by which a saucer's gun has taken its first
  // shot (specs/saucer.md), with the centre still where it was posed.
  await h.advance(WINDOW_FRAMES - SECOND_FRAMES);
  captureStill(h, "held");
  const end = h.snapshot();
  const stood = theSaucer(end, "the held saucer at the end of the window");
  assertCloseTo(
    stood.x,
    SAUCER_PLACE.x,
    HELD_DIGITS,
    "the centre x a held saucer reported a fire interval on",
  );
  assertCloseTo(stood.y, SAUCER_PLACE.y, HELD_DIGITS, "and its centre y");
  assertGreaterThanOrEqual(
    end.enemyBullets.length,
    1,
    "the shots a held saucer's gun took over one SAUCER_FIRE_INTERVAL " +
      "(specs/instrumentation.md: a held saucer still fires)",
  );

  // And the same pose with the gate open really does carry the craft away, so
  // what was read above is a hold rather than a saucer that never travels.
  poseTheSaucer(true);
  await h.advance(SECOND_FRAMES);
  const flown = theSaucer(h.snapshot(), "the travelling saucer, a second in");
  assertGreaterThanOrEqual(
    Math.abs(flown.x - SAUCER_PLACE.x),
    CROSSING_FLOOR,
    "how far a saucer with setSaucerTravel(true) crossed in a second, in " +
      "logical units (specs/saucer.md: it crosses at SAUCER_SPEED)",
  );
  assertLessThanOrEqual(
    Math.abs(flown.y - SAUCER_PLACE.y),
    1,
    "how far the crossing carried it off its row, with its mind shut",
  );
});
