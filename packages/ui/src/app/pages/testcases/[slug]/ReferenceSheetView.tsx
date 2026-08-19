import { Panel } from "@test-cabinet/ui";
import type {
  ReferenceSheet,
  TestCaseDetail,
  VariantSummary,
} from "../../../data/testCases";
import { useGalleryData } from "../../../data/galleryContext";
// The very player the run Verdict tab animates a produced sheet with. It is data
// source agnostic — it takes an ordered list of per-frame image URLs — so the
// reference frames drive it unchanged, and a reference animates exactly the way the
// run it is compared against does.
import { SpriteSheetPlayer } from "../../runs/[runId]/SpriteSheetPlayer";
import styles from "./ReferenceSheetView.module.scss";

// The two files published per reference frame, relative to the variant's prefix in
// the snapshot bucket. These MIRROR the Rust helpers that write them —
// `reference_image_key` and `reference_actions_key` in
// `crates/core/src/asset_reference.rs` — and must change with them. The host's
// `referenceMediaUrl` prepends the `media/references/<slug>/<version>/<variant>/`
// prefix (see `referenceMediaKey` in packages/ui/src/transport/httpBackend.ts and
// the same reconstruction in apps/site/vite-plugin-snapshot.ts).
const frameImageFile = (index: number) => `frames/${index}.png`;
const frameActionsFile = (index: number) => `frames/${index}.actions.json`;

// A frame at its published index, resolved for display: the rendered image and the
// action log it was drawn from, each null when this host cannot serve it.
interface ReferenceFrame {
  index: number;
  imageUrl: string | null;
  actionsUrl: string | null;
}

// The fallback frame box when the case ships no `[sheet]` dimensions (a single
// sprite, or a host whose catalog omits the sheet). The player scales a frame up to
// roughly its own display box, so this only sets the aspect it is scaled within.
const FALLBACK_FRAME_SIZE = 64;

/**
 * An **asset-generation** case variant's reference implementation, rendered
 * natively on the case-detail Reference tab.
 *
 * This is the counterpart to {@link ReferencePlayable}: an end-to-end variant's
 * reference is a deployed site, so that one iframes it; an asset variant produces no
 * site at all, so there is nothing to embed — its reference is the set of rendered
 * frames plus the action log each was drawn from, published to the public snapshot
 * bucket. Those are shown here directly.
 *
 * The composition follows what an asset case is actually judged on. The named
 * sequences lead, animated, because motion is most of the verdict on a sprite sheet
 * and a wall of stills hides it. The individual frames follow, at crisp
 * nearest-neighbour scaling, for the per-frame detail an animation moves past. And
 * every frame links its action log, because the log — not the picture — is the
 * authoritative output a run is scored against, so a reference that showed only
 * pictures would omit the part that matters most.
 *
 * Degrades the way `ReferencePlayable` does: a host that cannot serve reference
 * media (no snapshot bucket configured) gets a short placeholder rather than a grid
 * of broken images.
 */
export function ReferenceSheetView({
  testCase,
  variant,
  referenceSheet,
}: {
  testCase: TestCaseDetail;
  variant: VariantSummary;
  /** The variant's published frame indices. */
  referenceSheet: ReferenceSheet;
}) {
  const { referenceMediaUrl } = useGalleryData();

  // The reference belongs to a case VERSION, and the catalog surfaces the newest
  // version's variants, so that is the version its objects were published under.
  const version = testCase.latestVersion;
  const resolve = (file: string): string | null =>
    referenceMediaUrl?.(testCase.slug, version, variant.slug, file) ?? null;

  const frames: ReferenceFrame[] = referenceSheet.frames.map((index) => ({
    index,
    imageUrl: resolve(frameImageFile(index)),
    actionsUrl: resolve(frameActionsFile(index)),
  }));

  // No servable image anywhere means this host has no reference media at all (it
  // supplies no resolver, or its backend reports no snapshot bucket) — not that the
  // reference is missing. Say so plainly instead of rendering empty boxes.
  if (!frames.some((frame) => frame.imageUrl)) {
    return (
      <Panel>
        <p className={styles.placeholder}>
          Reference frames for this variant are not available here.
        </p>
      </Panel>
    );
  }

  // The sheet spec is a property of the CASE (frame size + named sequences), so the
  // sequences are read from it rather than re-sent with the reference. A host whose
  // catalog omits it (an older static snapshot) simply shows the frames.
  const sheet = testCase.sheet ?? null;
  const published = new Set(frames.map((frame) => frame.index));
  const imageByIndex = new Map(
    frames.map((frame) => [frame.index, frame.imageUrl]),
  );
  // Only sequences with at least one published frame are worth a player; one with
  // none would animate an empty box.
  const sequences = (sheet?.sequences ?? []).filter((sequence) =>
    sequence.frames.some((index) => published.has(index)),
  );

  return (
    <div className={styles.stack}>
      {sequences.length > 0 && sheet && (
        <Panel>
          <h2 className={styles.heading}>Animated sequences</h2>
          <p className={styles.note}>
            Each named animation, played from the reference frames — the motion
            a run of this variant is judged against.
          </p>
          <div className={styles.sequenceGrid}>
            {sequences.map((sequence) => (
              <div key={sequence.slug} className={styles.sequenceRow}>
                <div className={styles.sequenceMeta}>
                  <span className={styles.sequenceName}>{sequence.name}</span>
                  <span className={styles.sequenceSub}>
                    {sequence.frames.length}{" "}
                    {sequence.frames.length === 1 ? "frame" : "frames"} @{" "}
                    {sequence.fps} fps
                  </span>
                </div>
                <div>
                  <SpriteSheetPlayer
                    label={sequence.name}
                    frameUrls={sequence.frames.map(
                      (index) => imageByIndex.get(index) ?? null,
                    )}
                    frameWidth={sheet.frameWidth}
                    frameHeight={sheet.frameHeight}
                    fps={sequence.fps}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel>
        <h2 className={styles.heading}>Reference frames</h2>
        <p className={styles.note}>
          Every published frame, and the recorded action log it was drawn from —
          the authoritative output, since a run is scored on the operations it
          issued, not just the pixels they produced.
        </p>
        <div className={styles.frameGrid}>
          {frames.map((frame) => (
            <figure key={frame.index} className={styles.frame}>
              {frame.imageUrl ? (
                <img
                  className={styles.frameImage}
                  src={frame.imageUrl}
                  alt={`Reference frame ${frame.index}`}
                  width={sheet?.frameWidth ?? FALLBACK_FRAME_SIZE}
                  height={sheet?.frameHeight ?? FALLBACK_FRAME_SIZE}
                />
              ) : (
                <div
                  className={`${styles.frameImage} ${styles.frameMissing}`}
                  aria-label={`Reference frame ${frame.index} unavailable`}
                >
                  not available
                </div>
              )}
              <figcaption className={styles.frameCaption}>
                <span>Frame {frame.index}</span>
                {frame.actionsUrl && (
                  <a
                    className={styles.frameLog}
                    href={frame.actionsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    log
                  </a>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      </Panel>
    </div>
  );
}
