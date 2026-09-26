// Floe — audio/cue-hop: an accepted hop sounds, and a refused hop does not.
//
// WHAT CAN BE READ FROM OUTSIDE AN ENGINELESS BUILD, AND WHY THAT IS THE FAIR
// READING. Under an engine the game asks the cue bus for a cue BY NAME and the
// bus announces the play, so a check reads the name. There is no bus here:
// `specs/ui.md` hands the whole audio layer to the build and asks only that it
// synthesize the cues with the Web Audio API. So what is observed is the SOUND —
// the shared harness's audio probe watches the two doors a browser can emit
// audio through, and attributes each emission to the driven tick that produced
// it (`watchCues` in `../harness` says the whole of it). The cue's
// NAME is therefore not observable, and no check in this project asserts one;
// whether the ten are told apart by ear is the reviewer's. Nor is "exactly once"
// countable, because one cue may lawfully be several sources — a blip made of a
// tone and a noise burst is two sources and one cue. What IS assertable is that
// a stretch sounded, and that the stretches around it did not, which is what the
// checks in this directory are built out of. Every other file here refers back to
// this paragraph.
//
// THE RULE THIS POINT DECIDES. `specs/ui.md`: the `hop` cue plays when "an
// accepted hop is taken. A refused hop plays nothing." Both halves are read from
// ONE posed strait, because together they are what separates a build that cues
// the INPUT from one that cues the MOVEMENT. The near shore (`ROW_NEAR`, row
// `19`) is the bottom row of the grid, so a hop DOWN from it targets row `20` and
// is refused for being outside the grid (`specs/hopping.md`); a hop UP from it
// lands on row `18`, which `specs/strait.md` makes solid ice the critter may
// stand on anywhere, and this strait carries no vehicle to refuse it.
//
// AND THE CUE IS HELD TO THE HOP RATHER THAN TO THE KEY. The direction is
// RELEASED after the tick that delivers it, and the settle window that follows is
// longer than several of the `HOP_COOLDOWN` a HELD direction auto-repeats at
// (`specs/hopping.md`), so a build that blipped on every tick a key was down, or
// on every tick at all, sounds inside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { HOP_COOLDOWN, HOP_KEY, ROW_NEAR, START_COL } from "../constants";
import {
  captureReplay,
  createHarness,
  critterTile,
  startCrossing,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";

/**
 * A quarter second of posed strait recorded before anything is pressed.
 *
 * Long enough that a build sounding on a timer rather than on an event is heard:
 * it is two of the `HOP_COOLDOWN` (`0.12` s) `specs/hopping.md` fixes as the
 * game's shortest repeating interval.
 */
const QUIET_TICKS = ticksFor(0.25);

/**
 * Half a second driven after each key is released.
 *
 * Four of `HOP_COOLDOWN`, so a build that repeated a RELEASED direction — which
 * `specs/hopping.md` forbids, "a press released before the cooldown reaches `0`
 * produces exactly one hop" — would have hopped, and sounded, several times over
 * inside it.
 */
const SETTLE_TICKS = ticksFor(HOP_COOLDOWN * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the accepted hop and stays silent on the refused one", async () => {
  // An empty strait with the critter where a fresh crossing puts it: the near
  // shore at `START_COL`. Nothing else is on it, so every sound below is the
  // hop's.
  await startCrossing(h);
  await h.armAudio();

  const played = watchCues(h);
  const measured = await captureReplay(h, "hop", async () => {
    const beforeQuiet = played.length;
    await h.advance(QUIET_TICKS);
    const quiet = played.length - beforeQuiet;

    // DOWN from the bottom row of the grid: refused (specs/hopping.md).
    const beforeRefused = played.length;
    await h.hold(HOP_KEY.down);
    await h.advance(1);
    await h.release(HOP_KEY.down);
    await h.advance(SETTLE_TICKS);
    const refused = played.length - beforeRefused;
    const stood = critterTile(await h.snapshot());

    // UP onto the ice band, which this strait leaves clear: accepted.
    const beforeHop = played.length;
    await h.hold(HOP_KEY.up);
    await h.advance(1);
    const onHop = played.length - beforeHop;
    await h.release(HOP_KEY.up);

    const beforeSettle = played.length;
    await h.advance(SETTLE_TICKS);
    const afterHop = played.length - beforeSettle;
    const landed = critterTile(await h.snapshot());

    return { quiet, refused, stood, onHop, afterHop, landed };
  });

  assertEqual(measured.quiet, 0, "no sound on the posed strait");

  // The refused hop really was refused: it left the critter where it stood
  // (specs/hopping.md, "A refused hop leaves everything as it was").
  assertDeepEqual(
    measured.stood,
    { col: START_COL, row: ROW_NEAR },
    "the refused hop left the critter on the near shore",
  );
  assertEqual(measured.refused, 0, "no sound on the refused hop");

  // The accepted hop really moved the critter one tile up.
  assertDeepEqual(
    measured.landed,
    { col: START_COL, row: ROW_NEAR - 1 },
    "the accepted hop took the critter one row up",
  );
  assertGreaterThan(
    measured.onHop,
    0,
    "a sound on the tick the accepted hop is taken",
  );
  assertEqual(
    measured.afterHop,
    0,
    "no further sound once the direction is released",
  );
});
