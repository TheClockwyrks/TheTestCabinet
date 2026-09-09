// presentation/wheel-spokes-reach-its-ring — the wheel is drawn as a hub carrying
// its ring, with a spoke reaching each of the six fixture hexes.
//
// THE RULE. `specs/assets.md` puts "The wheel's spokes out to its fixture ring"
// under "What stays drawn in code", fixed by `specs/parts.md`, whose anatomy is
// "A `wheel` is a hub on its anchor hex carrying six fixture motes, one on each
// adjacent hex" — and `specs/field.md` asks that "A fixture reads as part of its
// wheel rather than as a loose mote". A spoke reaching each of the six is what
// carries that: the ring is drawn as held by the hub rather than as six motes that
// happen to sit around it.
//
// WHAT IS READ, AND WHY IT IS THE FRAME'S OPERATIONS RATHER THAN ITS PIXELS. A
// fixture hex carries a `48`-unit fixture mount and a `44`-unit mote sprite, and
// the wheel hub is `48` units across, so between the hub's edge and the mount's
// there is no stretch of the stage a spoke could be read on without a sprite over
// it. What settles the question instead is where the frame's own drawing REACHED:
// the operations it issued, each mapped through the transform in force at it
// (`drawing.ts`). A spoke that reaches a fixture hex names a point inside that hex
// — within `HEX_PITCH / 2` (`24`) of its centre, which is the hex's inradius —
// and nothing else the frame draws there does: a sprite centred on the hex names
// its top-left corner, `24` units or more away on both axes.
//
// THE COMPARISON IS AGAINST THE SAME FRAME WITHOUT THE WHEEL, so no width, colour
// or path shape is required of the build — and nothing is required of the bare
// field either. `specs/field.md` asks only that the field's hexes be "visible
// enough to place parts by" and `specs/ui.md` fixes no background, so a build may
// trace each cell inset from its pitch, dot its centre, or scatter stars over the
// sky, any of which names points inside a ring hex before a wheel exists. What is
// read is the DIFFERENCE the wheel makes: the points the wheel's frame names inside
// each ring hex that the bare frame did not.
//
// THE WHEEL IS PLACED INTO A LIVE RUN, which is what raises its ring: "While a run
// is live, a part one of them adds enters the run at its rest pose holding nothing,
// with a wheel's six fixtures on its spoke hexes" (`specs/instrumentation.md`). The
// run is held paused, so nothing turns between the two frames, and the bare opener
// emptied the field, so the six fixtures are the whole of what is on it.
//
// WHICH SIX HEXES. `specs/parts.md` puts one fixture "on each adjacent hex", and
// `wheelFixtureHexes` is that list, built from the `DIRS` of `specs/field.md`.
//
// THE VERDICT. With the wheel on the field the frame's drawing reaches inside all
// six fixture hexes at points the bare field's frame did not reach.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLength } from "../assert";
import { HEX_PITCH } from "../constants";
import { hexCenter, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  fixturesOf,
  openBareRun,
  placePart,
  pointsNear,
  type Harness,
} from "../harness";
import { wheelFixtureHexes } from "../parts";

/** How near a fixture hex's centre a drawn point counts as inside that hex. */
const INSIDE = HEX_PITCH / 2;

/** The six hexes `specs/parts.md` puts a wheel's fixtures on. */
const RING: readonly Hex[] = wheelFixtureHexes(ORIGIN);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** A drawn point as a key, so two frames' points can be set against each other. */
function keyOf(point: { x: number; y: number }): string {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
}

/** The distinct points the last frame's drawing named inside each fixture hex. */
async function reachedRing(): Promise<Set<string>[]> {
  const calls = await h.lastCalls();
  return RING.map(
    (hex) => new Set(pointsNear(calls, hexCenter(hex), INSIDE).map(keyOf)),
  );
}

it("draws a spoke reaching each of the wheel's six fixture hexes", async () => {
  await openBareRun(h, { challenge: BARE, paused: true });
  await h.advance(1);

  // What the bare field's frame names inside each ring hex, which is whatever the
  // build's cells and sky put there and is not the wheel's.
  const bare = await reachedRing();

  const wheel = await placePart(h, "wheel", ORIGIN, 0);
  // The editor outlines the selected part's hexes (`specs/editor.md`), which
  // would reach into the ring for a reason that is not a spoke.
  await h.debug.setSelected(null);
  await h.advance(1);
  await captureStill(h, "spokes");

  assertLength(
    fixturesOf(await h.snapshot(), wheel),
    RING.length,
    "the wheel placed into the live run raised its six fixtures, so the ring the spokes reach is really on the field",
  );

  for (const [index, reached] of (await reachedRing()).entries()) {
    const before = bare[index] as Set<string>;
    const gained = [...reached].filter((key) => !before.has(key));
    assertGreaterThanOrEqual(
      gained.length,
      1,
      `points the frame's drawing names inside the hex (${(RING[index] as Hex).q}, ${(RING[index] as Hex).r}) carrying the fixture on spoke ${index} that the bare field's frame did not, so the hub is drawn as carrying its ring`,
    );
  }
});
