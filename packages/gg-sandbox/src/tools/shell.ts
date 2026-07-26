/**
 * The `shell` family: running commands in the workspace.
 *
 * The one behavioural rule worth stating twice is that a **non-zero exit is a success of the call**.
 * Checking whether a build or a test run passed is the most common thing a program does, so throwing
 * on it would make `shell` unusable inside an expression; only a process that could not be launched,
 * or one the timeout killed, throws.
 */

import * as raw from "test-cabinet:gg/shell";
import { call, opts, positive } from "../errors.js";
import type { ShellOutput } from "../types.js";

/**
 * Run a command with `sh -c` in the workspace directory and return its merged stdout and stderr. A
 * non-zero exit is NOT a failure — check `exitCode` on the result; only a process that could not be
 * launched, or one the timeout killed, throws. `timeoutSecs` defaults to 120 and is clamped to
 * whatever is left of the run's wall-clock budget.
 */
export function shell(command: string, options?: { timeoutSecs?: number }): ShellOutput {
  const o = opts<{ timeoutSecs?: number }>("shell", options);
  const timeoutSecs = positive("shell", "timeoutSecs", o?.timeoutSecs);
  return call(() => raw.shell(command, timeoutSecs));
}
