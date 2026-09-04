// instrumentation/completion-off-carries-the-run-past-the-target — with the switch
// held off, a satisfied target ends nothing and the run keeps delivering.
//
// THE RULE. "Completion is the game's one autonomous consequence, and the surface
// carries a switch over it", and the switch's own table gives both columns
// (`specs/instrumentation.md`, The switch and the gates):
//
//   while it is ON  — "A boundary at which every set's tally has reached the
//     challenge's `target` completes the run, records the metrics, marks the
//     challenge solved, and unlocks what its mode unlocks."
//   while it is OFF — "The completion check does not fire. The run carries on past
//     a satisfied target, and nothing is recorded, solved, or unlocked."
//
// This point is the OFF column's first half: the check does not fire, and the run
// carries on. What the off column leaves untouched is the point next door.
//
// THE POSE is `First Light`, Extra 1 of `specs/challenges.md` — one `sol` in, the
// same `sol` out, `target` `6` — with a machine of ONE SET and nothing else, so the
// only thing that can move a tally is a constellation delivered onto that set's
// footprint, and the only thing that can end the run is the completion check.
// `specs/sigils.md` fixes what the set takes: "a constellation is accepted when it
// is unheld and is exactly the placed pattern", which a lone `sol` resting on the
// set's one hex is.
//
// THE TALLY IS CARRIED TO ONE SHORT OF THE TARGET WITH `setTally`, so the boundary
// under test is a boundary that REACHES the target rather than one that was already
// past it — which is exactly the boundary the ON column completes at. Then two more
// constellations are delivered over two more boundaries, and both of them land:
// "the run carries on past a satisfied target", so the deliveries after the target
// was met are deliveries like any other.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { CONSTELLATION_TARGET } from "../constants";
import { EAST } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  placeSet,
  spawnMote,
  tallyOf,
  type Harness,
} from "../harness";

/** `First Light` is Extra 1, whose one product is a lone `sol`. */
const EXTRA_INDEX = 0;

/** How many further constellations are delivered after the target is satisfied. */
const FURTHER = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("does not fire the completion check, and carries the run on past the target", async () => {
  await h.debug.reset();
  await h.debug.openChallenge("extras", EXTRA_INDEX);
  await h.debug.clearMachine();
  await placeSet(h, 0, EAST);
  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();

  const opened = await h.snapshot();
  assertEqual(opened.completion, false, "the completion switch is held off");
  assertEqual(
    opened.challenge?.target,
    CONSTELLATION_TARGET,
    "First Light asks for CONSTELLATION_TARGET constellations",
  );

  // One short of the target, with the constellation that reaches it on the set.
  await h.debug.setTally(0, CONSTELLATION_TARGET - 1);
  await spawnMote(h, EAST, "sol");

  const carried = await captureReplay(h, "carried", async () => {
    await advanceCycles(h, 1);
    const satisfied = await h.snapshot();
    for (let i = 0; i < FURTHER; i += 1) {
      // A build that wrongly completed here has no live run left to spawn onto,
      // and `spawnMote` "requires a live run and throws an Error without one".
      // The verdict below is what decides the point either way; this only keeps
      // a build that broke the rule from failing on the arrangement instead of
      // on the reading.
      const live = (await h.snapshot()).sim;
      if (live !== null && live.status === "running") {
        await spawnMote(h, EAST, "sol");
      }
      await advanceCycles(h, 1);
    }
    return satisfied;
  });

  assertNotNull(
    carried.sim,
    "the run is live at the boundary that reached the target",
  );
  assertEqual(
    tallyOf(carried, 0),
    CONSTELLATION_TARGET,
    "the boundary delivered the constellation that reached the challenge's target",
  );
  assertEqual(
    carried.sim?.status,
    "running",
    "and with the switch off the completion check does not fire: the run stays running",
  );
  assertNull(
    carried.sim?.metrics ?? null,
    "and nothing is recorded at a boundary the check never reached",
  );

  const later = await h.snapshot();
  assertEqual(
    later.sim?.status,
    "running",
    "the run carries on past the satisfied target",
  );
  assertEqual(
    tallyOf(later, 0),
    CONSTELLATION_TARGET + FURTHER,
    "delivering further constellations, which are counted like any other",
  );
  assertGreaterThan(
    later.sim?.cycle ?? -1,
    carried.sim?.cycle ?? 0,
    "over further cycles the satisfied target did not end",
  );
  assertNull(later.sim?.metrics ?? null, "and still nothing is recorded");
});
