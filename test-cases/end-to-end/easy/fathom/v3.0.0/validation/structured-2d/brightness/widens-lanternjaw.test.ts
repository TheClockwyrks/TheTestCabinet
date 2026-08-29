// brightness/widens-lanternjaw — brightness widens the Lanternjaw's reach.
//
// specs/predators/lanternjaw.md: "`R` grows with the forager's brightness `G`:
// `R = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G`, with `LANTERN_RANGE_BASE`
// (`128`) and `LANTERN_RANGE_GAIN` (`192`) in logical units. So `R` is `128` (4
// tiles) at `G = 0`, `320` (10 tiles) at `G = 1`, and rises smoothly between the
// two. The snapshot reports its current value as `detectRange`."
//
// That is the same dial the forager's own light turns, pointed the other way: the
// brighter the forager, the further the hunter senses it. It is read at five
// brightnesses across the range, so a build with the right endpoints and a wrong
// curve between them fails.
//
// THE HUNTER IS IN A ROOM OF ITS OWN. `poseApart` puts the forager's corridor and
// the Lanternjaw's patrol ring on one board with solid rock between them, and a
// posed fixture is exempt from specs/maze.md's one-connected-region rule
// (specs/instrumentation.md). At `G = 1` the range under measurement reaches ten
// tiles, so on any connected board the hunter would sense the forager and swim at
// it, and what the check would then be reading is a chase rather than a range.
// Sealed, the two never meet: no corridor joins them and no line between them is
// free of rock, so the Lanternjaw's own sense (which needs both) never fires, and
// it patrols its ring with its mind fully on.
//
// AND THE FORAGER STAYS DIM UNLESS THIS CHECK SAYS OTHERWISE. `clearPlankton`
// takes the plankton off the board without eating any of it
// (specs/instrumentation.md: "nothing here is eaten, so it scores nothing and
// clears no maze"), so the only thing that moves `G` is `setBrightness`.
//
// EACH READING IS TAKEN A BEAT AFTER THE POSE, because `detectRange` is DERIVED
// from `G` and a build that recomputes it at the top of the next step keeps the
// formula exactly as much as one that recomputes it inside the operation.

import { afterEach, beforeEach } from "vitest";
import { LANTERN_RANGE_BASE, LANTERN_RANGE_GAIN } from "../../src/constants";
import { assertLessThanOrEqual, assertNotEqual } from "../assert";
import { poseApart } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  check,
  denAll,
  failPrecondition,
  indexOfKind,
  parkForager,
  requireSceneHeld,
  sceneGuard,
} from "../scene";

/**
 * How far apart the two rooms are posed, in tiles.
 *
 * Twelve tiles is `384` logical units, past the `320` the range reaches at `G = 1`
 * — so even a build that traced its sense straight through rock would find nothing
 * at the far end of this board.
 */
const ROOMS_APART = 12;

/** How many tiles of corridor the Lanternjaw's patrol ring is built from. */
const RING_TILES = 3;

/** The brightnesses `detectRange` is read at. */
const SAMPLES: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

/** The review item's tolerance on the range, in logical units. */
const RANGE_TOLERANCE = 1;

/**
 * How far apart the brightest and dimmest `G` the build reports back must sit,
 * for the sweep below to have measured a range that WIDENS rather than five
 * readings of one range.
 *
 * The samples span the whole `[0, 1]` of `G`, and specs/instrumentation.md has
 * `setBrightness` pose the value outright and arm the hold in full, so a
 * conforming build reports the two ends as `0` and `1`. Four fifths of that is
 * room for a build whose hold is short of the second the specification gives it
 * without letting one that never moved `G` at all through.
 */
const BRIGHTNESS_SPAN = 0.8;

/** Ticks between posing a brightness and reading what was derived from it. */
const READ_BEAT = 2;

/** Ticks each posed brightness is held for the clip, after its reading is taken. */
const FILM_TICKS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check("Brightness widens the Lanternjaw's reach", async () => {
  startPlaying(h);
  const rooms = await poseApart(h, ROOMS_APART, { ring: RING_TILES });
  const lanternjaw = indexOfKind(h.snapshot(), "lanternjaw");
  if (lanternjaw < 0) {
    failPrecondition(
      "the roster to carry a Lanternjaw, whose detection range this point reads",
      "scoring/depth-scaling",
      "no lanternjaw on the roster",
    );
  }
  const quiet = await denAll(h, [lanternjaw]);
  h.debug.setPredatorTile(lanternjaw, rooms.far.tx, rooms.far.ty);
  h.debug.setPredatorState(lanternjaw, "wander");
  await parkForager(h, rooms.near);
  h.debug.clearPlankton();
  const watch = await sceneGuard(h, quiet);

  const sweep = await captureReplay(h, "range", async () => {
    const readings: {
      g: number;
      brightness: number;
      range: number | null;
    }[] = [];
    for (const g of SAMPLES) {
      h.debug.setBrightness(g);
      await h.advance(READ_BEAT);
      const snapshot = h.snapshot();
      readings.push({
        g,
        brightness: snapshot.brightness,
        range: snapshot.predators[lanternjaw]?.detectRange ?? null,
      });
      // Held on screen so the clip runs at this brightness; the reading above is
      // already taken, so nothing here can reach an assertion.
      await h.advance(FILM_TICKS);
    }
    return { readings, end: h.snapshot() };
  });

  requireSceneHeld(sweep.end, watch);

  // The sweep really did sweep. Without this, a build whose `G` never moved would
  // report one range at all five samples and clear the formula below at every one
  // of them, because the formula would be evaluated at the `G` it reported.
  const reported = sweep.readings.map((one) => one.brightness);
  const spanned = Math.max(...reported) - Math.min(...reported);
  if (spanned < BRIGHTNESS_SPAN) {
    failPrecondition(
      `G to move across the ${SAMPLES[0]} to ${SAMPLES[SAMPLES.length - 1]} ` +
        "this sweep posed it to, so there is a widening to read; " +
        "specs/instrumentation.md has setBrightness pose the value outright " +
        "and arm the hold in full",
      "brightness/holds-decays",
      `the reported G spanned ${spanned.toFixed(3)}`,
    );
  }

  // THE FORMULA IS HELD AGAINST THE BUILD'S OWN `G`, read out of the same
  // snapshot as the range, rather than against the brightness that was posed. The
  // two are the same figure on a conforming build, and on a build that lets a
  // posed `G` slip they are not. What this point claims is the RELATION between
  // the two, and that claim is decided either way; whether a posed `G` then holds
  // is brightness/holds-decays' verdict.
  for (const reading of sweep.readings) {
    assertNotEqual(
      reading.range,
      null,
      `the Lanternjaw's detectRange at G = ${reading.g}, which specs/state.md ` +
        "has it report as a number",
    );
    const expected =
      LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * reading.brightness;
    assertLessThanOrEqual(
      Math.abs((reading.range ?? Number.NaN) - expected),
      RANGE_TOLERANCE,
      `detectRange with G posed to ${reading.g} and reported as ` +
        `${reading.brightness.toFixed(4)}, against ` +
        `LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G (${expected.toFixed(2)})`,
    );
  }
});
