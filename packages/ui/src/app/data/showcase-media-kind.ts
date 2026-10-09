import type { MediaKind } from "../../client/types";

// Extension → media kind, the contract's own mapping. Mirrors
// `MediaKind::from_path` in `crates/contracts/src/test_case.rs`, which is what the run
// and case showcases are given their `kind` by before they reach the wire.
const BY_EXTENSION: Record<string, MediaKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  webm: "video",
  mp4: "video",
  json: "replay",
};

/**
 * The kind of media a showcase file name names, or null for a name that is none
 * of a supported image, video, or engine recording.
 *
 * A suite's showcase carousel is served as the authored `showcase.toml` — the
 * shared showcase format, which carries a file and a caption and no kind — so a
 * suite surface infers the kind the same way the capture of a run's showcase
 * does, by the extension. A recording is stored gzipped and so carries two
 * extensions, which is why the compound suffix is matched against the whole name
 * before the single extension is consulted at all.
 */
export function showcaseMediaKind(file: string): MediaKind | null {
  const name = file.toLowerCase();
  if (name.endsWith(".json.gz") && name.length > ".json.gz".length) {
    return "replay";
  }
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? null : (BY_EXTENSION[name.slice(dot + 1)] ?? null);
}
