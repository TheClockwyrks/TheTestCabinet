// The per-tick axis controller of `specs/program.md`, and the acceleration it
// reports to the inertial loads of `specs/statics.md`.

import {
  GRIP_ACCEL,
  GRIP_MAX_RATE,
  HOIST_ACCEL,
  HOIST_MAX_RATE,
  HOIST_START,
  SLEW_ACCEL,
  SLEW_MAX_RATE,
  TICK_HZ,
  TROLLEY_ACCEL,
  TROLLEY_MAX_RATE,
} from "../constants";
import type { AxisName, AxisState } from "./types";

/** A tick covers `1 / TICK_HZ` seconds. */
export const DT = 1 / TICK_HZ;

export interface AxisSpec {
  readonly maxRate: number;
  readonly accel: number;
}

export const AXES: Readonly<Record<AxisName, AxisSpec>> = {
  slew: { maxRate: SLEW_MAX_RATE, accel: SLEW_ACCEL },
  trolley: { maxRate: TROLLEY_MAX_RATE, accel: TROLLEY_ACCEL },
  hoist: { maxRate: HOIST_MAX_RATE, accel: HOIST_ACCEL },
  grip: { maxRate: GRIP_MAX_RATE, accel: GRIP_ACCEL },
};

export const AXIS_NAMES: readonly AxisName[] = [
  "slew",
  "trolley",
  "hoist",
  "grip",
];

/** Whether a string names an axis, for reading posed or stored data. */
export function isAxisName(name: string): name is AxisName {
  return (
    name === "slew" || name === "trolley" || name === "hoist" || name === "grip"
  );
}

/** The run-start posture `specs/program.md` fixes. */
export function startingAxes(): Record<AxisName, AxisState> {
  return {
    slew: { value: 0, rate: 0, command: null },
    trolley: { value: 0, rate: 0, command: null },
    hoist: { value: HOIST_START, rate: 0, command: null },
    grip: { value: 0, rate: 0, command: null },
  };
}

export interface AxisStep {
  readonly state: AxisState;
  /** What the inertial loads read: the controller's own term for the tick. */
  readonly accel: number;
  /** Whether this tick is the one the command arrived on. */
  readonly arrived: boolean;
}

/**
 * Advance one axis by a tick.
 *
 * `s` is the sign of the distance to go at the TOP of the tick, and the arrival
 * test reads that same `s` against the advanced value. A command whose target is
 * the axis's current value therefore has `s` of `0`: nothing moves and the
 * command is done on the tick it is issued.
 *
 * The reported acceleration: a tick that arrives reports `0`, whether it braked
 * or drove on the way in; otherwise a braking tick reports `-s * a`, a driving
 * tick that changed the rate reports `+s * a`, and a cruising tick, one whose
 * clamp left the rate as it was, reports `0`. An axis with no live command
 * reports `0` and holds its value with zero rate.
 */
export function stepAxis(axis: AxisState, name: AxisName): AxisStep {
  if (!axis.command) {
    return {
      state: { value: axis.value, rate: 0, command: null },
      accel: 0,
      arrived: false,
    };
  }
  const { target, rate: commandedRate } = axis.command;
  const accel = AXES[name].accel;
  const d = target - axis.value;
  const s = Math.sign(d);
  let v = axis.rate;
  let reported = 0;
  if (v * s > 0 && Math.abs(d) <= (v * v) / (2 * accel)) {
    v = v - s * accel * DT;
    reported = -s * accel;
  } else {
    const next = Math.min(
      commandedRate,
      Math.max(-commandedRate, v + s * accel * DT),
    );
    reported = next !== v ? s * accel : 0;
    v = next;
  }
  let value = axis.value + v * DT;
  if (s * (target - value) <= 0) {
    value = target;
    return {
      state: { value, rate: 0, command: null },
      accel: 0,
      arrived: true,
    };
  }
  return {
    state: { value, rate: v, command: axis.command },
    accel: reported,
    arrived: false,
  };
}
