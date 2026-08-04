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
 *
 * It is also not a **wrapper written here**, though it reads like one and once was. It calls its own
 * host import, because a helper composed in the guest out of `readFile` is invisible to the host:
 * gg would see the read and record it under the name the model did not write, while `readTextFile`
 * itself reported a zero — a page telling its reader the model ignored a call it in fact used. The
 * shared core lives on the far side of the membrane, where sharing a core costs nothing.
 */

import * as raw from "test-cabinet:gg/helpers";
import { U32_MAX, call, opts, uint } from "./errors.js";

/**
 * Read a text file and return its contents directly — `readFile` without the variant
 * narrowing, for the common case. Takes the same `offset`/`limit` window options. Throws
 * `invalid-argument` when the path names a picture; use `readFile` to inspect those.
 */
export function readTextFile(
  path: string,
  options?: { offset?: number; limit?: number },
): string {
  const o = opts<{ offset?: number; limit?: number }>("readTextFile", options);
  const offset = uint("readTextFile", "offset", o?.offset, U32_MAX);
  const limit = uint("readTextFile", "limit", o?.limit, U32_MAX);
  return call(() => raw.readTextFile(path, offset, limit));
}
