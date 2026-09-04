/**
 * Run shell commands in the workspace, which is the working directory.
 *
 * A non-zero exit is a result rather than a failure.
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
   * offloaded. An offloaded output that was cut ends with a note naming the two files that hold the
   * whole of it, and beneath each path the shape of that file: its line count, its 50th, 95th and
   * 99th-percentile line lengths, and the length and line number of its five longest lines.
   */
  output: string;

  /** Whether the ceiling cut `output`, dropping the head and keeping the tail. */
  truncated: boolean;
}

/**
 * Run a command with `sh -c` in the workspace and hand back its merged output.
 *
 * A non-zero exit is not a failure: `exitCode` on the result says whether the command succeeded,
 * and only a process that could not be launched, or one the timeout killed, throws.
 *
 * Where this run offloads shell output, `output` holds only the tail that fits and ends with a note
 * naming the two files the command's full stdout and stderr were written to, each with the shape of
 * what it holds: the line count, the 50th, 95th and 99th-percentile line lengths, and the five
 * longest lines by length and line number. Those files are readable by absolute path.
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
