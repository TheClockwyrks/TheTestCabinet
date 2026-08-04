/**
 * The one helper bound alongside the tools.
 *
 * Exactly one, deliberately. Reading a file's text is the single most common thing a program does,
 * and forcing a variant narrowing on it (`const r = readFile(p); if (r.kind !== "text") …`) is
 * friction on the hot path. Everything else a "standard library" might add is another name in the
 * system prompt and another thing for a model to get wrong, so nothing else is added here.
 *
 * A helper is not a tool: it is catalogued separately, so it cannot perturb the one-to-one
 * correspondence between the guest's bound names and gg's `ALL_TOOL_NAMES`, and it is bound into a
 * program's scope only when the tool it is built on is enabled.
 */

import { ToolError } from "./errors.js";
import { readFile } from "./tools/files.js";

/**
 * Read a text file and return its contents directly — `readFile` without the variant
 * narrowing, for the common case. Takes the same `offset`/`limit` window options. Throws
 * `invalid-argument` when the path names a picture; use `readFile` to inspect those.
 */
export function readTextFile(
  path: string,
  options?: { offset?: number; limit?: number },
): string {
  const read = readFile(path, options);
  if (read.kind !== "text") {
    throw new ToolError(
      "read_file",
      "invalid-argument",
      `\`${path}\` is a ${read.label} image, not text`,
    );
  }
  return read.contents;
}
