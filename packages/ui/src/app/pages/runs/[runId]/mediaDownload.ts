import { downloadBlob } from "./download";
import type { MediaKind } from "../../../../client/types";

/** Which side of a reference-vs-run pair a download comes from. */
export type PaneSide = "reference" | "run";

/** A filesystem-friendly stem for one side of a validation output: the output's
 * name slugged and the side appended, so the two files of a pair sort together
 * and never overwrite each other (`serve-still-reference`, `serve-still-run`). */
export function paneFileStem(name: string, side: PaneSide): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "output"}-${side}`;
}

/** File extensions by the MIME types the validators' media come in. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/** The extension a downloaded file should carry: from the blob's type where the
 * server said one, else from the URL's path, else a sensible default for the
 * kind of media it is. */
export function mediaExtension(
  type: string,
  url: string,
  kind: MediaKind,
): string {
  const known = EXTENSION_BY_TYPE[type.split(";")[0]!.trim().toLowerCase()];
  if (known) return known;
  const path = (() => {
    try {
      return new URL(url, "https://example.invalid/").pathname;
    } catch {
      return url;
    }
  })();
  const match = /\.([a-z0-9]{1,5})$/i.exec(path);
  if (match) return match[1]!.toLowerCase();
  return kind === "video" ? "webm" : "png";
}

/**
 * Save the image or clip at `url` under `stem` with the right extension. The
 * bytes are fetched and saved as they are — nothing is re-encoded — so the file
 * the reviewer gets is exactly what the validator captured.
 */
export async function downloadMediaFile(
  url: string,
  kind: MediaKind,
  stem: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`The download failed (${response.status}).`);
  }
  const blob = await response.blob();
  // The served Content-Type is the authority on what the bytes are; the blob's
  // own type is what the browser made of it, which is usually the same and is
  // sometimes blank.
  const type = response.headers.get("content-type") ?? blob.type;
  downloadBlob(blob, `${stem}.${mediaExtension(type, url, kind)}`);
}
