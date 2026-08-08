// Spectra — all canvas drawing (cold neon against deep space). Everything is
// drawn in logical 1280x720 space; main.ts sets the transform that fits it to the
// window. Sprites (ship, drones) come from the provided art (assets.ts); bullets,
// glow, starfield, discharge, the inversion overlay, the HUD, menus, and every
// state screen are drawn here in the palette from specs/overview.md.

import {
  CYAN,
  MAGENTA,
  COLOR,
  FIELD_H,
  FIELD_W,
  MONO,
  PLAY_BOTTOM,
  PLAY_TOP,
  PRISM_SIZE,
  RES_MAX,
  SHARD_SIZE,
  FLUX_SIZE,
  SHIP_Y,
  bandColor,
  type Band,
} from "./constants";
import type { Game } from "./game";
import type { Drone } from "./types";

// A faint, mostly static starfield generated once (deterministic).
const STARS = makeStars();
function makeStars(): Array<{ x: number; y: number; r: number }> {
  let s = 0x1234567;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const out: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < 90; i++) {
    out.push({ x: rnd() * FIELD_W, y: PLAY_TOP + rnd() * (PLAY_BOTTOM - PLAY_TOP), r: rnd() < 0.85 ? 1 : 1.6 });
  }
  return out;
}

export function render(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.save();
  // Void background.
  ctx.fillStyle = COLOR.void;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  drawStarfield(ctx);

  const st = game.state;
  const dimField = st === "title" || st === "howto" || st === "gameOver";

  if (st === "title") {
    drawFieldFurniture(ctx, game, 0.32);
    drawTitle(ctx, game);
  } else if (st === "howto") {
    drawFieldFurniture(ctx, game, 0.2);
    drawHowTo(ctx);
  } else {
    // Playing / frozen field states.
    if (!dimField) {
      drawField(ctx, game);
      drawHud(ctx, game);
    }
    if (st === "stageIntro") drawStageIntro(ctx, game);
    if (st === "stageCleared") drawStageCleared(ctx, game);
    if (st === "paused") drawPause(ctx, game);
    if (st === "gameOver") {
      drawFieldFurniture(ctx, game, 0.32);
      drawGameOver(ctx, game);
    }
  }

  if (game.debugOverlay) drawDebugOverlay(ctx, game);

  ctx.restore();
}

// ---- Debug overlay --------------------------------------------------------

// A read-only diagnostic layer over the running game: the same live internal
// state snapshot() reports. Toggled with the backtick key (see
// game.handleInput); off by default; draws only — it never changes gameplay.
// See specs/instrumentation.md.
function drawDebugOverlay(ctx: CanvasRenderingContext2D, game: Game): void {
  const s = game.debugSnapshot();
  const lines: string[] = [];
  lines.push(`screen  ${s.screen}   stage ${s.stage}${s.isChallenge ? " (challenge)" : ""}`);
  lines.push(`score   ${s.score}   lives ${s.lives}`);
  lines.push(
    `reson   ${s.resonance.toFixed(0)}/100${s.dischargeReady ? "  READY" : ""}${
      s.discharge.active ? `  wave r${s.discharge.radius.toFixed(0)}` : ""
    }`,
  );
  lines.push(`invert  ${s.inversionActive ? "ACTIVE" : "off"}   simT ${s.simTime.toFixed(2)}s`);
  lines.push(
    `ship    x ${s.ship.x.toFixed(0)}  band ${s.ship.band}  lock ${s.ship.lockout.toFixed(2)}${
      s.ship.canFire ? "  canFire" : ""
    }`,
  );
  lines.push(`drones  ${s.drones.length}   bullets ${s.bullets.length}`);
  const maxDrones = 12;
  s.drones.slice(0, maxDrones).forEach((d) => {
    let extra = "";
    if (d.kind === "flux") extra = d.shimmer ? " shimmer" : "";
    if (d.kind === "prism") extra = d.shellAlive ? ` shell ${d.shellBand}` : ` core ${d.coreBand}`;
    const bandTxt = d.band === d.effectiveBand ? d.band : `${d.band}->${d.effectiveBand}`;
    lines.push(
      `  #${d.id} ${d.kind} ${bandTxt} ${d.phase} ${d.x.toFixed(0)},${d.y.toFixed(0)}${extra}`,
    );
  });
  if (s.drones.length > maxDrones) lines.push(`  … +${s.drones.length - maxDrones} more`);

  const pad = 12;
  const lineH = 18;
  const headerH = 22;
  const w = 420;
  const x = 20;
  const y = HUD_TOP_OVERLAY_Y;
  const h = pad * 2 + headerH + lines.length * lineH;

  ctx.save();
  ctx.fillStyle = "rgba(5, 6, 15, 0.82)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLOR.panelBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 12px ${MONO}`;
  ctx.fillStyle = COLOR.resonance;
  ctx.fillText("DEBUG", x + pad, y + pad);
  ctx.font = `13px ${MONO}`;
  ctx.fillStyle = COLOR.textDim;
  let ly = y + pad + headerH;
  for (const line of lines) {
    ctx.fillText(line, x + pad, ly);
    ly += lineH;
  }
  ctx.restore();
}

const HUD_TOP_OVERLAY_Y = 76; // just below the top HUD strip

// ---- Field ----------------------------------------------------------------
function drawStarfield(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, PLAY_TOP, FIELD_W, PLAY_BOTTOM - PLAY_TOP);
  ctx.clip();
  ctx.fillStyle = COLOR.star;
  for (const s of STARS) {
    ctx.globalAlpha = s.r > 1.4 ? 0.7 : 0.4;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawField(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, PLAY_TOP, FIELD_W, PLAY_BOTTOM - PLAY_TOP);
  ctx.clip();

  // Spectral-inversion tint (drawn behind the entities so they stay readable).
  if (game.inversionActive) {
    const g = ctx.createLinearGradient(0, PLAY_TOP, FIELD_W, PLAY_BOTTOM);
    g.addColorStop(0, "rgba(255, 78, 199, 0.10)");
    g.addColorStop(1, "rgba(52, 226, 255, 0.10)");
    ctx.fillStyle = g;
    ctx.fillRect(0, PLAY_TOP, FIELD_W, PLAY_BOTTOM - PLAY_TOP);
  }

  for (const d of game.drones) drawDrone(ctx, game, d);
  for (const b of game.bullets) drawBullet(ctx, game, b);
  game.bursts.draw(ctx);

  // Ship + its shots.
  if (game.shipAlive) drawShip(ctx, game);

  // Discharge expanding wave.
  if (game.dischargeActive) drawDischarge(ctx, game);

  ctx.restore();

  // READY hold text.
  if (game.readyTimer > 0) {
    centerText(ctx, "READY", FIELD_W / 2, 360, 48, COLOR.text, 8);
  }

  // Inversion banner (over the field clip).
  if (game.inversionActive) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 3;
    ctx.strokeRect(3, PLAY_TOP + 3, FIELD_W - 6, PLAY_BOTTOM - PLAY_TOP - 6);
    ctx.restore();
    centerText(ctx, "SPECTRAL INVERSION", FIELD_W / 2, PLAY_TOP + 36, 24, COLOR.discharge, 6);
    centerText(ctx, "BANDS SWAPPED — RE-READ THE FIELD", FIELD_W / 2, PLAY_BOTTOM - 22, 15, COLOR.discharge, 5);
  }
}

// ---- Sprites & glyphs -----------------------------------------------------
function drawSprite(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  cx: number,
  cy: number,
  size: number,
  glow: string,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 14;
  ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
}

// The band glyph: a RING for cyan, a DIAMOND for magenta. Drawn in the band's
// own color so it enforces the correct shape read without introducing a
// contradictory color (never a cyan diamond or a magenta ring). specs/overview.md.
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  band: Band,
  cx: number,
  cy: number,
  r: number,
  filled = false,
): void {
  const col = bandColor(band);
  ctx.save();
  ctx.shadowColor = col;
  ctx.shadowBlur = 10;
  ctx.lineWidth = Math.max(2.5, r * 0.42);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  if (band === CYAN) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (filled) ctx.fill();
    else ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    if (filled) ctx.fill();
    else ctx.stroke();
  }
  ctx.restore();
}

function drawDrone(ctx: CanvasRenderingContext2D, game: Game, d: Drone): void {
  const a = game.assetSet();
  if (d.kind === "shard") {
    const b = game.effBand(d.band);
    drawSprite(ctx, a.shard[b], d.x, d.y, SHARD_SIZE, bandColor(b));
    // The band glyph frames the crystal at full footprint, so a cyan Shard reads
    // as a RING and a magenta Shard as a DIAMOND — never a cyan diamond.
    drawGlyph(ctx, b, d.x, d.y, SHARD_SIZE * 0.46);
  } else if (d.kind === "flux") {
    if (d.shimmer) {
      // Settled on neither band: the provided mid-shimmer art, both glyphs faint.
      drawSprite(ctx, a.fluxShimmer, d.x, d.y, FLUX_SIZE, "#ffffff");
      ctx.globalAlpha = 0.85;
      drawGlyph(ctx, CYAN, d.x - 7, d.y, FLUX_SIZE * 0.28);
      drawGlyph(ctx, MAGENTA, d.x + 7, d.y, FLUX_SIZE * 0.28);
      ctx.globalAlpha = 1;
    } else {
      const b = game.effBand(d.band);
      drawSprite(ctx, a.fluxHeld[b], d.x, d.y, FLUX_SIZE, bandColor(b));
      drawGlyph(ctx, b, d.x, d.y, FLUX_SIZE * 0.44);
    }
  } else {
    // Prism.
    if (d.shellAlive) {
      const shell = game.effBand(d.shellBand);
      const core = game.effBand(d.coreBand);
      drawSprite(ctx, a.prismFull[shell], d.x, d.y, PRISM_SIZE, bandColor(shell));
      drawGlyph(ctx, shell, d.x, d.y, PRISM_SIZE * 0.44); // outer shell glyph
      drawGlyph(ctx, core, d.x, d.y, PRISM_SIZE * 0.2, true); // core glyph
    } else {
      const core = game.effBand(d.coreBand);
      drawSprite(ctx, a.prismCore[core], d.x, d.y, PRISM_SIZE * 0.5, bandColor(core));
      drawGlyph(ctx, core, d.x, d.y, PRISM_SIZE * 0.22, true);
    }
  }
}

function drawShip(ctx: CanvasRenderingContext2D, game: Game): void {
  const a = game.assetSet();
  drawSprite(ctx, a.fighter[game.shipBand], game.shipX, SHIP_Y, 44, bandColor(game.shipBand));
  drawGlyph(ctx, game.shipBand, game.shipX, SHIP_Y - 1, 6, true);
}

function drawBullet(
  ctx: CanvasRenderingContext2D,
  game: Game,
  b: { x: number; y: number; friendly: boolean; band: Band },
): void {
  const band = b.friendly ? b.band : game.effBand(b.band);
  const col = bandColor(band);
  ctx.save();
  ctx.shadowColor = col;
  ctx.shadowBlur = 10;
  if (b.friendly) {
    ctx.fillStyle = col;
    roundRect(ctx, b.x - 2, b.y - 8, 4, 16, 2);
    ctx.fill();
    drawGlyph(ctx, band, b.x, b.y - 8, 3, true);
  } else {
    // Enemy bullets read by glyph shape too.
    drawGlyph(ctx, band, b.x, b.y, 5, true);
  }
  ctx.restore();
}

function drawDischarge(ctx: CanvasRenderingContext2D, game: Game): void {
  const r = game.dischargeR;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const grad = ctx.createRadialGradient(game.shipX, SHIP_Y, Math.max(0, r - 60), game.shipX, SHIP_Y, r);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.8, "rgba(255,255,255,0.10)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(game.shipX, SHIP_Y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 4;
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(game.shipX, SHIP_Y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Dim field furniture behind a menu / panel (a slice of swarm and ship).
function drawFieldFurniture(ctx: CanvasRenderingContext2D, game: Game, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  const a = game.assetSet();
  const props: Array<[HTMLCanvasElement, number, number, number, Band]> = [
    [a.shard[CYAN], 190, 150, SHARD_SIZE, CYAN],
    [a.shard[MAGENTA], 250, 150, SHARD_SIZE, MAGENTA],
    [a.fluxHeld[MAGENTA], 160, 205, FLUX_SIZE, MAGENTA],
    [a.shard[CYAN], 240, 205, SHARD_SIZE, CYAN],
    [a.prismFull[CYAN], 1075, 165, PRISM_SIZE, CYAN],
    [a.shard[MAGENTA], 1045, 235, SHARD_SIZE, MAGENTA],
    [a.shard[CYAN], 1120, 235, SHARD_SIZE, CYAN],
  ];
  for (const [img, x, y, size, band] of props) {
    drawSprite(ctx, img, x, y, size, bandColor(band));
    drawGlyph(ctx, band, x, y, size * 0.22);
  }
  // A dim ship.
  drawSprite(ctx, a.fighter[CYAN], 280, 540, 44, COLOR.cyan);
  ctx.restore();
}

// ---- HUD ------------------------------------------------------------------
function drawHud(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  // Top strip: score (left) and stage (right).
  ctx.fillStyle = COLOR.text;
  ctx.font = `700 40px ${MONO}`;
  ctx.textAlign = "left";
  ctx.save();
  ctx.shadowColor = "rgba(232,238,247,0.3)";
  ctx.shadowBlur = 8;
  ctx.fillText(pad(game.score, 7), 40, 46);
  ctx.restore();

  ctx.fillStyle = COLOR.textDim;
  ctx.font = `20px ${MONO}`;
  ctx.textAlign = "right";
  const stageLabel = game.isChallenge ? `STAGE ${game.stage}` : `STAGE ${game.stage}`;
  ctx.save();
  spaced(ctx, stageLabel, FIELD_W - 40, 42, 6, "right");
  ctx.restore();

  // Bottom strip: lives (left), the mute tell, resonance (center), polarity
  // (right).
  drawLives(ctx, game);
  drawMuted(ctx, game);
  drawResonance(ctx, game);
  drawPolarity(ctx, game);
  ctx.restore();
}

function drawLives(ctx: CanvasRenderingContext2D, game: Game): void {
  const a = game.assetSet();
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const n = Math.min(6, Math.max(0, game.lives));
  for (let i = 0; i < n; i++) {
    const x = 48 + i * 30;
    drawSprite(ctx, a.fighter[game.shipBand], x, 688, 26, bandColor(game.shipBand));
  }
  ctx.restore();
}

// The mute tell (specs/ui.md): while sound is muted the bottom strip carries a
// plain, persistent MUTED label in the HUD's muted grey, so a muted game is
// visible rather than only audible. It sits between the lives and the centred
// resonance meter, and it is the ONLY thing muting changes on screen.
function drawMuted(ctx: CanvasRenderingContext2D, game: Game): void {
  if (!game.audio.muted) return;
  ctx.save();
  ctx.font = `13px ${MONO}`;
  ctx.fillStyle = COLOR.textDim;
  spaced(ctx, "MUTED", 470, 693, 4, "right");
  // A struck-through speaker glyph reads at a glance where the word may not.
  const gx = 388;
  const gy = 688;
  ctx.strokeStyle = COLOR.textDim;
  ctx.fillStyle = COLOR.textDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(gx - 8, gy - 3);
  ctx.lineTo(gx - 3, gy - 3);
  ctx.lineTo(gx + 3, gy - 8);
  ctx.lineTo(gx + 3, gy + 8);
  ctx.lineTo(gx - 3, gy + 3);
  ctx.lineTo(gx - 8, gy + 3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(gx + 7, gy - 6);
  ctx.lineTo(gx + 15, gy + 6);
  ctx.moveTo(gx + 15, gy - 6);
  ctx.lineTo(gx + 7, gy + 6);
  ctx.stroke();
  ctx.restore();
}

function drawResonance(ctx: CanvasRenderingContext2D, game: Game): void {
  const ready = game.resonance >= RES_MAX;
  const cx = FIELD_W / 2;
  const barW = 180;
  const barH = 8;
  const barX = cx - barW / 2;
  const barY = 692;
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `13px ${MONO}`;
  ctx.fillStyle = ready ? COLOR.resonance : COLOR.textFaint;
  spaced(ctx, "RESONANCE", cx, 682, 4, "center");
  // Track.
  ctx.fillStyle = "rgba(136,147,173,0.18)";
  roundRect(ctx, barX, barY, barW, barH, 4);
  ctx.fill();
  // Fill.
  const w = (game.resonance / RES_MAX) * barW;
  ctx.fillStyle = COLOR.resonance;
  ctx.shadowColor = "rgba(255,216,107,0.85)";
  ctx.shadowBlur = ready ? 16 : 8;
  if (w > 0) {
    roundRect(ctx, barX, barY, w, barH, 4);
    ctx.fill();
  }
  ctx.restore();
}

function drawPolarity(ctx: CanvasRenderingContext2D, game: Game): void {
  const band = game.shipBand;
  const col = bandColor(band);
  const cy = 688;
  ctx.save();
  ctx.font = `700 22px ${MONO}`;
  // Right-anchor the swatch+label group so the widest label (MAGENTA) stays on
  // screen: the label's right edge sits at a fixed margin and the swatch a fixed
  // gap to its left. A fixed swatch x instead sized the group for CYAN and pushed
  // the longer MAGENTA label off the right edge.
  const labelW = measureSpaced(ctx, game.bandLabel, 6);
  const swX = FIELD_W - 40 - labelW - 26;
  // Swatch (cyan disc / magenta diamond) carrying the glyph.
  drawGlyph(ctx, band, swX, cy, 15, true);
  // A darker glyph inset so the shape reads on the bright swatch.
  ctx.fillStyle = COLOR.void;
  if (band === CYAN) {
    ctx.beginPath();
    ctx.arc(swX, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOR.void;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(swX, cy, 8.5, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.save();
    ctx.translate(swX, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = COLOR.void;
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  }
  // Label.
  ctx.fillStyle = col;
  ctx.textAlign = "left";
  ctx.shadowColor = col;
  ctx.shadowBlur = 8;
  spaced(ctx, game.bandLabel, swX + 26, cy + 8, 6, "left");
  ctx.restore();
}

// ---- State screens --------------------------------------------------------
function drawTitle(ctx: CanvasRenderingContext2D, game: Game): void {
  gradientText(ctx, "SPECTRA", FIELD_W / 2, 250, 120, 18);
  centerText(ctx, "TUNE TO SURVIVE", FIELD_W / 2, 315, 22, COLOR.textDim, 12);
  drawMenu(ctx, game.titleMenu(), game.menuIndex, 430, 52, 30);
  centerText(ctx, "▲ ▼ MOVE    ENTER SELECT", FIELD_W / 2, 686, 16, COLOR.textFaint, 6);
}

function drawHowTo(ctx: CanvasRenderingContext2D): void {
  panel(ctx, 900, 560);
  const cx = FIELD_W / 2;
  let y = 130;
  centerText(ctx, "HOW TO PLAY", cx, y, 40, COLOR.text, 6);
  y += 54;
  const lines: Array<[string, string]> = [
    ["MOVE", "← →  or  A / D"],
    ["FIRE", "SPACE  (or ↑ / W)"],
    ["FLIP BAND", "SHIFT  or  F"],
    ["DISCHARGE", "X  (when RESONANCE is full)"],
    ["PAUSE", "ESC  or  P     MUTE  M"],
  ];
  ctx.font = `18px ${MONO}`;
  for (const [k, v] of lines) {
    ctx.textAlign = "right";
    ctx.fillStyle = COLOR.cyan;
    ctx.fillText(k, cx - 30, y);
    ctx.textAlign = "left";
    ctx.fillStyle = COLOR.text;
    ctx.fillText(v, cx + 10, y);
    y += 30;
  }
  y += 8;
  const para = [
    "Your cannon is tuned to one of two bands, CYAN or MAGENTA.",
    "A shot destroys a drone only of the MATCHING band; a mismatch is wasted.",
    "Your band is also your SHIELD: same-band fire is absorbed (and builds",
    "resonance); opposite-band fire costs a life. A drone body is always lethal.",
    "SHARD: fixed band.  FLUX: oscillates — never kill it mid-shimmer.",
    "PRISM: break the shell, then the core (opposite band) — or it inverts the field.",
    "Fill RESONANCE to discharge: wipe every diving drone and all enemy fire.",
  ];
  ctx.font = `15px ${MONO}`;
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.textDim;
  for (const line of para) {
    ctx.fillText(line, cx, y);
    y += 24;
  }
  centerText(ctx, "ENTER / ESC — BACK", cx, y + 16, 15, COLOR.textFaint, 4);
}

function drawStageIntro(ctx: CanvasRenderingContext2D, game: Game): void {
  const label = game.isChallenge ? "CHALLENGING STAGE" : `STAGE ${game.stage}`;
  centerText(ctx, label, FIELD_W / 2, 360, game.isChallenge ? 56 : 72, COLOR.text, 8);
  if (game.isChallenge) {
    centerText(ctx, "NO FIRE · NO LIVES LOST · PERFECT = 10000", FIELD_W / 2, 420, 18, COLOR.textDim, 4);
  }
}

function drawStageCleared(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.save();
  ctx.fillStyle = "rgba(3,4,10,0.55)";
  ctx.fillRect(0, PLAY_TOP, FIELD_W, PLAY_BOTTOM - PLAY_TOP);
  ctx.restore();
  if (game.isChallenge) {
    centerText(ctx, "CHALLENGE COMPLETE", FIELD_W / 2, 330, 48, COLOR.text, 8);
    centerText(ctx, game.challengeResult, FIELD_W / 2, 390, 30, game.challengeResult === "PERFECT!" ? COLOR.resonance : COLOR.textDim, 8);
  } else {
    centerText(ctx, `STAGE ${game.stage} CLEARED`, FIELD_W / 2, 330, 48, COLOR.text, 8);
    centerText(ctx, "STAGE BONUS  1000", FIELD_W / 2, 390, 24, COLOR.resonance, 6);
  }
}

function drawPause(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.save();
  ctx.fillStyle = "rgba(3,4,10,0.7)";
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  ctx.restore();
  panel(ctx, 520, 420);
  centerText(ctx, "PAUSED", FIELD_W / 2, 240, 44, COLOR.text, 8);
  drawMenu(ctx, game.pauseMenu(), game.menuIndex, 320, 46, 24);
}

function drawGameOver(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.save();
  ctx.fillStyle = "rgba(3,4,10,0.78)";
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  ctx.restore();
  panel(ctx, 560, 420);
  const cx = FIELD_W / 2;
  centerText(ctx, "SIGNAL LOST", cx, 232, 18, COLOR.textDim, 10);
  gradientText(ctx, "GAME OVER", cx, 300, 52, 8);
  centerText(ctx, `SCORE ${pad(game.score, 7)}`, cx, 348, 34, COLOR.text, 8);
  centerText(ctx, `REACHED STAGE ${game.stageReached}`, cx, 386, 20, COLOR.textDim, 6);
  drawMenu(ctx, game.gameOverMenu(), game.menuIndex, 452, 34, 22);
}

// ---- Menu / text helpers --------------------------------------------------
function drawMenu(
  ctx: CanvasRenderingContext2D,
  items: string[],
  selected: number,
  yStart: number,
  gap: number,
  fontPx: number,
): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `${fontPx}px ${MONO}`;
  for (let i = 0; i < items.length; i++) {
    const y = yStart + i * gap;
    const sel = i === selected;
    ctx.fillStyle = sel ? COLOR.text : COLOR.textDim;
    spaced(ctx, items[i]!, FIELD_W / 2, y, 8, "center");
    if (sel) {
      const w = measureSpaced(ctx, items[i]!, 8);
      ctx.fillStyle = COLOR.cyan;
      ctx.textAlign = "center";
      ctx.fillText("▸", FIELD_W / 2 - w / 2 - 26, y);
      ctx.fillStyle = COLOR.magenta;
      ctx.fillText("◂", FIELD_W / 2 + w / 2 + 26, y);
    }
  }
  ctx.restore();
}

function gradientText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  fontPx: number,
  letterSpacing: number,
): void {
  ctx.save();
  ctx.font = `700 ${fontPx}px ${MONO}`;
  const w = measureSpaced(ctx, text, letterSpacing);
  const grad = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  grad.addColorStop(0, COLOR.cyan);
  grad.addColorStop(1, COLOR.magenta);
  ctx.fillStyle = grad;
  ctx.shadowColor = "rgba(120,180,255,0.25)";
  ctx.shadowBlur = 22;
  spaced(ctx, text, cx, y, letterSpacing, "center");
  ctx.restore();
}

function centerText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  fontPx: number,
  color: string,
  letterSpacing: number,
): void {
  ctx.save();
  ctx.font = `${fontPx >= 40 ? "700 " : ""}${fontPx}px ${MONO}`;
  ctx.fillStyle = color;
  spaced(ctx, text, cx, y, letterSpacing, "center");
  ctx.restore();
}

// Draw text with manual letter-spacing and alignment.
function spaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  ls: number,
  align: "left" | "center" | "right",
): void {
  const total = measureSpaced(ctx, text, ls);
  let start = align === "left" ? x : align === "center" ? x - total / 2 : x - total;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  for (const ch of text) {
    ctx.fillText(ch, start, y);
    start += ctx.measureText(ch).width + ls;
  }
  ctx.textAlign = prevAlign;
}

function measureSpaced(ctx: CanvasRenderingContext2D, text: string, ls: number): number {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + ls;
  return Math.max(0, w - ls);
}

function pad(n: number, len: number): string {
  return Math.max(0, Math.floor(n)).toString().padStart(len, "0");
}

function panel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const x = (FIELD_W - w) / 2;
  const y = (FIELD_H - h) / 2;
  ctx.save();
  ctx.fillStyle = COLOR.raised;
  ctx.strokeStyle = COLOR.panelBorder;
  ctx.lineWidth = 1;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 40;
  roundRect(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
