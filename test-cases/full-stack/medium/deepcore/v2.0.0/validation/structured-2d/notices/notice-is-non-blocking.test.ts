// Deepcore — notices/notice-is-non-blocking: the mine keeps running behind the
// card.
//
// `specs/hazards.md`: "The card is non-blocking: the mine keeps running behind
// it." So the card is raised by a real detonation, and then, with it still on
// screen, the three things the review item names are driven and read: the miner
// falls under gravity, a held `down` cuts a cell out from under it, and the tank
// drains while it does. Every one of them runs the game's own systems from the
// game's own input.
//
// The whole drive is short — a two-tile drop and one topsoil cell, together
// little more than a second of game time — so it finishes well inside
// `NOTICE_FADE`, and the notice is read as still drawn at the end. Without that
// last reading a build that froze the mine and then let the card lapse would look
// the same as one that never froze it.
//
// The miner's travel is off while the pocket goes off, because the blast shoves
// it away at `GAS_KNOCKBACK` and a miner thrown out of the scene answers nothing;
// it is handed back before the fall, which is what the fall is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { NOTICE_DELAY, TILE } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  digShaft,
  driveCut,
  minerXOn,
  minerYOn,
  placeAt,
  standOn,
  type Harness,
} from "../harness";
import {
  detonateGas,
  elapse,
  FIRST_COL,
  gasRow,
  openNoticeScene,
} from "./notice-scene";

/** Long enough for the card to be drawn. */
const SHOWN_AT = NOTICE_DELAY + 0.5;

/** The shaft the fall and the cut happen in, high in the topsoil. */
const SHAFT_COL = 8;
const SHAFT_TOP = 12;
const SHAFT_BOTTOM = 18;
const SHAFT_FLOOR = SHAFT_BOTTOM + 1;

/** Two tiles, which `specs/hazards.md` calls always harmless to land from. */
const DROP_TILES = 2;

/** Frames the fall is given: a two-tile drop takes well under half a second. */
const FALL_FRAMES = 240;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the miner falling, drilling and burning fuel behind the card", async () => {
  openNoticeScene(h);
  const row = gasRow(h.snapshot());

  const behind = await captureReplay(h, "behind", async () => {
    const blast = await detonateGas(h, FIRST_COL, row);
    await elapse(h, SHOWN_AT);
    const raised = h.snapshot();

    // The card is up. Hand the miner its body back and drop it down a shaft.
    h.debug.setMinerTravel(true);
    digShaft(h, SHAFT_COL, SHAFT_TOP, SHAFT_BOTTOM);
    placeAt(h, minerXOn(SHAFT_COL), minerYOn(SHAFT_FLOOR) - DROP_TILES * TILE);
    const beforeFall = h.snapshot();
    const landing = await h.until((s) => s.miner.grounded, {
      maxFrames: FALL_FRAMES,
      poll: 1,
    });
    await h.advance(1);
    const landed = h.snapshot();

    // And cut the floor it landed on out from under it.
    standOn(h, SHAFT_COL, SHAFT_FLOOR);
    const cut = await driveCut(
      h,
      "down",
      { col: SHAFT_COL, row: SHAFT_FLOOR },
      { maxFrames: FALL_FRAMES },
    );

    return { blast, raised, beforeFall, landing, landed, cut };
  });

  assertEqual(behind.blast.cut.broke, true, "the pocket detonated");
  assertEqual(behind.raised.notice?.shown, true, "the card is up");

  // It fell.
  assertEqual(behind.landing.hit, true, "the miner reached the floor");
  assertGreaterThan(
    behind.landed.miner.y - behind.beforeFall.miner.y,
    0,
    "world units the miner fell behind the card",
  );

  // It drilled.
  assertEqual(behind.cut.broke, true, "the cell under the miner broke");

  // It burned fuel.
  assertLessThan(
    behind.cut.snapshot.miner.fuel,
    behind.raised.miner.fuel,
    "fuel left after falling and drilling behind the card",
  );

  // And the card was on screen for all of it.
  assertEqual(
    behind.cut.snapshot.notice?.shown,
    true,
    "the card still drawn at the end of the drive",
  );
});
