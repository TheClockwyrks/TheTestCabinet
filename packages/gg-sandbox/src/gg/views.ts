/**
 * Show a file, a value, or an entry's documentation in the context window.
 *
 * Everything opened here arrives on the next turn, never the one that opened it.
 */

import * as raw from "test-cabinet:gg/views";
import { DOCS_NAME } from "../catalogue.js";
import { U32_MAX, call, opts, typeName, uint } from "../internal/errors.js";
import { ApiError } from "./core.js";
import { asFileRead } from "../internal/lower.js";
import type { FileRead } from "./files.js";

/**
 * Read a file and show it in the context window.
 *
 * An image file is shown as a picture; a text file is shown as the window of lines that was read.
 * Two pages of one file are two views that coexist, and re-opening the same page replaces what it
 * showed.
 *
 * The view's text is held to a 65,536-byte cap: a window that would carry more is refused, naming
 * the size and the bound, and nothing is opened. Nothing is truncated silently. A picture is bounded
 * by gg's image cap alone.
 *
 * @ggop views.open_file
 * @param path The file to open, relative to the workspace or absolute.
 * @param options The window of lines to show, and how long a shown line may be; omit it to show the
 * whole file with its lines whole.
 * @param options.offset The 1-based line to start at. Omitted, the view starts at the first line.
 * @param options.limit How many lines to show from `offset`. Omitted, a capped read policy's
 * default applies, or the view runs to the end of the file. Both are honoured under every read
 * policy.
 * @param options.maxLineChars The longest a line of the view may be, in characters. Set, each line
 * longer than it is cut there and annotated in place as `foo (123 more chars...)`; omitted, lines
 * arrive whole. It cuts the view alone: the returned value and the file itself are unchanged. The
 * byte cap is measured after the cut. It must be between 1 and 65,536.
 * @returns the window of text that was read, or the picture's description where the bytes are an
 * image.
 * @throws `ApiError` with `not-found` for a path that is not there, `limit-exceeded`, naming the
 * size and the bound, for a window whose text would be over the cap, and `invalid-argument` for a
 * `maxLineChars` of zero or over 65,536. Nothing is opened when the read fails.
 */
export function openFile(
  path: string,
  options?: { offset?: number; limit?: number; maxLineChars?: number },
): FileRead {
  const o = opts<{ offset?: number; limit?: number; maxLineChars?: number }>("openFile", options);
  const offset = uint("openFile", "offset", o?.offset, U32_MAX);
  const limit = uint("openFile", "limit", o?.limit, U32_MAX);
  const maxLineChars = uint("openFile", "maxLineChars", o?.maxLineChars, U32_MAX);
  return asFileRead(call(() => raw.openFileView(path, offset, limit, maxLineChars)));
}

/**
 * Show a value the program computed in the context window, filed under a label.
 *
 * Opening the same label again replaces what it showed. An empty body is allowed; an empty label is
 * not.
 *
 * @ggop views.open_text
 * @param label What the view is filed under, and what opening the same label again replaces. It may
 * not be empty.
 * @param body What to show. An empty body is allowed.
 * @throws `ApiError` with `invalid-argument` for an empty label, and `limit-exceeded`, naming the
 * cap, when a body or a label is over gg's ceilings. Nothing is truncated silently.
 */
export function openText(label: string, body: string): void {
  call(() => raw.openTextView(label, body));
}

/**
 * Show one module, function or type's full documentation: signature, description and types.
 *
 * Only the types it names that have not already been shown this session are appended. The
 * documentation arrives in the next prompt under a `Documentation` heading and is not available in
 * the turn that asked for it. Opening an entry that is already open does nothing.
 *
 * @ggop views.open_docs_view
 * @param target What to document: a bound function itself, or the entry's name as a string — a
 * module's name is its own path, as in `gg.views`.
 * @throws `ApiError` with `not-found` for an unknown or unbound name, and `invalid-argument` for an
 * argument that is neither a function nor a string.
 */
export function openDocsView(target: Function | string): void {
  call(() => raw.openDocsView(docsName(target)));
}

/**
 * The catalogue name behind an `openDocsView` argument: the string itself, or the
 * {@link DOCS_NAME} tag on the function.
 *
 * A bare `String(fn)` would give the source of the wrapper rather than the name gg knows it by,
 * which is why the tag exists at all. A function that carries no tag — something the program defined
 * itself — falls through to its own `name`, so the lookup fails as `not-found` on a name the model
 * can recognise rather than on a stringified closure.
 *
 * An argument that is neither is refused **here**, before the lookup, and that is the point.
 * `openDocsView(gg.shell.run)` — a function this run does not bind — evaluates to `undefined` long
 * before the call, and coercing it produced a lookup for a function literally named `"undefined"`,
 * reported back as an unknown name. The name was never the model's; nothing it wrote said
 * `undefined`, and telling it so sends it looking for a typo that is not there. So a value that does
 * not exist is reported as documentation that does not exist, and a value of the wrong type is
 * reported as the type it was.
 *
 * @internal
 */
function docsName(target: Function | string): string {
  if (typeof target === "string") return target;
  if (typeof target !== "function") {
    throw new ApiError(
      "openDocsView",
      "invalid-argument",
      target === undefined || target === null
        ? "no documentation found"
        : `expected a function or function name, got ${typeName(target)}`,
    );
  }
  const tagged = (target as unknown as Record<symbol, unknown>)[DOCS_NAME];
  return typeof tagged === "string" ? tagged : String(target.name);
}

/**
 * Close every view carrying a selector.
 *
 * For a file that is every page of that path, for a text view the one with that label, and for the
 * results of a search the label `search results`. Documentation views are not closed by this call.
 * Closing a selector that is not open is not a failure.
 *
 * Closing a file view forgets what was read, not what exists. Closing a text view discards the only
 * copy of what it held.
 *
 * @ggop views.close
 * @param selector What the view is filed under: a file's path, a text view's label, or `search
 * results`.
 * @returns how many views were closed, which is zero when the selector named nothing open.
 * @throws `ApiError` with `invalid-argument` for an empty selector, and `unavailable` when this run
 * did not enable `agent-managed-context`.
 */
export function close(selector: string): number {
  // A `u32`, so already a `number` — no `bigint` conversion is needed here.
  return call(() => raw.closeView(selector));
}
