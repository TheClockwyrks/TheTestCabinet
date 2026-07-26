/**
 * The `context` family: managing the agent's own context window.
 *
 * These are the only tools whose effect is on the conversation rather than on the workspace. They
 * are worth calling from a program precisely because a program can decide *when* to: read a set of
 * files, extract what matters, then evict the views in the same turn.
 */

import * as raw from "test-cabinet:gg/context";
import { U32_MAX, call, uint } from "../errors.js";
import type { ArchiveSearch, ReclaimReport } from "../types.js";

/**
 * Drop the contents of files you have read out of your context window, freeing the tokens they
 * occupy, and report what that reclaimed; omit `path` to drop every file view. The files on disk are
 * untouched — this forgets what you read, not what exists.
 */
export function evictFileView(path?: string): ReclaimReport {
  return call(() => raw.evictFileView(path));
}

/**
 * Move older thread history out of your context window, keeping the most recent turns (default 1),
 * and report what that reclaimed. Archived history stays searchable with `searchArchive`.
 */
export function archiveThread(keepRecentTurns?: number): ReclaimReport {
  const keep = uint("archiveThread", "keepRecentTurns", keepRecentTurns, U32_MAX);
  return call(() => raw.archiveThread(keep));
}

/**
 * Search archived history for a case-insensitive substring, most recent first, up to 8 hits. Check
 * `archiveEmpty` before reading `hits`: it distinguishes "nothing has been archived yet" from "the
 * search ran and matched nothing", so you do not archive again believing the first archive failed.
 */
export function searchArchive(query: string): ArchiveSearch {
  return call(() => raw.searchArchive(query));
}
