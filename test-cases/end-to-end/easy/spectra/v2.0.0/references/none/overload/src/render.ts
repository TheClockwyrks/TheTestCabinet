// Spectra — everything the game draws.
//
// The renderer is a PURE FUNCTION OF THE STATE: it reads and never writes, so the
// simulation can be stepped and read with no drawing taking part in the result
// (specs/instrumentation.md's render-free core). Every figure it draws at comes
// either from `src/constants.ts`, where the specification fixed it, or from
// `src/theme.ts`, where the look is this build's own choice.
//
// The layer order is the one thing here that a rule depends on. The field is drawn
// first and the two HUD STRIPS ARE DRAWN OVER IT, opaque, so nothing of the ship, a
// drone, a bullet or the discharge wave can ever appear inside a strip
// (specs/field.md) — while a drone in transit above the field still flies its whole
// path, it simply is not visible until it has crossed into the field.
//
// THREE THINGS CARRY A BAND, and all three carry it the same way: the band's colour
// from `BAND_COLOR`, and the band's shape accent — the ring for cyan, the diamond
// for magenta — drawn on top. That is the legibility table's "one palette for both"
// and "band by more than colour" rows, in one helper each.

import { captureBurst, burstScale } from "./bursts";
import {
  BAND_LABELS,
  CHALLENGE_BANNER,
  CHALLENGE_TOTAL,
  ENEMY_BULLET_H,
  ENEMY_BULLET_W,
  FIELD_BOTTOM,
  FIELD_TOP,
  GAME_OVER_ITEMS,
  HUD_BOTTOM_TOP,
  HUD_STAGE_LABEL,
  HUD_TOP_H,
  PAUSE_ITEMS,
  PERFECT_TEXT,
  PLAYER_BULLET_H,
  PLAYER_BULLET_W,
  READY_TEXT,
  RESONANCE_MAX,
  SHIP_H,
  SHIP_W,
  SHIP_Y,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
  droneSize,
  isChallengeStage,
} from "./constants";
import { BAND_COLOR, BAND_GLOW, COLOR, FONT, font } from "./theme";
import { STARFIELD } from "./field";
import { shimmering } from "./drones";
import { dischargeReady } from "./resonance";
import type { Sprites } from "./assets";
import type { Band, Drone, SpectraState } from "./types";

/** How to play, in a player's words. */
const HOWTO_LINES: readonly string[] = [
  "CLEAR EVERY WAVE BEFORE YOUR LAST LIFE IS GONE.",
  "",
  "YOUR SHIP IS TUNED TO ONE BAND AT A TIME, CYAN OR MAGENTA.",
  "ONLY A MATCHING SHOT DESTROYS A DRONE — AND THE SAME BAND IS",
  "YOUR SHIELD, SO A SHOT OF YOUR OWN BAND IS ABSORBED.",
  "FLIPPING COSTS YOU A BEAT OF FIRE, SO PICK YOUR MOMENT.",
  "",
  "A SHARD HOLDS ONE BAND. A FLUX SWINGS BETWEEN THEM AND CANNOT",
  "BE HIT MID-SHIMMER. A PRISM WEARS BOTH AT ONCE, SHELL THEN",
  "CORE, AND SWAPS THE WHOLE FIELD IF IT REACHES THE BOTTOM.",
  "",
  "ABSORBING AND KILLING CHARGE THE RESONANCE METER. A FULL METER",
  "BUYS A DISCHARGE THAT WIPES EVERY DIVER OFF THE FIELD.",
  "",
  "MOVE WITH THE ARROWS OR AD.  FIRE WITH SPACE.",
  "FLIP WITH F OR SHIFT.  X DISCHARGES.  P PAUSES.  M MUTES.",
];

/** Draw one whole frame of `state`. */
export function render(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  // The title and the how-to sit outside a run, so neither the field's entities
  // nor the run's HUD belongs on them.
  const inRun = state.screen !== "title" && state.screen !== "howto";
  drawField(state, ctx);
  if (inRun) {
    drawEntities(state, ctx, sprites);
    if (state.inversion > 0) drawInversionMark(ctx);
    drawHudStrips(state, ctx, sprites);
  }
  drawScreen(state, ctx, sprites);

  ctx.restore();
}

// --- The field --------------------------------------------------------------

function drawField(state: SpectraState, ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.fillStyle = COLOR.field;
  ctx.fillRect(0, FIELD_TOP, STAGE_W, FIELD_BOTTOM - FIELD_TOP);
  // The title and how-to screens show only a dim slice of the starfield.
  const dim = state.screen === "title" || state.screen === "howto" ? 0.45 : 1;
  for (const star of STARFIELD) {
    ctx.globalAlpha = star.alpha * dim;
    ctx.fillStyle = COLOR.star;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** The field-wide mark a spectral inversion carries. */
function drawInversionMark(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.inversion;
  ctx.fillRect(0, FIELD_TOP, STAGE_W, FIELD_BOTTOM - FIELD_TOP);
  ctx.strokeStyle = COLOR.inversionEdge;
  ctx.lineWidth = 4;
  ctx.strokeRect(3, FIELD_TOP + 3, STAGE_W - 6, FIELD_BOTTOM - FIELD_TOP - 6);
}

// --- What a band looks like -------------------------------------------------

/**
 * The band's shape accent, drawn on top of whatever carries the band: a ring for
 * cyan, a diamond for magenta. Used everywhere a band appears, so the two stay
 * legible to a colourblind player.
 */
export function drawAccent(
  ctx: CanvasRenderingContext2D,
  band: Band,
  x: number,
  y: number,
  r: number,
): void {
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = Math.max(1.2, r * 0.34);
  if (band === "cyan") {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// --- The entities -----------------------------------------------------------

function drawEntities(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
): void {
  for (const burst of state.bursts) drawBurst(ctx, burst);
  for (const drone of state.drones) drawDrone(state, ctx, sprites, drone);
  for (const bullet of state.bullets) {
    drawBullet(ctx, bullet.x, bullet.y, bullet.band, bullet.friendly);
  }
  if (state.phase !== "ready") drawShip(state, ctx, sprites);
  if (state.discharge.active) drawDischarge(state, ctx);
}

/** The ship, from the seeded fighter art in the band it holds. */
function drawShip(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
): void {
  const source = sprites.fighter[state.ship.band];
  ctx.drawImage(
    source,
    state.ship.x - SHIP_W / 2,
    SHIP_Y - SHIP_H / 2,
    SHIP_W,
    SHIP_H,
  );
  // The band the ship holds, readable on the ship itself.
  ctx.fillStyle = BAND_GLOW[state.ship.band];
  ctx.beginPath();
  ctx.arc(state.ship.x, SHIP_Y + 2, 9, 0, Math.PI * 2);
  ctx.fill();
  drawAccent(ctx, state.ship.band, state.ship.x, SHIP_Y + 2, 4);
}

/**
 * One drone, from its own seeded sprite at its own footprint.
 *
 * Each kind also carries a code-drawn mark of its own — a hard band-coloured halo on
 * a Shard, a white-hot core on a Flux, a band-coloured shell edge on a Prism — so
 * the three read apart from one another as well as from the field.
 */
function drawDrone(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  drone: Drone,
): void {
  const size = droneSize(drone.kind, drone.shellAlive);
  const half = size / 2;
  const band = drone.band;
  const source = droneSource(sprites, state, drone);

  if (drone.kind === "shard") {
    ctx.strokeStyle = BAND_COLOR[band];
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = size * 0.16;
    ctx.beginPath();
    ctx.arc(drone.x, drone.y, half * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.drawImage(source, drone.x - half, drone.y - half, size, size);

  if (drone.kind === "flux") {
    const shimmer = shimmering(drone, state.stage);
    // The tuning core is white on both states; the ring is the band the Flux is
    // holding, and white only while it holds neither.
    // A soft white halo on both states, stronger while it holds neither band: the
    // Flux is the drone that reads as light rather than as a colour.
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = shimmer ? 0.3 : 0.13;
    ctx.beginPath();
    ctx.arc(drone.x, drone.y, half, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(drone.x, drone.y, size * (shimmer ? 0.34 : 0.26), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = shimmer ? "#ffffff" : BAND_COLOR[band];
    ctx.globalAlpha = shimmer ? 0.95 : 1;
    ctx.lineWidth = shimmer ? size * 0.18 : size * 0.11;
    ctx.beginPath();
    ctx.arc(drone.x, drone.y, half * (shimmer ? 0.95 : 0.86), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (drone.kind === "prism") {
    // The violet rim is the Prism's own chassis, not a band: it is what tells the
    // two-layer drone apart from a Shard and a Flux of the same band at a glance.
    ctx.strokeStyle = COLOR.prismRim;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = size * 0.09;
    ctx.beginPath();
    ctx.arc(drone.x, drone.y, half * 0.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // A shimmering Flux is settled on neither band, so it carries no accent.
  if (!shimmering(drone, state.stage)) {
    const accentBand =
      drone.kind === "prism" && !drone.shellAlive ? oppositeBand(band) : band;
    drawAccent(
      ctx,
      accentBand,
      drone.x,
      drone.y - half + size * 0.18,
      size * 0.12,
    );
  }

  drawTelegraph(ctx, drone, size);
}

/** The other band, without importing the whole constants module for one call. */
function oppositeBand(band: Band): Band {
  return band === "cyan" ? "magenta" : "cyan";
}

/** The seeded source a drone is drawn from, in the state it is in. */
function droneSource(
  sprites: Sprites,
  state: SpectraState,
  drone: Drone,
): CanvasImageSource {
  if (drone.kind === "shard") return sprites.shard[drone.band];
  if (drone.kind === "flux") {
    return shimmering(drone, state.stage)
      ? sprites.fluxShimmer
      : sprites.fluxHeld[drone.band];
  }
  return drone.shellAlive
    ? sprites.prismShell[drone.band]
    : sprites.prismCore[drone.band];
}

/**
 * The charge telegraph (specs/mode.md).
 *
 * A drone at charge `0` draws none at all; every charge above that adds a wash over
 * the drone's own footprint and one more hard tick around it, so a drone at charge
 * `1` and one at charge `2` are told apart at a glance.
 */
function drawTelegraph(
  ctx: CanvasRenderingContext2D,
  drone: Drone,
  size: number,
): void {
  if (drone.charge <= 0) return;
  const half = size / 2;
  ctx.save();
  ctx.globalAlpha = 0.2 * drone.charge;
  ctx.fillStyle = COLOR.charge;
  ctx.beginPath();
  ctx.arc(drone.x, drone.y, half, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = COLOR.charge;
  ctx.lineWidth = Math.max(3, size * 0.14);
  for (let tick = 0; tick < drone.charge; tick += 1) {
    const from = -Math.PI / 2 + tick * ((Math.PI * 2) / 3) + 0.12;
    ctx.beginPath();
    ctx.arc(drone.x, drone.y, half * 0.78, from, from + 1.6);
    ctx.stroke();
  }
  ctx.restore();
}

/** One bullet, drawn in code in its band's colour and accent. */
export function drawBullet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  band: Band,
  friendly: boolean,
): void {
  const w = friendly ? PLAYER_BULLET_W : ENEMY_BULLET_W;
  const h = friendly ? PLAYER_BULLET_H : ENEMY_BULLET_H;
  ctx.fillStyle = BAND_GLOW[band];
  ctx.fillRect(x - w, y - h / 2 - 2, w * 2, h + 4);
  ctx.fillStyle = BAND_COLOR[band];
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  drawAccent(ctx, band, x, y, Math.max(1.6, w * 0.5));
}

/** The discharge wave: a growing ring centred on the ship. */
function drawDischarge(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.save();
  ctx.strokeStyle = COLOR.discharge;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(
    state.ship.x,
    SHIP_Y,
    Math.max(1, state.discharge.radius),
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 34;
  ctx.beginPath();
  ctx.arc(
    state.ship.x,
    SHIP_Y,
    Math.max(1, state.discharge.radius * 0.86),
    0,
    Math.PI * 2,
  );
  ctx.stroke();
  ctx.restore();
}

/**
 * One drone-burst: the particles its own simulation reports, composited additively
 * so the effect reads as light.
 */
function drawBurst(
  ctx: CanvasRenderingContext2D,
  burst: { x: number; y: number; size: number; sim: unknown } & {
    elapsed: number;
  },
): void {
  const particles = captureBurst(burst as never);
  if (particles.length === 0) return;
  const scale = burstScale(burst as never);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const particle of particles) {
    const [px, py] = particle.position;
    // The authored field is y-up about its own centre; the stage is y-down.
    const x = burst.x + (px - 64) * scale;
    const y = burst.y - (py - 64) * scale;
    const r = Math.max(0.6, particle.size * scale * 0.5);
    const [lr, lg, lb] = particle.color;
    ctx.globalAlpha = Math.max(0, Math.min(1, particle.opacity));
    ctx.fillStyle = `rgb(${Math.round(lr * 255)}, ${Math.round(
      lg * 255,
    )}, ${Math.round(lb * 255)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// --- The HUD ----------------------------------------------------------------

function drawHudStrips(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
): void {
  ctx.fillStyle = COLOR.hud;
  ctx.fillRect(0, 0, STAGE_W, HUD_TOP_H);
  ctx.fillRect(0, HUD_BOTTOM_TOP, STAGE_W, STAGE_H - HUD_BOTTOM_TOP);
  ctx.fillStyle = COLOR.hudEdge;
  ctx.fillRect(0, HUD_TOP_H - 2, STAGE_W, 2);
  ctx.fillRect(0, HUD_BOTTOM_TOP, STAGE_W, 2);

  // Top strip: the score, the most prominent readout, and the stage.
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(FONT.body, 14);
  ctx.fillText("SCORE", 24, 20);
  ctx.fillStyle = COLOR.text;
  ctx.font = font(FONT.numeric, 30);
  ctx.fillText(String(state.score), 24, 44);

  ctx.textAlign = "right";
  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(FONT.body, 14);
  ctx.fillText(HUD_STAGE_LABEL, STAGE_W - 24, 20);
  ctx.fillStyle = COLOR.text;
  ctx.font = font(FONT.numeric, 30);
  ctx.fillText(String(state.stage), STAGE_W - 24, 44);
  ctx.textAlign = "left";

  drawLives(state, ctx, sprites);
  drawMeter(state, ctx);
  drawPolarity(state, ctx);
  if (state.muted) drawMuteIndicator(ctx);
}

/** The lives remaining, as a row of small fighters. */
function drawLives(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
): void {
  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(FONT.body, 13);
  ctx.fillText("LIVES", 24, HUD_BOTTOM_TOP + 18);
  const source = sprites.fighter[state.ship.band];
  for (let index = 0; index < Math.max(0, state.lives); index += 1) {
    ctx.drawImage(source, 24 + index * 30, HUD_BOTTOM_TOP + 30, 26, 18);
  }
}

/** The resonance meter, as a bar whose filled extent grows with it. */
function drawMeter(state: SpectraState, ctx: CanvasRenderingContext2D): void {
  const x = 300;
  const y = HUD_BOTTOM_TOP + 30;
  const w = 400;
  const h = 18;
  const ready = dischargeReady(state);
  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(FONT.body, 13);
  ctx.fillText("RESONANCE", x, HUD_BOTTOM_TOP + 18);
  ctx.fillStyle = COLOR.meterEmpty;
  ctx.fillRect(x, y, w, h);
  const filled = w * Math.max(0, Math.min(1, state.resonance / RESONANCE_MAX));
  ctx.fillStyle = ready ? COLOR.meterReady : COLOR.meterFill;
  ctx.fillRect(x, y, filled, h);
  if (ready) {
    // A full meter is drawn distinctly from one a point below full. The label sits
    // above the bar rather than beside it, so it never reaches the polarity
    // indicator's own region however wide the type it is set in turns out to be.
    ctx.strokeStyle = COLOR.meterReady;
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
    ctx.fillStyle = COLOR.meterReady;
    ctx.font = font(FONT.display, 14);
    ctx.fillText("DISCHARGE READY", x + 110, HUD_BOTTOM_TOP + 18);
  }
}

/** The polarity indicator: the ship's band, in its colour, accent and label. */
function drawPolarity(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  const band = state.ship.band;
  const x = 860;
  const y = HUD_BOTTOM_TOP + 34;
  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(FONT.body, 13);
  ctx.fillText("POLARITY", x, HUD_BOTTOM_TOP + 15);
  ctx.fillStyle = BAND_GLOW[band];
  ctx.fillRect(x - 4, y - 16, 200, 32);
  ctx.fillStyle = BAND_COLOR[band];
  ctx.beginPath();
  ctx.arc(x + 14, y, 11, 0, Math.PI * 2);
  ctx.fill();
  drawAccent(ctx, band, x + 14, y, 5);
  ctx.fillStyle = BAND_COLOR[band];
  ctx.font = font(FONT.display, 20);
  ctx.fillText(BAND_LABELS[band], x + 34, y);
}

/** Shown whenever sound is muted, and absent whenever it is not. */
function drawMuteIndicator(ctx: CanvasRenderingContext2D): void {
  ctx.textAlign = "right";
  ctx.fillStyle = COLOR.text;
  ctx.font = font(FONT.display, 18);
  ctx.fillText("MUTED", STAGE_W - 24, HUD_BOTTOM_TOP + 34);
  ctx.textAlign = "left";
}

// --- The screens ------------------------------------------------------------

function drawScreen(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
): void {
  switch (state.screen) {
    case "title":
      drawTitle(state, ctx, sprites);
      return;
    case "howto":
      drawHowto(ctx);
      return;
    case "stageIntro":
      drawStageIntro(state, ctx);
      return;
    case "inWave":
      if (state.phase === "ready") drawBanner(ctx, READY_TEXT);
      return;
    case "paused":
      drawMenuScreen(state, ctx, "PAUSED", PAUSE_ITEMS, []);
      return;
    case "stageCleared":
      drawStageCleared(state, ctx);
      return;
    case "gameOver":
      drawGameOver(state, ctx);
      return;
  }
}

/** A veil over the field, so a screen's text reads against whatever is behind it. */
function veil(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.veil;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function drawTitle(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
): void {
  veil(ctx);
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.text;
  ctx.font = font(FONT.display, 96);
  ctx.fillText(TITLE_TEXT, STAGE_W / 2, 190);
  ctx.fillStyle = BAND_COLOR.cyan;
  ctx.font = font(FONT.display, 26);
  ctx.fillText(TAGLINE_TEXT, STAGE_W / 2, 250);
  ctx.drawImage(sprites.fighter.cyan, STAGE_W / 2 - 40, 290, 80, 56);
  drawMenu(ctx, TITLE_ITEMS, state.menuIndex, 420);
  ctx.textAlign = "left";
}

function drawHowto(ctx: CanvasRenderingContext2D): void {
  veil(ctx);
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.text;
  ctx.font = font(FONT.display, 42);
  ctx.fillText("HOW TO PLAY", STAGE_W / 2, 110);
  ctx.font = font(FONT.body, 20);
  HOWTO_LINES.forEach((line, index) => {
    ctx.fillStyle =
      line.startsWith("MOVE") || line.startsWith("FLIP")
        ? BAND_COLOR.cyan
        : COLOR.text;
    ctx.fillText(line, STAGE_W / 2, 170 + index * 28);
  });
  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(FONT.body, 18);
  ctx.fillText("ESC RETURNS TO THE MENU", STAGE_W / 2, 660);
  ctx.textAlign = "left";
}

function drawStageIntro(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(FONT.body, 28);
  ctx.fillText(HUD_STAGE_LABEL, STAGE_W / 2, 300);
  ctx.fillStyle = COLOR.text;
  ctx.font = font(FONT.numeric, 92);
  ctx.fillText(String(state.stage), STAGE_W / 2, 372);
  if (isChallengeStage(state.stage)) {
    ctx.fillStyle = BAND_COLOR.magenta;
    ctx.font = font(FONT.display, 34);
    ctx.fillText(CHALLENGE_BANNER, STAGE_W / 2, 452);
  }
  ctx.textAlign = "left";
}

function drawStageCleared(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.textAlign = "center";
  const challenge = isChallengeStage(state.stage);
  const perfect = challenge && state.challengeHits >= CHALLENGE_TOTAL;
  ctx.fillStyle = COLOR.text;
  ctx.font = font(FONT.display, 54);
  if (perfect) {
    ctx.fillStyle = COLOR.meterReady;
    ctx.fillText(PERFECT_TEXT, STAGE_W / 2, 300);
  } else if (challenge) {
    ctx.fillText("FLYOVER OVER", STAGE_W / 2, 290);
    ctx.fillStyle = COLOR.textDim;
    ctx.font = font(FONT.body, 22);
    ctx.fillText("DRONES DESTROYED", STAGE_W / 2, 348);
    ctx.fillStyle = COLOR.text;
    ctx.font = font(FONT.numeric, 60);
    ctx.fillText(String(state.challengeHits), STAGE_W / 2, 404);
    ctx.fillStyle = COLOR.textDim;
    ctx.font = font(FONT.body, 20);
    ctx.fillText(`OF ${CHALLENGE_TOTAL}`, STAGE_W / 2, 452);
  } else {
    ctx.fillText("STAGE CLEARED", STAGE_W / 2, 300);
    ctx.fillStyle = COLOR.meterFill;
    ctx.font = font(FONT.display, 30);
    ctx.fillText("BONUS 1000", STAGE_W / 2, 360);
  }
  ctx.textAlign = "left";
}

function drawGameOver(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  veil(ctx);
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.text;
  ctx.font = font(FONT.display, 66);
  ctx.fillText("GAME OVER", STAGE_W / 2, 190);
  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(FONT.body, 20);
  ctx.fillText("SCORE", STAGE_W / 2 - 150, 270);
  ctx.fillText(HUD_STAGE_LABEL, STAGE_W / 2 + 150, 270);
  ctx.fillStyle = COLOR.text;
  ctx.font = font(FONT.numeric, 44);
  ctx.fillText(String(state.score), STAGE_W / 2 - 150, 316);
  ctx.fillText(String(state.stage), STAGE_W / 2 + 150, 316);
  drawMenu(ctx, GAME_OVER_ITEMS, state.menuIndex, 430);
  ctx.textAlign = "left";
}

function drawMenuScreen(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  heading: string,
  items: readonly string[],
  _unused: readonly string[],
): void {
  veil(ctx);
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.text;
  ctx.font = font(FONT.display, 54);
  ctx.fillText(heading, STAGE_W / 2, 210);
  drawMenu(ctx, items, state.menuIndex, 320);
  ctx.textAlign = "left";
}

/** A banner over the field, for the ready hold. */
function drawBanner(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.text;
  ctx.font = font(FONT.display, 60);
  ctx.fillText(text, STAGE_W / 2, 360);
  ctx.textAlign = "left";
}

/**
 * A vertical menu, with the highlighted item drawn distinctly from the others so a
 * player always sees which item `confirm` would take.
 */
function drawMenu(
  ctx: CanvasRenderingContext2D,
  items: readonly string[],
  index: number,
  top: number,
): void {
  items.forEach((item, at) => {
    const highlighted = at === index;
    const y = top + at * 56;
    if (highlighted) {
      ctx.fillStyle = BAND_GLOW.cyan;
      ctx.fillRect(STAGE_W / 2 - 220, y - 24, 440, 48);
    }
    ctx.fillStyle = highlighted ? BAND_COLOR.cyan : COLOR.textDim;
    ctx.font = font(FONT.display, highlighted ? 34 : 30);
    ctx.fillText(item, STAGE_W / 2, y);
  });
}
