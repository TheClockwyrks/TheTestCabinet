import type { Ref } from "react";
import type { MediaKind } from "../../client/types";
import styles from "./MediaView.module.scss";

// Render a piece of reference or proof media — an image or a video — by its kind.
// A video is shown with native controls; an image fills the available width and
// keeps its aspect ratio. Used for the expected/submitted panes in the review
// flow and the standalone Proof and References views.
//
// A video optionally takes `loop`/`muted` and a `videoRef`, so a caller pairing
// two clips (the automated-validation actual-vs-baseline comparison) can loop them
// and drive both from one control by holding a ref to each element. These are
// inert for an image.
export function MediaView({
  kind,
  url,
  alt,
  loop,
  muted,
  videoRef,
}: {
  kind: MediaKind;
  url: string;
  alt: string;
  loop?: boolean;
  muted?: boolean;
  videoRef?: Ref<HTMLVideoElement>;
}) {
  if (kind === "video") {
    return (
      <video
        ref={videoRef}
        className={styles.media}
        src={url}
        controls
        playsInline
        loop={loop}
        muted={muted}
      />
    );
  }
  return <img className={styles.media} src={url} alt={alt} loading="lazy" />;
}
