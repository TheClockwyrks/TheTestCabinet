/**
 * Read, write, edit, list, walk and search the files of the workspace.
 *
 * Every call here hands its answer to the program and places nothing in the context window.
 */

import * as raw from "test-cabinet:gg/files";
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
 * The pixels never enter the program: `gg.views.openFile` is what shows the picture itself.
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
 * The `kind` discriminant narrows it to one arm.
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
   * chars...)`.
   */
  text: string;
}

/**
 * Read a file, as either a `TextFile` or an `ImageFile`.
 *
 * Which of the two comes back is detected from the file's bytes, never from the extension, so a
 * mislabelled picture is still a picture. The two are discriminated by `kind`.
 *
 * A relative path resolves against the workspace; an absolute one is read as given, so a file
 * elsewhere in the container — an offloaded command's output under `/tmp/gg-shell` — is readable.
 * The bytes go to the program and nothing is placed in the context window: reading a picture
 * describes it and shows nothing.
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
 * Write UTF-8 text to a file, creating parent directories and replacing what is there.
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
 * Render the tree beneath a directory, skipping everything the ignore files exclude.
 *
 * One block of text: the root itself unnamed, each level indented two further spaces than its
 * parent, every level in path order, and directories suffixed `/`. A root with nothing beneath it
 * renders as `(empty directory)`.
 *
 * `depth` counts levels of children below the root, so `1` is the root's own entries. A directory
 * sitting at the bound is suffixed with how many entries it holds that were not walked, as
 * `assets/ (12 entries not shown)`.
 *
 * What `.gitignore`, `.ignore` and their kin exclude — nested files, negations and
 * `.git/info/exclude` included, and `.git` itself — is never walked and never rendered, in a
 * workspace that is a repository and in one that is not yet. Dotfiles are otherwise rendered like
 * any other entry, and symbolic links are not followed.
 *
 * The rendering is bounded at 1000 lines and 16 KiB, whichever binds first, and a result cut by
 * either ends with a line saying so.
 *
 * @ggop files.tree
 * @param options Where to root the tree and how deep to walk it; omit it for the workspace root at
 * depth 2.
 * @param options.path The directory to walk, relative to the workspace or absolute. Omitted, the
 * tree starts at the workspace root.
 * @param options.depth How many levels of children below the root to render: 2 by default, and a
 * request over 10 is answered at 10. It may not be zero.
 * @returns the rendered tree.
 * @throws `ApiError` with `not-found` for a `path` that is not there, and `invalid-argument` for a
 * `path` that is not a directory or a `depth` of zero.
 */
export function tree(options?: { path?: string; depth?: number }): string {
  const o = opts<{ path?: string; depth?: number }>("tree", options);
  const depth = uint("tree", "depth", o?.depth, U32_MAX);
  if (depth === 0) {
    throw new ApiError("tree", "invalid-argument", "`depth` must be at least 1, got 0");
  }
  return call(() => raw.tree(o?.path, depth));
}

/**
 * Search the workspace's files for a pattern, skipping everything the ignore files exclude.
 *
 * A grep over the project rather than over the disk. `query` is a regular expression tried against
 * each line on its own, and every line it matches comes back with its path and 1-based line number,
 * in path order and then line order. What
 * `.gitignore`, `.ignore` and their kin exclude — nested files, negations and `.git/info/exclude`
 * included, and `.git` itself — is never scanned and never returned, in a workspace that is a
 * repository and in one that is not yet. Dotfiles are otherwise searched like any other file, and a
 * file carrying a NUL byte is skipped.
 *
 * At most `limit` matches come back, 50 by default and never more than 200, and a matching line
 * longer than 200 characters is cut there and annotated in place as `foo (123 more chars...)`. A
 * list exactly `limit` long may have been cut. There is no offset.
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
