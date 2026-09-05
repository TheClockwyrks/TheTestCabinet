// load — reading back the composition of a wave the game itself composed.
//
// Not a suite: vitest collects `*.test.ts` alone, so nothing here runs on its
// own. Five checks next door decide a composition rule of specs/enemies.md —
// the air cadence, the milestone Dynamos, the opening waves, when Clusters and
// Slugs are allowed, and the growth floor — and every one of them needs the same
// thing: the type and the maximum health of every unit a chosen wave released,
// and nothing else on the yard while it is being read.
//
// HOW A CHOSEN WAVE IS REACHED. specs/campaign.md gives a level one build phase
// followed by the wave its harvest launches, and specs/instrumentation.md's
// `setWave` sets the counter "so units released from now on scale to wave `n`".
// So a run posed at `w - 1` and then harvested launches wave `w`, composed and
// scaled as wave `w`, without the `w - 1` waves before it having to be played.
//
// THE HARVEST IS A REGULATOR. Committing the harvest is the only way to start a
// wave (specs/campaign.md: "There is no separate send control"), so a structure
// is always left standing when one starts. specs/components.md has exactly one
// type that never fires, and that is the one used here: a Regulator has no
// range, no damage and no targeting, so nothing on the yard can remove a unit
// before it has been counted, and its aura has no firing structure to buff.
//
// HOW THE WAVE IS READ TO ITS END. Every unit released is appended to the
// snapshot's `units`, so sampling often enough that nothing can arrive and leave
// between two samples reads every one of them. The yard is emptied after each
// sample through `clearUnits`, which "removes every live unit ... None of them is
// killed and none of them leaks, so no bounty is paid and no Grid Integrity is
// lost" — and that is also what ends the reading, because "a wave with nothing
// left to release and nothing left on the yard clears on the next advance". A
// wave therefore ends the moment its schedule is exhausted rather than tens of
// seconds later when its last unit finally grounds out, and no leak drains the
// run while a whole campaign's worth of waves is being read.

import { ConstantClock } from "@clockwyrks/structured-2d";
import { assertEqual, assertTruthy, fail } from "../assert";
import type { DifficultyId, SpawnType } from "../constants";
import {
  createHarness,
  type Harness,
  openYard,
  startWave,
  TICK_MS,
} from "../harness";

/** One unit a wave released, as the snapshot first reported it. */
export interface Released {
  id: number;
  type: SpawnType;
  maxHp: number;
}

/** Where the Regulator that commits each level's harvest stands. */
const HARVEST = { col: 10, row: 10 };

/**
 * The frame rate a composition is read at: `40` Hz, a third of this project's
 * default.
 *
 * A whole campaign's worth of waves is minutes of simulation, and the
 * specification deliberately fixes no frame size: "an interval of simulation time
 * reaches the same state however it was divided into frames and whatever frame
 * rate produced it" (specs/instrumentation.md). Nothing read here is a
 * projectile, so the one step size this project has to respect — a shot's travel
 * staying inside its hit radius — does not arise, and a `25` ms frame is an
 * ordinary frame for a slow machine rather than an exotic one.
 */
const HZ = 40;

/** Frames between two readings of the yard: half a second. */
const POLL = HZ / 2;

/** Three minutes of simulation: past any wave, and a verdict if a build has none. */
const MAX_FRAMES = 180 * HZ;

/** A harness whose clock runs at the rate a composition is read at. */
export function createWaveHarness(): Promise<Harness> {
  return createHarness({ clock: new ConstantClock((TICK_MS * 120) / HZ) });
}

/**
 * A run posed at the build phase whose harvest launches wave `wave`, on an
 * otherwise empty yard.
 */
export function openWave(
  h: Harness,
  wave: number,
  difficulty: DifficultyId,
): void {
  openYard(h, { difficulty, wave: wave - 1 });
}

/**
 * Commit the harvest, read every unit the wave releases, and hand them back.
 *
 * The drive of every composition check: call it inside `captureReplay` and the
 * clip is the wave arriving.
 */
export async function collectWave(
  h: Harness,
  wave: number,
): Promise<Released[]> {
  startWave(h, "regulator", 1, HARVEST.col, HARVEST.row);
  const launched = h.snapshot();
  assertEqual(
    launched.wave,
    wave,
    "the harvest launches the wave the run was posed for " +
      "(specs/campaign.md)",
  );

  const seen = new Map<number, Released>();
  let frames = 0;
  for (;;) {
    const s = h.snapshot();
    for (const unit of s.units) {
      if (!seen.has(unit.id)) {
        seen.set(unit.id, {
          id: unit.id,
          type: unit.type,
          maxHp: unit.maxHp,
        });
      }
    }
    if (!s.waveActive) break;
    if (s.units.length > 0) h.debug.clearUnits();
    if (frames >= MAX_FRAMES) {
      fail(
        `wave ${wave} to release its units and clear (specs/campaign.md); it ` +
          `was still live after ${MAX_FRAMES / HZ} seconds, having released ` +
          `${seen.size}`,
        "a wave that never ends",
      );
    }
    await h.advance(POLL);
    frames += POLL;
  }

  assertTruthy(
    seen.size > 0,
    `wave ${wave} to release at least one unit (specs/enemies.md)`,
  );
  return [...seen.values()];
}

/** Open a wave and read it, for a check whose evidence is not this wave. */
export function wave(
  h: Harness,
  n: number,
  difficulty: DifficultyId,
): Promise<Released[]> {
  openWave(h, n, difficulty);
  return collectWave(h, n);
}

/** The types a wave released, deduplicated, in the order they first arrived. */
export function typesOf(released: readonly Released[]): SpawnType[] {
  return [...new Set(released.map((unit) => unit.type))];
}

/** How many of one type a wave released. */
export function countOf(
  released: readonly Released[],
  type: SpawnType,
): number {
  return released.filter((unit) => unit.type === type).length;
}

/** A wave's total health pool: the maximum health of every unit it released. */
export function healthPool(released: readonly Released[]): number {
  return released.reduce((total, unit) => total + unit.maxHp, 0);
}
