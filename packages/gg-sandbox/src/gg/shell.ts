/**
 * Run shell commands in the workspace.
 *
 * One function, and the way a program reaches everything gg has no call of its own for: a build, a
 * test run, `git`, `curl`, a package manager. The workspace is the working directory.
 *
 * A non-zero exit is a *result* rather than a failure, because deciding whether a build or a test run
 * passed is the single most common thing a program does with one.
 */

import * as raw from "test-cabinet:gg/shell";
import { call, opts, positive } from "../internal/errors.js";

/** What a command reported when it finished. */
export interface ShellOutput {
  /** The process's exit status; `undefined` when a signal killed it. Zero means success. */
  exitCode: number | undefined;

  /**
   * Merged stdout then stderr, cut at the tail if it was too long.
   *
   * The ceiling is 16 KiB, or the run's configured line and character limits where shell output is
   * offloaded. Under the default adaptive mode a command that succeeded returns only the note naming
   * the files that hold the whole of it.
   */
  output: string;

  /** Whether the ceiling cut `output`, dropping the head and keeping the tail. */
  truncated: boolean;
}

/**
 * Run a command with `sh -c` in the workspace and hand back its merged output.
 *
 * A non-zero exit is not a failure: `exitCode` on the result is what says whether the command
 * succeeded, and only a process that could not be launched, or one the timeout killed, throws.
 *
 * This run may **offload** shell output. Under `offload`, `output` holds only the tail that fits and
 * ends with a note naming the two files the command's full stdout and stderr were written to. Under
 * `adaptive`, the default, a command that succeeded returns no output at all and only that note,
 * while one that failed returns the tail. Grepping the named files beats running the command again.
 *
 * @ggop shell.shell
 * @param command The command line, run by `sh -c` with the workspace as its working directory.
 * @param options How to run it.
 * @param options.timeoutSecs How long to let it run before killing it. The default is 120, clamped to
 * whatever is left of the run's wall-clock budget.
 * @returns the command's exit status and its merged output, whether or not it succeeded.
 * @throws `ApiError` with `limit-exceeded` when the timeout killed the process, and `io-error`
 * when it could not be launched at all.
 */
export function shell(command: string, options?: { timeoutSecs?: number }): ShellOutput {
  const o = opts<{ timeoutSecs?: number }>("shell", options);
  const timeoutSecs = positive("shell", "timeoutSecs", o?.timeoutSecs);
  return call(() => raw.shell(command, timeoutSecs));
}
