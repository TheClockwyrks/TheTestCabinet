// presentation/surge-reads-apart-from-the-floor — every surge type is drawn where
// it stands.
//
// THE RULE. `specs/overview.md`'s legibility table: "The surge — Ground units,
// flyers, and the boss read apart from one another, from the floor, and from every
// color a tower shows anywhere on its heat ramp." What a check can decide of that
// is presence: each of the six types `specs/surge.md` tabulates — Mote, Sprint,
// Hulk, Swarm, Drift and Core — is drawn on the tile it stands on. How far apart
// the six read from one another and from the floor is appearance, which the
// palette clause of the same specification hands to the build: "The palette, the
// type, the glow, and every other aspect of the look are yours."
//
// WHY THE READING IS A REMOVAL. `specs/instrumentation.md` gives `removeUnit`, so
// the patch is read with the unit standing on it and again with the unit taken
// away, and the unit is what disappeared. The floor art under it, the grid line
// `specs/floor.md` puts on every tile boundary, and anything else the build laid
// there are identical in the two frames and cancel exactly. How much the picture
// moves on its own is measured first, by reading the same points on two frames
// with the surge standing, and the removal has to beat that by `NOISE_MARGIN`.
//
// WHERE A UNIT'S OWN PIXELS ARE. `specs/surge.md` fixes a unit's position as its
// CENTRE — "Wherever a tower or a surge unit is given, taken, or reported as an
// `(x, y)` pair, that pair is the centre of the entity" (`specs/overview.md`) —
// and fixes nothing at all about how large it is drawn or in what shape. So the
// patch read is three units either way from that centre, and the reading over it
// is the WIDEST movement rather than an average: a unit drawn as an outline reads
// as its outline, a Swarm drawn small reads as the few pixels it covers, and
// neither is diluted by the floor showing between them. The health bar
// `specs/hud.md` puts above a unit is outside that patch at any size a player
// could see.
//
// WHY THE UNITS ARE PARKED AND WHY THAT IS NOT A BYSTANDER. `poseTarget` puts each
// unit on a named tile with its motion off (`specs/instrumentation.md`), because a
// walking unit would be somewhere else by the time the pixels were read. Nothing
// else stands on the floor: no tower, so nothing fires and nothing is drawn over
// them.
//
// WHAT IT DOES NOT DECIDE. What each type is worth, how fast it walks and how much
// it carries are `surge/`'s items. This item is that the build drew each of the
// six somewhere a player looking at its tile would find it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { SURGE_TYPES } from "../constants";
import type { SurgeType } from "../constants";
import {
  captureStill,
  createHarness,
  poseTarget,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";
import {
  NOISE_MARGIN,
  readPixels,
  unitPoints,
  widestGap,
  type Point,
} from "./read";

/** Where each type stands: spread across a clear rank of the floor. */
const STANDS: Record<SurgeType, { col: number; row: number }> = {
  mote: { col: 6, row: 6 },
  sprint: { col: 13, row: 6 },
  hulk: { col: 20, row: 6 },
  swarm: { col: 27, row: 6 },
  drift: { col: 34, row: 6 },
  core: { col: 41, row: 6 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every surge type on the tile it stands on", async () => {
  await startRun(h);
  const ids = new Map<SurgeType, number>();
  for (const type of SURGE_TYPES) {
    const { col, row } = STANDS[type];
    ids.set(type, await poseTarget(h, type, col, row));
  }
  await h.debug.setPhase("wave");
  await h.advance(1);

  const snapshot = await h.snapshot();
  const patches = new Map<SurgeType, Point[]>();
  const points: Point[] = [];
  for (const type of SURGE_TYPES) {
    const unit = requireUnit(snapshot, ids.get(type) as number, `the ${type}`);
    const patch = unitPoints(unit);
    patches.set(type, patch);
    points.push(...patch);
  }

  const first = await readPixels(h, points);
  await h.advance(1);
  const second = await readPixels(h, points);
  await captureStill(h, "surge");

  await h.debug.clearSurge();
  await h.advance(1);
  const cleared = await readPixels(h, points);

  let at = 0;
  for (const type of SURGE_TYPES) {
    const patch = patches.get(type) as Point[];
    const from = at;
    at += patch.length;
    const noise = widestGap(
      first.slice(from, at),
      second.slice(from, at),
    ).distance;
    const gone = widestGap(second.slice(from, at), cleared.slice(from, at));

    assertGreaterThanOrEqual(
      gone.distance,
      noise + NOISE_MARGIN,
      `the ${type} on tile (${STANDS[type].col}, ${STANDS[type].row}): the ` +
        `patch on the tile it stands on changes when the unit is taken away, ` +
        `by more than the ${noise} two frames with it standing moved on ` +
        `their own ` +
        `(specs/overview.md: the surge reads apart from the floor)`,
    );
  }
});
