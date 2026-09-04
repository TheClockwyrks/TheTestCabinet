// Spectra — how a drone behaves, whatever kind it is (`specs/swarm.md`).
//
// A drone is always in exactly one of four phases, and each phase is a rule this
// file runs: `entering` flies it in from above toward its slot, `formation`
// holds it in that slot riding the sway, `diving` runs an attack down the field,
// and `returning` brings it home.
//
// EVERY PATH IS FLOWN AT ITS OWN SPEED, EXACTLY. A phase moves the drone by
// `speed * h` along a UNIT direction recomputed from the field each sub-step, so
// the path length over an interval is the speed times that interval whatever the
// path curves through, which is what `specs/swarm.md` states an entrance and a
// dive travel at. The curve comes from steering rather than from a slower or a
// faster stretch: the direction is the one that points at the path's aim,
// rotated aside by a term that decays or oscillates, so a path bends without a
// single unit of its length going missing. Nothing is integrated outside the
// sub-step loop and nothing about a path is remembered between frames — a
// direction is a function of the drone's own declared fields, the wave's clocks
// and the ship's position — so a posed drone flies exactly as one the game
// brought in.
//
// A DIVE PURSUES THE SHIP. Its aim point is the ship's current `x` with a weave
// laid over it, so a dive closes on the ship rather than running a fixed track
// while staying wide enough to dodge. Where a dive ENDS is fixed per drone: a
// Prism always presses on to `PRISM_INVERT_Y` and inverts the field there
// (`specs/drones.md`), and a Shard or a Flux either turns back above
// `FIELD_BOTTOM` or wraps through it, by the parity of its own id, so both
// endings `specs/swarm.md` allows are flown.

import {
  DIVE_FIRE_Y,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  DIVE_SPEED,
  ENEMY_BULLET_SPEED,
  ENTER_GROUP_GAP,
  ENTER_SPEED,
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FORM_CENTER_X,
  INVERSION_TIME,
  PRISM_INVERT_Y,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxWindow,
  isChallengeStage,
  swayOffset,
} from "./constants";
import { isShimmering, opposite } from "./bands";
import { CHALLENGE_MARGIN } from "./waves";
import { randomBetween, randomIndex, takeId } from "./entities";
import type { FrameEvents } from "./events";
import type { Band, DroneState, SpectraState } from "./game";

/** How long a dive may run before the drone is sent home regardless. */
const DIVE_MAX_TIME = 8;

/** How long a returning drone has to reach its slot before it is placed there. */
const RETURN_MAX_TIME = 4;

/** How far aside a dive's steering swings, as the tangent of the angle. */
const DIVE_WEAVE = 0.85;

/** How long one weave takes. */
const DIVE_WEAVE_PERIOD = 1.7;

/**
 * The entrance's two legs.
 *
 * A drone sweeps down INTO the field first, aiming at a waypoint out to its own
 * side and well down the play field, and only then climbs back to its slot, so
 * the entrance reads as the swoop `specs/swarm.md` allows — "the path may cross
 * the upper field and curve back" — rather than as a straight drop onto the
 * block. It also keeps an entrance a second and a half of flying at the very
 * least, which is what makes an entrance something a player watches arrive.
 *
 * `ENTER_LEG` is how long the first leg aims at the waypoint and `ENTER_BLEND`
 * how long the aim takes to slide from the waypoint onto the slot, so the turn is
 * a curve rather than a corner.
 */
const ENTER_DEEP = 440;
const ENTER_BOW = 150;
const ENTER_LEG = 1.3;
const ENTER_BLEND = 0.5;

/** How far aside an entrance's steering starts, as the tangent of the angle. */
const ENTER_SWIRL = 0.5;

/** How far below the field a wrapping dive aims. */
const DIVE_DEPTH_WRAP = FIELD_BOTTOM + 60;

/**
 * How far above `FIELD_TOP` a wrapped dive re-appears.
 *
 * `specs/swarm.md` puts the drone back ABOVE the field rather than on its top
 * edge, so the wrap reads as the one discontinuity it is: the drone leaves below
 * `FIELD_BOTTOM` and comes back in from over the top strip, the same way it
 * arrived when the wave opened.
 */
const WRAP_ABOVE = 24;

/** How far down the field a looping dive turns back. */
const DIVE_DEPTH_LOOP = 612;

/** How far past the field's side a challenge drone travels before it is gone. */
const CHALLENGE_EXIT = CHALLENGE_MARGIN + 40;

/** How far a challenge sweep bends off the horizontal, in radians. */
const CHALLENGE_BEND = 0.36;

/** How long one bend of a challenge sweep takes. */
const CHALLENGE_BEND_PERIOD = 2.4;

/** How fast anything a wave sends travels at `stage`, per `specs/stages.md`. */
export function waveSpeedScale(stage: number): number {
  // A challenge stage does not scale: whatever stage it falls on, it runs at the
  // stage-1 figures.
  return isChallengeStage(stage) ? 1 : droneSpeedScale(stage);
}

/** How fast enemy fire falls at `stage`. */
export function waveBulletScale(stage: number): number {
  return isChallengeStage(stage) ? 1 : bulletSpeedScale(stage);
}

/** The centre of the drone's slot at this instant, sway included. */
export function slotPoint(
  drone: Pick<DroneState, "slotX" | "slotY">,
  swayClock: number,
): { x: number; y: number } {
  return { x: drone.slotX + swayOffset(swayClock), y: drone.slotY };
}

/**
 * Carry `drone` `distance` units along the direction that points at `(tx, ty)`,
 * turned aside by `lateral` — the tangent of the angle it is turned by, positive
 * to the direction's right — and report whether it arrived.
 *
 * The direction is a unit vector whatever `lateral` is, because the aim's own
 * unit vector and its perpendicular are orthogonal, so the whole of `distance`
 * is travelled every time. Arriving is only possible on a straight run at the
 * aim: a path still steering aside is still on its way.
 */
function steer(
  drone: DroneState,
  tx: number,
  ty: number,
  lateral: number,
  distance: number,
): boolean {
  const dx = tx - drone.x;
  const dy = ty - drone.y;
  const span = Math.hypot(dx, dy);
  if (span <= 1e-9) return true;
  if (lateral === 0 && span <= distance) {
    drone.x = tx;
    drone.y = ty;
    return true;
  }
  const ux = dx / span;
  const uy = dy / span;
  const scale = distance / Math.hypot(1, lateral);
  drone.x += (ux - lateral * uy) * scale;
  drone.y += (uy + lateral * ux) * scale;
  return false;
}

/** Put the drone into `phase`, from the beginning of that phase's own path. */
function enterPhase(drone: DroneState, phase: DroneState["phase"]): void {
  drone.phase = phase;
  drone.phaseClock = 0;
  drone.shotsFired = 0;
}

/** Whether the wave has released the drone's entry group yet. */
function released(state: SpectraState, drone: DroneState): boolean {
  // A drone under way is under way: its own clock has started, and turning the
  // wave's entry off leaves it flying its path as usual.
  if (drone.phaseClock > 0) return true;
  return (
    state.waveEntry && state.entryClock >= ENTER_GROUP_GAP * drone.entryGroup
  );
}

/** One sub-step of a drone flying its entrance toward its slot. */
function stepEntering(state: SpectraState, drone: DroneState, h: number): void {
  if (isChallengeStage(state.stage)) {
    stepChallengeSweep(state, drone, h);
    return;
  }
  drone.phaseClock += h;
  const slot = slotPoint(drone, state.swayClock);
  const side = drone.slotX < FORM_CENTER_X ? -1 : 1;

  // The aim slides from the waypoint the first leg sweeps down to onto the slot
  // itself, so the two legs meet as one curve.
  const onto = Math.min(
    1,
    Math.max(0, (drone.phaseClock - ENTER_LEG) / ENTER_BLEND),
  );
  const aimX = (1 - onto) * (drone.slotX + side * ENTER_BOW) + onto * slot.x;
  const aimY = (1 - onto) * ENTER_DEEP + onto * slot.y;
  // A swirl that decays over the first leg, so the sweep reads as a bank rather
  // than as a straight run at the waypoint.
  const lateral =
    ENTER_SWIRL * side * (1 - Math.min(1, drone.phaseClock / ENTER_LEG));
  const arrived = steer(
    drone,
    aimX,
    aimY,
    lateral,
    ENTER_SPEED * waveSpeedScale(state.stage) * h,
  );
  if (arrived && onto >= 1) enterPhase(drone, "formation");
}

/** One sub-step of a challenge drone sweeping across the field. */
function stepChallengeSweep(
  state: SpectraState,
  drone: DroneState,
  h: number,
): void {
  drone.phaseClock += h;
  const rightward = drone.slotX < FIELD_LEFT;
  const bend =
    CHALLENGE_BEND *
    Math.sin((2 * Math.PI * drone.phaseClock) / CHALLENGE_BEND_PERIOD);
  const speed = ENTER_SPEED * waveSpeedScale(state.stage) * h;
  drone.x += (rightward ? 1 : -1) * Math.cos(bend) * speed;
  drone.y += Math.sin(bend) * speed;
}

/** One sub-step of a drone resting in its slot, riding the sway. */
function stepFormation(
  state: SpectraState,
  drone: DroneState,
  h: number,
): void {
  drone.phaseClock += h;
  const slot = slotPoint(drone, state.swayClock);
  drone.x = slot.x;
  drone.y = slot.y;
}

/** How far down the field this drone's dive presses. */
function diveDepth(drone: DroneState): number {
  if (drone.kind === "prism") return DIVE_DEPTH_WRAP;
  return drone.id % 2 === 0 ? DIVE_DEPTH_WRAP : DIVE_DEPTH_LOOP;
}

/** One sub-step of a drone on its attack run. */
function stepDiving(
  state: SpectraState,
  drone: DroneState,
  h: number,
  events: FrameEvents,
): void {
  drone.phaseClock += h;
  const before = drone.y;
  // The run aims at the ship's own lane position, so it closes on the ship
  // rather than running a fixed track, and weaves either side of that line so it
  // stays wide enough to dodge.
  const weave =
    DIVE_WEAVE * Math.sin((2 * Math.PI * drone.phaseClock) / DIVE_WEAVE_PERIOD);
  steer(
    drone,
    state.ship.x,
    diveDepth(drone),
    weave,
    DIVE_SPEED * waveSpeedScale(state.stage) * h,
  );
  drone.x = Math.max(FIELD_LEFT + 8, Math.min(FIELD_RIGHT - 8, drone.x));

  fireOnDive(state, drone);

  // A Prism that reaches its line swaps the whole field's bands and turns for
  // home, unharmed by the crossing (`specs/drones.md`). A Prism on the field
  // always has a layer standing, so a crossing always inverts.
  if (
    drone.kind === "prism" &&
    before < PRISM_INVERT_Y &&
    drone.y >= PRISM_INVERT_Y
  ) {
    state.inversion = INVERSION_TIME;
    events.cues.add("inversion");
    enterPhase(drone, "returning");
    return;
  }

  if (drone.y > FIELD_BOTTOM) {
    // The one discontinuity a dive may hold: out through the bottom and back in
    // above the top, where the run ends and the drone turns for its slot.
    drone.y -= FIELD_BOTTOM - FIELD_TOP + WRAP_ABOVE;
    enterPhase(drone, "returning");
    return;
  }
  if (drone.y >= DIVE_DEPTH_LOOP && diveDepth(drone) === DIVE_DEPTH_LOOP) {
    enterPhase(drone, "returning");
    return;
  }
  if (drone.phaseClock >= DIVE_MAX_TIME) enterPhase(drone, "returning");
}

/** One sub-step of a drone travelling back to its slot after a dive. */
function stepReturning(
  state: SpectraState,
  drone: DroneState,
  h: number,
): void {
  drone.phaseClock += h;
  const slot = slotPoint(drone, state.swayClock);
  const arrived = steer(
    drone,
    slot.x,
    slot.y,
    0,
    DIVE_SPEED * waveSpeedScale(state.stage) * h,
  );
  if (arrived || drone.phaseClock >= RETURN_MAX_TIME) {
    drone.x = slot.x;
    drone.y = slot.y;
    enterPhase(drone, "formation");
  }
}

/** Put one enemy bullet on the field, fired by `drone` and carrying `band`. */
function fireBullet(state: SpectraState, drone: DroneState, band: Band): void {
  state.bullets.push({
    id: takeId(state),
    x: drone.x,
    y: drone.y,
    vx: 0,
    vy: ENEMY_BULLET_SPEED * waveBulletScale(state.stage),
    band,
    friendly: false,
  });
}

/**
 * The shots a dive carries (`specs/swarm.md`, `specs/drones.md`).
 *
 * A diver takes its first shot in the sub-step its centre first crosses
 * `DIVE_FIRE_Y` travelling downward. A Shard and a Flux take one shot over the
 * dive and a Prism takes two, fired together, one carrying each band, so it
 * threatens the ship whichever band the ship is tuned to. A shimmering Flux
 * fires nothing: it takes its shot as soon as it settles on a band, if it is
 * still diving.
 */
function fireOnDive(state: SpectraState, drone: DroneState): void {
  if (!drone.fire) return;
  // No drone fires in a challenge stage, and no enemy bullet appears in one.
  if (isChallengeStage(state.stage)) return;
  if (drone.y < DIVE_FIRE_Y) return;
  if (drone.shotsFired > 0) return;
  if (drone.kind === "flux") {
    if (isShimmering(drone, state.stage)) return;
    fireBullet(state, drone, drone.band);
    drone.shotsFired = 1;
    return;
  }
  if (drone.kind === "prism") {
    fireBullet(state, drone, drone.band);
    fireBullet(state, drone, opposite(drone.band));
    drone.shotsFired = 2;
    return;
  }
  fireBullet(state, drone, drone.band);
  drone.shotsFired = 1;
}

/** A Flux's band window: the clock runs, and the band flips at the window's end. */
function stepOscillation(
  state: SpectraState,
  drone: DroneState,
  h: number,
): void {
  if (drone.kind !== "flux" || !drone.oscillation) return;
  drone.bandClock += h;
  if (drone.bandClock >= fluxWindow(state.stage)) {
    drone.band = opposite(drone.band);
    drone.bandClock = 0;
  }
}

/** Whether the drone has travelled off the field for good. */
function gone(state: SpectraState, drone: DroneState): boolean {
  if (!isChallengeStage(state.stage)) return false;
  if (drone.phase !== "entering") return false;
  return (
    drone.x > FIELD_RIGHT + CHALLENGE_EXIT ||
    drone.x < FIELD_LEFT - CHALLENGE_EXIT
  );
}

/** One sub-step of the whole swarm: every drone's clock, path and fire. */
export function stepSwarm(
  state: SpectraState,
  h: number,
  events: FrameEvents,
): void {
  for (const drone of state.drones) {
    stepOscillation(state, drone, h);
    if (!drone.travel) {
      // The travel gate holds the drone's LOCOMOTION alone
      // (`specs/instrumentation.md`): its band clock, above, and its firing,
      // here, run on exactly as they would have.
      if (drone.phase === "diving") fireOnDive(state, drone);
      continue;
    }
    switch (drone.phase) {
      case "entering":
        if (released(state, drone)) stepEntering(state, drone, h);
        break;
      case "formation":
        stepFormation(state, drone, h);
        break;
      case "diving":
        stepDiving(state, drone, h, events);
        break;
      case "returning":
        stepReturning(state, drone, h);
        break;
    }
  }
  const left = state.drones.filter((drone) => gone(state, drone)).length;
  if (left > 0) {
    state.drones = state.drones.filter((drone) => !gone(state, drone));
    events.dronesRemoved += left;
  }
}

/**
 * The wave's own dive launching (`specs/swarm.md`).
 *
 * The clock advances only while dive launching runs, and a launch takes one
 * drone resting in the formation, chosen from the game's own generator. The
 * first launch of a wave waits `DIVE_FIRST_DELAY`; each later one waits a fresh
 * draw between `DIVE_GAP_MIN` and `DIVE_GAP_MAX`, scaled for the stage.
 */
export function stepDiveLaunching(state: SpectraState, h: number): void {
  if (!state.diveLaunching) return;
  state.diveClock += h;
  if (state.diveClock < state.diveTarget) return;
  const resting = state.drones.filter((drone) => drone.phase === "formation");
  if (resting.length === 0) return;
  const chosen = resting[randomIndex(state, resting.length)];
  if (chosen === undefined) return;
  enterPhase(chosen, "diving");
  state.diveClock = 0;
  state.diveTarget =
    randomBetween(state, DIVE_GAP_MIN, DIVE_GAP_MAX) *
    diveGapScale(state.stage);
}
