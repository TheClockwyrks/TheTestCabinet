// Valence — rendering (specs/overview.md, specs/board.md, specs/flow.md).
//
// Draws the whole 1280x720 stage in logical space: the board (produced conduit,
// build-cell markers, inlet, collector sprites), the towers and matter (produced sprites +
// animated cycles), the live decomposition bursts, and the in-code HUD (status bar,
// build panel), menus, and selection feedback. Matter now reads by its stackable TRAITS
// (bonded / heavy / inert) and hit points; a tower reads by its role, damage type, and
// tier III branch. Returns the frame's clickable regions so the input layer can route
// pointer events without re-deriving the layout.

import {
  ATOM_INNER_MAX,
  ATOM_MAX_ELECTRONS,
  ATOM_OUTER_MAX,
  BOARD_X0,
  BOARD_X1,
  BOARD_Y0,
  BOARD_Y1,
  COL,
  DMG_COLOR,
  FONT,
  MATTER,
  PANEL_X,
  STAGE_H,
  STAGE_W,
  STATUS_H,
  TOTAL_ROUNDS,
  TOWERS,
  TOWER_ORDER,
  deriveStats,
  type Branch,
  type EffStats,
  type MatterType,
  type TowerKind,
} from "./constants";
import { Board, MAPS, TOWER_FOOTPRINT, type GameMap } from "./board";
import { projSprite, towerSprite, type Assets } from "./assets";
import type { Bursts } from "./particles";
import type { Clickable, Tower, Unit } from "./types";
import { Game } from "./sim";
import { menuItems, type MenuItem } from "./menus";

let time = 0;
let menuIndex = 0;
let muted = false;
export function setRenderTime(t: number): void {
  time = t;
}
export function setMenuIndex(i: number): void {
  menuIndex = i;
}
export function setMuted(m: boolean): void {
  muted = m;
}

const DAMAGE_TOWERS: TowerKind[] = ["emitter", "ionizer", "cleaver", "reactor", "beam"];
function isDamageTower(kind: TowerKind): boolean {
  return DAMAGE_TOWERS.includes(kind);
}
const ROMAN = ["I", "II", "III"];

// ---- small helpers ------------------------------------------------------------
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
  weight = "400",
  letter = 0,
): void {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  if (letter > 0) {
    const chars = [...s];
    const total = chars.length * (size * 0.6 + letter);
    let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
    ctx.textAlign = "left";
    for (const c of chars) {
      ctx.fillText(c, cx, y);
      cx += size * 0.6 + letter;
    }
  } else {
    ctx.fillText(s, x, y);
  }
}

function blit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, w: number, h: number, ang = 0): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(cx, cy);
  if (ang) ctx.rotate(ang);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// ---- entry --------------------------------------------------------------------
export function render(ctx: CanvasRenderingContext2D, game: Game, A: Assets, bursts: Bursts): Clickable[] {
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const clicks: Clickable[] = [];

  if (game.state === "title") {
    drawTitle(ctx, game, A, clicks);
    return clicks;
  }
  if (game.state === "mapselect") {
    drawMapSelect(ctx, game, clicks);
    return clicks;
  }
  if (game.state === "howto") {
    drawHowto(ctx, clicks);
    return clicks;
  }

  drawBoard(ctx, game, A);
  drawZones(ctx, game);
  drawUnits(ctx, game, A);
  drawProjectiles(ctx, game, A);
  bursts.draw(ctx);
  drawStatusBar(ctx, game, A, clicks);
  drawPanel(ctx, game, A, clicks);
  drawBuildCursor(ctx, game, A);

  if (game.state === "paused") drawPause(ctx, game, clicks);
  if (game.state === "victory") drawEnd(ctx, game, clicks, true);
  if (game.state === "defeat") drawEnd(ctx, game, clicks, false);

  return clicks;
}

// ---- board --------------------------------------------------------------------
// Lay the produced track sprites along every path of the current map (curved or
// straight/right-angle), draw the flow direction and the inlet/collector of each path,
// then the auras, the selected tower's range, and the towers. Placement is free, so there
// is no grid to draw — the legal/illegal cue rides the held-tower cursor (drawBuildCursor).
function drawPaths(ctx: CanvasRenderingContext2D, board: Board, A: Assets, step: number, size: number): void {
  const conduit = A.sprite("board/conduit");
  ctx.save();
  ctx.shadowColor = COL.flow;
  ctx.shadowBlur = 10;
  for (let i = 0; i < board.pathCount; i++) for (const p of board.pathSamples(i, step)) blit(ctx, conduit, p.x, p.y, size, size, p.ang);
  ctx.restore();
}

function drawBoard(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  const board = game.board;
  ctx.fillStyle = COL.substrate;
  ctx.fillRect(BOARD_X0, BOARD_Y0, BOARD_X1 - BOARD_X0, BOARD_Y1 - BOARD_Y0);

  drawPaths(ctx, board, A, 9, 22);

  const flow = A.sprite("board/flow");
  const march = (time * 60) % 46;
  for (let i = 0; i < board.pathCount; i++) {
    const total = board.pathLength(i);
    for (let s = march; s < total; s += 46) {
      const p = board.sample(i, s);
      ctx.globalAlpha = 0.55;
      blit(ctx, flow, p.x, p.y, 15, 15, p.ang);
    }
  }
  ctx.globalAlpha = 1;

  // Inlet at the start of each path, collector at its end (positions may be shared).
  for (const path of board.paths) {
    blit(ctx, A.sprite("board/inlet"), path.inlet.x + 6, path.inlet.y, 40, 40, 0);
    blit(ctx, A.sprite("board/collector"), path.collector.x - 4, path.collector.y, 40, 40, 0);
  }

  for (const t of game.towers) drawAura(ctx, game, t);
  const sel = game.selectedTower;
  if (sel) drawRange(ctx, sel.x, sel.y, sel.range, sel.kind);
  for (const t of game.towers) drawTower(ctx, t, A, game);
}

// Reactor Fallout zones — an irradiated field that damages and reveals (specs/towers.md).
function drawZones(ctx: CanvasRenderingContext2D, game: Game): void {
  for (const z of game.zones) {
    ctx.save();
    const a = 0.12 + 0.05 * Math.sin(time * 8 + z.x);
    const g = ctx.createRadialGradient(z.x, z.y, z.radius * 0.2, z.x, z.y, z.radius);
    g.addColorStop(0, hexA(COL.fission, a + 0.06));
    g.addColorStop(1, hexA(COL.fission, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexA(COL.fission, 0.3);
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawAura(ctx: CanvasRenderingContext2D, game: Game, t: Tower): void {
  if (t.kind !== "catalyst" && t.kind !== "moderator") return;
  const c = t.kind === "catalyst" ? COL.catalyst : COL.moderator;
  const range = game.statsOf(t).range;
  ctx.save();
  const g = ctx.createRadialGradient(t.x, t.y, range * 0.2, t.x, t.y, range);
  g.addColorStop(0, hexA(c, 0.16));
  g.addColorStop(1, hexA(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(t.x, t.y, range, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexA(c, 0.22);
  ctx.setLineDash([4, 6]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(t.x, t.y, range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawRange(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, kind: TowerKind): void {
  const c = TOWERS[kind].color;
  ctx.save();
  ctx.strokeStyle = hexA(c, 0.8);
  ctx.fillStyle = hexA(c, 0.08);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function towerHead(ctx: CanvasRenderingContext2D, A: Assets, kind: TowerKind, level: number, cx: number, cy: number, size: number, aimAngle: number): void {
  blit(ctx, A.sprite("towers/base"), cx, cy, size, size, 0);
  const ang = isDamageTower(kind) ? aimAngle : 0;
  blit(ctx, A.sprite(towerSprite(kind, level)), cx, cy, size, size, ang);
}

function drawTower(ctx: CanvasRenderingContext2D, t: Tower, A: Assets, game: Game): void {
  const size = 34;
  const cy = t.y - 4;
  towerHead(ctx, A, t.kind, t.level, t.x, cy, size, t.aimAngle);
  if (isDamageTower(t.kind)) {
    const frames = A.towerFire[t.kind];
    if (frames.length && t.fireAnim < 0.24) {
      const idx = Math.min(frames.length - 1, Math.floor((t.fireAnim / 0.24) * frames.length));
      ctx.save();
      ctx.globalAlpha = 0.9;
      blit(ctx, frames[idx]!, t.x, cy, size, size, t.aimAngle);
      ctx.restore();
    }
  }
  if (game.selectedTowerId === t.id) {
    ctx.strokeStyle = COL.text;
    ctx.lineWidth = 2;
    roundRect(ctx, t.x - size / 2, cy - size / 2, size, size, 5);
    ctx.stroke();
  }
  // level pips; the tier-III pip carries the branch letter.
  for (let i = 0; i < t.level; i++) {
    ctx.fillStyle = TOWERS[t.kind].color;
    ctx.beginPath();
    ctx.arc(t.x - 8 + i * 8, t.y + 14, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (t.level === 3 && t.branch) text(ctx, t.branch, t.x + 12, t.y + 14, 8, TOWERS[t.kind].color, "left", "800");
}

// ---- projectiles in flight ----------------------------------------------------
function drawProjectiles(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  for (const pr of game.projectiles) {
    ctx.save();
    ctx.shadowColor = DMG_COLOR[pr.damageType];
    ctx.shadowBlur = 8;
    blit(ctx, A.sprite(projSprite(pr.damageType)), pr.x, pr.y, 16, 16, pr.angle);
    ctx.restore();
  }
}

// ---- matter -------------------------------------------------------------------
function hasT(u: Unit, t: "bonded" | "heavy" | "inert"): boolean {
  return u.traits.includes(t);
}

function drawUnits(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  for (const u of game.units) {
    const p = game.board.sample(u.lane, u.s);
    const cloaked = hasT(u, "inert") && !u.revealed;
    ctx.save();
    if (cloaked) ctx.globalAlpha = 0.5; // an unrevealed inert unit reads as shrouded

    if (u.type === "macromass") drawBoss(ctx, A, p.x, p.y, u);
    else if (hasT(u, "bonded")) drawMolecule(ctx, A, p, u);
    else if (hasT(u, "heavy")) drawHeavy(ctx, A, p.x, p.y, u);
    else drawAtom(ctx, A, p.x, p.y, u);

    ctx.restore();

    // Trait / status overlays (drawn at full alpha over the body).
    if (hasT(u, "inert")) drawCloak(ctx, p.x, p.y, u.radius, u.revealed);
    if (u.slowFactor < 0.999) ring(ctx, p.x, p.y, u.radius + 6, COL.moderator, 0.5);
    if (u.markTimer > 0) ring(ctx, p.x, p.y, u.radius + 8, COL.beam, 0.8);
    if (u.excite > 0) ring(ctx, p.x, p.y, u.radius + 3, COL.catalyst, 0.4);
  }
}

// A regular atom: a nucleus orb with TWO electron shells — up to 2 electrons on the inner
// shell and up to 4 on the outer (specs/matter.md, specs/overview.md). The electron count
// is the atom's remaining hit points, so as it is stripped it visibly sheds electrons (the
// outer shell empties first, then the inner), and the ring for an empty shell disappears.
function drawAtom(ctx: CanvasRenderingContext2D, A: Assets, x: number, y: number, u: Unit): void {
  const orb = A.sprite(u.element === 0 ? "matter/nucleus_i" : "matter/nucleus_ii");
  const col = u.element === 0 ? COL.elemI : COL.elemII;
  const e = Math.max(1, Math.min(ATOM_MAX_ELECTRONS, Math.round(u.shells)));
  const inner = Math.min(e, ATOM_INNER_MAX);
  const outer = Math.min(Math.max(e - ATOM_INNER_MAX, 0), ATOM_OUTER_MAX);
  const rIn = 8;
  const rOut = 13;

  ctx.save();
  ctx.strokeStyle = hexA(COL.shell, 0.45);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, rIn, 0, Math.PI * 2);
  ctx.stroke();
  if (outer > 0) {
    ctx.beginPath();
    ctx.arc(x, y, rOut, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  blitGlow(ctx, orb, x, y, 20, col);

  if (A.electron.length) {
    // Composite the produced single-electron sprite once per electron, spaced evenly around
    // its shell and orbiting on a timer (the two shells counter-rotate so the motion reads).
    const dot = A.electron[Math.floor((u.animT * 6 + u.id) % A.electron.length)]!;
    const DOT = 7;
    ctx.save();
    ctx.globalAlpha = 0.95;
    const ring = (count: number, radius: number, dir: number, phase: number): void => {
      for (let j = 0; j < count; j++) {
        const a = phase + dir * u.animT * 1.7 + (j / count) * Math.PI * 2;
        blit(ctx, dot, x + Math.cos(a) * radius, y + Math.sin(a) * radius, DOT, DOT, 0);
      }
    };
    ring(inner, rIn, 1, u.id * 0.7);
    ring(outer, rOut, -1, u.id * 1.3);
    ctx.restore();
  }
  if (u.hitFlash < 0.1) flash(ctx, x, y, 16, COL.ionizer);
}

function drawMolecule(ctx: CanvasRenderingContext2D, A: Assets, p: { x: number; y: number; ang: number }, u: Unit): void {
  const remaining = u.atoms.length - u.fragmentsShed; // atoms still bonded in the cluster
  const n = Math.max(1, remaining);
  const spacing = 14;
  const dx = Math.cos(p.ang);
  const dy = Math.sin(p.ang);
  const start = -((n - 1) * spacing) / 2;
  const bond = A.sprite("matter/bond");
  for (let i = 0; i < n - 1; i++) {
    const bx = p.x + dx * (start + i * spacing + spacing / 2);
    const by = p.y + dy * (start + i * spacing + spacing / 2);
    blit(ctx, bond, bx, by, spacing, 8, p.ang);
  }
  for (let i = 0; i < n; i++) {
    const ax = p.x + dx * (start + i * spacing);
    const ay = p.y + dy * (start + i * spacing);
    const a = u.atoms[Math.min(u.fragmentsShed + i, u.atoms.length - 1)]!;
    const orb = A.sprite(a.element === 0 ? "matter/nucleus_i" : "matter/nucleus_ii");
    blitGlow(ctx, orb, ax, ay, 18, a.element === 0 ? COL.elemI : COL.elemII);
  }
  // bond-integrity read: an outer arc that drains as any tower chips the bonds.
  const frac = u.maxBondHP > 0 ? Math.max(0, u.bondHP) / u.maxBondHP : 0;
  ctx.save();
  ctx.strokeStyle = COL.bond;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 16 + n, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  if (u.hitFlash < 0.1) flash(ctx, p.x, p.y, 20, COL.shear);
}

function drawHeavy(ctx: CanvasRenderingContext2D, A: Assets, x: number, y: number, u: Unit): void {
  blitGlow(ctx, A.sprite("matter/heavy"), x, y, 26, COL.heavy);
  // hit-point read: an arc of REMAINING shells (kinetic/nuclear only chip it).
  const frac = u.maxShells > 0 ? Math.max(0, u.shells) / u.maxShells : 0;
  ctx.save();
  ctx.strokeStyle = COL.heavy;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = COL.fission;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, 15, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  if (u.hitFlash < 0.1) flash(ctx, x, y, 20, COL.fission);
}

function drawBoss(ctx: CanvasRenderingContext2D, A: Assets, x: number, y: number, u: Unit): void {
  const frames = A.boss;
  if (frames.length) {
    const f = Math.floor((u.animT * 11) % frames.length);
    blitGlow(ctx, frames[f]!, x, y, 52, COL.boss);
  } else {
    blitGlow(ctx, A.sprite("matter/boss"), x, y, 52, COL.boss);
  }
  const frac = u.maxShells > 0 ? Math.max(0, u.shells) / u.maxShells : 0;
  ctx.save();
  ctx.strokeStyle = COL.boss;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = COL.fission;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, 30, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  if (u.hitFlash < 0.12) flash(ctx, x, y, 34, COL.fission);
}

// A sealed inert "cloak" — a dashed shell that reads as camouflage when unseen, and
// snaps to a solid reveal ring while a detector covers it (specs/matter.md).
function drawCloak(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, revealed: boolean): void {
  ctx.save();
  ctx.strokeStyle = revealed ? hexA(COL.catalyst, 0.9) : hexA(COL.inert, 0.8);
  ctx.lineWidth = revealed ? 2 : 1.5;
  ctx.setLineDash(revealed ? [] : [3, 3]);
  ctx.beginPath();
  ctx.arc(x, y, r + 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string, a: number): void {
  ctx.save();
  ctx.strokeStyle = hexA(c, a);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function blitGlow(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, size: number, glow: string): void {
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 8;
  blit(ctx, img, x, y, size, size, 0);
  ctx.restore();
}

function flash(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, hexA(c, 0.5));
  g.addColorStop(1, hexA(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---- status bar ---------------------------------------------------------------
function drawStatusBar(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  ctx.fillStyle = COL.panel;
  ctx.fillRect(0, 0, STAGE_W, STATUS_H);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.moveTo(0, STATUS_H - 0.5);
  ctx.lineTo(STAGE_W, STATUS_H - 0.5);
  ctx.stroke();

  blit(ctx, A.sprite("icons/energy"), 26, 28, 18, 18, 0);
  text(ctx, "ENERGY", 42, 21, 10, COL.text3, "left", "600", 1);
  text(ctx, `${Math.floor(game.energy)}`, 42, 36, 18, COL.energy, "left", "700");

  const low = game.integrity <= game.maxIntegrity * 0.25;
  blit(ctx, A.sprite("icons/integrity"), 176, 28, 18, 18, 0);
  text(ctx, "INTEGRITY", 192, 21, 10, COL.text3, "left", "600", 1);
  text(ctx, `${Math.max(0, Math.floor(game.integrity))}`, 192, 36, 18, low ? COL.alert : COL.integrity, "left", "700");

  text(ctx, "ROUND", 330, 21, 10, COL.text3, "left", "600", 1);
  text(ctx, `${game.round === 0 ? 1 : game.round}`, 330, 36, 18, COL.text, "left", "700");
  text(ctx, `/ ${TOTAL_ROUNDS}`, 360, 37, 13, COL.text2, "left", "500");
  let sub = "";
  let subColor: string = COL.text2;
  if (game.paused) {
    // Interactive (in-place) pause: the board is frozen but still fully interactive.
    sub = "PAUSED";
    subColor = COL.alert;
  } else if (game.state === "playing" && game.phase === "build") sub = game.buildTimed ? `BUILD · ${Math.ceil(game.buildTimer)}s` : "BUILD · READY";
  else if (game.phase === "round") sub = `${Math.round(game.roundProgress() * 100)}%`;
  if (sub) text(ctx, sub, 420, 37, 12, subColor, "left", "600", 1);

  ctrl(ctx, clicks, 1112, `${game.speed}x`, "speed", COL.text, 52);
  ctrl(ctx, clicks, 1172, game.paused ? "▶" : "❚❚", "pause", game.paused ? COL.alert : COL.text, 40);
  ctrl(ctx, clicks, 1220, muted ? "♪̸" : "♪", "mute", muted ? COL.text3 : COL.text, 40);
}

function ctrl(ctx: CanvasRenderingContext2D, clicks: Clickable[], x: number, label: string, action: string, color: string, w: number): void {
  const y = 12,
    h = 32;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 14, color, "center", "600");
  clicks.push({ x, y, w, h, action });
}

// ---- build panel --------------------------------------------------------------
const SHOP_Y0 = 90;
const SHOP_PITCH = 40;

function drawPanel(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  ctx.fillStyle = COL.panel;
  ctx.fillRect(PANEL_X, STATUS_H, STAGE_W - PANEL_X, STAGE_H - STATUS_H);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.moveTo(PANEL_X + 0.5, STATUS_H);
  ctx.lineTo(PANEL_X + 0.5, STAGE_H);
  ctx.stroke();

  const px = PANEL_X + 12;
  const pw = STAGE_W - PANEL_X - 24;
  text(ctx, "REACTOR ARRAY", px, 78, 11, COL.text3, "left", "700", 1);

  let hover: TowerKind | null = null;
  TOWER_ORDER.forEach((kind, i) => {
    const def = TOWERS[kind];
    const y = SHOP_Y0 + i * SHOP_PITCH;
    const h = SHOP_PITCH - 4;
    const afford = game.energy >= def.cost;
    const active = game.buildKind === kind;
    roundRect(ctx, px, y, pw, h, 6);
    ctx.fillStyle = active ? hexA(def.color, 0.18) : "rgba(255,255,255,0.03)";
    ctx.fill();
    ctx.strokeStyle = active ? def.color : "rgba(255,255,255,0.08)";
    ctx.lineWidth = active ? 2 : 1;
    ctx.stroke();
    roundRect(ctx, px + 7, y + 6, 22, 22, 5);
    ctx.fillStyle = hexA(def.color, afford ? 0.9 : 0.3);
    ctx.fill();
    text(ctx, `${i + 1}`, px + 18, y + 17, 12, COL.void, "center", "800");
    text(ctx, def.name, px + 38, y + 13, 12, afford ? COL.text : COL.text3, "left", "600", 0.5);
    text(ctx, damageTag(kind), px + 38, y + 27, 9, hexA(tagColor(kind), 0.9), "left", "500", 0.5);
    text(ctx, `${def.cost}`, px + pw - 10, y + 17, 13, afford ? COL.energy : COL.text3, "right", "700");
    clicks.push({ x: px, y, w: pw, h, action: `shop:${kind}`, disabled: !afford });
    if (game.pointerX >= px && game.pointerX <= px + pw && game.pointerY >= y && game.pointerY <= y + h) hover = kind;
  });
  game.hoverShop = hover;

  const iy = SHOP_Y0 + TOWER_ORDER.length * SHOP_PITCH + 8;
  const ih = STAGE_H - 58 - iy - 8;
  roundRect(ctx, px, iy, pw, ih, 8);
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const sel = game.selectedTower;
  if (hover) drawTowerInfo(ctx, hover, deriveStats(hover, 1, null), 1, null, px + 14, iy + 10, pw - 28);
  else if (sel) drawSelectedTower(ctx, game, sel, px + 14, iy + 10, pw - 28, clicks);
  else drawPreview(ctx, game, A, px + 14, iy + 10, pw - 28);

  drawRoundButton(ctx, game, px, pw, clicks);
}

function damageTag(kind: TowerKind): string {
  const def = TOWERS[kind];
  if (def.support) return kind === "catalyst" ? "SUPPORT · REVEAL" : "SUPPORT · SLOW";
  const dt = def.damageType!.toUpperCase();
  return def.detection ? `${dt} · SEES INERT` : dt;
}
function tagColor(kind: TowerKind): string {
  const def = TOWERS[kind];
  if (def.support) return def.color;
  return DMG_COLOR[def.damageType!];
}

function drawTowerInfo(ctx: CanvasRenderingContext2D, kind: TowerKind, s: EffStats, level: number, branch: Branch | null, x: number, y: number, w: number): void {
  const def = TOWERS[kind];
  const tier = branch ? `${ROMAN[level - 1]}·${branch === "A" ? def.branchA.name : def.branchB.name}` : ROMAN[level - 1];
  text(ctx, `${def.name} · ${tier}`, x, y + 8, 14, def.color, "left", "700", 0.5);
  // The role/targets line can be long — wrap it to the panel width instead of letting it
  // run off the edge, and start the stat rows below however many lines it took.
  const targets = capitalize(def.targets);
  const targetLines = lineCount(ctx, targets, w, 10);
  wrap(ctx, targets, x, y + 28, w, 10, COL.text2, 13);
  let row = y + 28 + (targetLines - 1) * 13 + 22;
  const line = (k: string, v: string, c: string = COL.text) => {
    text(ctx, k, x, row, 11, COL.text3, "left", "500", 0.5);
    text(ctx, v, x + w, row, 12, c, "right", "600");
    row += 18;
  };
  line("RANGE", `${Math.round(s.range)}`);
  if (def.support) {
    if (kind === "moderator") {
      line("SLOW", `${Math.round((1 - s.auraSlow) * 100)}%`);
      if (s.auraExcite > 0) line("BRITTLE", `+${s.auraExcite} dmg`, COL.catalyst);
    } else {
      line("REVEAL", "inert matter", COL.catalyst);
      line("EXCITE", `+${s.auraExcite} dmg`);
    }
  } else {
    line("DAMAGE TYPE", def.damageType!.toUpperCase(), DMG_COLOR[def.damageType!]);
    line("FIRE RATE", `${s.fireRate.toFixed(1)} /s`);
    line("DAMAGE", `${s.dmg} shell${s.dmg > 1 ? "s" : ""}`);
    if (s.detection) line("DETECT", "sees inert", COL.catalyst);
    if (s.splash > 0) line("SPLASH", `${Math.round(s.splash)}`);
    if (s.lanePierce) line("PIERCE", "whole lane");
    else if (s.pierce > 0) line("PIERCE", `${s.pierce}`);
    if (s.chain > 0) line("CHAIN", `${s.chain}`);
    if (s.multiTarget > 1) line("TARGETS", `${s.multiTarget}`);
    if (s.heavyBonus > 0) line("VS HEAVY", `+${s.heavyBonus}`, COL.heavy);
    if (s.mark > 0) line("MARK", `+${s.mark} dmg`, COL.beam);
  }
}

function drawSelectedTower(ctx: CanvasRenderingContext2D, game: Game, t: Tower, x: number, y: number, w: number, clicks: Clickable[]): void {
  drawTowerInfo(ctx, t.kind, game.statsOf(t), t.level, t.branch, x, y, w);
  const by = STAGE_H - 58 - 8 - 44 - 40; // sit the controls above the round button
  const def = TOWERS[t.kind];
  const cost = game.upgradeCost(t);
  const half = (w - 10) / 2;
  if (t.level === 1) {
    const en = cost != null && game.energy >= cost;
    button(ctx, clicks, x, by, half, 34, `UPGRADE ${cost}`, "upgrade", en ? COL.integrity : COL.text3, en);
  } else if (t.level === 2) {
    // Tier III — choose a branch (specs/towers.md). Two buttons, the identity choice.
    const en = cost != null && game.energy >= cost;
    text(ctx, `TIER III — CHOOSE  (${cost})`, x, by - 12, 10, COL.text3, "left", "600", 0.5);
    button(ctx, clicks, x, by, half, 34, def.branchA.name, "branchA", en ? def.color : COL.text3, en);
    button(ctx, clicks, x + half + 10, by, half, 34, def.branchB.name, "branchB", en ? def.color : COL.text3, en);
    // The choice is permanent, so make the buttons self-explanatory: hovering either one
    // pops a tooltip describing what that branch actually does.
    const overA = inRect(game.pointerX, game.pointerY, x, by, half, 34);
    const overB = inRect(game.pointerX, game.pointerY, x + half + 10, by, half, 34);
    if (overA) drawTooltip(ctx, `${def.branchA.name} — TIER III`, def.branchA.blurb, def.color, by + 17);
    else if (overB) drawTooltip(ctx, `${def.branchB.name} — TIER III`, def.branchB.blurb, def.color, by + 17);
  } else {
    text(ctx, `MAX · ${t.branch === "A" ? def.branchA.name : def.branchB.name}`, x, by + 8, 12, def.color, "left", "700", 0.5);
  }
  button(ctx, clicks, x, by + 42, w, 30, `SELL ${game.sellRefund(t)}`, "sell", COL.energy, true);
}

function drawPreview(ctx: CanvasRenderingContext2D, game: Game, A: Assets, x: number, y: number, w: number): void {
  text(ctx, "NEXT ROUND", x, y + 8, 12, COL.text3, "left", "700", 1);
  const w2 = game.comingRound;
  const label = w2.hasBoss ? `ROUND ${w2.round} · BOSS` : `ROUND ${w2.round}`;
  text(ctx, label, x, y + 28, 14, w2.hasBoss ? COL.boss : COL.text, "left", "700", 0.5);
  const iconFor: Record<MatterType, string> = {
    atom: "icons/atom",
    dimer: "icons/molecule",
    polymer: "icons/molecule",
    noble: "icons/noble",
    heavy: "icons/heavy",
    chelate: "icons/molecule",
    shroud: "icons/heavy",
    macromass: "icons/boss",
  };
  let row = y + 50;
  for (const type of w2.types) {
    const def = MATTER[type];
    blit(ctx, A.sprite(iconFor[type]), x + 9, row + 7, 17, 17, 0);
    text(ctx, def.label, x + 24, row + 7, 11, COL.text2, "left", "500", 0.5);
    text(ctx, counter(type), x + w, row + 7, 9, COL.text3, "right", "400");
    row += 21;
  }
}

// What the coming type asks of the board, in words (its traits).
function counter(type: MatterType): string {
  const traits = MATTER[type].traits;
  const bits: string[] = [];
  if (traits.includes("inert")) bits.push("DETECT");
  if (traits.includes("heavy")) bits.push("KIN/NUC");
  if (traits.includes("bonded")) bits.push("CHIP BONDS");
  if (!bits.length) bits.push("ANY DMG");
  return bits.join(" · ");
}

function drawRoundButton(ctx: CanvasRenderingContext2D, game: Game, px: number, pw: number, clicks: Clickable[]): void {
  const y = STAGE_H - 58,
    h = 44;
  if (game.phase === "build") {
    const label = game.buildTimed ? `SEND NEXT · +${Math.max(0, Math.floor(game.buildTimer))}` : `START ROUND`;
    roundRect(ctx, px, y, pw, h, 8);
    ctx.fillStyle = hexA(COL.energy, 0.9);
    ctx.fill();
    text(ctx, label, px + pw / 2, y + h / 2 + 1, 15, COL.void, "center", "800", 1);
    clicks.push({ x: px, y, w: pw, h, action: "startRound" });
  } else {
    roundRect(ctx, px, y, pw, h, 8);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.stroke();
    text(ctx, `ROUND ${game.round} · ACTIVE`, px + pw / 2, y + h / 2 + 1, 14, COL.text2, "center", "700", 1);
  }
}

function button(ctx: CanvasRenderingContext2D, clicks: Clickable[], x: number, y: number, w: number, h: number, label: string, action: string, color: string, enabled: boolean): void {
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = enabled ? hexA(color, 0.12) : "rgba(255,255,255,0.03)";
  ctx.fill();
  ctx.strokeStyle = enabled ? color : "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 12, enabled ? color : COL.text3, "center", "700");
  if (enabled) clicks.push({ x, y, w, h, action });
}

// A floating info popover, anchored to the LEFT of the build panel (over the board) so it
// never clips past the panel edge. `anchorY` is the vertical centre it points at; the box
// is clamped to stay on-screen.
function drawTooltip(ctx: CanvasRenderingContext2D, title: string, body: string, accent: string, anchorY: number): void {
  const tw = 236;
  const pad = 12;
  const innerW = tw - pad * 2;
  const bodyLines = lineCount(ctx, body, innerW, 11);
  const th = pad + 16 + bodyLines * 15 + pad;
  const tx = PANEL_X - 12 - tw;
  const ty = Math.max(STATUS_H + 8, Math.min(STAGE_H - th - 8, anchorY - th / 2));
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 24;
  roundRect(ctx, tx, ty, tw, th, 10);
  ctx.fillStyle = COL.panel;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, tx, ty, tw, th, 10);
  ctx.strokeStyle = hexA(accent, 0.6);
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, title, tx + pad, ty + pad + 6, 12, accent, "left", "700", 0.5);
  wrap(ctx, body, tx + pad, ty + pad + 24, innerW, 11, COL.text2, 15);
}

// ---- build cursor (held tower ghost + range + legality) -----------------------
// Free placement (specs/board.md): the held tower follows the pointer exactly, its range
// is previewed, and a green/red footprint ring cues whether the spot is legal.
function drawBuildCursor(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  if (!game.buildKind) return;
  if (game.state !== "playing") return;
  const px = game.pointerX,
    py = game.pointerY;
  if (px < BOARD_X0 || px > BOARD_X1 || py < BOARD_Y0 || py > BOARD_Y1) return;
  const legal = game.canBuildAt(px, py, game.buildKind);
  drawRange(ctx, px, py, deriveStats(game.buildKind, 1, null).range, game.buildKind);
  // Footprint validity ring.
  ctx.save();
  ctx.strokeStyle = legal ? COL.integrity : COL.alert;
  ctx.fillStyle = hexA(legal ? COL.integrity : COL.alert, 0.12);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, TOWER_FOOTPRINT, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = legal ? 0.95 : 0.4;
  towerHead(ctx, A, game.buildKind, 1, px, py - 4, 34, -Math.PI / 2);
  ctx.globalAlpha = 1;
}

// ---- title / how-to / overlays ------------------------------------------------
function drawTitle(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  ctx.save();
  ctx.globalAlpha = 0.25;
  const conduit = A.sprite("board/conduit");
  for (let i = 0; i < game.board.pathCount; i++) for (const p of game.board.pathSamples(i, 16)) blit(ctx, conduit, p.x, p.y, 18, 18, p.ang);
  ctx.restore();

  const grad = ctx.createLinearGradient(360, 0, 920, 0);
  grad.addColorStop(0, COL.ionizer);
  grad.addColorStop(0.35, COL.catalyst);
  grad.addColorStop(0.6, COL.fission);
  grad.addColorStop(1, COL.energy);
  ctx.save();
  ctx.shadowColor = COL.catalyst;
  ctx.shadowBlur = 24;
  ctx.font = `800 92px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = grad;
  drawSpaced(ctx, "VALENCE", STAGE_W / 2, 250, 92, 14);
  ctx.restore();
  text(ctx, game.mode.tagline, STAGE_W / 2, 320, 16, COL.text2, "center", "500", 6);

  const items = menuItems("title", game);
  items.forEach((it, i) => {
    const y = 420 + i * 60;
    const on = highlighted(game, i, STAGE_W / 2 - 200, y - 26, 400, 52);
    text(ctx, it.label, STAGE_W / 2, y, 30, on ? COL.energy : COL.text, "center", "700", 6);
    if (on) {
      text(ctx, "▶", STAGE_W / 2 - 190, y, 20, COL.energy, "center", "700");
      text(ctx, "◀", STAGE_W / 2 + 190, y, 20, COL.energy, "center", "700");
    }
    clicks.push({ x: STAGE_W / 2 - 200, y: y - 26, w: 400, h: 52, action: it.action });
  });
  text(ctx, "↑↓ SELECT    ENTER CONFIRM    MOUSE OK", STAGE_W / 2, 660, 13, COL.text3, "center", "500", 4);
}

// ---- map select ---------------------------------------------------------------
// Cache one Board per map so its dense path polylines can be drawn as a preview thumbnail.
const previewBoards = new Map<string, Board>();
function previewBoard(map: GameMap): Board {
  let b = previewBoards.get(map.id);
  if (!b) {
    b = new Board(map);
    previewBoards.set(map.id, b);
  }
  return b;
}

function difficultyColor(d: GameMap["difficulty"]): string {
  return d === "EASY" ? COL.moderator : d === "MEDIUM" ? COL.energy : COL.alert;
}

// Draw a map's paths, scaled from board space into the preview rect (curved or straight).
function drawMapPreview(ctx: CanvasRenderingContext2D, map: GameMap, x: number, y: number, w: number, h: number): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, 8);
  ctx.fillStyle = COL.substrate;
  ctx.fill();
  ctx.clip();
  const bw = BOARD_X1 - BOARD_X0;
  const bh = BOARD_Y1 - BOARD_Y0;
  const s = Math.min((w - 20) / bw, (h - 20) / bh);
  const ox = x + (w - bw * s) / 2 - BOARD_X0 * s;
  const oy = y + (h - bh * s) / 2 - BOARD_Y0 * s;
  const board = previewBoard(map);
  ctx.strokeStyle = COL.conduit;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const path of board.paths) {
    ctx.beginPath();
    path.poly.forEach((p, i) => {
      const px = ox + p.x * s;
      const py = oy + p.y * s;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = COL.conduit;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = hexA(COL.flow, 0.8);
    ctx.lineWidth = 2;
    ctx.stroke();
    // inlet (green) and collector (alert) dots.
    ctx.fillStyle = COL.elemI;
    ctx.beginPath();
    ctx.arc(ox + path.inlet.x * s, oy + path.inlet.y * s, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COL.alert;
    ctx.beginPath();
    ctx.arc(ox + path.collector.x * s, oy + path.collector.y * s, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMapSelect(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(ctx, "SELECT MAP", STAGE_W / 2, 70, 34, COL.text, "center", "700", 6);
  text(ctx, "SAME CAMPAIGN, DIFFERENT FRONT — THE MAP IS THE DIFFICULTY", STAGE_W / 2, 108, 12, COL.text3, "center", "500", 3);

  const n = MAPS.length;
  const cardW = 360;
  const gap = 30;
  const total = n * cardW + (n - 1) * gap;
  const x0 = (STAGE_W - total) / 2;
  const cardY = 150;
  const cardH = 400;

  MAPS.forEach((map, i) => {
    const x = x0 + i * (cardW + gap);
    const on = highlighted(game, i, x, cardY, cardW, cardH);
    const dc = difficultyColor(map.difficulty);
    roundRect(ctx, x, cardY, cardW, cardH, 12);
    ctx.fillStyle = on ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)";
    ctx.fill();
    ctx.strokeStyle = on ? COL.energy : "rgba(255,255,255,0.10)";
    ctx.lineWidth = on ? 2.5 : 1;
    ctx.stroke();

    drawMapPreview(ctx, map, x + 18, cardY + 18, cardW - 36, 200);

    text(ctx, map.name, x + 20, cardY + 248, 24, on ? COL.energy : COL.text, "left", "800", 2);
    // difficulty pill
    const pillW = 12 + map.difficulty.length * 8;
    roundRect(ctx, x + cardW - 20 - pillW, cardY + 236, pillW, 24, 6);
    ctx.fillStyle = hexA(dc, 0.18);
    ctx.fill();
    ctx.strokeStyle = dc;
    ctx.lineWidth = 1;
    ctx.stroke();
    text(ctx, map.difficulty, x + cardW - 20 - pillW / 2, cardY + 249, 11, dc, "center", "700", 1);

    text(ctx, `${map.topology} · ${map.styleLabel}`, x + 20, cardY + 280, 11, COL.text2, "left", "600", 1);
    wrap(ctx, map.blurb, x + 20, cardY + 306, cardW - 40, 12, COL.text3);

    clicks.push({ x, y: cardY, w: cardW, h: cardH, action: `map:${map.id}` });
  });

  // BACK button (last menu item).
  const backIdx = MAPS.length;
  const bx = STAGE_W / 2 - 90;
  const byy = cardY + cardH + 26;
  const onBack = highlighted(game, backIdx, bx, byy, 180, 42);
  button(ctx, clicks, bx, byy, 180, 42, "BACK", "menu:back", onBack ? COL.energy : COL.text, true);

  text(ctx, "↑↓ / ← → SELECT    ENTER CONFIRM    MOUSE OK", STAGE_W / 2, STAGE_H - 22, 12, COL.text3, "center", "500", 3);
}

function drawSpaced(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number, size: number, letter: number): void {
  const chars = [...s];
  const adv = size * 0.62 + letter;
  const total = chars.length * adv;
  let x = cx - total / 2 + adv / 2;
  ctx.textAlign = "center";
  for (const c of chars) {
    ctx.fillText(c, x, y);
    x += adv;
  }
}

function drawHowto(ctx: CanvasRenderingContext2D, clicks: Clickable[]): void {
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(ctx, "HOW TO PLAY", STAGE_W / 2, 60, 32, COL.text, "center", "700", 4);
  const lines: [string, string][] = [
    ["GOAL", "Break matter down before it reaches the collector. Every leak costs integrity; reach 0 and containment fails."],
    ["HIT POINTS", "Every unit has electron SHELLS — its hit points. A regular ATOM carries 1–6 electrons (its layers) on two shells; each is one hit point, so a bigger atom takes more hits. Any of three damage types strips them: ENERGY, KINETIC, NUCLEAR. At zero it is neutralized and pays energy; a leaking atom costs its remaining electrons."],
    ["BONDED (molecules)", "A cluster carries an outer BOND pool — extra health ANY tower chips through, shedding free atoms as it breaks. KINETIC (Cleaver) chews bonds fastest, but it is not the only opener."],
    ["HEAVY (isotope)", "A radioactive isotope: immune to ENERGY, cracked only by KINETIC or NUCLEAR — the Cleaver, the Reactor, or a Beam's Disruptor. As it is worn down it DECAYS, shedding ALPHA (6-electron) and BETA (2-electron) atoms until it reaches a stable nucleus."],
    ["INERT (camo)", "Untargetable until a DETECTOR sees it: a Catalyst's field, a Reactor's fallout, an Ionizer's Array upgrade, or a Beam (which sees it natively). Traits stack late — a heavy that is also inert needs both answers."],
    ["TOWERS", "Seven general-purpose towers; each picks one of two BRANCHES at tier III. Support: a Catalyst reveals + excites (+damage), a Moderator slows."],
    ["ECONOMY", "Neutralizing pays energy; clearing a round pays a bonus; banked energy earns interest. Spend it to build and upgrade."],
    ["CONTROLS", "Pick a map, then click a shop tower (or 1-7) and place it freely beside the paths — anywhere off the track and clear of other towers. Select a tower to UPGRADE (U) or SELL (S); at tier III pick a branch. SPACE starts a round, then pauses it in place (build while frozen); the status-bar ❚❚ pauses in place too. F cycles speed; ESC opens the pause menu; M mutes."],
  ];
  let y = 108;
  for (const [k, v] of lines) {
    text(ctx, k, 150, y, 14, COL.integrity, "left", "700", 1);
    wrap(ctx, v, 340, y, 800, 14, COL.text2);
    y += lineCount(ctx, v, 800, 14) * 20 + 12;
  }
  const bx = STAGE_W / 2 - 90,
    byy = STAGE_H - 66;
  button(ctx, clicks, bx, byy, 180, 42, "BACK", "menu:back", COL.text, true);
}

function wrap(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, size: number, color: string, lineHeight = 20): void {
  ctx.font = `400 ${size}px ${FONT}`;
  const words = s.split(" ");
  let line = "";
  let yy = y;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lineHeight;
    } else line = test;
  }
  ctx.fillText(line, x, yy);
}

function lineCount(ctx: CanvasRenderingContext2D, s: string, maxW: number, size: number): number {
  ctx.font = `400 ${size}px ${FONT}`;
  const words = s.split(" ");
  let line = "";
  let n = 1;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW) {
      n++;
      line = w;
    } else line = test;
  }
  return n;
}

function drawPause(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  dim(ctx);
  panelBox(ctx, 440, 210, 400, 320);
  text(ctx, "PAUSED", STAGE_W / 2, 262, 30, COL.text, "center", "700", 4);
  menuButtons(ctx, game, menuItems("paused", game), 330, 56, 260, clicks);
}

function menuButtons(ctx: CanvasRenderingContext2D, game: Game, items: MenuItem[], y0: number, gap: number, w: number, clicks: Clickable[]): void {
  const x = STAGE_W / 2 - w / 2;
  items.forEach((it, i) => {
    const y = y0 + i * gap;
    const on = highlighted(game, i, x, y, w, 44);
    button(ctx, clicks, x, y, w, 44, it.label, it.action, on ? COL.energy : COL.text, true);
  });
}

function drawEnd(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[], won: boolean): void {
  dim(ctx);
  panelBox(ctx, 400, 180, 480, 360);
  text(ctx, won ? "CONTAINMENT HELD" : "CONTAINMENT FAILED", STAGE_W / 2, 232, 15, won ? COL.moderator : COL.alert, "center", "700", 3);
  text(ctx, won ? "SECURED" : "BREACH", STAGE_W / 2, 282, 42, won ? COL.integrity : COL.shear, "center", "800", 2);
  if (won) {
    text(ctx, `ALL ${TOTAL_ROUNDS} ROUNDS SURVIVED`, STAGE_W / 2, 340, 20, COL.text, "center", "600", 2);
    text(ctx, `INTEGRITY ${Math.max(0, Math.floor(game.integrity))}`, STAGE_W / 2, 372, 14, COL.text2, "center", "500", 1);
  } else {
    text(ctx, `REACHED ROUND ${game.round} / ${TOTAL_ROUNDS}`, STAGE_W / 2, 344, 22, COL.text, "center", "600", 2);
  }
  text(ctx, `SCORE ${game.score.toLocaleString()}`, STAGE_W / 2, 404, 15, COL.text2, "center", "500", 1);
  const items = menuItems(won ? "victory" : "defeat", game);
  const xs = [STAGE_W / 2 - 170, STAGE_W / 2 + 10];
  items.forEach((it, i) => {
    const on = highlighted(game, i, xs[i]!, 452, 160, 46);
    button(ctx, clicks, xs[i]!, 452, 160, 46, it.label, it.action, on ? COL.energy : COL.text, true);
  });
}

function highlighted(game: Game, i: number, x: number, y: number, w: number, h: number): boolean {
  return menuIndex === i || inRect(game.pointerX, game.pointerY, x, y, w, h);
}

function dim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(6,9,14,0.72)";
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}
function panelBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 30;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = COL.panel;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();
}

// ---- utils --------------------------------------------------------------------
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function inRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}
