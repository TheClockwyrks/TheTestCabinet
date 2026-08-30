// audio/sell-cue — `KeyS` on a selected tower sounds a cue on the frame the sale
// resolves, and the quiet floor around it stays silent.
//
// `specs/audio.md`'s cue table: `sell` answers "A placed tower is sold", and every
// cue is "raised by the frame that resolves the event it answers ... and played
// from the frame loop". `specs/controls.md` binds `sell` to `KeyS` and has it
// "[s]ell[] the selected tower", read "as a press edge" that "fires once per
// press". `specs/building.md` fixes what the sale does on that frame: "Selling a
// placed tower pays its refund into the money and removes it. On that frame every
// tile of its footprint reopens ... and the selection is cleared when the tower
// sold was the selected one."
//
// THE KEY IS A REAL ONE, and it has to be. `specs/instrumentation.md`: "No
// operation on this surface plays a cue, and none can ... Every cue is reached the
// way a player reaches it." A sale posed through `sellTower()` is entitled to be
// silent in a perfectly good build, so this drives the binding through Chromium's
// own input pipeline and releases it the moment the tower is gone — which means
// exactly one sale happens whether the build latches the press edge in its
// keyboard layer or compares held state at the top of its update, and
// `specs/controls.md` fixes neither.
//
// THE REFUND IS THE SPECIFICATION'S, NOT THE BUILD'S. `addTower` puts the tower on
// the floor with "`spent` equal to its build cost, `fresh` true"
// (`specs/instrumentation.md`), and `specs/building.md` refunds a fresh tower
// "`spent`, in full, with no rounding" — so the money the sale pays is the Arc's
// `15`, computed here from `specs/towers.md`. Reading the build's own `refund`
// field back would be asking the build to mark its own arithmetic.
//
// THE FLOOR HOLDS THE ONE TOWER AND NOTHING ELSE. `startRun` empties both rosters
// and shuts the world gate, so nothing arrives, nothing leaks, nothing dies, and
// no wave clears; the tower is a mover-free Arc with no target in range, so it
// resolves no shot and cannot trip. Every sound in the window belongs to the sale,
// and the quiet stretch before the key is where a build that blips per frame
// fails.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseTower,
  startRun,
  watchCues,
  type Harness,
} from "../harness";
import { TOWER_DEFS } from "../constants";
import { FREE_SITE } from "../fixtures";
import { framesOtherThan, sellSelected, soundsOn } from "./cues";

/** The type sold, and what a fresh one refunds in full (`specs/towers.md`). */
const TYPE = "arc" as const;
const REFUND = TOWER_DEFS[TYPE].cost;

/** Quiet play driven before the key, in frames: a third of a second of nothing. */
const QUIET_FRAMES = framesFor(0.3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the sale resolves, and on no other frame", async () => {
  await startRun(h);
  const id = await poseTower(h, TYPE, FREE_SITE.col, FREE_SITE.row);
  await h.debug.setSelected(id);
  const before = await h.snapshot();
  await h.armAudio();

  // Watched after the floor is posed, so what is read is the drive alone.
  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);
  await captureStill(h, "sell");

  const sale = await sellSelected(h);
  const saleFrame = sale.frame;
  const heard = [...played];

  assertEqual(before.selected, id, "the tower the inspector was opened on");
  assertEqual(sale.hit, true, "KeyS on the selected tower to sell it");
  assertEqual(
    sale.snapshot.towers.length,
    0,
    "the towers left on the floor once the sale resolved",
  );
  assertEqual(
    sale.snapshot.money,
    before.money + REFUND,
    `the money after a fresh ${TYPE} refunded ${REFUND}, from ${before.money}`,
  );
  assertNull(
    sale.snapshot.selected,
    "the selection, cleared by selling the selected tower",
  );

  assertGreaterThan(
    soundsOn(heard, saleFrame),
    0,
    `sounds emitted on frame ${saleFrame}, the frame the sale resolved`,
  );
  assertDeepEqual(
    framesOtherThan(heard, saleFrame),
    [],
    "the frames of every sound emitted away from the sale",
  );
});
