// drones/prism-escort — a Prism flies in between two Shards of opposite bands.
//
// specs/drones.md, Its escort: "A Prism enters the wave with `PRISM_ESCORTS` (`2`)
// Shards, one of each band, flying in alongside it before taking their own slots.
// The escort travels with the Prism's entry group." It is the wave's one piece of
// choreography a player can read: the Prism announces itself, and the two bands
// beside it say the drone behind them costs a shot of each.
//
// WHAT IS DRIVEN. The wave the GAME builds, through `startStage`, with nothing
// posed and the wave's own entry gate opened: the grouping under test IS the wave's
// own, so a posed field could only grade the pose, and `waveEntry` is the one gate
// this item's requirement is. specs/swarm.md gives the entrance its shape — groups
// released `ENTER_GROUP_GAP` (`0.6` s) apart, each drone across `FIELD_TOP` within
// a second of its release and at its slot within six — so the whole entrance is
// swept rather than read at one instant.
//
// WHY THE WHOLE ENTRANCE, AND WHY "IN MOTION". This is the defect v1.0.0's own
// manifest records against this item. Counting entering drones at one chosen
// instant passed a build that lists its whole wave as `entering` from the first
// frame — fifteen Shards, none of them near the Prism — and failed a build that
// staggers its groups honestly, because the chosen instant caught one escort
// airborne and not the other. The reading that fixes it comes from the
// specification: specs/swarm.md says "A drone that has not been released holds its
// starting point", so a drone whose centre has not moved between two samples has
// not been released, whatever phase it reports.
//
// WHICH DRONES ARE "THE ESCORT". Its ENTRY GROUP, which specs/drones.md names
// outright. A group is released as one — the wave's clock reaches `ENTER_GROUP_GAP`
// times the group's index and every drone in it starts flying — so the drones that
// FIRST MOVE on the same sample as the Prism are its group, and consecutive groups
// are `0.6` s, twelve samples, apart. Reading the group this way is what keeps the
// check honest: `ESCORT_RADIUS` has to be wide enough to be fair to any entrance a
// build designs, which makes it wide enough for a Shard of the NEXT group to drift
// through it, and a build whose two real escorts share a band would otherwise be
// handed the missing band by a stranger passing at 300 units.
//
// SO TWO THINGS ARE READ, ONE FOR EACH HALF OF THE SENTENCE. That the Prism's own
// entry group carries a Shard of each band, and that at some instant
// `PRISM_ESCORTS` of them are in flight within `ESCORT_RADIUS` of it at once —
// "flying in alongside it". The best instant of the entrance decides the second, so
// a build whose escorts converge on the Prism part-way through its arc is judged at
// the moment the escort exists rather than on whichever frame the sweep happened to
// land on.

import { afterEach, beforeEach, it } from "vitest";
import { ENTER_GROUP_GAP, PRISM_ESCORTS } from "../constants";
import { assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  distanceBetween,
  startPosed,
  startStage,
  ticksFor,
  type Band,
  type DroneSnapshot,
  type Harness,
} from "../harness";

/** The stage whose entrance is swept: a standard wave, so it holds a Prism. */
const STAGE = 1;

/** The two bands specs/bands.md fixes; there is no third and no neutral value. */
const BANDS: readonly Band[] = ["cyan", "magenta"];

/**
 * How near the Prism a Shard must fly to be flying in alongside it, in logical
 * units.
 *
 * NOT AN ASSERTED FIGURE. No statement fixes an escort radius, so this is an honest
 * tolerance on the word "alongside", and it is v1.0.0's own hardened value carried
 * forward with its reasoning. The slot grid is `SLOT_DX` (`64`) wide per column, so
 * a group of three entering together spans a couple of hundred units; `320` is a
 * quarter of the field's width — comfortably alongside for any entrance
 * choreography a build designs, and nowhere near loose enough to sweep in a drone
 * entering on the other side of the stage. IT MUST NOT BE TIGHTENED: at
 * `ENTER_SPEED` (`260`) a trio flown single-file `ENTER_GROUP_GAP` apart sits `156`
 * units apart and satisfies every stated requirement.
 */
const ESCORT_RADIUS = 320;

/**
 * How far a drone's centre must move between two samples to count as flying, in
 * logical units.
 *
 * specs/swarm.md makes an unreleased drone hold its starting point exactly, so any
 * movement at all separates released from waiting. Half a unit is a floor against
 * floating-point noise rather than a speed: at `ENTER_SPEED` (`260`) a released
 * drone covers `13` units between two samples, twenty-six times this.
 */
const MOVED_EPSILON = 0.5;

/**
 * Frames between two samples of the entrance.
 *
 * A twelfth of `ENTER_GROUP_GAP` (`0.6` s), so two groups released one gap apart
 * are twelve samples apart and no sampling error can put a drone of one in the
 * other.
 */
const POLL = ticksFor(ENTER_GROUP_GAP / 12);

/**
 * Frames the entrance is swept for.
 *
 * specs/swarm.md releases a wave "in between two and eight groups", each
 * `ENTER_GROUP_GAP` (`0.6` s) after the one before it, and every drone is at its
 * slot "within six seconds of its release" — so the longest entrance a build may
 * fly is `7 * 0.6 + 6` = `10.2` s. Twelve seconds covers it with room to spare, and
 * the sweep stops itself as soon as the escort is seen or the entrance is over.
 */
const SWEEP_FRAMES = ticksFor(12);

/**
 * Frames held after the escort is seen, so the clip shows it flying rather than
 * cutting on the frame the reading was taken.
 */
const HOLD_FRAMES = ticksFor(0.9);

/** What the sweep found across the whole entrance. */
interface Entrance {
  /** A Prism was seen genuinely flying in. */
  sawPrism: boolean;
  /** The most Shards of the Prism's own entry group seen beside it at one instant. */
  bestEscort: number;
  /** The bands those Shards carried, over the whole entrance. */
  bands: Set<Band>;
}

/** Drones that are `entering` AND have moved since the previous sample. */
function inFlight(
  drones: readonly DroneSnapshot[],
  previous: Map<number, { x: number; y: number }>,
): DroneSnapshot[] {
  return drones.filter((drone) => {
    if (drone.phase !== "entering") return false;
    const was = previous.get(drone.id);
    // A first sighting has no displacement to read yet.
    return was !== undefined && distanceBetween(drone, was) > MOVED_EPSILON;
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flies a Prism in with two Shards of opposite bands alongside it", async () => {
  // A clean field, then the game's own stage-1 wave, then the one gate this item's
  // requirement is: the wave's own release of its entry groups.
  startPosed(h);
  await startStage(h, STAGE);
  h.debug.setWaveEntry(true);

  const found = await captureReplay(
    h,
    "escort",
    async (): Promise<Entrance> => {
      const entrance: Entrance = {
        sawPrism: false,
        bestEscort: 0,
        bands: new Set<Band>(),
      };
      /** The sample each drone was first seen flying on: its group's release. */
      const released = new Map<number, number>();
      /** The sample the first Prism was released on, once one has been seen. */
      let prismGroup: number | null = null;
      let previous = new Map<number, { x: number; y: number }>();
      let sawAnyEntering = false;

      for (let sample = 0; sample * POLL < SWEEP_FRAMES; sample += 1) {
        await h.advance(POLL);
        const snapshot = h.snapshot();

        const flying = inFlight(snapshot.drones, previous);
        for (const drone of flying) {
          if (!released.has(drone.id)) released.set(drone.id, sample);
        }

        const prism = flying.find(
          (drone) =>
            drone.kind === "prism" &&
            (prismGroup === null || released.get(drone.id) === prismGroup),
        );
        if (prism !== undefined) {
          entrance.sawPrism = true;
          prismGroup ??= released.get(prism.id) ?? sample;
          const escort = flying.filter(
            (drone) =>
              drone.kind === "shard" &&
              released.get(drone.id) === prismGroup &&
              distanceBetween(drone, prism) <= ESCORT_RADIUS,
          );
          entrance.bestEscort = Math.max(entrance.bestEscort, escort.length);
          for (const drone of escort) entrance.bands.add(drone.band);
        }

        if (
          entrance.bestEscort >= PRISM_ESCORTS &&
          BANDS.every((band) => entrance.bands.has(band))
        ) {
          break;
        }
        if (snapshot.drones.some((drone) => drone.phase === "entering")) {
          sawAnyEntering = true;
        } else if (sawAnyEntering) {
          break; // the entrance is over
        }
        if (snapshot.screen !== "inWave") break;

        previous = new Map(
          snapshot.drones.map((drone) => [
            drone.id,
            { x: drone.x, y: drone.y },
          ]),
        );
      }

      await h.advance(HOLD_FRAMES);
      return entrance;
    },
  );

  assertTrue(
    found.sawPrism,
    "a Prism genuinely flying in over the wave's entrance (specs/drones.md)",
  );
  assertGreaterThanOrEqual(
    found.bestEscort,
    PRISM_ESCORTS,
    `Shards of the Prism's own entry group in flight within ${String(ESCORT_RADIUS)} ` +
      "units of it at one instant (specs/drones.md)",
  );
  for (const band of BANDS) {
    assertTrue(
      found.bands.has(band),
      `a ${band} Shard among the escort flying in with the Prism ` +
        "(specs/drones.md)",
    );
  }
});
