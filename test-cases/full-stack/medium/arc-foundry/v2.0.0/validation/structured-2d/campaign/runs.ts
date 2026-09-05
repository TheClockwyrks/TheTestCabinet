// campaign — driving a run through the events its checks are about.
//
// Not a suite: vitest collects `*.test.ts` alone. What lives here is the
// sequence every campaign check needs and no check should spell twice: launching
// a level's wave, taking a live wave to its clear, reaching the finale, walking
// one unit into the collector, and killing one unit where a bounty can be read.
//
// LAUNCHING A WAVE IS COMMITTING A HARVEST. specs/campaign.md: the build phase
// "ends when the player commits the level's harvest ... That harvest launches the
// wave", and there is no send control. So a wave is started here the only way the
// game starts one, and the structure the harvest leaves standing is a Regulator —
// specs/components.md's one type that "never fires" — so nothing the harvest
// leaves behind can kill a unit under a check that is counting kills, or pay a
// bounty into a Charge figure a check is reading.
//
// CLEARING A WAVE IS EMPTYING IT. specs/campaign.md: "A wave is cleared when
// every unit it released has died or leaked." Waiting for a whole wave to walk
// the maze is minutes of simulation and tens of leaks, so a wave is taken to its
// clear here through `clearUnits`, which "removes every live unit from the yard.
// None of them is killed and none of them leaks, so no bounty is paid and no
// Grid Integrity is lost", and after which "a wave with nothing left to release
// and nothing left on the yard clears on the next advance"
// (specs/instrumentation.md). A wave therefore ends the moment its schedule is
// exhausted, and the two counters a campaign check reads are untouched on the way.

import { ConstantClock } from "@clockwyrks/structured-2d";
import { assertEqual, assertTruthy, fail } from "../assert";
import {
  COLLECTOR_WAYPOINT,
  difficultyById,
  type DifficultyId,
  type LoadType,
  structureCenter,
  tileCenter,
} from "../constants";
import {
  createHarness,
  type FoundrySnapshot,
  type Harness,
  openYard,
  parkUnit,
  releaseUnit,
  standComponent,
  startWave,
  TICK_MS,
  type UnitView,
} from "../harness";

/**
 * Where the Regulator that commits a level's harvest stands.
 *
 * A level's harvest leaves a structure standing, so a run that walks several
 * levels needs a free footprint for each: these eight are `4` tiles apart along
 * one row, all clear of the Substation's waypoint platforms, its entry and its
 * collector.
 */
function harvestAnchor(wave: number): { col: number; row: number } {
  return { col: 10 + 4 * ((wave - 1) % 8), row: 10 };
}

/** The Capacitor a check that needs a kill fires with. */
const GUN = { col: 30, row: 20 };
const GUN_CENTER = structureCenter(GUN.col, GUN.row);

/** Where a unit is held to be shot: inside the Capacitor's `100` reach. */
export const KILL_AT = { x: GUN_CENTER.x + 60, y: GUN_CENTER.y };

/** Three tiles short of the Substation's collector, and `310` from the gun. */
export const LEAK_FROM = tileCenter(46, 20);

/**
 * The frame rate a check that plays whole waves runs at: `40` Hz.
 *
 * A run's last wave is half a minute of simulation. The specification fixes no
 * frame size — "an interval of simulation time reaches the same state however it
 * was divided into frames and whatever frame rate produced it" — and nothing
 * these checks read is a projectile, so the one step size this project has to
 * respect does not arise.
 */
export const RUN_HZ = 40;

/** Frames between two samples while a wave is being emptied. */
export const CLEAR_POLL = RUN_HZ / 2;

/** Three minutes of simulation: past any wave, and a verdict if a build has none. */
const CLEAR_MAX = 180 * RUN_HZ;

/** A harness whose clock runs at the rate a wave-playing check reads at. */
export function createRunHarness(): Promise<Harness> {
  return createHarness({ clock: new ConstantClock((TICK_MS * 120) / RUN_HZ) });
}

/** Commit the level's harvest, and check the wave it launched is the one wanted. */
export function harvestWave(h: Harness, wave: number): FoundrySnapshot {
  const anchor = harvestAnchor(wave);
  startWave(h, "regulator", 1, anchor.col, anchor.row);
  const s = h.snapshot();
  assertEqual(
    s.wave,
    wave,
    "the level's harvest launches its wave (specs/campaign.md)",
  );
  assertEqual(s.phase, "wave", `wave ${wave} is running`);
  return s;
}

/** What a wave's clear left behind. */
export interface Cleared {
  snapshot: FoundrySnapshot;
  /** Whether the phase ever read `finale` between the launch and the clear. */
  sawFinale: boolean;
}

/**
 * Take the live wave to its clear, and hand back the frame it cleared on.
 *
 * Stops as soon as the phase stops reading `wave`, which is the clear
 * (specs/campaign.md: clearing "opens the next build phase") or, on the run's
 * last wave, the finale that follows it.
 */
export async function clearWave(h: Harness): Promise<Cleared> {
  let sawFinale = false;
  let frames = 0;
  for (;;) {
    const s = h.snapshot();
    if (s.phase === "finale") sawFinale = true;
    if (s.phase !== "wave") return { snapshot: s, sawFinale };
    if (s.units.length > 0) h.debug.clearUnits();
    if (frames >= CLEAR_MAX) {
      fail(
        `the live wave to clear once its schedule is exhausted ` +
          `(specs/campaign.md); it was still running after ` +
          `${CLEAR_MAX / RUN_HZ} seconds`,
        "a wave that never clears",
      );
    }
    await h.advance(CLEAR_POLL);
    frames += CLEAR_POLL;
  }
}

/**
 * A run posed at the build phase before its LAST wave, on an empty yard.
 *
 * specs/campaign.md ends a run at wave `N`, and specs/difficulty.md fixes `N`
 * per difficulty, so this is where every check about the end of a run starts.
 */
export function openFinalWave(h: Harness, difficulty: DifficultyId): number {
  const waves = difficultyById(difficulty).waves;
  openYard(h, { difficulty, wave: waves - 1 });
  return waves;
}

/**
 * Play a run's LAST wave and take it to its clear, which is what opens the
 * finale.
 *
 * specs/campaign.md: "Victory — Wave `N` is cleared with Grid Integrity
 * remaining. The finale runs, then the victory screen." Every check about the end
 * of a run starts here, and none of them asserts what this returns: the phase the
 * clear left behind is the thing `victory-after-final-wave` decides.
 */
export async function reachFinale(
  h: Harness,
  difficulty: DifficultyId,
): Promise<{ cleared: Cleared; waves: number }> {
  const waves = openFinalWave(h, difficulty);
  harvestWave(h, waves);
  return { cleared: await clearWave(h), waves };
}

/** The one live unit of that type, or a failure naming what is on the yard. */
export function onlyUnit(
  snapshot: FoundrySnapshot,
  type: LoadType | "overload",
): UnitView {
  const found = snapshot.units.filter((unit) => unit.type === type);
  assertTruthy(
    found.length === 1,
    `exactly one ${type} on the yard; it carries ${
      snapshot.units.length === 0
        ? "no units"
        : snapshot.units.map((unit) => unit.type).join(", ")
    }`,
  );
  return found[0]!;
}

/**
 * How far a sweep for one unit's kill or leak may run.
 *
 * `600` frames is five seconds at this project's default clock and fifteen at the
 * slower one above, and the slowest thing either sweep waits on is a Dynamo
 * walking three tiles at `30` units per second, which is two.
 */
const SWEEP = 600;

/** Stand the Capacitor a check that needs a kill fires with. */
export function standGun(h: Harness): number {
  return standComponent(h, "capacitor", 1, GUN.col, GUN.row);
}

/** The Charge one kill of that type paid, read on the frame it was removed. */
export async function killOne(h: Harness, type: LoadType): Promise<number> {
  const id = parkUnit(h, type, KILL_AT, { hp: 1 });
  const before = h.snapshot().charge;
  const removed = await h.until(
    (s) => !s.units.some((unit) => unit.id === id),
    { maxFrames: SWEEP, poll: 6 },
  );
  assertEqual(
    removed.hit,
    true,
    `the ${type} held under the Capacitor to be killed by it`,
  );
  return removed.snapshot.charge - before;
}

/** Walk one unit of that type into the collector, and hand back the frame it left on. */
export async function leakOne(
  h: Harness,
  type: LoadType | "overload",
  id?: number,
): Promise<FoundrySnapshot> {
  const unit =
    id ?? releaseUnit(h, type, { at: LEAK_FROM, waypoint: COLLECTOR_WAYPOINT });
  if (id !== undefined) {
    h.debug.setUnitWaypoint(id, COLLECTOR_WAYPOINT);
    h.debug.setUnitPosition(id, LEAK_FROM.x, LEAK_FROM.y);
    h.debug.setUnitFrozen(id, false);
  }
  const grounded = await h.until(
    (s) => !s.units.some((live) => live.id === unit),
    { maxFrames: SWEEP, poll: 2 },
  );
  assertEqual(
    grounded.hit,
    true,
    `the ${type} released three tiles short of the collector to ground out`,
  );
  return grounded.snapshot;
}
