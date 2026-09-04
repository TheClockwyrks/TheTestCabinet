// progression/life-lost-decrements — a contact with lives to spare costs exactly
// one life.
//
// specs/progression.md, Losing a life: on a contact with lives to spare, lives
// falls by one. specs/cursor.md fixes what a contact is — a worm segment whose
// tile overlaps the cursor's box reaches the cursor — and `poseContact` poses
// exactly that, on the empty, quiet board `startPlaying` leaves behind.
//
// ONE LIFE, NOT MERELY FEWER. The count is asserted as an exact figure, so a
// build that charges two lives for one touch, or empties the whole store, is
// told apart from one that charges the one life the specification names. Lives
// are posed at `START_LIVES` so the contact has lives to spare and the run
// cannot end on it — the end of a run is `game-over-at-zero-lives`'s point.
//
// What the respawn does with the board is not read here. Every other consequence
// of the same event — the swept rosters, the re-centred cursor, the
// invulnerability — is its own point, so a build that decrements correctly and
// respawns badly is docked once, on the thing it got wrong.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { poseContact } from "./contact";

/** The one life specs/progression.md says a contact costs. */
const LIFE_COST = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes exactly one life on a contact with lives to spare", async () => {
  startPlaying(h);
  h.debug.setLives(START_LIVES);
  poseContact(h);

  // One frame: the contact test runs at the end of every update, so the touch
  // posed above is resolved by the first update that runs at all.
  await h.advance(1);
  captureStill(h, "lives");

  assertEqual(h.snapshot().lives, START_LIVES - LIFE_COST);
});
