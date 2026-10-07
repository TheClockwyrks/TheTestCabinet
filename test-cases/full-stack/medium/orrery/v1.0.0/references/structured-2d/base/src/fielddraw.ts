// Orrery — drawing the field: the sky's ninety-one cells, the engravings, the
// machine, the motes, and the editor's hands over all of it (specs/field.md,
// specs/parts.md, specs/sigils.md, specs/editor.md, specs/assets.md).
//
// Each function here draws ONE thing, and `src/actors.ts` gives each its place
// in the engine's layer order: the cells are the ground; the engravings are cut
// into it, so they sit under everything; tracks are laid on it; filaments run
// under the motes they join; the machine stands over the motes it carries; and
// the editor's own marks — the selection, the ghost, the targeted hex — sit
// above the machine, because they are what the player is pointing at. That
// order is `LAYERS` in `src/theme.ts`, and it is the reading order of the
// field.
//
// Every produced sprite is drawn at its native canvas size, centered on the
// thing it depicts and turned to its live angle, exactly as specs/assets.md
// tabulates. Each is drawn through `sprite`, which reports whether it had an
// image; when it did not, the fallback beside it is drawn instead, so a field
// with no sprites at all is still a field a machine can be built on.

import {
  APERTURE_FRAMES,
  APERTURE_FRAME_TIME,
  FILAMENT_SPRITE_H,
  FILAMENT_SPRITE_PATHS,
  FILAMENT_SPRITE_W,
  FIXTURE_MOUNT_PATH,
  GRIPPER_PATHS,
  GRIPPER_SPRITE_SIZE,
  HEX_PITCH,
  HUB_PATHS,
  HUB_SPRITE_SIZE,
  MOTE_R,
  MOTE_SPRITE_PATHS,
  MOTE_SPRITE_SIZE,
  SIGIL_GLYPH_PATHS,
  SIGIL_GLYPH_SIZE,
  WHEEL_HUB_PATH,
  WHEEL_SPRITE_SIZE,
} from "./constants";
import { TRIUNE_WEIGHT } from "./figures";
import { aperturePath } from "./assets";
import { moteStagePosition } from "./cycle";
import { disc, hexPath, line, sprite, text } from "./draw";
import { addHex, fieldHexes, hexCenter, hexX, hexY } from "./hex";
import type { Sprites } from "./assets";
import { rowLabels } from "./labels";
import { clonePart, createPart, findPart } from "./machine";
import type { StagePoint } from "./motion";
import {
  apertureFootprint,
  apertureMolecule,
  armSpokes,
  isArmKind,
  isTransformingSigil,
  partClass,
  partHexes,
  placeHex,
  placementLegal,
  sigilFootprint,
} from "./parts";
import { drawnGrippers, drawnParts, type DrawnPart } from "./pose";
import { COLORS, MOTE_COLORS } from "./theme";
import type {
  DragState,
  Hex,
  Molecule,
  MoteState,
  PartState,
  SimFilament,
} from "./types";
import type { OrreryState } from "./state";

/**
 * The radius a pointy-top hex is drawn at. Adjacent centers are `HEX_PITCH`
 * apart and a pointy-top hex's circumradius is that over `sqrt(3)`, so the
 * ninety-one cells tile the field with shared edges rather than sitting apart.
 */
const HEX_R = HEX_PITCH / Math.sqrt(3);

/** Short tags for the roles specs/sigils.md gives a sigil's hexes. */
const ROLE_TAGS: Record<string, string> = {
  first: "1",
  second: "2",
  center: "CTR",
  reach: "RCH",
  seat: "SEAT",
  source: "SRC",
  target: "TGT",
  prime: "PRI",
  crown: "CRN",
  fount: "FNT",
  "umbral-crown": "UMB",
  "lumen-crown": "LUM",
  "nebula-crown": "NEB",
  "comet-crown": "COM",
  "nova-crown": "NOV",
  "meteor-crown": "MET",
  maw: "MAW",
  rim: "RIM",
};

/**
 * The whole field in one pass, in the layer order `src/actors.ts` spreads
 * across its components. The build draws through the actors; this is the same
 * picture as one call, which is what the build's own tests draw with.
 */
export function drawFieldScreen(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
  sprites: Sprites,
): void {
  drawCells(ctx);
  for (const part of state.editor.parts)
    drawEngraving(ctx, state, sprites, part);
  for (const part of state.editor.parts) {
    if (part.kind === "track") drawTrack(ctx, part);
  }
  for (const filament of state.sim?.filaments ?? []) {
    drawFilament(ctx, state, sprites, filament);
  }
  for (const mote of state.sim?.motes ?? [])
    drawMote(ctx, sprites, mote, state);
  for (const drawn of drawnParts(state)) {
    drawMechanism(ctx, state, sprites, drawn);
  }
  drawHands(ctx, state);
}

/** The editor's own marks, over the machine they point at. */
export function drawHands(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
): void {
  drawSelection(ctx, state);
  drawGhost(ctx, state);
  drawTargetHex(ctx, state);
  drawFaultMarks(ctx, state);
}

/** The field's ninety-one cells, drawn at their fixed geometry. */
export function drawCells(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.lineWidth = 1;
  for (const cell of fieldHexes()) {
    hexPath(ctx, hexX(cell.q, cell.r), hexY(cell.q, cell.r), HEX_R);
    ctx.fillStyle = COLORS.hex;
    ctx.fill();
    ctx.strokeStyle = COLORS.hexEdge;
    ctx.stroke();
  }
  ctx.restore();
}

/** Trace one hex's outline in a color, at a given width. */
function outlineHex(
  ctx: CanvasRenderingContext2D,
  cell: Hex,
  color: string,
  width = 2,
  radius = HEX_R,
): void {
  const at = hexCenter(cell);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  hexPath(ctx, at.x, at.y, radius);
  ctx.stroke();
  ctx.restore();
}

/** Fill one hex's ground, for an engraved footprint. */
function fillHex(
  ctx: CanvasRenderingContext2D,
  cell: Hex,
  color: string,
): void {
  const at = hexCenter(cell);
  ctx.save();
  ctx.fillStyle = color;
  hexPath(ctx, at.x, at.y, HEX_R - 1);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Engravings: the sigils, and the rises and sets
// ---------------------------------------------------------------------------

/** One engraved part: its footprint, the roles its hexes carry, and its glyph. */
export function drawEngraving(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
  sprites: Sprites,
  part: PartState,
): void {
  const cls = partClass(part.kind);
  if (cls !== "sigil" && cls !== "rise" && cls !== "set") return;
  const anchor: Hex = { q: part.q, r: part.r };

  if (isTransformingSigil(part.kind)) {
    for (const cell of sigilFootprint(part.kind, anchor, part.rotation)) {
      fillHex(ctx, cell.hex, COLORS.engraving);
      outlineHex(ctx, cell.hex, COLORS.brassDark, 1.5);
      const at = hexCenter(cell.hex);
      text(ctx, ROLE_TAGS[cell.role] ?? cell.role, at.x, at.y + 20, {
        size: 8,
        color: COLORS.textFaint,
        align: "center",
      });
    }
    const at = hexCenter(anchor);
    if (
      !sprite(
        ctx,
        sprites.get(SIGIL_GLYPH_PATHS[part.kind]),
        at.x,
        at.y,
        SIGIL_GLYPH_SIZE,
      )
    ) {
      text(ctx, part.kind, at.x, at.y + 3, {
        size: 10,
        color: COLORS.brass,
        align: "center",
      });
    }
    return;
  }

  const challenge = state.challenge;
  if (challenge === null) return;
  const molecule = apertureMolecule(part, challenge);
  if (molecule === null) return;
  const repeating = part.kind === "set";
  for (const cell of apertureFootprint(
    molecule,
    anchor,
    part.rotation,
    repeating,
  )) {
    fillHex(ctx, cell, COLORS.engraving);
    outlineHex(ctx, cell, COLORS.brassDark, 1.5);
  }
  const at = hexCenter(anchor);
  const frame =
    Math.floor(Math.max(0, state.simTime) / APERTURE_FRAME_TIME) %
    APERTURE_FRAMES;
  const sheet = part.kind === "rise" ? "rise" : "set";
  if (!sprite(ctx, sprites.get(aperturePath(sheet, frame)), at.x, at.y, 48)) {
    outlineHex(
      ctx,
      anchor,
      part.kind === "rise" ? COLORS.brass : COLORS.steel,
      2.5,
      HEX_R - 6,
    );
  }
  drawPattern(ctx, molecule, anchor, part.rotation, repeating);
}

/**
 * The pattern a rise or a set shows: one bead per pattern mote, in that mote's
 * own color, and a thread for each pattern filament. A repeating product also
 * shows the copy one repeat vector along, drawn back, so the chain reads.
 */
function drawPattern(
  ctx: CanvasRenderingContext2D,
  molecule: Molecule,
  anchor: Hex,
  rotation: number,
  repeating: boolean,
): void {
  const copies: { offset: Hex; alpha: number }[] = [
    { offset: { q: 0, r: 0 }, alpha: 1 },
  ];
  if (repeating && molecule.repeat !== null) {
    const vector = placeHex(molecule.repeat.vector, { q: 0, r: 0 }, rotation);
    copies.push({ offset: vector, alpha: 0.45 });
  }
  ctx.save();
  for (const copy of copies) {
    ctx.globalAlpha = copy.alpha;
    const at = (cell: Hex): StagePoint => {
      const placed = placeHex(cell, anchor, rotation);
      return hexCenter(addHex(placed, copy.offset));
    };
    for (const filament of molecule.filaments) {
      const a = at(filament.a);
      const b = at(filament.b);
      line(
        ctx,
        a.x,
        a.y,
        b.x,
        b.y,
        COLORS.brass,
        filament.weight === TRIUNE_WEIGHT ? 4 : 2,
      );
    }
    for (const mote of molecule.motes) {
      const point = at(mote);
      disc(ctx, point.x, point.y, 7, MOTE_COLORS[mote.type] ?? COLORS.text);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Track
// ---------------------------------------------------------------------------

/** A track's path: its cells, the run between them, and its two ends. */
export function drawTrack(
  ctx: CanvasRenderingContext2D,
  part: PartState,
): void {
  const cells = part.cells ?? [];
  if (cells.length === 0) return;
  const points = cells.map((cell) => hexCenter(cell));
  ctx.save();
  ctx.strokeStyle = COLORS.brassDark;
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  if (part.closed === true && points.length > 2) ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = COLORS.brass;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  for (const cell of cells) outlineHex(ctx, cell, COLORS.brassDark, 1);
  if (part.closed !== true) {
    for (const end of [points[0], points[points.length - 1]]) {
      disc(ctx, end.x, end.y, 6, COLORS.brass);
      disc(ctx, end.x, end.y, 3, COLORS.sky);
    }
  }
}

// ---------------------------------------------------------------------------
// The run: filaments and motes
// ---------------------------------------------------------------------------

/** One filament, drawn as its produced strip between the motes it joins. */
export function drawFilament(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
  sprites: Sprites,
  filament: SimFilament,
): void {
  const sim = state.sim;
  if (sim === null) return;
  const a = sim.motes.find((mote) => mote.id === filament.a);
  const b = sim.motes.find((mote) => mote.id === filament.b);
  if (a === undefined || b === undefined) return;
  const from = moteStagePosition(a, sim);
  const to = moteStagePosition(b, sim);
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const degrees = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  const triune = filament.weight === TRIUNE_WEIGHT;
  const path = triune
    ? FILAMENT_SPRITE_PATHS.triune
    : FILAMENT_SPRITE_PATHS.plain;
  if (
    !sprite(
      ctx,
      sprites.get(path),
      midX,
      midY,
      FILAMENT_SPRITE_W,
      FILAMENT_SPRITE_H,
      degrees,
    )
  ) {
    line(ctx, from.x, from.y, to.x, to.y, COLORS.brass, triune ? 9 : 3);
  }
}

/** One mote, at the position its cycle has carried it to this frame. */
export function drawMote(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  mote: MoteState,
  state: OrreryState,
): void {
  const sim = state.sim;
  if (sim === null) return;
  const at = moteStagePosition(mote, sim);
  if (mote.wheel !== null) {
    sprite(ctx, sprites.get(FIXTURE_MOUNT_PATH), at.x, at.y, WHEEL_SPRITE_SIZE);
  }
  if (
    !sprite(
      ctx,
      sprites.get(MOTE_SPRITE_PATHS[mote.type]),
      at.x,
      at.y,
      MOTE_SPRITE_SIZE,
    )
  ) {
    disc(ctx, at.x, at.y, MOTE_R - 4, MOTE_COLORS[mote.type] ?? COLORS.text);
    text(ctx, mote.type.slice(0, 2), at.x, at.y + 4, {
      size: 11,
      color: COLORS.sky,
      align: "center",
      bold: true,
    });
  }
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

/** One arm or wheel, at the pose this frame draws it in, with its label. */
export function drawMechanism(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
  sprites: Sprites,
  drawn: DrawnPart,
): void {
  if (drawn.part.kind === "wheel") drawWheel(ctx, sprites, drawn);
  else drawArm(ctx, sprites, drawn);
  const label = rowLabels(state.editor.parts).get(drawn.part.id);
  if (label !== undefined) {
    text(ctx, label, drawn.base.x, drawn.base.y - 16, {
      size: 11,
      color: COLORS.text,
      align: "center",
      bold: true,
    });
  }
}

/** The pose one placed part is drawn in this frame, or `null` for a part with none. */
export function drawnPartOf(state: OrreryState, id: number): DrawnPart | null {
  return drawnParts(state).find((drawn) => drawn.part.id === id) ?? null;
}

/** One arm: a shaft out to each gripper, its hub, and each gripper's jaw. */
function drawArm(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  drawn: DrawnPart,
): void {
  const grippers = drawnGrippers(drawn);
  for (const gripper of grippers) {
    line(
      ctx,
      drawn.base.x,
      drawn.base.y,
      gripper.at.x,
      gripper.at.y,
      COLORS.brassDark,
      7,
    );
    line(
      ctx,
      drawn.base.x,
      drawn.base.y,
      gripper.at.x,
      gripper.at.y,
      COLORS.brass,
      3,
    );
  }
  const hub = drawn.part.kind === "piston" ? HUB_PATHS.piston : HUB_PATHS.arm;
  if (
    !sprite(
      ctx,
      sprites.get(hub),
      drawn.base.x,
      drawn.base.y,
      HUB_SPRITE_SIZE,
      HUB_SPRITE_SIZE,
      drawn.bearing,
    )
  ) {
    disc(ctx, drawn.base.x, drawn.base.y, 13, COLORS.brassDark);
    disc(ctx, drawn.base.x, drawn.base.y, 9, COLORS.brass);
  }
  for (const gripper of grippers) {
    const path = gripper.closed ? GRIPPER_PATHS.closed : GRIPPER_PATHS.open;
    if (
      !sprite(
        ctx,
        sprites.get(path),
        gripper.at.x,
        gripper.at.y,
        GRIPPER_SPRITE_SIZE,
        GRIPPER_SPRITE_SIZE,
        gripper.bearing,
      )
    ) {
      ctx.save();
      ctx.strokeStyle = gripper.closed ? COLORS.brass : COLORS.steel;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(
        gripper.at.x,
        gripper.at.y,
        13,
        gripper.closed ? 0 : 0.6,
        gripper.closed ? Math.PI * 2 : Math.PI * 2 - 0.6,
      );
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** The zodiac wheel: six spokes out to its fixture ring, and its dial. */
function drawWheel(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  drawn: DrawnPart,
): void {
  for (let spoke = 0; spoke < 6; spoke += 1) {
    const radians = ((drawn.bearing + spoke * 60) * Math.PI) / 180;
    line(
      ctx,
      drawn.base.x,
      drawn.base.y,
      drawn.base.x + Math.cos(radians) * HEX_PITCH,
      drawn.base.y + Math.sin(radians) * HEX_PITCH,
      spoke === 0 ? COLORS.brass : COLORS.brassDark,
      spoke === 0 ? 5 : 3,
    );
  }
  if (
    !sprite(
      ctx,
      sprites.get(WHEEL_HUB_PATH),
      drawn.base.x,
      drawn.base.y,
      WHEEL_SPRITE_SIZE,
      WHEEL_SPRITE_SIZE,
      drawn.bearing,
    )
  ) {
    disc(ctx, drawn.base.x, drawn.base.y, 16, COLORS.brassDark);
    disc(ctx, drawn.base.x, drawn.base.y, 11, COLORS.brass);
  }
}

// ---------------------------------------------------------------------------
// The editor's hands
// ---------------------------------------------------------------------------

/** The selected part, outlined so it is told from the rest at a glance. */
function drawSelection(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
): void {
  const selected = state.editor.selected;
  if (selected === null) return;
  const part = findPart(state.editor.parts, selected);
  if (part === null) return;
  for (const cell of partHexes(part, state.challenge)) {
    outlineHex(ctx, cell, COLORS.brass, 3);
  }
  if (isArmKind(part.kind) || part.kind === "wheel") {
    outlineHex(ctx, { q: part.q, r: part.r }, COLORS.brass, 3);
  }
}

/** The hex the pointer is targeting, while the editor is being worked. */
function drawTargetHex(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
): void {
  if (state.sim !== null) return;
  const drag = state.editor.drag;
  const at = drag !== null && drag.kind !== "lay" ? drag.at : null;
  if (at === null) return;
  outlineHex(ctx, at, COLORS.target, 2, HEX_R - 3);
}

/**
 * The live drag's ghost: the part as the release would leave it, marked legal
 * or illegal by the placement rules of specs/parts.md.
 */
function drawGhost(ctx: CanvasRenderingContext2D, state: OrreryState): void {
  const drag = state.editor.drag;
  if (drag === null || drag.kind === "lay") return;
  const ghost = ghostPart(state, drag);
  if (ghost === null) return;
  const others = state.editor.parts.filter((part) => part.id !== ghost.id);
  const legal = placementLegal(ghost, others, state.challenge);
  const color = legal ? COLORS.legal : COLORS.fault;
  ctx.save();
  ctx.globalAlpha = 0.75;
  for (const cell of partHexes(ghost, state.challenge)) {
    outlineHex(ctx, cell, color, 2.5);
  }
  if (isArmKind(ghost.kind) || ghost.kind === "wheel") {
    const base = hexCenter({ q: ghost.q, r: ghost.r });
    outlineHex(ctx, { q: ghost.q, r: ghost.r }, color, 2.5);
    const spokes = isArmKind(ghost.kind)
      ? armSpokes(ghost.kind, ghost.rotation)
      : [0, 1, 2, 3, 4, 5];
    for (const spoke of spokes) {
      const radians = (spoke * 60 * Math.PI) / 180;
      const reach = HEX_PITCH * (isArmKind(ghost.kind) ? ghost.length : 1);
      line(
        ctx,
        base.x,
        base.y,
        base.x + Math.cos(radians) * reach,
        base.y + Math.sin(radians) * reach,
        color,
        3,
      );
    }
  }
  ctx.restore();
}

/** The part a live drag would leave behind, built as the release would build it. */
function ghostPart(state: OrreryState, drag: DragState): PartState | null {
  if (drag.kind === "place") {
    if (drag.at === null) return null;
    return createPart(0, drag.part, drag.at.q, drag.at.r, drag.rotation, {
      length: drag.length,
      index: drag.index ?? undefined,
    });
  }
  if (drag.kind === "move") {
    const part = findPart(state.editor.parts, drag.part);
    if (part === null || drag.at === null) return null;
    const dq = drag.at.q - drag.from.q;
    const dr = drag.at.r - drag.from.r;
    const ghost = clonePart(part);
    ghost.q = part.q + dq;
    ghost.r = part.r + dr;
    if (ghost.cells !== null) {
      ghost.cells = ghost.cells.map((cell) => ({
        q: cell.q + dq,
        r: cell.r + dr,
      }));
    }
    if (ghost.kind !== "track") ghost.rotation = drag.rotation;
    if (isArmKind(ghost.kind)) ghost.length = drag.length;
    return ghost;
  }
  return null;
}

/**
 * The parts and motes the fault of specs/simulation.md names, drawn visibly
 * apart from the rest while the run stands frozen.
 */
function drawFaultMarks(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
): void {
  const sim = state.sim;
  const fault = sim?.fault ?? null;
  if (sim === null || fault === null) return;
  for (const id of fault.parts) {
    const part = findPart(state.editor.parts, id);
    if (part === null) continue;
    // An arm's hexes are its anchor alone, which is also the fallback for a
    // part whose footprint the open challenge cannot resolve.
    const footprint = partHexes(part, state.challenge);
    const cells = footprint.length > 0 ? footprint : [{ q: part.q, r: part.r }];
    for (const cell of cells) outlineHex(ctx, cell, COLORS.fault, 3);
  }
  for (const id of fault.motes) {
    const mote = sim.motes.find((entry) => entry.id === id);
    if (mote === undefined) continue;
    const at = moteStagePosition(mote, sim);
    ctx.save();
    ctx.strokeStyle = COLORS.fault;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(at.x, at.y, MOTE_R + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
