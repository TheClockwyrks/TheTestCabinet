// cascade/trail-persists — a card's stamp stays on the table after it.
//
// specs/victory.md's fourth step of every frame stamps the card onto the painted
// layer at its position, and the layer "is a persistent surface the size of the
// stage. It is never cleared while the cascade runs, so the stamps a card leaves
// stay on the table long after the card has moved on". Only a new deal clears it
// (`specs/deal.md`).
//
// THE READING IS TAKEN AFTER THE CARD IS GONE ALTOGETHER. One card is put in
// flight on an empty `won` table with nothing launching, and it is driven right
// until it has cleared the right edge and retired. The point sampled is the
// centre of its very first stamp, which the card covers only over the first
// `0.12` s of the flight and never returns to — its `vx` is positive and nothing
// in the five steps of a frame reverses it. So a colour there once the flight is
// empty can only be the painted layer: there is no card at that point, no pile at
// that point (`specs/table.md` puts the columns at `x >= 224` and no higher than
// `y = 320` when empty), and no win message, because the cascade never launched
// anything and is not done.
//
// THE SAME POINT IS READ BEFORE AND AFTER, so what is compared is the table
// against itself rather than against a colour taken from somewhere else, and the
// case's own palette never enters it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { STAGE_W } from "../constants";
import {
  type Harness,
  cardCenter,
  captureStill,
  colorDistance,
  createHarness,
  framesFor,
  poseFlyer,
  sampleColor,
} from "../harness";
import { openFlight } from "./flight";

/** A card put in flight low on the table and driven off the right edge. */
const THROW = { x: 300, y: 380, vx: 420, vy: 0 };

/** The centre of the card's very first stamp: the pixels this point is about. */
const STAMPED = cardCenter(THROW.x, THROW.y);

/**
 * How long the card is left flying, in frames.
 *
 * It clears `STAGE_W` after `(1280 - 300) / 420` = `2.33` s, so `2.6` s leaves
 * the flight empty and the stamp about six hundred frames old. A bound on the
 * drive, not a reading of it.
 */
const DRIVE_FRAMES = framesFor(2.6);

/*
 * The reading itself: the sampled point has to have MOVED from the bare felt.
 *
 * Nothing is measured beyond that. The case fixes no palette — `specs/overview.md`
 * leaves every colour to the build — so how far a stamp reads from the felt is
 * the reviewer's. The point is read twice, once before anything painted and once
 * after the card has flown on; rendering is deterministic, the world holds this
 * one card and nothing else, and the card is no longer over the point, so any
 * difference at all is the stamp the painted layer kept.
 */

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("leaves a flyer's stamp on the table long after the flyer has gone", async () => {
  await openFlight(harness, { painting: true });

  // The bare table at the point the stamp will land, read before anything paints.
  await harness.advance(1);
  const before = await sampleColor(harness, STAMPED.x, STAMPED.y);

  await poseFlyer(harness, THROW);
  await harness.advance(DRIVE_FRAMES);
  await captureStill(harness, "trail");

  const flown = await harness.snapshot();
  assertLength(
    flown.flyers,
    0,
    `cards left in flight after ${DRIVE_FRAMES} frames, by which point the card had passed STAGE_W (${STAGE_W})`,
  );

  const after = await sampleColor(harness, STAMPED.x, STAMPED.y);
  assertGreaterThan(
    colorDistance(after, before),
    0,
    `the table at (${STAMPED.x}, ${STAMPED.y}) to still carry the stamp the card left there, reading differently from the bare felt it read before the flight`,
  );
});
