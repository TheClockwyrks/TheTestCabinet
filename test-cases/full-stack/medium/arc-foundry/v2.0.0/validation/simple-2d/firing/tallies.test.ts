// firing/tallies — a structure counts what it killed and what it dealt.
//
// specs/components.md fixes both: "Every firing structure keeps two running
// tallies for the run: the number of units it killed, and the total damage it
// dealt." specs/hud.md is what they are for — the inspector's read and the damage
// leaderboard's ranking — so a build with the wrong tallies ranks its towers
// wrongly.
//
// The arrangement is chosen so the two figures cannot drift apart from overkill:
// a Scrap Emitter deals `2` a shot and a Mote at wave `1` on Medium carries `10`
// health, so each Mote takes exactly five whole shots and the health the structure
// removed is exactly the damage it dealt. Three Motes are held inside the radius
// and nothing else is on the yard, so every point of that damage and every one of
// those kills belongs to the one structure being read.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureReplay,
  componentDamage,
  createHarness,
  difficultyById,
  loadDef,
  openYard,
  parkUnit,
  scaledHp,
  standComponent,
  structureById,
  ticks,
  type Harness,
} from "../harness";

const ANCHOR = { col: 10, row: 10 };

/** Three places inside the Scrap Emitter's `88`, each clear of the others. */
const PLACES = [
  { x: 50, y: 0 },
  { x: 0, y: 50 },
  { x: -50, y: 0 },
];

/** How long the Emitter is given to work through them, in seconds. */
const PATIENCE = 20;

/** One Mote's health at wave 1 on Medium, from specs/enemies.md's formula. */
const MOTE_HP = scaledHp(
  loadDef("mote").baseHealth,
  1,
  difficultyById("medium"),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("tallies three kills and the health it removed to make them", async () => {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "emitter", 1, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  for (const place of PLACES) {
    parkUnit(h, "mote", {
      x: structure.cx + place.x,
      y: structure.cy + place.y,
    });
  }

  const cleared = await captureReplay(h, "tally", () =>
    h.until((s) => s.units.length === 0, {
      maxFrames: ticks(PATIENCE),
      poll: 2,
    }),
  );

  assertEqual(
    cleared.hit,
    true,
    `all ${PLACES.length} Motes killed within ${PATIENCE}s`,
  );
  const after = structureById(cleared.snapshot, id);
  assertEqual(
    after.kills,
    PLACES.length,
    "the structure's kill tally after killing every unit on the yard",
  );
  assertCloseTo(
    after.damageDealt,
    PLACES.length * MOTE_HP,
    6,
    `the structure's damage tally: ${PLACES.length} Motes of ${MOTE_HP} health, ` +
      `each taking whole ${componentDamage("emitter", 1)}-damage shots with ` +
      `nothing spilled`,
  );
});
