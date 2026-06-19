import type { MediaKind } from "../../client/types";
import styles from "./MediaView.module.scss";

// Render a piece of reference or proof media — an image or a video — by its kind.
// A video is shown with native controls; an image fills the available width and
// keeps its aspect ratio. Used for the expected/submitted panes in the review
// flow and the standalone Proof and References views.
export function MediaView({
  kind,
  url,
  alt,
}: {
  kind: MediaKind;
  url: string;
  alt: string;
}) {
  if (kind === "video") {
    return <video className={styles.media} src={url} controls playsInline />;
  }
  return <img className={styles.media} src={url} alt={alt} loading="lazy" />;
}
