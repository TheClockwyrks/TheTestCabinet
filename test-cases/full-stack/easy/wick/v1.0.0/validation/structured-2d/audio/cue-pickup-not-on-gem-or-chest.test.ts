// Wick — audio/cue-pickup-not-on-gem-or-chest: neither a collected gem nor a
// collected chest plays `pickup`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `pickup` to "Bread or a draft is collected" and to nothing else, and gives
// a gem's collection its own cue, `gem`, and a chest's overlay its own,
// `chest`. The paragraph under the table fixes the whole of what a tick
// plays: "Each is played on the tick its event happens ... and at most once
// on that tick", and "a tick that raises several different cues plays each of
// those once". A tick that raises neither of `pickup`'s two events therefore
// carries zero `pickup` plays.
//
// WHY BOTH ARE DRIVEN HERE. `specs/world.md` lists three `PICKUP_KINDS`, and
// `chest` is the one of the three the cue does not cover; a gem is the other
// thing the world collects on the same phase of a tick. A build that sounds
// `pickup` on either has bound the cue to collection in general rather than
// to the two kinds the table names, and the two are the same requirement in
// the same direction.
//
// WHY THE WORLDS ARE POSED AS THEY ARE. Both are isolated runs with every
// driver switch off, holding nothing but the one thing being collected, on
// the lamplighter's own center — inside `COLLECT_RADIUS` (`8`) for the gem
// and inside `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS` (`12`) for the
// chest, whatever the build's pickup radius — so each collection lands on the
// first tick. The gem run leaves the `progression` switch off, so the `1`
// experience a small gem carries is spent on no level and opens no overlay.
// The chest run holds no weapon and no passive, so the chest heals rather than
// evolving or levelling.
//
// THE TOLERANCE. None: the count of a cue the specification does not put on
// these ticks is zero.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  openChest,
  placeGem,
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

it("plays no pickup on the tick a gem or a chest is collected", async () => {
  await captureReplay(h, "silent", async () => {
    const before = await isolatedRun(h);
    const { player } = before.run;
    placeGem(h, "small", player.x, player.y);
    const gem = await cuesOf(h, () => advanceTicks(h, 1));

    assertEqual(
      gem.result.run.gems.length,
      0,
      "the gems left on the field after the collecting tick",
    );
    assertEqual(
      heard(gem.played, CUES.pickup),
      0,
      "pickup cues on the tick a gem was collected (specs/ui.md, Audio)",
    );

    await isolatedRun(h);
    const chest = await cuesOf(h, () => openChest(h));

    assertEqual(
      chest.result.screen,
      "chest",
      "the screen the collecting tick ended on (specs/progression.md)",
    );
    assertEqual(
      heard(chest.played, CUES.pickup),
      0,
      "pickup cues on the tick a chest was collected (specs/ui.md, Audio)",
    );
  });
});
