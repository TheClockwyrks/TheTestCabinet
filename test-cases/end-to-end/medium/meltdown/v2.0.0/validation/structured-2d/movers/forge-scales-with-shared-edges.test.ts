// Meltdown — movers/forge-scales-with-shared-edges: the Forge scales with contact.
//
// specs/heat.md counts the Forge's flow PER SHARED EDGE-TILE:
// `forgeGain(T) = FORGE_K * sharedEdges(T, F) * max(0, setpoint(F) - H_T)`, where
// "`sharedEdges(T, U)` is the number of edge-tiles along which towers `T` and `U`
// abut". So the flow into one gun is proportional to how much of the Forge's face
// actually meets it, and a Forge that meets a gun along twice as many edge-tiles
// warms it exactly twice as fast.
//
// THE TWO CONTACTS. Both movers are 2x2 (specs/towers.md), so a Forge flush against
// a 2x2 Arc's north face abuts it along both of that face's edge-tiles — a
// TWO-EDGE contact. Nudge the same Forge one column west and only its south-east
// tile still lies over the Arc's north-west tile: the rest of its south face looks
// out at open floor and its east face at open floor too, so the pair abut along ONE
// edge-tile and nothing else. Nothing about the towers changes between the two
// arrangements; only the overlap does.
//
// WHY THAT PAIR AND NOT A WIDER ONE. It is the pair that tells the models apart. A
// build that drives its flow per FACE-CONTACT rather than per edge-tile reads the
// SAME number in both arrangements — one contact either way — where the
// specification requires a factor of two. A pair of contacts that differed by a
// whole Forge could not say that: two Forges against one gun is
// `movers/forge-stacks`, and a build summing per contact and a build summing per
// edge-tile both double there.
//
// THE GUN IS COLD, so `max(0, setpoint - H)` is the whole setpoint at both
// readings and no clamp is in play, and the air term is exactly nothing at heat
// `0` — though `bench.ts` subtracts a walled control from each leg regardless, so
// the two arrangements are compared on the Forge's term alone. The note at the head
// of that file states the whole of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  type Face,
  type Harness,
} from "../harness";
import { faceAnchor, moverFlow, type Neighbour } from "./bench";

/** The emitter read, the face the Forge stands against, and its heat. */
const SUBJECT = "arc";
const FACE: Face = "N";
const COLD = 0;

/** The two contacts, in edge-tiles, and what the wider one must be worth. */
const NARROW_EDGES = 1;
const WIDE_EDGES = 2;
const RATIO = WIDE_EDGES / NARROW_EDGES;

/**
 * How close the wide reading must come to twice the narrow one, as decimal places
 * of heat per second.
 *
 * One place is `0.05` of a heat point per second against a required `129.6`. Both
 * readings are one frame of the same build's own arithmetic over the same figures,
 * so a conformant build's ratio is exact to floating point; the bound is a
 * thousand times smaller than the distance to the model this item exists to name,
 * which reads `64.8` where `129.6` is required.
 */
const RATE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Forge scales with the contact", async () => {
  const flush = faceAnchor(SUBJECT, FACE);
  /** The same Forge, one column west, so a single edge-tile still overlaps. */
  const nudged = { col: flush.col - 1, row: flush.row };

  const narrow = await moverFlow(h, { type: SUBJECT, heat: COLD }, [
    { type: "forge", ...nudged } satisfies Neighbour,
  ]);
  const wide = await moverFlow(h, { type: SUBJECT, heat: COLD }, [
    { type: "forge", ...flush } satisfies Neighbour,
  ]);
  captureStill(h, "contact");

  assertGreaterThan(
    narrow,
    0,
    `precondition: heat per second a Forge overlapping a cold ${SUBJECT} by ` +
      `${NARROW_EDGES} edge-tile drives into it`,
  );
  assertCloseTo(
    wide,
    RATIO * narrow,
    RATE_DIGITS,
    `heat per second a Forge sharing ${WIDE_EDGES} edge-tiles with a cold ` +
      `${SUBJECT} drives into it, against ${RATIO} times the ${NARROW_EDGES}` +
      `-edge-tile contact's ${narrow}`,
  );
});
