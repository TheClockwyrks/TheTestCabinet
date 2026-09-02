// Meltdown — audio/fire-cue: an emitter landing a shot plays the `fire` cue on
// the frame the shot resolves, and plays nothing else.
//
// `specs/audio.md` binds `fire` to "an emitter's shot resolves" and fixes the
// frame: "A cue is raised by the frame that resolves the event it answers, and it
// is played from the frame loop, so a cue always names one real frame." So the
// measurement is the shot's own frame — read by the frame `damageDealt` first
// rises, which `specs/combat.md` makes the frame the shot resolved on — against
// the frames before it.
//
// THE SHOT IS REAL. No operation of the debug surface plays a cue and none can
// (`specs/instrumentation.md`), so the emitter acquires its own target and runs
// its own fire clock; what is posed is the floor it does that on.
//
// THE HEAT IS PINNED, SO THE CLIP CANNOT BE A TRIP. `setTowerThermal(id, false)`
// holds the heat exactly where it was posed "while it goes on acquiring targets,
// firing at its rate, and dealing its damage at that pinned heat"
// (`specs/instrumentation.md`), so nothing on this floor can reach `100` and
// raise the `trip` cue. The target's hp is far past what the shot removes and its
// motion is off, so it neither dies nor leaks. Every one of the other nine cues
// is therefore unreachable here, which is what makes "and nothing else" a
// reading of the build rather than of the scenario.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../constants";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseTarget,
  posePinnedTower,
  startRun,
  ticksFor,
  towerById,
  watchCues,
  type Harness,
} from "../harness";
import { playedBefore, playedOn } from "./cues";

/** The tile the Arc's 2x2 footprint is anchored on: quiet floor, off every opening. */
const TOWER = { col: 10, row: 10 } as const;

/**
 * The tile the target stands on.
 *
 * The Arc's range is `6.0` tiles from its footprint centre (`specs/towers.md`),
 * measured as `specs/combat.md` states; this tile's centre is about `3.5` tiles
 * out, comfortably inside it at level I and nowhere near the boundary, because
 * this point is about the cue and not about where range ends.
 */
const TARGET = { col: 14, row: 10 } as const;

/**
 * The target's hp, and its maximum.
 *
 * An Arc at heat `0` removes `6 * heatMultiplier(0, 80)`, which is `6 * 0.35` =
 * `2.1` per shot (`specs/towers.md`, `specs/heat.md`). A pool four orders of
 * magnitude past that cannot be emptied inside this check's window, so the
 * reading is a shot and never a kill.
 */
const TARGET_HP = 100_000;

/**
 * How long the shot is given to land.
 *
 * `specs/combat.md` lands the first shot "one full interval after the target was
 * acquired", and the Arc's fire rate is `2.0` shots per second at level I
 * (`specs/towers.md`), so a conforming build resolves it `0.5` seconds in. Three
 * seconds is a hard ceiling six times that: a build that is merely slow fails
 * here rather than leaving the point inconclusive.
 */
const SHOT_TICKS = ticksFor(3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the fire cue on the frame the shot resolves, and nothing else", async () => {
  startRun(h);
  const arc = posePinnedTower(h, "arc", TOWER.col, TOWER.row, 0);
  poseTarget(h, "mote", TARGET.col, TARGET.row, TARGET_HP);

  // Subscribed after the floor is posed, so what is read is the drive alone.
  const played = watchCues(h);

  // `damageDealt` accumulates "the hp each of its shots actually removed"
  // (specs/combat.md), so the frame it first rises is the frame a shot resolved
  // on — the frame specs/audio.md puts the cue on.
  const shot = await h.until((s) => (towerById(s, arc)?.damageDealt ?? 0) > 0, {
    maxFrames: SHOT_TICKS,
  });
  const frame = h.engine.frame().count;
  captureStill(h, "fire");

  assertEqual(
    shot.hit,
    true,
    `the Arc resolved a shot on the target inside ${String(SHOT_TICKS)} ` +
      "frames (specs/combat.md, The fire clock)",
  );
  assertLength(
    playedBefore(played, frame),
    0,
    "cues that played on any frame before the shot resolved — a cue is raised " +
      "by the frame that resolves the event it answers (specs/audio.md)",
  );
  assertDeepEqual(
    playedOn(played, frame),
    [CUES.fire],
    "the cues that played on the frame the shot resolved: the fire cue, and " +
      "nothing else (specs/audio.md)",
  );
  assertGreaterThan(
    played[0].gain,
    0,
    "the gain the fire cue played at on an unmuted bus (specs/audio.md)",
  );
});
