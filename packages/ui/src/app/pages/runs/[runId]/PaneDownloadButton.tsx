import { useEffect, useRef, useState } from "react";
import { DownloadIcon } from "../../../components/DownloadIcon";
import styles from "../RunExec.module.scss";

/**
 * The icon-only download control beside a validation pane's name. The caller
 * supplies *how* the download happens — fetching a captured image or clip, or
 * rendering a replay to a clip — and this owns the busy/error state and its
 * accessible name. A replay export runs for as long as the recording does, so
 * the control stays visibly busy rather than looking like a click that did
 * nothing, and a failed export says so on hover instead of silently giving up.
 *
 * The state belongs to one side of one output: a caller keys the control on
 * that side's URL, so stepping to another item (whose output ids may collide
 * with this one's and reuse the pair's elements) starts from an idle control
 * rather than inheriting a failure or a still-running export.
 */
export function PaneDownloadButton({
  label,
  download,
  disabled = false,
}: {
  /** The accessible name and idle hover text, e.g. `Download reference`. */
  label: string;
  /** Performs the download when pressed. */
  download: () => Promise<void>;
  /** Nothing to download yet (a replay still loading, a side that was never
   * produced). */
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  // A replay export can outlive the control (a reviewer clicks, then steps to
  // the next item, which remounts it under a new key), so never set state after
  // unmount.
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
      await download();
      if (mounted.current) setStatus("idle");
    } catch (error) {
      console.error("Download failed", error);
      if (mounted.current) setStatus("error");
    }
  };

  const title =
    status === "working"
      ? "Preparing the download…"
      : status === "error"
        ? "The download failed. Click to retry."
        : label;
  return (
    <button
      type="button"
      className={styles.mediaPaneDownload}
      onClick={onClick}
      disabled={disabled || status === "working"}
      aria-busy={status === "working"}
      aria-label={label}
      title={title}
      data-status={status}
    >
      {status === "working" ? (
        <span className={styles.mediaPaneDownloadBusy} aria-hidden="true" />
      ) : (
        <DownloadIcon className={styles.mediaPaneDownloadIcon} />
      )}
    </button>
  );
}
