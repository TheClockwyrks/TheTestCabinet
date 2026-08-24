/**
 * Read, write, edit, list and search the files of the workspace.
 *
 * Reading is the cheap direction of this sandbox and writing is the expensive one, so a program that
 * reads a dozen files to decide what to change is well shaped, while one that rewrites forty large
 * files in a single turn will exhaust its fuel budget.
 *
 * Nothing here places anything in the agent's context window: every call hands its answer to the
 * program, and a view is what puts something in front of the agent.
 */

import * as raw from "test-cabinet:gg/files";
import * as helpers from "test-cabinet:gg/helpers";
import { U32_MAX, call, opts, uint } from "../internal/errors.js";
import { asFileRead } from "../internal/lower.js";
import { ApiError } from "./core.js";

/** A text file's window, as the text arm of a `FileRead` carries it. */
export interface TextFile {
  /** Names this arm of `FileRead` as the text one. */
  kind: "text";

  /** The file's text, or just the requested window where the read named one. */
  contents: string;

  /** The 1-based first line returned. */
  firstLine: number;

  /** The 1-based last line returned. */
  lastLine: number;

  /** The file's total line count, which says whether to page again. */
  totalLines: number;

  /** Whether a 256 KiB byte ceiling cut the returned text. */
  byteTruncated: boolean;
}

/**
 * A picture's description, as the image arm of a `FileRead` carries it.
 *
 * The pixels never enter the program. `gg.views.openFile` is what attaches the picture to the turn to
 * be looked at, which is worth far more than base64 in a variable.
 */
export interface ImageFile {
  /** Names this arm of `FileRead` as the picture one. */
  kind: "image";

  /** The IANA media type: `image/png`, `image/jpeg`, `image/gif`, `image/webp`. */
  mediaType: string;

  /** The short format label: `PNG`, `JPEG`, `GIF`, `WebP`. */
  label: string;

  /** The file's size in bytes. */
  bytes: number;

  /** Whether the picture is being attached to this turn to be looked at. */
  shown: boolean;

  /** Why it is not being shown; `undefined` when it is. */
  notShownReason: string | undefined;
}

/**
 * What a read returned: a text file's window, or a picture's description.
 *
 * A picture is a different kind of thing from text, so it is a different arm rather than a string
 * that happens to be binary. The `kind` discriminant is what narrows it, and a program that treats an
 * image as text is caught by that check instead of silently writing an empty string somewhere.
 */
export type FileRead = TextFile | ImageFile;

/** What a directory entry is. */
export type EntryKind =
  /** An ordinary file. */
  | "file"
  /** A directory, which can be listed in turn. */
  | "directory"
  /** Everything that is neither, a symlink among them. */
  | "other";

/** One entry `listDir` found: a bare name, and its kind. */
export interface DirEntry {
  /** The entry's bare name, with no directory part. Join it with the directory that was listed. */
  name: string;

  /** What the entry is. */
  kind: EntryKind;
}

/** One line `search` matched: the file it is in, its 1-based line number, and the line itself. */
export interface SearchMatch {
  /** The file's path, relative to the workspace root, or absolute for a search rooted outside it. */
  path: string;

  /** The 1-based line number of the match within that file. */
  line: number;

  /**
   * The matching line, without its line ending.
   *
   * A line longer than 200 characters is cut there and annotated in place as `foo (123 more
   * chars...)`, so a match in a minified bundle costs a line rather than the bundle.
   */
  text: string;
}

/**
 * Read a file, as either a `TextFile` or an `ImageFile`.
 *
 * Which of the two comes back is detected from the file's bytes, never from the extension, so a
 * mislabelled picture is still a picture. The two are discriminated by `kind`, so an ordinary
 * narrowing separates them:
 *
 * ```
 * const read = gg.files.readFile("logo.png");
 * if (read.kind === "text") gg.views.openText("logo", read.contents);
 * else gg.views.openText("logo", read.label);
 * ```
 *
 * A relative path resolves against the workspace; an absolute one is read as given, so anything else
 * in this container — an offloaded command's output under `/tmp/gg-shell`, say — is readable. This
 * call hands bytes to the program and places nothing in the context window; reading a picture
 * describes it and shows nothing, so a file only read here is a file nobody has looked at.
 *
 * @ggop files.read_file
 * @param path The file to read, relative to the workspace or absolute.
 * @param options The window of lines to read; omit it to read the whole file.
 * @param options.offset The 1-based line to start at. Omitted, the read starts at the first line.
 * @param options.limit How many lines to return from `offset`. Omitted, a capped read policy's
 * default applies, or the read runs to the end of the file.
 * @returns the window of text that was read, or the picture's description where the bytes are an
 * image.
 * @throws `ApiError` with `invalid-argument` for an empty path, and `not-found` for a path that is
 * not there.
 */
export function readFile(path: string, options?: { offset?: number; limit?: number }): FileRead {
  const o = opts<{ offset?: number; limit?: number }>("readFile", options);
  const offset = uint("readFile", "offset", o?.offset, U32_MAX);
  const limit = uint("readFile", "limit", o?.limit, U32_MAX);
  return asFileRead(call(() => raw.readFile(path, offset, limit)));
}

/**
 * Read a text file and hand back its contents directly.
 *
 * `readFile` without the narrowing, for the common case: the same read, the same window, the same
 * cost.
 *
 * @ggop files.read_text_file
 * @param path The file to read, relative to the workspace or absolute.
 * @param options The window of lines to read; omit it to read the whole file.
 * @param options.offset The 1-based line to start at. Omitted, the read starts at the first line.
 * @param options.limit How many lines to return from `offset`. Omitted, a capped read policy's
 * default applies, or the read runs to the end of the file.
 * @returns the text that was read: the whole file, or the requested window.
 * @throws `ApiError` with `invalid-argument` when the path names a picture, which `readFile`
 * inspects instead and `gg.views.openFile` displays, and `not-found` for a path that is not there.
 */
export function readTextFile(path: string, options?: { offset?: number; limit?: number }): string {
  const o = opts<{ offset?: number; limit?: number }>("readTextFile", options);
  const offset = uint("readTextFile", "offset", o?.offset, U32_MAX);
  const limit = uint("readTextFile", "limit", o?.limit, U32_MAX);
  return call(() => helpers.readTextFile(path, offset, limit));
}

/**
 * Write UTF-8 text to a file, creating parent directories and replacing what is there.
 *
 * Writing is the expensive direction of this sandbox: rewriting more than a few dozen large files in
 * one program exhausts its fuel budget, so a large rewrite is best split across several turns.
 *
 * @ggop files.write_file
 * @param path Where to write, relative to the workspace or absolute. Parent directories are created.
 * @param contents The UTF-8 text to write. It replaces the file entirely.
 * @returns how many bytes were written, which is the length of `contents` in UTF-8.
 * @throws `ApiError` with `invalid-argument` for an empty path, and `io-error` when the write or a
 * parent directory failed.
 */
export function writeFile(path: string, contents: string): number {
  return Number(call(() => raw.writeFile(path, contents)));
}

/**
 * Replace the one exact occurrence of some text in a file with something else.
 *
 * Widening the surrounding context until the match is unique is the way to disambiguate; counting
 * occurrences is not.
 *
 * @ggop files.edit_file
 * @param path The file to edit.
 * @param oldString The exact text to find, whitespace included. It must appear exactly once.
 * @param newString The text to put in its place. An empty string deletes the match.
 * @throws `ApiError` with `not-found` when the text does not appear, and `conflict` — carrying the
 * number of matches — when it appears more than once.
 */
export function editFile(path: string, oldString: string, newString: string): void {
  call(() => raw.editFile(path, oldString, newString));
}

/**
 * List a directory, sorted by name; the default lists the workspace root.
 *
 * Each entry carries a bare `name` — join it with the directory that was listed — and its `kind`. An
 * empty directory is an empty array, not a failure.
 *
 * @ggop files.list_dir
 * @param path The directory to list, relative to the workspace or absolute. The default lists the
 * workspace root.
 * @returns the directory's entries, sorted by name.
 * @throws `ApiError` with `not-found` for a directory that is not there, and `invalid-argument`
 * for an empty path — omitting it entirely is what lists the workspace root.
 */
export function listDir(path?: string): DirEntry[] {
  return call(() => raw.listDir(path));
}

/**
 * Search the workspace's files for a pattern, skipping everything the ignore files exclude.
 *
 * A grep over the project rather than over the disk. `query` is a regular expression tried against
 * each line on its own, and every line it matches comes back with its path and 1-based line number,
 * in path order and then line order. What `.gitignore`, `.ignore` and their kin exclude — nested
 * files, negations and `.git/info/exclude` included, and `.git` itself — is never scanned and never
 * returned, in a workspace that is a repository and in one that is not yet, so a match list holds
 * the sources rather than `node_modules`, build output and the run's own bookkeeping. Dotfiles are
 * otherwise searched like any other file, and a file that is not text (one carrying a NUL byte) is
 * skipped rather than matched byte by byte.
 *
 * The result is bounded so one search cannot flood a turn: at most `limit` matches, 50 by default
 * and never more than 200, and a matching line longer than 200 characters is cut there and annotated
 * in place as `foo (123 more chars...)`. A list exactly `limit` long may have been cut, and there is
 * no offset — a search is a question about where to point the other calls, not a way of reading a
 * file — so the answer to a cut list is a narrower query or a narrower `path`.
 *
 * @ggop files.search
 * @param query The pattern to look for: a regular expression in Rust syntax — `foo|bar`,
 * `fn\s+update`, `(?i)todo` for a case-insensitive match — tried against each line on its own. It
 * may not be blank.
 * @param options Where to look and how many matches to return; omit it to search the whole
 * workspace.
 * @param options.path The directory to search under, or the one file to search, relative to the
 * workspace or absolute. Omitted, the search starts at the workspace root.
 * @param options.limit How many matches to return at most: 50 by default, and a request over 200 is
 * answered with the first 200. It may not be zero.
 * @returns every line the pattern matched, up to `limit`, in path order and then line order; empty
 * when nothing matched.
 * @throws `ApiError` with `invalid-argument` for a blank query, a pattern that does not parse, or a
 * `limit` of zero, and `not-found` for a `path` that is not there.
 */
export function search(query: string, options?: { path?: string; limit?: number }): SearchMatch[] {
  const o = opts<{ path?: string; limit?: number }>("search", options);
  const limit = uint("search", "limit", o?.limit, U32_MAX);
  if (limit === 0) {
    throw new ApiError("search", "invalid-argument", "`limit` must be at least 1, got 0");
  }
  return call(() => raw.search(query, o?.path, limit));
}
