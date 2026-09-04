// presentation/pickups-drawn-from-sprites — each pickup kind is drawn from its
// own produced sprite.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The sprites": "Pickups |
// `assets/sprites/pickups/chest.png`, `bread.png`, `draft.png` | `draw` | `1`
// each | `24 x 24`". `specs/world.md` — "Pickups": "`PICKUP_KINDS` lists the
// three kinds in this order", and `specs/ui.md` has the playing screen draw every
// pickup "inside the view ... at its world position". `specs/overview.md` names
// the same thing among what a player reads at a glance: "A chest, bread, and a
// draft are told apart from each other and from any gem."
//
// WHY ALL THREE AT ONCE. A build that drew one sprite for every kind, or that
// mapped the kinds onto the files in another order, is invisible to a reading
// taken over one kind, and a player who cannot tell a chest from bread cannot
// tell what is worth walking to.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held, and
// one pickup of each kind posed `200` units or more from the lamplighter. The
// collection distance `specs/world.md` fixes is `PICKUP_ITEM_RADIUS` (`16`) plus
// `PLAYER_RADIUS` (`12`), so nothing is collected before the frame is read and no
// chest overlay opens over the reading.
//
// WHAT IS READ. The image drawn at each pickup's own place, and which produced
// file it is, decided by the file's own pixels.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit on the centre, which is one device
// pixel at the harness's fit. The identity of the file has no tolerance.

import { afterEach, beforeEach, it } from "vitest";
import { PICKUP_KINDS, pickupSprite } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placePickup,
  stagePoint,
  type Harness,
} from "../harness";
import { drawFromAt } from "./readouts";
import { primeSources } from "./sources";

/** Where the three pickups lie: far past collection, and inside the view. */
const SLOTS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: -300, dy: -150 },
  { dx: 0, dy: 200 },
  { dx: 300, dy: -150 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each pickup kind from the produced sprite its row names", async () => {
  const posed = await isolate(h);
  await primeSources(
    h,
    PICKUP_KINDS.map((kind) => pickupSprite(kind)),
  );

  const at = posed.run.player;
  const placed = [];
  for (const [index, kind] of PICKUP_KINDS.entries()) {
    const slot = SLOTS[index]!;
    placed.push({
      kind,
      pickup: await placePickup(h, kind, at.x + slot.dx, at.y + slot.dy),
    });
  }

  const snapshot = await h.step(1);
  const calls = await h.lastCalls();
  await captureStill(h, "pickups");

  for (const { kind, pickup } of placed) {
    await drawFromAt(
      h,
      calls,
      [pickupSprite(kind)],
      stagePoint(snapshot, pickup.x, pickup.y),
      `the produced ${kind} sprite (${pickupSprite(kind)})`,
    );
  }
});
