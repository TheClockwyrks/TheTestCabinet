// Wireworm — board/scatter-inert: every node of the starting scatter is inert.
//
// specs/nodes.md, The starting field: "Every node of the scatter is laid at
// charge `0`." That is the state the whole of the case's charge economy is
// written against — charge only ever rises where specs/nodes.md and
// specs/foes.md say it rises — so a run that opened on a pre-charged field would
// hand the player a board that had already been fought over.
//
// The run is opened the way a player opens one, through `DESCEND` on the title
// (specs/ui.md), because that is the path that lays the field. The board is read
// on the frame the run opens, while the level's banner is still up: nothing has
// entered, nothing has spawned, and no bolt has flown, so nothing that raises or
// lowers a charge has had a chance to run.
//
// Several seeds, because the tiles are drawn from the generator. The count is
// read only far enough to know a scatter happened at all, since a run that laid
// nothing would satisfy a rule about every node it laid; how many are laid is
// board/scatter-density's requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startRunFromTitle,
  type Harness,
} from "../harness";

/** The charge specs/nodes.md lays every scattered node at: inert. */
const INERT = 0;

/** The seeds the scatter is read over. Each is one draw of the same rule. */
const SEEDS = [1, 2, 3, 7, 11];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it.each(SEEDS)("lays every scattered node inert from seed %i", async (seed) => {
  await startRunFromTitle(h, { seed });
  await captureStill(h, "scatter");

  const { nodes } = await h.snapshot();
  assertGreaterThan(
    nodes.length,
    0,
    `a starting scatter to read, from seed ${seed} (specs/nodes.md)`,
  );

  const charged = nodes.filter((node) => node.charge !== INERT);
  assertEqual(
    charged.length,
    0,
    `scattered nodes carrying a charge other than ${INERT}, from seed ` +
      `${seed} — the first is ${JSON.stringify(charged[0] ?? null)}`,
  );
});
