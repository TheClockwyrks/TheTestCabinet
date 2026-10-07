// Arc Foundry — audio/playable-muted: muting changes the sound and nothing else.
//
// THE REQUIREMENT, from `specs/ui.md`: "Muting and the first-interaction unlock
// belong to the engine: the game binds the mute action to the engine's mute bit,
// toggles it from any screen, and stays fully playable with sound muted."
//
// WHAT "FULLY PLAYABLE" IS READ AS. That a run driven with the mute bit engaged
// keeps playing: the structure fires, its shots land and tally damage, the units
// it hits lose health, and the simulation clock advances over the drive. A build
// whose audio layer is load-bearing — a cue whose completion advances something, a
// sound that throws when the bus is off — stalls one of those readings, and each
// is read off the snapshot rather than off anything the audio layer reports.
//
// THE DRIVE IS ORDINARY PLAY, on purpose: a structure firing, two units taking
// damage, statuses running down and the economy paying out over two seconds of
// simulation, so the reading covers the systems a cue is played from rather than
// an idle yard.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  pressAction,
  standComponent,
  structureById,
} from "../harness";
import { structureCenter } from "../constants";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 21, row: 17 };
const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/** How long the yard is driven, in seconds of simulation. */
const SPAN = 2;

/** Digits the clock is held to: floating point, not a rule about the game. */
const DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps playing with the mute bit engaged", async () => {
  openYard(h, { wave: 3, charge: 500 });

  await pressAction(h, "mute");
  assertEqual(
    h.snapshot().muted,
    true,
    "the mute action to engage the mute bit the snapshot reports " +
      "(specs/ui.md, specs/instrumentation.md)",
  );

  const id = standComponent(h, "choke", 2, ANCHOR.col, ANCHOR.row);
  const units = [
    parkUnit(h, "slug", { x: HEAD.x + 80, y: HEAD.y }),
    parkUnit(h, "mote", { x: HEAD.x + 60, y: HEAD.y + 40 }),
  ];
  const opened = h.snapshot();

  const played = await captureReplay(h, "muted", async () => {
    await h.advanceSeconds(SPAN);
    return h.snapshot();
  });

  assertCloseTo(
    played.simTime - opened.simTime,
    SPAN,
    DIGITS,
    `the simulation clock over ${SPAN}s of play with sound muted (specs/ui.md)`,
  );
  assertGreaterThan(
    structureById(played, id).damageDealt,
    0,
    "the damage the Choke tallied with sound muted: a muted run keeps firing " +
      "(specs/ui.md)",
  );
  const removed = units
    .map((unit) => played.units.find((u) => u.id === unit))
    .reduce((sum, u) => sum + (u === undefined ? 0 : u.maxHp - u.hp), 0);
  assertGreaterThan(
    removed,
    0,
    "the health the held units lost with sound muted: a muted run keeps " +
      "landing its shots (specs/ui.md)",
  );
});
