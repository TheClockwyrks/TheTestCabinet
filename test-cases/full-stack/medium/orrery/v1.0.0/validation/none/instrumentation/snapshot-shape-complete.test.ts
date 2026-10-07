// instrumentation/snapshot-shape-complete — the snapshot reports the whole of the
// documented shape, on a session posed to use every part of it.
//
// THE RULE, from `specs/instrumentation.md`, Snapshot shape: the object literal
// that file prints is the whole contract, and "The shape is fixed, and every
// field is present whatever the screen and mode." So every name in that literal
// is read here, at the type the literal gives it, on a session posed so that none
// of them is resting: an open challenge, a machine of four parts with tapes, a
// live run carrying motes joined by a filament and held by a gripper, a posed
// tally, posed progress in both modes, and a posed pointer.
//
// THE DRAG IS POSED IN ITS OWN WORLD, AND THE SPECIFICATION IS WHY. `editor.drag`
// is one of three shapes, and `specs/editor.md` puts a live drag and a live run in
// different worlds: "While a run is active, in any status, a press on the field or
// the tape panel sets the focus alone, and the editor reads the run controls above
// and `mute` and nothing else." So the run is posed first, where `drag` reports its
// documented `null`, and the three drag shapes are posed afterwards while editing,
// each read for exactly the fields `specs/instrumentation.md` lists for it.
//
// WHAT IS NOT ASSERTED. No reading here is a deep-equal against a whole record: a
// build is free to carry a field of its own beside the ones the specification
// fixes, and comparing whole records would refuse it. Each field is read by name,
// at its documented type, against the value posed.
//
// `autoStep` IS THE ONE FIELD READ TWO WAYS. `specs/instrumentation.md` carries it
// in the literal under NO ENGINE alone, because under either engine the clock is
// the engine's and the surface has no switch over it, so the field a build must
// report is a boolean there and nothing at all here. Its behaviour is decided by
// `instrumentation/reset-leaves-the-clock-switch`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertHasProperty,
  assertLength,
  assertNear,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  DEFAULT_SPEED_INDEX,
  EXTRA_COUNT,
  FRACTION_TOLERANCE,
  MODES,
  ORRERY_DEBUG_VERSION,
  SCREENS,
  SIM_STATUSES,
} from "../constants";
import { at, hexCenter, traySlot } from "../field";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import { armPart, risePart, setPart, solution } from "../formats";
import { machineCost } from "../parts";
import {
  captureStill,
  centerOf,
  createHarness,
  filamentBetween,
  heldBy,
  moteById,
  moveTo,
  partById,
  placeTrack,
  poseOf,
  pressAt,
  releasePointer,
  solePartOfKind,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";

/** The machine posed on the field: a rise, a set, an arm with a tape, a wheel. */
const MACHINE = solution([
  risePart(0, WEST.q, WEST.r),
  setPart(0, EAST.q, EAST.r),
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [
    "grab",
    "rotate-cw",
    "drop",
    "rotate-ccw",
  ]),
  armPart("wheel", 0, -3, 0, 1, ["rotate-cw"]),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports every documented field, at its documented type, as posed", async () => {
  await h.debug.reset();
  await h.debug.setMode("extras");
  await h.debug.setUnlockedCount(3);
  await h.debug.setSolved("campaign", 1, true);
  await h.debug.setRecord("campaign", 1, "cost", 120);

  // One Extras challenge visited and left, so `extras.stashed` is not resting.
  await h.debug.openChallenge("extras", 0);
  await h.debug.placePart("arm", ORIGIN.q, ORIGIN.r, 0);
  await h.debug.setScreen("title");
  await h.debug.setLast("campaign", 2);
  await h.debug.setLast("extras", 4);

  await h.debug.loadChallenge(BARE);
  await h.debug.clearMachine();
  await h.debug.loadSolution(MACHINE);
  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();

  // Each of the four parts is the only one of its kind, so every id below is
  // found by what it IS rather than by where it sits in the list: what
  // `editor.parts` is ordered by is another item's business.
  const posed = await h.snapshot();
  const rise = solePartOfKind(posed, "rise")?.id ?? -1;
  const set = solePartOfKind(posed, "set")?.id ?? -1;
  const arm = solePartOfKind(posed, "arm")?.id ?? -1;
  const wheel = solePartOfKind(posed, "wheel")?.id ?? -1;

  const carried = await spawnMote(h, at(1, 0), "dust");
  const bonded = await spawnMote(h, at(2, 0), "luna");
  await h.debug.linkMotes(carried, bonded, 3);
  await takeGrip(h, arm, 0, carried);
  await h.debug.setTally(0, 2);
  await h.debug.setPaused(true);
  // The REAL pointer, through the frame that reads it: `pointer` mirrors what
  // "the pointer input reports" (`specs/instrumentation.md`), and a frame after a
  // posed `pointerMove` an engine's input reports no such move.
  await h.mouseGlide(300, 200);
  await captureStill(h, "posed");

  const s = await h.snapshot();

  /* -- The top level ------------------------------------------------------ */

  assertEqual(s.version, ORRERY_DEBUG_VERSION, "version is a plain 1");
  assertContains(SCREENS, s.screen, "screen is one of the four screen names");
  assertEqual(s.screen, "editor", "the posed session is on the editor");
  assertContains(MODES, s.mode, "mode is one of the two mode names");
  assertEqual(s.mode, "extras", "mode reports the mode posed");
  assertEqual(typeof s.menuIndex, "number", "menuIndex is a number");
  assertEqual(typeof s.titleIndex, "number", "titleIndex is a number");
  assertEqual(typeof s.selectIndex, "number", "selectIndex is a number");
  assertEqual(s.howtoPage, 0, "howtoPage is 0 away from the how-to");
  assertEqual(typeof s.completion, "boolean", "completion is a boolean");
  assertEqual(s.completion, false, "completion reports the switch posed off");
  assertEqual(typeof s.muted, "boolean", "muted is a boolean");
  assertEqual(typeof s.simTime, "number", "simTime is a number");
  assertGreaterThanOrEqual(
    s.simTime,
    0,
    "simTime accumulated the frame that was driven",
  );
  assertContains(
    ["boolean", "undefined"],
    typeof s.autoStep,
    "autoStep is a boolean under no engine and absent under either engine, which owns the clock",
  );

  /* -- campaign and extras ------------------------------------------------ */

  assertGreaterThanOrEqual(
    s.campaign.count,
    1,
    "campaign.count is how many challenges the shipped course holds",
  );
  assertEqual(
    s.campaign.unlockedCount,
    3,
    "campaign.unlockedCount reports the count posed",
  );
  assertDeepEqual(
    s.campaign.solved,
    [1],
    "campaign.solved holds the ascending indices posed solved",
  );
  assertLength(
    s.campaign.records,
    s.campaign.count,
    "campaign.records holds one entry per challenge",
  );
  assertEqual(
    s.campaign.records[1]?.cost,
    120,
    "the posed record reports the metric it was given",
  );
  assertEqual(
    s.campaign.records[1]?.cycles,
    0,
    "a challenge with no record yet gains one whose other two metrics are 0",
  );
  assertEqual(
    s.campaign.records[1]?.area,
    0,
    "a challenge with no record yet gains one whose other two metrics are 0",
  );
  assertNull(
    s.campaign.records[0] ?? null,
    "a challenge with no record reports null",
  );
  assertDeepEqual(s.campaign.stashed, [], "campaign.stashed is empty");
  assertEqual(s.campaign.last, 2, "campaign.last reports the row posed");

  assertEqual(
    s.extras.count,
    EXTRA_COUNT,
    "extras.count is the ten challenges of specs/modes/extras.md",
  );
  assertDeepEqual(s.extras.solved, [], "extras.solved is empty");
  assertLength(
    s.extras.records,
    EXTRA_COUNT,
    "extras.records holds one entry per challenge",
  );
  assertDeepEqual(
    s.extras.stashed,
    [0],
    "extras.stashed holds the index of the challenge visited and left",
  );
  assertEqual(s.extras.last, 4, "extras.last reports the row posed");

  /* -- challenge ---------------------------------------------------------- */

  const challenge = s.challenge;
  assertNotNull(
    challenge,
    "challenge reports the challenge open in the editor",
  );
  assertEqual(challenge?.name, BARE.name, "challenge.name is the posed name");
  assertLength(
    challenge?.reagents ?? [],
    BARE.reagents.length,
    "challenge.reagents holds the posed reagents",
  );
  assertDeepEqual(
    challenge?.reagents[0]?.motes,
    BARE.reagents[0]?.motes,
    "a reagent reports the pattern it was posed with",
  );
  assertLength(
    challenge?.products ?? [],
    BARE.products.length,
    "challenge.products holds the posed products",
  );
  assertDeepEqual(
    challenge?.products[0]?.motes,
    BARE.products[0]?.motes,
    "a product reports the pattern it was posed with",
  );
  assertDeepEqual(
    challenge?.permitted,
    BARE.permitted,
    "challenge.permitted is the posed permitted list",
  );
  assertEqual(
    challenge?.target,
    BARE.target,
    "challenge.target is the posed target",
  );
  assertEqual(
    challenge?.source,
    "custom",
    "a challenge loaded as a document reports its source as custom",
  );
  assertNull(challenge?.index ?? null, "index is null when source is custom");

  /* -- editor ------------------------------------------------------------- */

  assertLength(
    s.editor.parts,
    MACHINE.parts.length,
    "editor.parts holds every placed part",
  );
  assertEqual(
    s.editor.cost,
    machineCost(MACHINE.parts),
    "editor.cost is PART_COSTS over the parts",
  );
  assertEqual(s.editor.period, 4, "editor.period is the longest tape's length");
  assertNull(
    s.editor.selected,
    "editor.selected is null: nothing was selected",
  );
  assertEqual(s.editor.focus, "field", "editor.focus is field");
  assertNull(s.editor.cursor, "editor.cursor is null: nothing was pointed at");
  assertNull(s.editor.drag, "editor.drag is null outside a press");
  assertEqual(
    s.editor.undoDepth,
    0,
    "no operation of the surface pushes an undo entry",
  );
  assertEqual(
    s.editor.redoDepth,
    0,
    "no operation of the surface pushes a redo entry",
  );

  const armPlaced = partById(s, arm);
  assertNotNull(armPlaced, "the arm is reported among the parts");
  assertEqual(typeof armPlaced?.id, "number", "a part's id is a number");
  assertEqual(
    armPlaced?.kind,
    "arm",
    "a part reports the kind it was placed as",
  );
  assertEqual(armPlaced?.q, ORIGIN.q, "a part reports its anchor q");
  assertEqual(armPlaced?.r, ORIGIN.r, "a part reports its anchor r");
  assertEqual(armPlaced?.rotation, 0, "a part reports its rest rotation");
  assertEqual(armPlaced?.length, 1, "a part reports its rest length");
  assertNull(
    armPlaced?.cells ?? null,
    "cells is null on everything but a track",
  );
  assertNull(
    armPlaced?.closed ?? null,
    "closed is null on everything but a track",
  );
  assertNull(
    armPlaced?.index ?? null,
    "index is null on everything but a rise or set",
  );
  assertDeepEqual(
    armPlaced?.tape,
    MACHINE.parts[2]?.tape,
    "an arm reports the tape it was placed with",
  );

  const risePlaced = partById(s, rise);
  assertEqual(risePlaced?.kind, "rise", "the rise is reported as a rise");
  assertEqual(risePlaced?.index, 0, "a rise reports which reagent it is");
  assertNull(
    risePlaced?.tape ?? null,
    "tape is null on everything but an arm or wheel",
  );
  assertEqual(partById(s, set)?.kind, "set", "the set is reported as a set");
  assertEqual(partById(s, set)?.index, 0, "a set reports which product it is");

  /* -- sim ---------------------------------------------------------------- */

  const sim = s.sim;
  assertNotNull(sim, "sim reports the live run");
  assertContains(
    SIM_STATUSES,
    sim?.status,
    "sim.status is one of the four statuses",
  );
  assertEqual(sim?.status, "paused", "sim.status reports the run posed paused");
  assertEqual(sim?.cycle, 0, "sim.cycle counts completed cycles");
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "sim.fraction is the progress through the current cycle",
  );
  assertEqual(
    sim?.speed,
    DEFAULT_SPEED_INDEX,
    "sim.speed is the SPEEDS index a run starts at",
  );

  assertLength(sim?.motes ?? [], 2, "sim.motes holds every mote on the field");
  const carriedView = moteById(s, carried);
  assertNotNull(carriedView, "the carried mote is reported");
  assertEqual(
    carriedView?.q,
    1,
    "a mote reports the hex it held at the last boundary",
  );
  assertEqual(
    carriedView?.r,
    0,
    "a mote reports the hex it held at the last boundary",
  );
  assertNear(
    carriedView?.x ?? -1,
    hexCenter(at(1, 0)).x,
    FRACTION_TOLERANCE,
    "a mote at a boundary is drawn on its hex's center",
  );
  assertNear(
    carriedView?.y ?? -1,
    hexCenter(at(1, 0)).y,
    FRACTION_TOLERANCE,
    "a mote at a boundary is drawn on its hex's center",
  );
  assertEqual(
    carriedView?.type,
    "dust",
    "a mote reports the type it was spawned as",
  );
  assertNull(carriedView?.wheel ?? null, "wheel is null on every real mote");

  assertLength(sim?.filaments ?? [], 1, "sim.filaments holds every filament");
  const filament = filamentBetween(s, carried, bonded);
  assertNotNull(
    filament,
    "the posed filament joins the two motes it was given",
  );
  assertEqual(
    filament?.weight,
    3,
    "a filament reports the weight it was posed with",
  );

  assertLength(
    sim?.poses ?? [],
    2,
    "sim.poses holds one entry per arm and wheel",
  );
  const armPose = poseOf(s, arm);
  assertNotNull(armPose, "the arm's live pose is reported");
  assertEqual(armPose?.rotation, 0, "a pose reports the part's live rotation");
  assertEqual(armPose?.length, 1, "a pose reports the part's live length");
  assertDeepEqual(armPose?.cell, ORIGIN, "a pose reports the live base cell");
  assertNotNull(poseOf(s, wheel), "the wheel's live pose is reported");

  assertLength(
    sim?.grips ?? [],
    1,
    "sim.grips holds one entry per holding gripper",
  );
  assertEqual(
    heldBy(s, arm, 0),
    carried,
    "a grip reports the part, the spoke and the mote posed",
  );

  assertDeepEqual(sim?.tallies, [2], "sim.tallies holds one entry per product");
  assertEqual(
    typeof sim?.area,
    "number",
    "sim.area is the length of the area bank",
  );
  assertGreaterThanOrEqual(sim?.area ?? -1, 0, "sim.area is a count of hexes");
  assertNull(sim?.fault ?? null, "sim.fault is null while nothing has faulted");
  assertNull(
    sim?.metrics ?? null,
    "sim.metrics is null until the run completes",
  );

  /* -- pointer ------------------------------------------------------------ */

  assertHasProperty(s.pointer, "x", "pointer reports an x");
  assertHasProperty(s.pointer, "y", "pointer reports a y");
  assertHasProperty(s.pointer, "down", "pointer reports a press state");
  assertEqual(
    s.pointer.x,
    300,
    "pointer.x is the posed position, in stage units",
  );
  assertEqual(
    s.pointer.y,
    200,
    "pointer.y is the posed position, in stage units",
  );
  assertEqual(
    s.pointer.down,
    false,
    "pointer.down is false with nothing pressed",
  );

  /* -- editor.drag, in each of its three shapes, while editing ------------ */

  await h.debug.reset();
  await h.debug.loadChallenge(BARE);
  await h.debug.clearMachine();

  await pressAt(h, centerOf(traySlot(0)));
  const pressed = (await h.snapshot()).editor.drag;
  assertEqual(
    pressed?.kind,
    "place",
    "a press in the tray begins a place drag",
  );
  assertEqual(
    pressed?.kind === "place" ? pressed.part : null,
    "arm",
    "a place drag names the part kind the tray handed out",
  );
  assertNull(
    pressed?.kind === "place" ? pressed.index : "no place drag",
    "a place drag of a plain kind names no reagent or product index",
  );
  assertEqual(
    pressed?.kind === "place" ? pressed.rotation : null,
    0,
    "a place drag out of the tray starts at rotation 0",
  );
  assertEqual(
    pressed?.kind === "place" ? pressed.length : null,
    1,
    "a place drag out of the tray starts at length 1",
  );
  assertNull(
    pressed?.kind === "place" ? pressed.at : "no place drag",
    "at is null while no hex is targeted",
  );

  await moveTo(h, hexCenter(at(1, 0)));
  const targeted = (await h.snapshot()).editor.drag;
  assertDeepEqual(
    targeted?.kind === "place" ? targeted.at : null,
    at(1, 0),
    "at is the targeted hex once the pointer is over one",
  );
  await releasePointer(h);

  const dragged = solePartOfKind(await h.snapshot(), "arm")?.id ?? -1;
  await pressAt(h, hexCenter(at(1, 0)));
  const grabbed = (await h.snapshot()).editor.drag;
  assertEqual(
    grabbed?.kind,
    "move",
    "a press on a placed part begins a move drag",
  );
  assertEqual(
    grabbed?.kind === "move" ? grabbed.part : null,
    dragged,
    "a move drag names the part by id",
  );
  assertDeepEqual(
    grabbed?.kind === "move" ? grabbed.from : null,
    at(1, 0),
    "a move drag carries the hex the press grabbed",
  );
  await moveTo(h, hexCenter(at(2, 0)));
  const moved = (await h.snapshot()).editor.drag;
  assertDeepEqual(
    moved?.kind === "move" ? moved.at : null,
    at(2, 0),
    "a move drag's at follows the pointer",
  );
  await releasePointer(h);

  await h.debug.clearMachine();
  const track = await placeTrack(h, [at(-2, 1), at(-1, 1), at(0, 1)]);
  await pressAt(h, hexCenter(at(0, 1)));
  const laying = (await h.snapshot()).editor.drag;
  assertEqual(
    laying?.kind,
    "lay",
    "a press on an end cell of an open track begins a lay",
  );
  assertEqual(
    laying?.kind === "lay" ? laying.part : null,
    track,
    "a lay drag names the track by id",
  );
  assertContains(
    ["first", "last"],
    laying?.kind === "lay" ? laying.end : null,
    "a lay drag names which end of the track it is extending",
  );
  await releasePointer(h);
  assertNull((await h.snapshot()).editor.drag, "a drag ends at its release");
});
