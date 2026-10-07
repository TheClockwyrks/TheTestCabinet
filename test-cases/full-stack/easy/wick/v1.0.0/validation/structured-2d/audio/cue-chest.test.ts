// Wick — audio/cue-chest: the tick that opens the chest overlay plays
// `chest`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `chest` to "A chest overlay opens", and "Each is played on the tick its
// event happens ... and at most once on that tick."
// `specs/progression.md`, The chest overlay: "On the tick it is collected the
// tick runs to completion, the chest's result is applied ..., `chestResult`
// records it, and `screen` becomes `chest`". One opening on one tick is
// therefore exactly one `chest`.
//
// WHY THE WORLD IS POSED AS IT IS. One chest pickup on the lamplighter's own
// center in an isolated run holding no weapon and no passive, and one tick.
// A distance of `0` is inside `PICKUP_ITEM_RADIUS` (`16`) plus
// `PLAYER_RADIUS` (`12`) whatever the build's pickup radius
// (`specs/world.md`, Collection), so the collection lands on the first tick;
// `specs/instrumentation.md` names this the real collection path: "The chest
// overlay is reached through `spawnPickup("chest", x, y)` at the
// lamplighter's center and one tick".
//
// Holding nothing decides the chest's result without a draw. `specs/
// evolutions.md`, Opening a chest, takes the first rule that applies: no
// weapon is held at `MAX_WEAPON_LEVEL` with its recipe passive, so no
// evolution; no held item is below its max because none is held, so no level;
// the chest heals. That leaves `evolve` unraised on this tick, so what the
// count reads is the overlay's own cue. Every driver switch is off and the
// world holds nothing else, so no other event lands on the tick.
//
// THE TOLERANCE. None: the specification fixes the cue to the tick the
// overlay opens on and to at most one play on it, and the collector reads
// whole frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  openChest,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays chest once on the tick the chest overlay opens", async () => {
  await isolatedRun(h);

  const { result: after, played } = await captureReplay(h, "chest", () =>
    cuesOf(h, () => openChest(h)),
  );

  // The premise: the tick really collected the chest and opened the overlay.
  assertEqual(
    after.screen,
    "chest",
    "the screen the collecting tick ended on (specs/progression.md, The chest overlay)",
  );
  assertNotNull(after.run.chestResult, "the result the chest recorded");
  assertEqual(after.run.pickups.length, 0, "the pickups left on the field");

  assertEqual(
    heard(played, CUES.chest),
    1,
    "chest cues on the tick the overlay opened (specs/ui.md, Audio)",
  );
});
