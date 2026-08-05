/**
 * The `context` family: managing the agent's own context window.
 *
 * These are the only tools whose effect is on the conversation rather than on the workspace. They
 * are worth calling from a program precisely because a program can decide *when* to: read a set of
 * files, extract what matters, then evict the views in the same turn.
 */

import * as raw from "test-cabinet:gg/context";
import { ToolError, U32_MAX, call, list, typeName, uint } from "../errors.js";
import type { ArchiveSearch, ReclaimReport, TurnRange } from "../types.js";

/**
 * Drop the contents of files you have read out of your context window, freeing the tokens they
 * occupy, and report what that reclaimed; omit `path` to drop every file view. The files on disk are
 * untouched — this forgets what you read, not what exists.
 *
 * @param path The file whose views to drop. Omit it to drop every file view you hold.
 */
export function evictFileView(path?: string): ReclaimReport {
  return call(() => raw.evictFileView(path));
}

/**
 * Move whole turns out of your context window and report what that reclaimed.
 *
 * Every result you are given carries a header with its turn number and roughly what holding it
 * costs, so name the turns worth dropping: `ranges` is a list of inclusive spans, and
 * `archiveThread([{ from: 4, to: 19 }])` archives turns 4 through 19. Your own messages in an
 * archived turn are dropped; the results are kept and stay searchable with `searchArchive`.
 *
 * @param ranges The inclusive spans of turn numbers to move out of your window.
 */
export function archiveThread(ranges: TurnRange[]): ReclaimReport {
  const spans = list<TurnRange>("archiveThread", "ranges", ranges).map((range) => {
    if (typeof range !== "object" || range === null) {
      throw new ToolError(
        "archiveThread",
        "invalid-argument",
        `every entry of \`ranges\` must be a { from, to } turn span, got ${typeName(range)}`,
      );
    }
    const from = uint("archiveThread", "ranges[].from", range.from, U32_MAX);
    const to = uint("archiveThread", "ranges[].to", range.to, U32_MAX);
    if (from === undefined || to === undefined) {
      throw new ToolError(
        "archiveThread",
        "invalid-argument",
        "every entry of `ranges` needs both `from` and `to`",
      );
    }
    // `from`/`to` on the way in, `start`/`end` across the membrane — `from` is a WIT keyword, and
    // the model-facing spelling is the one worth keeping.
    return { start: from, end: to };
  });
  return call(() => raw.archiveThread(spans));
}

/**
 * Search archived history for a case-insensitive substring, most recent first, up to 8 hits. Check
 * `archiveEmpty` before reading `hits`: it distinguishes "nothing has been archived yet" from "the
 * search ran and matched nothing", so you do not archive again believing the first archive failed.
 *
 * @param query The substring to look for. Matching is case-insensitive.
 */
export function searchArchive(query: string): ArchiveSearch {
  return call(() => raw.searchArchive(query));
}

/**
 * Compact your context window: the detailed thread is dropped and restarted from `summary`, plus a
 * fresh read of each path in `files`. Your skills, memories and task list are kept as they are. You
 * are asked to call this when your window is full, and every other call is refused until you do.
 *
 * It does NOT stop your program: it registers the request and returns, and the rewrite happens once
 * your program has ended. Everything not in your summary and not in `files` is gone, so write the
 * summary for your future self and name the files you will actually need in hand.
 *
 * @param summary What your restarted window opens with. Write it for your future self:
 * everything not in it and not re-read from `files` is gone.
 * @param files The paths to read afresh into the restarted window. Defaults to none.
 */
export function compact(summary: string, files: string[] = []): void {
  call(() => raw.compact(summary, files));
}
