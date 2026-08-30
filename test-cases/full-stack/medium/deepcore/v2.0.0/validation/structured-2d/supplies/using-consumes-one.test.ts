// Deepcore — supplies/using-consumes-one: a use takes one, and only from its own
// pocket.
//
// `specs/items.md`: "A field supply is bought with Credits and carried as a count
// per type. Using one consumes one." So the six counts are posed alike, one
// supply is used, and all six are read back: the one used down by exactly one and
// the other five untouched.
//
// The charge is used in a pocket of solid rock, where it has something to clear.
// A supply "that would change nothing" is a no-op the specification does not
// consume, so a check about consumption has to give the supply real work — and
// that no-op is a requirement of its own, decided by its own validator.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ITEM_IDS } from "../../src/constants";
import {
  captureStill,
  createHarness,
  stageItems,
  type Harness,
} from "../harness";
import { openBlastScene } from "./blast-scene";

/** The supply used. Every other count is read against it. */
const USED = "dynamite";

/** More than one of each, so a count taken to zero cannot be mistaken for the rule. */
const HELD = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes one of the supply used and leaves the other five alone", async () => {
  openBlastScene(h);
  stageItems(h, Object.fromEntries(ITEM_IDS.map((id) => [id, HELD])));

  const before = h.snapshot();
  for (const id of ITEM_IDS) {
    assertEqual(before.items[id], HELD, `${id} held before the use`);
  }

  h.debug.useItem(USED);
  const after = h.snapshot();

  await h.advance(2);
  captureStill(h, "count");

  for (const id of ITEM_IDS) {
    assertEqual(
      after.items[id],
      id === USED ? HELD - 1 : HELD,
      `${id} held after using one ${USED}`,
    );
  }
});
