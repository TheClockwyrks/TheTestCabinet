// load/roster-flying — exactly the Load types the roster marks as flying, fly.
//
// `specs/enemies.md`'s roster fixes a flying bit per type, and `specs/pathing.md`
// makes it the thing that decides whether a unit walks the maze at all: "flying
// units ignore the maze". So the bit is a requirement of its own — a build that
// walks a Filament round the chain plays a different game from the one specified,
// whatever else it gets right — and `specs/instrumentation.md` reports it as a
// unit's `flying`.
//
// READ OFF A UNIT THAT IS TRAVELLING, so what is read is a unit the game has
// actually started moving rather than a field set at the spawn. Each type is
// released alone on an empty yard and removed before the next, so nothing else is
// on the yard while it is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LOAD_ROSTER } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { travellingFor } from "./vitals";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("flies exactly the roster types marked as flying", async () => {
  await openYard(h, { wave: 1 });

  for (const def of LOAD_ROSTER) {
    const moving = await travellingFor(h, def.type);
    await captureStill(h, "flying");
    assertEqual(
      moving.flying,
      def.flying,
      `a ${def.type} ${def.flying ? "flies" : "walks"}`,
    );
  }
});
