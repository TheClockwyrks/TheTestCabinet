// Which of a test suite asset's declared files the console can play, one asset
// kind at a time. Kept apart from the viewer component itself, so the question is
// answered the same way by the viewer and by a page deciding whether to list the
// files instead.

/** The asset kinds a suite declares, as `asset.toml` spells them. */
export type SuiteAssetPreviewKind =
  | "sprite"
  | "sprite-sheet"
  | "voxel"
  | "blender"
  | "particle"
  | "music"
  | "audio-fx";

/** The extensions each previewable family is recognized by. */
const IMAGE = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const MESH = [".glb", ".gltf"];
const AUDIO = [".wav", ".mp3", ".ogg", ".m4a", ".flac"];

/** What each kind's viewer reads: the extensions it plays. Stated once, because
 * the question "is there anything to play here" is asked both by this component
 * and by a caller deciding whether to say there is not. */
const COVERS: Record<SuiteAssetPreviewKind, readonly string[]> = {
  sprite: IMAGE,
  "sprite-sheet": IMAGE,
  voxel: MESH,
  blender: MESH,
  particle: [".json"],
  music: AUDIO,
  "audio-fx": AUDIO,
};

/**
 * The declared files a kind's viewer covers, in declaration order.
 *
 * Empty means there is nothing here to play: the asset's files are listed instead,
 * which is the whole of what there is to show of them. A caller saying so renders
 * this against the files that are actually on disk.
 */
export function previewedFiles(
  kind: SuiteAssetPreviewKind,
  files: readonly string[],
): string[] {
  const suffixes = COVERS[kind];
  return files.filter((file) => {
    const name = file.toLowerCase();
    return suffixes.some((suffix) => name.endsWith(suffix));
  });
}
