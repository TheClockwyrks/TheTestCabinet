/**
 * Manage the agent's own context window.
 *
 * These are the only calls whose effect is on the conversation rather than on the workspace, and they
 * are worth making from a program precisely because a program can decide *when*: read a set of files,
 * extract what matters, then evict the views, all in one turn.
 */

import * as raw from "test-cabinet:gg/context";
import { U32_MAX, arrayArg, call, typeName, uint } from "../internal/errors.js";
import { ApiError } from "./core.js";

/** What a reclaim actually freed from the live context window. */
export interface ReclaimReport {
  /** Context items dropped from the live window. */
  items: number;

  /** Approximately how many tokens that freed. */
  reclaimedTokens: number;

  /** The workspace paths whose views were evicted. Empty for an archive. */
  paths: string[];

  /** The prose summary of what was reclaimed. */
  detail: string;
}

/**
 * An inclusive span of turn numbers, which is the unit `archiveThread` moves out of the window.
 *
 * The numbers are the ones on the header of every result, so `{ from: 4, to: 19 }` means exactly the
 * turns numbered 4 through 19, both ends included.
 */
export interface TurnRange {
  /** The first turn in the span. */
  from: number;

  /** The last turn in the span, inclusive. */
  to: number;
}

/** One archived message that matched a search. */
export interface ArchiveHit {
  /** The archived message's sequence number. */
  seq: number;

  /** Who said it. */
  role: "system" | "user" | "assistant" | "tool";

  /** The message text. */
  text: string;
}

/** What a search of the archive found. */
export interface ArchiveSearch {
  /**
   * Whether nothing has been archived yet, so there was nothing to search.
   *
   * Deliberately distinct from a search that ran and matched nothing, so that an empty result is not
   * read as a first archive having failed.
   */
  archiveEmpty: boolean;

  /** The matches, most recent first, at most eight. */
  hits: ArchiveHit[];
}

/**
 * Drop the contents of files already read out of the context window.
 *
 * Omitting the path drops every file view. The files on disk are untouched: this forgets what was
 * read, not what exists.
 *
 * @ggop context.evict_file_view
 * @param path The file whose views to drop. Omit it to drop every file view held.
 * @returns what the eviction actually freed: the items dropped, the tokens they held, and the paths
 * they covered.
 * @throws `ApiError` with `invalid-argument` for an empty path — omitting it entirely is what
 * drops every file view.
 */
export function evictFileView(path?: string): ReclaimReport {
  return call(() => raw.evictFileView(path));
}

/**
 * Move whole turns out of the context window.
 *
 * Every result carries a header with its turn number and roughly what holding it costs, so the turns
 * worth dropping can be named: `ranges` is a list of inclusive spans, and one span of `{ from: 4, to:
 * 19 }` archives turns 4 through 19. The agent's own messages in an archived turn are dropped; the
 * results are kept and stay searchable with `searchArchive`.
 *
 * @ggop context.archive_thread
 * @param ranges The inclusive spans of turn numbers to move out of the window.
 * @returns what the archival actually freed: the items moved out and the tokens they held.
 * @throws `ApiError` with `invalid-argument` for an empty list, for more than 32 spans at once,
 * and for a span that ends before it starts.
 */
export function archiveThread(ranges: TurnRange[]): ReclaimReport {
  const spans = arrayArg<TurnRange>("archiveThread", "ranges", ranges).map((range) => {
    if (typeof range !== "object" || range === null) {
      throw new ApiError(
        "archiveThread",
        "invalid-argument",
        `every entry of \`ranges\` must be a { from, to } turn span, got ${typeName(range)}`,
      );
    }
    const from = uint("archiveThread", "ranges[].from", range.from, U32_MAX);
    const to = uint("archiveThread", "ranges[].to", range.to, U32_MAX);
    if (from === undefined || to === undefined) {
      throw new ApiError(
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
 * Search archived history for a case-insensitive substring, most recent first, up to eight hits.
 *
 * `archiveEmpty` on the result is worth checking before the hits: it distinguishes nothing having
 * been archived yet from a search that ran and matched nothing, so an empty answer is not read as a
 * failed archive.
 *
 * @ggop context.search_archive
 * @param query The substring to look for. Matching is case-insensitive.
 * @returns the matches, most recent first, beside the flag that says whether anything has been
 * archived at all.
 * @throws `ApiError` with `invalid-argument` for an empty query.
 */
export function searchArchive(query: string): ArchiveSearch {
  return call(() => raw.searchArchive(query));
}

/**
 * Request a compaction: the detailed thread is dropped and restarted from a summary and some files.
 *
 * Skills, memories and the task list are kept as they are. gg asks for this when the window is full,
 * and refuses every other call until it happens.
 *
 * It does not stop the program. The request is registered, the call returns, and the rewrite happens
 * once the program has ended — so everything not in the summary and not among the named files is
 * gone. The summary is worth writing for the agent that reads it next, which is this one.
 *
 * @ggop context.compact
 * @param summary What the restarted window opens with. Everything not in it, and not re-read from the
 * named files, is gone.
 * @param files The paths to read afresh into the restarted window. The default is none.
 * @throws `ApiError` with `invalid-argument` for a blank summary.
 */
export function compact(summary: string, files: string[] = []): void {
  call(() => raw.compact(summary, files));
}
