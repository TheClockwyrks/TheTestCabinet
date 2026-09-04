// Wireworm — instrumentation/reset-seeds-randomness: `reset({ seed })` seeds all
// of the game's randomness, so the same seed lays the same starting field and a
// different seed lays a different one.
//
// specs/instrumentation.md rests the surface on it: "Any randomness the game
// uses runs off a generator seeded from the state's generator field... so
// reseeding and replaying the same calls reproduces the same result exactly",
// and "`options.seed`, a number defaulting to `DEFAULT_SEED` (`1`), seeds all of
// the game's randomness". specs/nodes.md names the starting scatter as one of
// the things drawn from it: "The tiles are drawn from the run's seeded random
// generator, so a run's starting field is a fresh scatter rather than one fixed
// layout, and two runs from different seeds lay different fields."
//
// THE SCATTER IS THE WITNESS BECAUSE IT IS THE FIRST THING DRAWN. It is laid
// once, at the moment a run opens, from hundreds of draws — so two runs that
// agree on every tile of it agree on the generator, and two that disagree
// disagree on the generator rather than on a single coin toss. The foes' arrival
// intervals and an arc's drawn shape run off the same generator and would each
// take a scenario of their own to reach.
//
// THE RUN IS OPENED THROUGH THE TITLE'S FIRST ITEM, WHICH IS THE ONLY ROUTE.
// The surface poses fields; it has no operation that opens a run, and
// specs/progression.md lays the starting field only when one opens
// ("A new run opens on the `playing` screen with... A fresh scatter"). So
// `confirm` on the title's highlighted item — which `reset` leaves at `DESCEND`
// (specs/ui.md) — is how a scatter is reached at all, and a build that cannot
// open a run from its title fails here as well as at `ui/title-descend`.
//
// WHAT THIS DOES NOT DECIDE. Nothing about the scatter itself: which rows it may
// occupy, how dense it is, and that every node of it is inert are `board/
// scatter-rows`, `board/scatter-density` and `board/scatter-inert`. This point
// reads only whether two fields are the same field.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** The seed two runs share, and the one a third run is given instead. */
const SEED = 7;
const OTHER_SEED = 8;

/**
 * The field as one comparable string: every node's tile and charge, in a fixed
 * order, so two scatters compare as fields rather than as roster orders.
 *
 * The order the snapshot reports the nodes in is not what this point is about,
 * so the entries are sorted here rather than compared where they lie.
 */
function fieldOf(snapshot: WirewormSnapshot): string {
  return snapshot.nodes
    .map((node) => `${node.c},${node.r}@${node.charge}`)
    .sort()
    .join(" ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays the same starting field for one seed and a different one for another", async () => {
  /** Seed the generator, open a run from the title, and read the field it laid. */
  const scatterFor = async (seed: number): Promise<string> => {
    resetTo(h, seed);
    await tapAction(h, "confirm");
    return fieldOf(h.snapshot());
  };

  const first = await scatterFor(SEED);
  // Before the assertions, so a failing seed still leaves the picture of the
  // field the first run laid.
  captureStill(h, "scatter");

  assertGreaterThan(
    first.length,
    0,
    `the nodes a run opened after reset({ seed: ${SEED} }) laid — a run opens ` +
      `on confirm at the title's first item and lays its starting field then ` +
      `(specs/progression.md), and an empty board leaves nothing to compare`,
  );

  const again = await scatterFor(SEED);
  assertEqual(
    again,
    first,
    `the field a second run opened after reset({ seed: ${SEED} }) laid, ` +
      `against the field the first one laid — the same seed replays the same ` +
      `draws exactly (specs/instrumentation.md)`,
  );

  const other = await scatterFor(OTHER_SEED);
  assertNotEqual(
    other,
    first,
    `the field a run opened after reset({ seed: ${OTHER_SEED} }) laid, ` +
      `against the field seed ${SEED} laid — two runs from different seeds ` +
      `lay different fields (specs/nodes.md)`,
  );
});
