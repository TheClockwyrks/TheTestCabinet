// press/allowance-refreshes — the next build phase opens with five stamps,
// however many were left over.
//
// `specs/scrap-press.md` refreshes the allowance to five at the start of every
// build phase and carries nothing over. Both halves are a rule: a build that
// carries the unspent stamps forward hands a cautious player ten rocks on a later
// level, and one that carries the SPENT count forward — a refresh that never
// happens — leaves a run that quietly runs out of building after the first level.
//
// THE WAVE IS LAUNCHED WITH STAMPS STILL IN HAND, which is the only way to tell
// those two apart, and it is then cleared the way `specs/campaign.md` clears one:
// every unit it released is gone, so the next build phase opens on its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { STAMPS_PER_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standCandidate,
  type Harness,
} from "../harness";

/** The multiplier the wave is run down at. */
const WAVE_SPEED = 8;

/** How many rocks go down before the harvest, of the five the level grants. */
const SPENT = 2;

/** Where those rocks land. */
const ANCHORS = [10, 14].map((col) => ({ col, row: 10 }));

/** How the wave is run down: frames per pass, and how many passes are allowed. */
const PASS_FRAMES = 60;
const MAX_PASSES = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the next build phase at five stamps, with none carried over", async () => {
  await openYard(h, { speed: WAVE_SPEED });

  const candidates: number[] = [];
  for (const anchor of ANCHORS) {
    candidates.push(
      await standCandidate(h, "capacitor", 1, anchor.col, anchor.row),
    );
  }
  const held = await h.snapshot();
  assertEqual(
    held.stampsLeft,
    STAMPS_PER_LEVEL - SPENT,
    `the stamps left with ${SPENT} of the level's ${STAMPS_PER_LEVEL} spent`,
  );
  assertGreaterThan(
    held.stampsLeft,
    0,
    "the stamps still in hand when the wave is launched",
  );

  // The harvest launches the wave.
  await h.debug.keep(candidates[0]!);
  assertEqual(
    (await h.snapshot()).phase,
    "wave",
    "the phase the harvest opened",
  );

  // Run the wave down. Clearing the yard between passes kills nothing and leaks
  // nothing, so the wave ends when its schedule is done and its units are gone,
  // and no bounty or Grid Integrity moves in the meantime.
  let cleared = false;
  for (let pass = 0; pass < MAX_PASSES && !cleared; pass += 1) {
    await h.advance(PASS_FRAMES);
    await h.debug.clearUnits();
    cleared = !(await h.snapshot()).waveActive;
  }
  await h.advance(1);
  await captureStill(h, "refresh");

  assertTrue(
    cleared,
    `the wave to clear once every unit it released is gone, within ` +
      `${MAX_PASSES * PASS_FRAMES} frames at speed ${WAVE_SPEED}`,
  );

  const next = await h.snapshot();
  assertEqual(next.phase, "build", "the phase a cleared wave opens");
  assertEqual(
    next.stampsLeft,
    STAMPS_PER_LEVEL,
    `the stamps the next build phase opens with, after a wave launched with ` +
      `${STAMPS_PER_LEVEL - SPENT} unspent`,
  );
});
