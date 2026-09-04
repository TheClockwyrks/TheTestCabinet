// audio/creak-needs-a-crossing — the creak needs a CROSSING, not a level.
//
// specs/ui.md § Audio, the `creak` row: the cue plays when "a member's
// utilization reaches `CREAK_THRESHOLD` (`0.8`) on a tick HAVING BEEN BELOW IT ON
// THE TICK BEFORE". The second clause is the whole of this point. A build that
// reads the level alone — creak whenever some member sits at or above `0.8`, gated
// only by `CREAK_COOLDOWN` — sounds identical on the tick the load comes on and
// then creaks again every thirty ticks for as long as the load hangs, which is a
// crane that groans forever under a steady load.
//
// THE CROSSING IS MADE ONCE AND THE LOAD IS THEN LEFT ALONE. The minimal crane
// carries the bare hook at a utilization well below `0.8`; hanging a load on the
// hook lifts one member across the threshold on a single known tick, and after
// that nothing changes — no axis drives the pivot, no member breaks, the bob
// hangs at rest — so every tick after the crossing has a member at or above `0.8`
// having also been at or above it on the tick before. That is exactly the state
// the rule says is silent.
//
// SIXTY TICKS IS TWO WHOLE COOLDOWNS. `CREAK_COOLDOWN` (`0.5`) run-clock seconds
// is `30` ticks, so a build gating on the level alone would creak twice more
// inside the window this check reads — the first of them thirty ticks in, which
// is well short of the window's end. Reading fewer than one cooldown would decide
// nothing, and reading more than two only repeats a verdict already reached.
//
// THE CUES ARE TAKEN ONCE, AT THE END OF THE WINDOW. `cues()` reports every sound
// played since the last call, so one reading after the window carries whatever
// fell anywhere inside it. The utilization is the reading that has to be taken
// tick by tick, because what makes the silence mean anything is a member held over
// the threshold on EVERY tick rather than at the window's two ends.
//
// THE LOAD IS HUNG THROUGH THE SURFACE rather than through an `attach` step:
// specs/instrumentation.md has `setLoadPhase` to `"attached"` hang the load "on
// the hook exactly as a successful `attach` leaves it", so the crossing is reached
// without the candidate rules of specs/rigging.md standing in the way, and it falls
// on a tick this check knows the number of.
//
// THE MASS IS CHOSEN SO THE MEMBER CROSSES AND SURVIVES. The load takes the
// crane's worst utilization from below `0.8` to comfortably inside `[0.8, 1)`,
// so the crossing is unambiguous and no member breaks — a break would end the
// scenario and raise cues of its own. The utilization is read off `run.forces`
// every tick rather than assumed, so the silence is only ever read against a
// member that is genuinely still over the threshold.
//
// THE TAPE IS ONE LONG `grip` MOVE, the only axis whose motion moves neither the
// pivot nor the cable — "Turning the grip applies no force to anything"
// (specs/rigging.md § The grip) — so the run keeps running with the loading
// untouched.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import {
  CREAK_COOLDOWN,
  CREAK_THRESHOLD,
  GRIP_MAX_RATE,
  HOIST_START,
  TICK_HZ,
} from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the hook hangs at the run's start: the pivot minus `(0, L, 0)`. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z, yaw: 0 };

/**
 * The mass hung on the hook: enough to take the worst member from below `0.8`
 * to inside `[0.8, 1)`, so the crossing is unambiguous and nothing breaks.
 */
const LOAD_MASS = 170;

/** A move that keeps the run running and loads nothing. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** Two whole cooldowns of held load, in ticks. */
const HELD_TICKS = 2 * CREAK_COOLDOWN * TICK_HZ;

/** The worst utilization the latest solve reports. */
function worstUtilization(snapshot: GantrySnapshot): number {
  return snapshot.run.forces.reduce(
    (worst, member) => Math.max(worst, member.utilization),
    0,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creaks on the crossing tick and stays silent while the member is held over the threshold", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h, [HOLD]);
  await startRun(h);

  // Two ticks of the bare hook, so the crossing is neither the run's first tick
  // — "no member creaks on a run's first tick" — nor the tick the run started on.
  const bare = await runTicks(h, 2);
  assertLessThan(
    worstUtilization(bare),
    CREAK_THRESHOLD,
    "the crane's worst utilization under the bare hook, so the load's arrival " +
      `is a crossing of CREAK_THRESHOLD (${CREAK_THRESHOLD}) from below ` +
      "(specs/ui.md § Audio, the `creak` row)",
  );
  await h.cues();

  await h.debug.setLoadPhase(0, "attached");
  const crossing = await runTicks(h, 1);
  const atCrossing = await h.cues();
  assertGreaterThanOrEqual(
    worstUtilization(crossing),
    CREAK_THRESHOLD,
    `the crane's worst utilization once ${LOAD_MASS} hangs on the hook, so a ` +
      "member reached CREAK_THRESHOLD on this tick having been below it on " +
      "the tick before",
  );
  assertContains(
    atCrossing,
    "creak",
    `the cue the crossing tick (${crossing.run.tick}) raises (specs/ui.md § ` +
      "Audio, the `creak` row)",
  );

  // The load hangs and nothing else moves. Every tick from here has a member at
  // or above the threshold that was ALSO at or above it on the tick before, so
  // the rule says every one of them is silent.
  let worstHeld = Number.POSITIVE_INFINITY;
  for (let i = 0; i < HELD_TICKS; i += 1) {
    const held = await runTicks(h, 1);
    worstHeld = Math.min(worstHeld, worstUtilization(held));
  }
  const heard = await h.cues();
  const creaks = heard.filter((cue) => cue === "creak");
  const after = await h.snapshot();
  await h.capture(
    "creak",
    `the load held on the hook for ${HELD_TICKS} ticks after the crossing`,
  );

  assertEqual(
    after.run.phase,
    "running",
    "the run across the held window, so nothing broke and no other verdict " +
      "reached the tick that could have silenced the crane",
  );
  assertGreaterThanOrEqual(
    worstHeld,
    CREAK_THRESHOLD,
    "the crane's worst utilization on every tick of the held window, so each " +
      "of them had a member at or above CREAK_THRESHOLD that was there on " +
      "the tick before too",
  );
  assertEqual(
    creaks.length,
    0,
    `the creaks in the ${HELD_TICKS} ticks after the crossing — two whole ` +
      `CREAK_COOLDOWN (${CREAK_COOLDOWN}s) windows — with the member held ` +
      "over the threshold the whole time: the cue needs a member that was " +
      "BELOW the threshold on the tick before, so a level that never falls " +
      `raises nothing (specs/ui.md § Audio). The window sounded ` +
      `[${heard.join(", ")}]`,
  );
});
