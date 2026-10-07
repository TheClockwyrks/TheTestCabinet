/**
 * Save a blob to disk under `filename` by clicking a synthetic, object-URL-backed
 * download link. This is the shared path for every "download …" affordance in the
 * gallery, needing no file-system access beyond the browser's own download.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoke on the next tick so the click has a chance to claim the URL first;
    // revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
