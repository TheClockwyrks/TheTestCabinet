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
//
// AND EACH IS HELD AGAINST THE `G` THE BUILD ITSELF REPORTS IN THAT SAME READING,
// not against the value posed a beat earlier. The claim is a relation between two
// fields of one snapshot — `detectRange` is `LANTERN_RANGE_BASE +
// LANTERN_RANGE_GAIN * G` — and reading `G` beside the range is the only way to
// grade the relation alone. Whether a posed `G` is still standing a beat later is
// the brightness hold, which `brightness/holds-decays` owns; a build that let it
// slip would otherwise fail here too, for a range that is right about the
// brightness the build actually had. What this check keeps for itself is that the
// samples SPAN the dial: a reported `G` that never moved leaves no curve for a
// range to follow, and the check fails on that rather than on a range that is
// flat because its input was.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertNotEqual,
} from "../assert";
import {
  BRIGHT_HOLD,
  LANTERN_RANGE_BASE,
  LANTERN_RANGE_GAIN,
} from "../constants";
import { poseApart, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  poseBrightness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";

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
 * How far the reported `G` must move across the sweep for the readings to be a
 * curve rather than one point.
 *
 * Half the dial. {@link SAMPLES} asks for the whole of it, so a build whose hold
 * lets a posed value slip a little still clears this by a wide margin, and one
 * that ignored `setBrightness` altogether does not.
 */
const SPAN_MIN = 0.5;

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

it("Brightness widens the Lanternjaw's reach", async () => {
  await startPlaying(h);
  const rooms = await poseApart(h, ROOMS_APART, { ring: RING_TILES });
  // What is read is the range it REPORTS as the dial turns, which its mind
  // computes; its travel is held, so the reading is taken on one standing pose.
  const lanternjaw = await spawnPredator(h, "lanternjaw", rooms.far, {
    state: "wander",
    travel: false,
  });
  await parkForager(h, rooms.near);
  const watch = await sceneGuard(h);

  const sweep = await captureReplay(h, "range", async () => {
    const readings: { g: number; range: number | null }[] = [];
    for (const posed of SAMPLES) {
      await poseBrightness(h, posed, BRIGHT_HOLD);
      await h.advance(READ_BEAT);
      const read = h.snapshot();
      readings.push({
        g: read.brightness,
        range: read.predators[lanternjaw]?.detectRange ?? null,
      });
      // Held on screen so the clip runs at this brightness; the reading above is
      // already taken, so nothing here can reach an assertion.
      await h.advance(FILM_TICKS);
    }
    return { readings, end: h.snapshot() };
  });

  requireSceneHeld(sweep.end, watch);

  // The dial really moved. Without this the readings could all be one G and a
  // build with a flat range would pass on a curve nobody drove.
  const reported = sweep.readings.map((reading) => reading.g);
  const span = Math.max(...reported) - Math.min(...reported);
  assertGreaterThanOrEqual(
    span,
    SPAN_MIN,
    `the span of the brightnesses the build reported across the sweep, which ` +
      `setBrightness poses and setBrightHold holds steady ` +
      `(specs/instrumentation.md) — a build whose G does not move has no curve ` +
      "for a range to follow",
  );

  for (const reading of sweep.readings) {
    assertNotEqual(
      reading.range,
      null,
      `the Lanternjaw's detectRange at G = ${reading.g}, which specs/state.md ` +
        "has it report as a number",
    );
    const expected = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * reading.g;
    assertLessThanOrEqual(
      Math.abs((reading.range ?? Number.NaN) - expected),
      RANGE_TOLERANCE,
      `detectRange at the G = ${reading.g.toFixed(3)} the build reported ` +
        `beside it, against LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G ` +
        `(${expected.toFixed(2)})`,
    );
  }
});
