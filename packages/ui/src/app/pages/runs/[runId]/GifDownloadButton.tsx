import { useEffect, useRef, useState } from "react";
import { downloadBlob } from "./download";
import styles from "./RunDetailPages.module.scss";

/**
 * A button that runs an async encoder to build a GIF blob and saves it as
 * `filename`. Shared by the animation previews (sprite-sheet today, voxel next):
 * the caller supplies *how* to build the blob, this owns the busy/error UX and
 * the download itself. Encoding can be slow (loading frames, quantizing), so the
 * button disables while it runs and reports a failed encode instead of silently
 * doing nothing — a dead-looking button is a feature that may as well not exist.
 */
export function GifDownloadButton({
  filename,
  encode,
  disabled = false,
}: {
  /** The download's suggested filename, e.g. `walk.gif`. */
  filename: string;
  /** Builds the GIF blob when the button is pressed. */
  encode: () => Promise<Blob>;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  // Encoding can outlive the row (a reviewer clicks, then navigates away), so
  // don't set state after unmount.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onClick = async () => {
    if (status === "working") return;
    setStatus("working");
    try {
      const blob = await encode();
      downloadBlob(blob, filename);
      if (mounted.current) setStatus("idle");
    } catch (error) {
      console.error("GIF export failed", error);
      if (mounted.current) setStatus("error");
    }
  };

  return (
    <button
      type="button"
      className={styles.gifDownloadButton}
      onClick={onClick}
      disabled={disabled || status === "working"}
      aria-busy={status === "working"}
    >
      {status === "working"
        ? "Preparing GIF…"
        : status === "error"
          ? "Failed — retry"
          : "Download GIF"}
    </button>
  );
}
