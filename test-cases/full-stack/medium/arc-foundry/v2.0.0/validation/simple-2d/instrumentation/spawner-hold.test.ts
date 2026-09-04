// instrumentation/spawner-hold — `spawnUnit` releases exactly the unit it names,
// and nothing else arrives while it is on the yard.
//
// THIS IS THE HOLD EVERY LOAD-FACING CHECK IN THIS PROJECT STANDS ON.
// `specs/instrumentation.md` makes `spawnUnit` put the run into a live wave whose
// spawn schedule is EMPTY, so a scenario that poses one Slug is a scenario about
// one Slug. A build whose `spawnUnit` merely starts the level's own composed wave
// would leave a check on a Choke's slow reading whichever of nine units the
// pathfinder happened to put in range first — and it would pass or fail at
// random rather than saying anything.
//
// THE HOLD IS NARROW, AND THAT IS THE OTHER HALF. It is a hold on the spawner and
// on nothing else: the wave still clears the ordinary way, when every unit it
// released has died or leaked, and clearing it opens the next build phase. So the
// released unit is grounded out at the collector and the run is read again.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertLength } from "../assert";
import {
  COLLECTOR_WAYPOINT,
  captureReplay,
  createHarness,
  mapById,
  openYard,
  releaseUnit,
  tileCenter,
  type Harness,
} from "../harness";

/** The wave the run is posed at: deep enough to compose a crowd of its own. */
const WAVE = 6;

/** How long the yard is watched for an arrival the surface never asked for. */
const HOLD_SECONDS = 10;

/** How long the grounding-out is waited for, in frames of the 120 Hz clock. */
const LEAK_FRAMES = 600;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("releases one unit into a wave that spawns nothing else, and clears", async () => {
  openYard(h, { wave: WAVE });
  const collector = mapById(h.snapshot().map).collector;
  const sink = tileCenter(collector.col, collector.row);

  const driven = await captureReplay(h, "hold", async () => {
    const id = releaseUnit(h, "mote");
    const opened = h.snapshot();

    // Ten seconds of the wave running itself. A composed wave of this depth
    // would have released a good deal by now.
    await h.advanceSeconds(HOLD_SECONDS);
    const held = h.snapshot();

    // Then ground the released unit out, which is the ordinary way this wave has
    // to end: it is the only unit the wave ever held.
    h.debug.setUnitWaypoint(id, COLLECTOR_WAYPOINT);
    h.debug.setUnitPosition(id, sink.x, sink.y);
    const cleared = await h.until((s) => !s.waveActive, {
      maxFrames: LEAK_FRAMES,
    });
    return { id, opened, held, cleared };
  });

  // Releasing from a build phase puts the run into a live wave.
  assertEqual(driven.opened.waveActive, true, "the wave spawnUnit opened");
  assertEqual(
    driven.opened.phase,
    "wave",
    "the phase a unit released from a build phase leaves the run in",
  );

  // And that wave's spawner is held: the yard still carries exactly the one unit
  // the surface released.
  assertLength(
    driven.held.units,
    1,
    `the units on the yard ${HOLD_SECONDS}s into a wave whose schedule is empty`,
  );
  assertEqual(
    driven.held.units[0]!.id,
    driven.id,
    "the id of the one unit left on the yard",
  );
  assertEqual(
    driven.held.wave,
    WAVE,
    "the wave counter, which spawnUnit spends nothing of",
  );

  // The hold is on the spawner alone, so the wave still clears the ordinary way
  // once the unit it released is gone, and the next build phase opens.
  assertEqual(
    driven.cleared.hit,
    true,
    "the wave clearing once the unit it released grounded out",
  );
  assertLength(
    driven.cleared.snapshot.units,
    0,
    "the units left once the released unit grounded out",
  );
  assertEqual(
    driven.cleared.snapshot.phase,
    "build",
    "the phase a cleared wave opens",
  );
});
