// Spectra — every pixel the game draws.
//
// Rendering belongs to the ENGINE's pipeline: it collects every enabled, visible
// render component, orders it by layer, and calls each in turn with a context
// that already carries the world-to-device transform. The game leaves the camera
// at rest, so everything below is drawn in the stage's 1280x720 logical units and
// nothing here reads the canvas element's size. Each function is a PURE READ of
// the live `SpectraState` and writes nothing back (`specs/state.md`); the
// components in `src/actors.ts` are what call them, each at its own layer, so the
// order the picture overlaps in is the pipeline's rather than the order any call
// is written in.
//
// THE BAND IS THE WHOLE READ, so it is carried three ways at once, which is what
// `specs/overview.md`'s legibility table asks for: the band's own colour — the
// exact colour the seeded art is painted in — a glow of that colour, and the
// band's SHAPE ACCENT, the ring for cyan and the diamond for magenta, so the two
// stay apart for a colourblind player.
//
// HOW A SEEDED SPRITE CARRIES THE OTHER BAND. Each sprite is seeded in ONE
// band-state, and the other state is the same silhouette in the other band's
// colour. The silhouette on screen is therefore always the seeded one — the
// bitmap the loader decoded is what `drawImage` is handed, never a copy this
// build painted — and the band comes from a `"color"` composite over the drawn
// box, which takes the band's hue and saturation and keeps every pixel's own
// luminosity. The dark field under the box keeps its luminosity too, so it is
// unchanged, and the art keeps its shading instead of flattening into one flat
// colour. A Prism is tinted twice, its shell's ring and then its core's disc, so
// its two layers read as two bands at once.

import {
  BAND_LABELS,
  BURST_DURATION,
  BURST_FIELD,
  CHALLENGE_BANNER,
  CHALLENGE_TOTAL,
  ENEMY_BULLET_H,
  ENEMY_BULLET_W,
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  HUD_BOTTOM_TOP,
  HUD_STAGE_LABEL,
  HUD_TOP_H,
  PERFECT_TEXT,
  PLAYER_BULLET_H,
  PLAYER_BULLET_W,
  READY_TEXT,
  RESONANCE_MAX,
  SHIP_H,
  SHIP_W,
  SHIP_Y,
  SPRITE_SIZE,
  STAGE_H,
  STAGE_W,
  STARFIELD_MIN,
  TAGLINE_TEXT,
  TITLE_TEXT,
  isChallengeStage,
} from "./constants";
import { art } from "./assets";
import { droneBand, inverted, isShimmering, opposite } from "./bands";
import { dischargeReady } from "./discharge";
import { highlightedItem, itemBaselineY, menuOf } from "./menus";
import { droneSize } from "./simulate";
import { CYAN, COLOR, FONT, MAGENTA } from "./theme";
import type {
  Band,
  BulletState,
  BurstState,
  DroneState,
  Screen,
  SpectraState,
} from "./game";

type Ctx = CanvasRenderingContext2D;

const TAU = Math.PI * 2;

/** The colour a band is drawn in, everywhere it appears. */
export function bandColor(band: Band): string {
  return band === "cyan" ? CYAN : MAGENTA;
}

/** How many marks the starfield carries. */ const STARS = STARFIELD_MIN + 30;

/** How fast the starfield drifts down the field. */
const STAR_SPEED = 14;

/**
 * Whether the screen shows the play field's own contents.
 *
 * The title and the how-to are the two screens that stand in front of the field
 * rather than over it, so nothing the field carries is drawn on either.
 */
export function fieldVisible(screen: Screen): boolean {
  return screen !== "title" && screen !== "howto";
}

/** Set the context up the way every layer expects to find it. */
export function prepare(ctx: Ctx): void {
  // The art is pixel art, sampled without smoothing so it stays crisp at every
  // scale the stage is fitted to.
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "middle";
}

// ---- the field ----------------------------------------------------------

/** The play field's own ground, and the starfield behind everything on it. */
export function renderGround(state: SpectraState, ctx: Ctx): void {
  prepare(ctx);
  ctx.fillStyle = COLOR.field;
  ctx.fillRect(
    FIELD_LEFT,
    FIELD_TOP,
    FIELD_RIGHT - FIELD_LEFT,
    FIELD_BOTTOM - FIELD_TOP,
  );
  renderStarfield(state, ctx);
}

/**
 * The starfield: `STARS` marks well below either band in brightness, drifting
 * down the field so the stage reads as travelling.
 *
 * The layout is a fixed hash of the mark's index rather than a draw on the game's
 * own generator: it is presentation, it must not move the simulation on, and it
 * must look the same in every run.
 */
function renderStarfield(state: SpectraState, ctx: Ctx): void {
  const span = FIELD_BOTTOM - FIELD_TOP;
  for (let i = 0; i < STARS; i++) {
    const hx = Math.abs(Math.sin(i * 12.9898) * 43758.5453);
    const hy = Math.abs(Math.sin(i * 78.233) * 12345.6789);
    const x = (hx % 1) * (FIELD_RIGHT - FIELD_LEFT);
    const drift = (state.simTime * STAR_SPEED * (0.4 + (i % 3) * 0.3)) % span;
    const y = FIELD_TOP + (((hy % 1) * span + drift) % span);
    const near = i % 5 === 0;
    ctx.fillStyle = near ? COLOR.starBright : COLOR.star;
    ctx.fillRect(Math.round(x), Math.round(y), near ? 2 : 1, near ? 2 : 1);
  }
}

/** The field-wide mark a spectral inversion carries, absent otherwise. */
export function renderInversion(state: SpectraState, ctx: Ctx): void {
  if (!inverted(state.inversion)) return;
  const span = FIELD_BOTTOM - FIELD_TOP;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = MAGENTA;
  ctx.fillRect(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT - FIELD_LEFT, span / 2);
  ctx.fillStyle = CYAN;
  ctx.fillRect(
    FIELD_LEFT,
    FIELD_TOP + span / 2,
    FIELD_RIGHT - FIELD_LEFT,
    span / 2,
  );
  ctx.restore();

  // A hatched frame around the whole field, pulsing with the time left, so the
  // swap is unmistakable and not merely a change of tint.
  ctx.save();
  ctx.globalAlpha = 0.55 + 0.35 * Math.sin(state.simTime * 9);
  ctx.strokeStyle = MAGENTA;
  ctx.lineWidth = 6;
  ctx.strokeRect(
    FIELD_LEFT + 3,
    FIELD_TOP + 3,
    FIELD_RIGHT - FIELD_LEFT - 6,
    span - 6,
  );
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    FIELD_LEFT + 9,
    FIELD_TOP + 9,
    FIELD_RIGHT - FIELD_LEFT - 18,
    span - 18,
  );
  ctx.restore();
}

/**
 * The two HUD strips' own ground.
 *
 * It is drawn UNDER everything the field carries, so a drone flying in from above
 * the field and a diving drone wrapping through the bottom cross a strip while
 * they travel, exactly as `specs/field.md` allows.
 */
export function renderStrips(ctx: Ctx): void {
  ctx.fillStyle = COLOR.hud;
  ctx.fillRect(0, 0, STAGE_W, HUD_TOP_H);
  ctx.fillRect(0, HUD_BOTTOM_TOP, STAGE_W, STAGE_H - HUD_BOTTOM_TOP);
  ctx.fillStyle = COLOR.hudEdge;
  ctx.fillRect(0, HUD_TOP_H - 1, STAGE_W, 1);
  ctx.fillRect(0, HUD_BOTTOM_TOP, STAGE_W, 1);
}

// ---- the band accents ---------------------------------------------------

/** The band's shape accent: the ring for cyan, the diamond for magenta. */
function drawAccent(
  ctx: Ctx,
  cx: number,
  cy: number,
  r: number,
  band: Band,
  width = 2,
): void {
  ctx.save();
  ctx.strokeStyle = bandColor(band);
  ctx.lineWidth = width;
  ctx.beginPath();
  if (band === "cyan") {
    ctx.arc(cx, cy, r, 0, TAU);
  } else {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}

/** A soft glow of the band's colour, behind whatever carries it. */
function drawGlow(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  band: Band,
): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = bandColor(band);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * Tint the pixels already drawn inside a box to `band`.
 *
 * `"color"` takes the source's hue and saturation and keeps the backdrop's
 * luminosity, so the seeded silhouette keeps its shading and the near-black field
 * inside the same box stays as dark as it was.
 */
function tint(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  band: Band,
  disc?: { cx: number; cy: number; r: number },
): void {
  ctx.save();
  ctx.beginPath();
  if (disc === undefined) ctx.rect(x, y, w, h);
  else ctx.arc(disc.cx, disc.cy, disc.r, 0, TAU);
  ctx.clip();
  ctx.globalCompositeOperation = "color";
  ctx.fillStyle = bandColor(band);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// ---- the entities -------------------------------------------------------

/** One drone, at `(cx, cy)`: its own seeded silhouette, in the band it reads as. */
export function renderDrone(
  state: SpectraState,
  ctx: Ctx,
  drone: DroneState,
  cx: number,
  cy: number,
): void {
  prepare(ctx);
  const swapped = inverted(state.inversion);
  const size = droneSize(drone);
  const band = droneBand(drone, state.stage, swapped);
  const shimmering = isShimmering(drone, state.stage);
  const x = cx - size / 2;
  const y = cy - size / 2;

  if (drone.kind === "prism") {
    renderPrism(ctx, drone, band, cx, cy);
    return;
  }

  const sprite = drone.kind === "shard" ? art().shard : art().flux;
  drawGlow(ctx, cx, cy, size * 0.6, size * 0.6, band);
  if (sprite !== null) {
    ctx.drawImage(sprite, x, y, size, size);
    // A shimmering Flux is left exactly as the seeded art paints it — both bands
    // at once — which is half of what makes it visibly different from one holding
    // a band.
    if (!shimmering) tint(ctx, x, y, size, size, band);
  } else {
    renderFallbackDrone(ctx, cx, cy, size, band, shimmering);
  }
  // The other half: a drone settled ON a band carries that band's core, and a
  // shimmering Flux carries none, so the two are told apart at the body's centre
  // and not only at its edge.
  if (!shimmering) {
    ctx.save();
    ctx.fillStyle = bandColor(band);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2.5, size * 0.16), 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  if (shimmering) {
    // Neither accent, because the Flux is settled on neither band: a double ring
    // that reads as the telegraph it is.
    ctx.save();
    ctx.globalAlpha = 0.8;
    drawAccent(ctx, cx, cy, size * 0.66, "cyan", 1.5);
    drawAccent(ctx, cx, cy, size * 0.52, "magenta", 1.5);
    ctx.restore();
  } else {
    drawAccent(ctx, cx, cy, size * 0.62, band);
  }
}

/** A Prism: two layers of opposite bands, or the core alone once the shell is gone. */
function renderPrism(
  ctx: Ctx,
  drone: DroneState,
  band: Band,
  cx: number,
  cy: number,
): void {
  const size = droneSize(drone);
  const x = cx - size / 2;
  const y = cy - size / 2;
  const sprite = art().prism;
  // `band` is what the Prism READS as, which is the exposed layer's band; the
  // hidden layer is always the other one.
  const shell = drone.shellAlive ? band : opposite(band);
  const core = opposite(shell);

  drawGlow(ctx, cx, cy, size * 0.62, size * 0.62, band);
  if (sprite === null) {
    renderFallbackPrism(ctx, cx, cy, size, shell, core, drone.shellAlive);
  } else if (drone.shellAlive) {
    ctx.drawImage(sprite, x, y, size, size);
    tint(ctx, x, y, size, size, shell);
    tint(ctx, x, y, size, size, core, { cx, cy, r: size * 0.28 });
  } else {
    // Only the inner layer is drawn, taken from the seeded art's own core.
    const crop = SPRITE_SIZE * 0.28;
    const span = SPRITE_SIZE - crop * 2;
    ctx.drawImage(sprite, crop, crop, span, span, x, y, size, size);
    tint(ctx, x, y, size, size, core);
  }
  drawAccent(ctx, cx, cy, size * 0.58, shell);
  if (!drone.shellAlive) drawAccent(ctx, cx, cy, size * 0.34, core, 1.5);
}

/** A drone where the seeded art did not arrive: its silhouette, drawn in code. */
function renderFallbackDrone(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  band: Band,
  shimmering: boolean,
): void {
  const r = size / 2;
  ctx.save();
  ctx.fillStyle = shimmering ? COLOR.text : bandColor(band);
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A Prism where the seeded art did not arrive. */
function renderFallbackPrism(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  shell: Band,
  core: Band,
  shellAlive: boolean,
): void {
  ctx.save();
  if (shellAlive) {
    ctx.fillStyle = bandColor(shell);
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = bandColor(core);
  ctx.beginPath();
  ctx.arc(cx, cy, shellAlive ? size * 0.28 : size / 2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** One bullet, drawn in code in its band's colour, with its band's accent. */
export function renderBullet(
  state: SpectraState,
  ctx: Ctx,
  bullet: BulletState,
  cx: number,
  cy: number,
): void {
  prepare(ctx);
  const swapped = inverted(state.inversion);
  const band =
    bullet.friendly || !swapped ? bullet.band : opposite(bullet.band);
  const friendly = bullet.friendly;
  const w = friendly ? PLAYER_BULLET_W : ENEMY_BULLET_W;
  const h = friendly ? PLAYER_BULLET_H : ENEMY_BULLET_H;
  drawGlow(ctx, cx, cy, w * 1.6, h * 0.9, band);
  ctx.save();
  ctx.fillStyle = bandColor(band);
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
  drawAccent(ctx, cx, friendly ? cy - h / 2 : cy + h / 2, w * 1.4, band, 1.5);
}

/** The ship: the seeded fighter, its core in the band it holds. */
export function renderShip(state: SpectraState, ctx: Ctx, cx: number): void {
  prepare(ctx);
  const band = state.ship.band;
  const x = cx - SHIP_W / 2;
  const y = SHIP_Y - SHIP_H / 2;
  drawGlow(ctx, cx, SHIP_Y, SHIP_W * 0.62, SHIP_H * 0.9, band);
  const fighter = art().fighter;
  if (fighter !== null) {
    ctx.drawImage(fighter, x, y, SHIP_W, SHIP_H);
  } else {
    ctx.save();
    ctx.fillStyle = COLOR.hull;
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(x + SHIP_W, y + SHIP_H);
    ctx.lineTo(x, y + SHIP_H);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // The hull stays the hull and the CORE carries the band, which is what
  // `specs/assets.md` asks the other band-state to be.
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = band === "cyan" ? "#a8f4ff" : "#ffc3e8";
  ctx.beginPath();
  ctx.arc(cx, SHIP_Y, 4.5, 0, TAU);
  ctx.fill();
  ctx.restore();
  drawAccent(ctx, cx, SHIP_Y, SHIP_W * 0.34, band);
}

/** The discharge wave: a band-blind ring, growing from the ship. */
export function renderDischarge(state: SpectraState, ctx: Ctx): void {
  if (!state.discharge.active) return;
  const r = state.discharge.radius;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = COLOR.hull;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(state.ship.x, SHIP_Y, Math.max(1, r), 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.arc(state.ship.x, SHIP_Y, Math.max(1, r * 0.82), 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * One drone-burst, composited additively so the effect reads as light.
 *
 * The particles are the ones the burst's own simulation reports, drawn from the
 * system's `BURST_FIELD` square scaled onto the popped drone's footprint.
 */
export function renderBurst(
  ctx: Ctx,
  burst: BurstState,
  cx: number,
  cy: number,
): void {
  const scale = burst.size / BURST_FIELD;
  const fade = Math.max(0, 1 - burst.elapsed / BURST_DURATION);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of burst.sim.capture()) {
    const px = cx + (p.position[0] - BURST_FIELD / 2) * scale;
    const py = cy - (p.position[1] - BURST_FIELD / 2) * scale;
    const r = Math.max(0.6, p.size * scale * 0.5);
    ctx.globalAlpha = Math.max(0, Math.min(1, p.opacity * fade));
    ctx.fillStyle = channel(p.color);
    const stretch = Math.max(1, p.stretch);
    ctx.fillRect(px - r, py - r * stretch, r * 2, r * 2 * stretch);
  }
  ctx.restore();
}

/** A linear `0..1` RGB triple as a CSS colour. */
function channel(color: readonly [number, number, number]): string {
  const to255 = (v: number): number =>
    Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${to255(color[0])}, ${to255(color[1])}, ${to255(color[2])})`;
}

// ---- the HUD ------------------------------------------------------------

/** Both strips' readouts: the score and the stage above, the run's own below. */
export function renderHud(state: SpectraState, ctx: Ctx): void {
  prepare(ctx);
  const width = STAGE_W;
  if (!fieldVisible(state.screen)) {
    // The title and the how-to carry no readouts, and the mute mark is the one
    // thing about the HUD that is shown on every screen.
    renderMuteMark(state, ctx);
    return;
  }

  ctx.save();
  ctx.fillStyle = COLOR.text;
  ctx.font = FONT.heading;
  ctx.textAlign = "left";
  ctx.fillText(String(state.score).padStart(6, "0"), 28, HUD_TOP_H / 2);

  ctx.font = FONT.body;
  ctx.textAlign = "right";
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText(`${HUD_STAGE_LABEL} ${state.stage}`, width - 28, HUD_TOP_H / 2);
  if (isChallengeStage(state.stage)) {
    ctx.textAlign = "center";
    ctx.fillStyle = COLOR.meterReady;
    ctx.font = FONT.small;
    ctx.fillText(CHALLENGE_BANNER, width / 2, HUD_TOP_H / 2);
  }
  ctx.restore();

  renderLives(state, ctx);
  renderMeter(state, ctx);
  renderPolarity(state, ctx);
  renderMuteMark(state, ctx);
}

/** The lives remaining, as a row of hulls. */
function renderLives(state: SpectraState, ctx: Ctx): void {
  const y = HUD_BOTTOM_TOP + 32;
  const fighter = art().fighter;
  for (let i = 0; i < state.lives; i++) {
    const x = 34 + i * 30;
    if (fighter !== null) {
      ctx.drawImage(fighter, x - 11, y - 8, 22, 16);
    } else {
      ctx.save();
      ctx.fillStyle = COLOR.hull;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x + 9, y + 8);
      ctx.lineTo(x - 9, y + 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

/** The resonance meter, drawn distinctly once it is full and ready to spend. */
function renderMeter(state: SpectraState, ctx: Ctx): void {
  const width = STAGE_W;
  const w = 300;
  const h = 16;
  const x = width / 2 - w / 2;
  const y = HUD_BOTTOM_TOP + 24;
  const ready = dischargeReady(state.resonance);
  ctx.save();
  ctx.fillStyle = COLOR.meter;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = ready ? COLOR.meterReady : CYAN;
  ctx.fillRect(x, y, (w * state.resonance) / RESONANCE_MAX, h);
  ctx.strokeStyle = ready ? COLOR.meterReady : COLOR.hudEdge;
  ctx.lineWidth = ready ? 3 : 1;
  ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = ready ? COLOR.meterReady : COLOR.textDim;
  ctx.font = FONT.small;
  ctx.textAlign = "center";
  ctx.fillText(
    ready ? "RESONANCE — X TO DISCHARGE" : "RESONANCE",
    width / 2,
    y + h + 16,
  );
  ctx.restore();
}

/** The polarity indicator: the ship's band, its accent, and its label. */
function renderPolarity(state: SpectraState, ctx: Ctx): void {
  const band = state.ship.band;
  const cx = STAGE_W - 150;
  const cy = HUD_BOTTOM_TOP + 32;
  drawGlow(ctx, cx, cy, 20, 20, band);
  ctx.save();
  ctx.fillStyle = bandColor(band);
  ctx.beginPath();
  ctx.arc(cx, cy, 9, 0, TAU);
  ctx.fill();
  ctx.fillStyle = bandColor(band);
  ctx.font = FONT.body;
  ctx.textAlign = "left";
  ctx.fillText(BAND_LABELS[band], cx + 24, cy);
  ctx.restore();
  drawAccent(ctx, cx, cy, 16, band);
}

/** The mute mark: drawn whenever sound is muted, absent whenever it is not. */
function renderMuteMark(state: SpectraState, ctx: Ctx): void {
  if (!state.muted) return;
  ctx.save();
  ctx.fillStyle = COLOR.textDim;
  ctx.font = FONT.small;
  ctx.textAlign = "right";
  ctx.fillText("MUTED", STAGE_W - 28, HUD_BOTTOM_TOP + 52);
  ctx.restore();
}

// ---- the screens --------------------------------------------------------

/** A line of text, centred. */
function centered(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
): void {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** A dark wash over the field, so text on top of it stays legible. */
function scrim(ctx: Ctx, alpha = 0.62): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLOR.background;
  ctx.fillRect(
    FIELD_LEFT,
    FIELD_TOP,
    FIELD_RIGHT - FIELD_LEFT,
    FIELD_BOTTOM - FIELD_TOP,
  );
  ctx.restore();
}

/** The vertical menu a screen shows, its highlight on the item `menuIndex` names. */
function renderMenu(state: SpectraState, ctx: Ctx): void {
  const width = STAGE_W;
  const menu = menuOf(state.screen);
  if (menu === null) return;
  const selected = highlightedItem(menu, state.menuIndex);
  menu.items.forEach((item, i) => {
    const y = itemBaselineY(menu, i);
    const hot = i === selected;
    if (hot) {
      drawAccent(ctx, width / 2 - 150, y, 10, state.ship.band, 2);
      drawAccent(ctx, width / 2 + 150, y, 10, state.ship.band, 2);
    }
    centered(
      ctx,
      item,
      width / 2,
      y,
      FONT.body,
      hot ? COLOR.textHot : COLOR.textDim,
    );
  });
}

/** Whichever screen is up, over the field the layers below have drawn. */
export function renderScreen(state: SpectraState, ctx: Ctx): void {
  prepare(ctx);
  switch (state.screen) {
    case "title":
      renderTitle(state, ctx);
      break;
    case "howto":
      renderHowTo(ctx);
      break;
    case "stageIntro":
      renderStageIntro(state, ctx);
      break;
    case "inWave":
      if (state.phase === "ready") renderBanner(ctx, READY_TEXT);
      break;
    case "paused":
      renderMenuScreen(state, ctx, "PAUSED");
      break;
    case "stageCleared":
      renderStageCleared(state, ctx);
      break;
    case "gameOver":
      renderGameOver(state, ctx);
      break;
  }
}

/** The title screen. */
function renderTitle(state: SpectraState, ctx: Ctx): void {
  const width = STAGE_W;
  scrim(ctx, 0.35);
  centered(ctx, TITLE_TEXT, width / 2, 210, FONT.title, COLOR.text);
  drawAccent(ctx, width / 2 - 250, 210, 26, "cyan", 3);
  drawAccent(ctx, width / 2 + 250, 210, 26, "magenta", 3);
  centered(ctx, TAGLINE_TEXT, width / 2, 274, FONT.body, CYAN);
  renderMenu(state, ctx);
  centered(
    ctx,
    "ARROWS / AD MOVE — SPACE FIRE — F FLIP — X DISCHARGE",
    width / 2,
    600,
    FONT.small,
    COLOR.textDim,
  );
}

/** How to play, in a player's words. */
function renderHowTo(ctx: Ctx): void {
  const width = STAGE_W;
  scrim(ctx, 0.55);
  centered(ctx, "HOW TO PLAY", width / 2, 120, FONT.heading, COLOR.text);
  const lines = [
    "Hold the lane and clear every wave of drones before your last life is gone.",
    "",
    `Your fighter is tuned to one band at a time, ${BAND_LABELS.cyan} or ${BAND_LABELS.magenta}.`,
    "Only a shot of the drone's own band destroys it — and that same band is your",
    "shield, so fire of your band is absorbed and fire of the other band kills you.",
    "Flipping costs a beat of fire, so pick your moment.",
    "",
    "A SHARD holds one band for life. A FLUX swings between the two and shimmers",
    "as it changes — nothing can destroy it mid-shimmer. A PRISM wears two bands",
    "at once, shell then core, and swaps the whole field if it reaches the bottom.",
    "",
    "Absorbing fire and killing drones fill the RESONANCE meter. Full, it pays for",
    "a discharge that sweeps every diving drone and every enemy shot off the field.",
    "",
    "ARROWS or AD to move. SPACE to fire. F to flip. X to discharge.",
    "P pauses, M mutes, ESC goes back.",
  ];
  lines.forEach((line, i) => {
    centered(ctx, line, width / 2, 190 + i * 26, FONT.small, COLOR.text);
  });
  centered(ctx, "ESC — BACK", width / 2, 620, FONT.body, COLOR.textDim);
}

/** The hold that announces the stage about to be played. */
function renderStageIntro(state: SpectraState, ctx: Ctx): void {
  const width = STAGE_W;
  scrim(ctx, 0.5);
  centered(
    ctx,
    `${HUD_STAGE_LABEL} ${state.stage}`,
    width / 2,
    330,
    FONT.title,
    COLOR.text,
  );
  if (isChallengeStage(state.stage)) {
    centered(
      ctx,
      CHALLENGE_BANNER,
      width / 2,
      410,
      FONT.heading,
      COLOR.meterReady,
    );
  }
}

/** A banner over the live field. */
function renderBanner(ctx: Ctx, text: string): void {
  centered(ctx, text, STAGE_W / 2, 420, FONT.title, COLOR.textHot);
}

/** The interstitial a finished stage opens. */
function renderStageCleared(state: SpectraState, ctx: Ctx): void {
  const width = STAGE_W;
  scrim(ctx, 0.55);
  // The stage that was cleared is the one just played, which is this one: the
  // stage number moves on when the interstitial gives way.
  if (isChallengeStage(state.stage)) {
    const perfect = state.challengeHits >= CHALLENGE_TOTAL;
    centered(
      ctx,
      perfect ? PERFECT_TEXT : "CHALLENGE OVER",
      width / 2,
      320,
      FONT.title,
      perfect ? COLOR.meterReady : COLOR.text,
    );
    centered(
      ctx,
      `${state.challengeHits} OF ${CHALLENGE_TOTAL} DESTROYED`,
      width / 2,
      396,
      FONT.body,
      COLOR.text,
    );
    if (perfect) {
      centered(ctx, "+10000", width / 2, 444, FONT.body, COLOR.meterReady);
    }
    return;
  }
  centered(
    ctx,
    `${HUD_STAGE_LABEL} ${state.stage} CLEARED`,
    width / 2,
    330,
    FONT.title,
    COLOR.text,
  );
  centered(ctx, "+1000", width / 2, 404, FONT.heading, COLOR.meterReady);
}

/** The run was lost. */
function renderGameOver(state: SpectraState, ctx: Ctx): void {
  const width = STAGE_W;
  scrim(ctx, 0.66);
  centered(ctx, "GAME OVER", width / 2, 210, FONT.title, COLOR.text);
  centered(
    ctx,
    `SCORE ${state.score}`,
    width / 2,
    300,
    FONT.heading,
    COLOR.text,
  );
  centered(
    ctx,
    `${HUD_STAGE_LABEL} ${state.stage}`,
    width / 2,
    350,
    FONT.body,
    COLOR.textDim,
  );
  renderMenu(state, ctx);
}

/** A screen that is a menu over the frozen field. */
function renderMenuScreen(
  state: SpectraState,
  ctx: Ctx,
  heading: string,
): void {
  scrim(ctx, 0.6);
  centered(ctx, heading, STAGE_W / 2, 250, FONT.title, COLOR.text);
  renderMenu(state, ctx);
}
