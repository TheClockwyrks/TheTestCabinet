// waves/an-empty-field-does-not-clear-by-itself — an emptied field is not a cleared
// wave.
//
// `specs/progression.md`, Clearing a wave: "A wave clears on the tick in which the
// last rock on the field is destroyed. It is a transition, not a condition on the
// field: a field that holds no rocks and has had none destroyed on that tick is a
// wave being played, not a wave cleared." And `specs/instrumentation.md` says of
// `clearRocks`: it "empties the rocks alone. It destroys nothing and scores
// nothing."
//
// WHY THE NEGATIVE DIRECTION IS ITS OWN POINT. `clears-on-last-rock` grades a build
// that never turns a wave over. This grades the opposite mistake: a build that
// clears on a PREDICATE — "no rocks on the field" polled every tick — rather than
// on the destruction. On the positive direction alone the two are
// indistinguishable, since a predicate build turns the wave over on the last kill
// too. Both directions are load-bearing, so each carries an item and a build with
// one of the two defects loses one point rather than two.
//
// AND IT IS WHAT EVERY OTHER GROUP IN THIS PROJECT STANDS ON. `startPlaying` poses
// an EMPTY field for a check about bullets, or gravity, or the saucer, and it is
// this rule that makes that safe: a field that never held a rock is being played,
// not cleared. If the rule did not hold, every scenario in the case would have to
// park a bystander rock in a corner to stop a wave arriving in the middle of it —
// which is the defence the authoring guidance names as insufficient, and the one
// v3.0.0 removed.
//
// THE ONE CHECK IN THIS GROUP THAT MAY CALL `clearRocks`. Everywhere else in
// `waves` it is forbidden, because a cleared wave has to be reached by shooting.
// Here it is the instrument: it is precisely the operation that empties a field
// without destroying anything, so it is the only way to pose the state the rule is
// about.
//
// THE ROCKS ARE REAL BEFORE THEY ARE TAKEN. Two Large rocks stand on the field and
// the game runs with them for a moment before `clearRocks` takes them, so what is
// posed is a wave being PLAYED that then goes empty — not a game that never had a
// rock. A build that watches for the roster falling to zero sees exactly the fall
// it is watching for.
//
// TEN SECONDS, SAMPLED THROUGHOUT. The banner runs for a second and a half, so a
// wave raised and spawned and cleared again could come and go inside a longer
// window; the sweep therefore looks every four ticks — thirty times a second — for
// a banner, a change in the wave number, or a rock, and any one of the three ends
// it. The wave number and the roster are both sticky, so only the banner needs the
// cadence, and thirty samples a second against a banner that runs for a second and
// a half is forty-five chances to see it.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_BANNER_TIME } from "../constants";
import { assertLength, assertLessThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { STANDING_ROCKS } from "./scenario";

/** The wave the run is posed at, so a change in it is visible in either direction. */
const POSED_WAVE = 4;

/** How long the emptied field is watched: the review item's own figure. */
const QUIET_SECONDS = 10;
const QUIET_TICKS = ticksFor(QUIET_SECONDS);

/**
 * How many ticks separate two samples: four, so thirty a second.
 *
 * Fine enough that a banner running for `WAVE_BANNER_TIME` cannot open and close
 * between two samples — that is forty-five samples inside one banner — and coarse
 * enough that ten seconds of game time costs three hundred crossings rather than
 * twelve hundred. The other two things the sweep watches for, the wave number and
 * the rock roster, do not need a cadence at all: neither goes back.
 */
const POLL_TICKS = 4;

/** How long the field runs with its rocks on it before they are taken. */
const LIVE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises no banner and advances no wave over ten seconds of empty field", async () => {
  startPlaying(h);
  h.debug.setWave(POSED_WAVE);
  for (const at of STANDING_ROCKS) {
    poseRock(h, "large", at.x, at.y);
  }
  // The game's own wave loop, running: without it this item would be reading a
  // gate rather than the rule.
  h.debug.setWaveSpawning(true);
  await h.advance(LIVE_TICKS);

  const live = h.snapshot();
  assertLength(
    live.rocks,
    STANDING_ROCKS.length,
    "rocks on the field before it is emptied, so what follows is a wave being " +
      "played going empty rather than a game that never had a rock",
  );
  assertLessThanOrEqual(
    live.waveBanner,
    0,
    "the seconds left on the WAVE N banner on a field being played, before " +
      "anything is emptied",
  );

  // The instrument, and the only use of it anywhere in this group: an emptying
  // that destroys nothing (specs/instrumentation.md).
  h.debug.clearRocks();

  const stirred = await h.until(
    (snapshot) =>
      snapshot.waveBanner > 0 ||
      snapshot.wave !== POSED_WAVE ||
      snapshot.rocks.length > 0,
    { maxFrames: QUIET_TICKS, poll: POLL_TICKS },
  );
  captureStill(h, "quiet");

  assertTrue(
    !stirred.hit,
    `nothing but a destroyed rock clears a wave, so over ${QUIET_SECONDS} ` +
      `seconds of a field emptied by clearRocks specs/progression.md leaves ` +
      `waveBanner 0, wave ${POSED_WAVE} and the rock roster empty — after ` +
      `${stirred.frames} ticks this build reported waveBanner ` +
      `${stirred.snapshot.waveBanner}, wave ${stirred.snapshot.wave} and ` +
      `${stirred.snapshot.rocks.length} rocks (WAVE_BANNER_TIME is ` +
      `${WAVE_BANNER_TIME})`,
  );
});
