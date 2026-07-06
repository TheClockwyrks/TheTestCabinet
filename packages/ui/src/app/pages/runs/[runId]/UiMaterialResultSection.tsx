import { Suspense, lazy, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  type MaterialResultView,
  type UiElementView,
  type UiResultView,
} from "../../../data/galleryContext";
import { prefersReducedMotion, supportsWebGL } from "../../../components/webgl";
import styles from "./RunDetailPages.module.scss";

// `three` is heavy, so the lit material preview is split into its own chunk and only
// fetched when a WebGL-capable browser mounts it.
const MaterialPreview = lazy(() => import("./MaterialPreview"));

// A checkerboard backing so a transparent-margin UI element (or a map with alpha)
// reads clearly against the panel.
const CHECKER =
  "repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 16px 16px";

const ELEMENT_IMG: CSSProperties = {
  maxWidth: 240,
  maxHeight: 240,
  imageRendering: "pixelated",
  background: CHECKER,
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
  display: "block",
};

function UnavailableBox({ label }: { label: string }) {
  return (
    <div
      style={{
        width: 160,
        height: 160,
        background: CHECKER,
        border: "1px solid var(--tc-border, #444)",
        borderRadius: 4,
        display: "grid",
        placeItems: "center",
      }}
      aria-label={`${label} unavailable`}
    >
      <span className={styles.secondary}>not available</span>
    </div>
  );
}

/**
 * A nine-slice **stretch preview**: the element's art scaled to a larger box with its
 * declared insets held fixed, so a reviewer confirms the panel/button borders stay
 * crisp while the center stretches. Implemented with CSS `border-image`, which slices
 * and stretches exactly the nine-slice regions.
 */
function NineSliceStretch({
  url,
  nineSlice,
  width,
  height,
}: {
  url: string;
  nineSlice: NonNullable<UiElementView["nineSlice"]>;
  width: number;
  height: number;
}) {
  const { top, right, bottom, left } = nineSlice;
  // Stretch to roughly 1.7× wide and 1.4× tall (bounded) so the center visibly
  // scales while the fixed borders hold.
  const stretchW = Math.min(Math.round(width * 1.7), 360);
  const stretchH = Math.min(Math.round(height * 1.4), 260);
  const style: CSSProperties = {
    width: stretchW,
    height: stretchH,
    borderStyle: "solid",
    borderColor: "transparent",
    borderWidth: `${top}px ${right}px ${bottom}px ${left}px`,
    borderImageSource: `url("${url}")`,
    borderImageSlice: `${top} ${right} ${bottom} ${left} fill`,
    borderImageRepeat: "stretch",
    imageRendering: "pixelated",
    background: CHECKER,
    borderRadius: 4,
    boxSizing: "border-box",
  };
  return <div style={style} aria-label="Nine-slice stretch preview" />;
}

/** One UI element: its static art, its size/nine-slice readout, and (when the element
 * declares a nine-slice) its stretch preview beside the static art. */
function UiElement({ element }: { element: UiElementView }) {
  return (
    <div className={styles.sequenceRow}>
      <div className={styles.sequenceMeta}>
        <span className={styles.sequenceName}>{element.name}</span>
        <span className={styles.sequenceSub}>
          {element.width}×{element.height}
          {element.nineSlice ? " · nine-slice" : ""}
        </span>
        {element.detail ? (
          <span className={styles.secondary}>{element.detail}</span>
        ) : null}
      </div>
      <div
        style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}
      >
        {element.imageUrl ? (
          <figure style={{ margin: 0, textAlign: "center" }}>
            <img src={element.imageUrl} alt={element.name} style={ELEMENT_IMG} />
            <figcaption className={styles.sequenceSub} style={{ marginTop: 4 }}>
              static
            </figcaption>
          </figure>
        ) : (
          <UnavailableBox label={element.name} />
        )}
        {element.imageUrl && element.nineSlice ? (
          <figure style={{ margin: 0, textAlign: "center" }}>
            <NineSliceStretch
              url={element.imageUrl}
              nineSlice={element.nineSlice}
              width={element.width}
              height={element.height}
            />
            <figcaption className={styles.sequenceSub} style={{ marginTop: 4 }}>
              stretched
            </figcaption>
          </figure>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The generated-asset result for a `ui` asset-generation run: each emitted element's
 * flattened PNG (reviewed against the brief), and — for an element with an authored
 * nine-slice — a stretch preview confirming its borders scale cleanly. A `ui` run is
 * not regenerated; the emitted image is the scored artifact.
 *
 * Imported by {@link AssetResultSection}, which mounts it when the run carries
 * `validation.ui`.
 */
export function UiResultSection({ view }: { view: UiResultView }) {
  return (
    <>
      <h3 className={`${styles.section} ${styles.leadHeading}`}>UI elements</h3>
      <p className={styles.secondary}>
        Each element&rsquo;s emitted image is reviewed against the brief. An element
        with an authored nine-slice also shows a <strong>stretch preview</strong> so
        its borders can be checked as it scales.
      </p>
      <div className={styles.sequenceList}>
        {view.elements.map((element) => (
          <UiElement key={element.name} element={element} />
        ))}
      </div>
      {view.detail ? <p className={styles.secondary}>{view.detail}</p> : null}
    </>
  );
}

const MAP_THUMB: CSSProperties = {
  width: 120,
  height: 120,
  objectFit: "cover",
  imageRendering: "pixelated",
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
  display: "block",
};

const PREVIEW_SIZE = 320;
const PREVIEW_BOX: CSSProperties = {
  width: PREVIEW_SIZE,
  maxWidth: "100%",
  height: PREVIEW_SIZE,
  background: "var(--tc-panel-2, #1c1c1c)",
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
  overflow: "hidden",
};

/** The base-color map tiled **2×2** so any seam at the tile boundary shows — the
 * quickest read on whether a "seamless" material actually wraps. */
function TilingPreview({ url }: { url: string }) {
  return (
    <div
      aria-label="2×2 tiling"
      style={{
        width: PREVIEW_SIZE,
        maxWidth: "100%",
        height: PREVIEW_SIZE,
        backgroundImage: `url("${url}")`,
        backgroundRepeat: "repeat",
        backgroundSize: "50% 50%",
        imageRendering: "pixelated",
        border: "1px solid var(--tc-border, #444)",
        borderRadius: 4,
      }}
    />
  );
}

/** The lit 3D preview, guarded on WebGL — the lazy {@link MaterialPreview}, or the
 * 2×2 tiling as the static fallback where WebGL is unavailable. */
function LitPreview({ view }: { view: MaterialResultView }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(supportsWebGL() && !prefersReducedMotion());
  }, []);

  const fallback = view.baseColorUrl ? (
    <TilingPreview url={view.baseColorUrl} />
  ) : (
    <div style={{ ...PREVIEW_BOX, display: "grid", placeItems: "center" }}>
      <span className={styles.secondary}>not available</span>
    </div>
  );

  if (!enabled) return fallback;
  return (
    <div style={PREVIEW_BOX}>
      <Suspense fallback={fallback}>
        <MaterialPreview
          maps={view.maps}
          height={PREVIEW_SIZE}
          label="Lit material preview"
        />
      </Suspense>
    </div>
  );
}

/**
 * The generated-asset result for a `material` asset-generation run: the material shown
 * **per map**, as a **2×2 tiling** (so seams show), and on the **lit 3D preview** (the
 * material on a test surface, so it reads as it will on a mesh). A `material` run is
 * not regenerated; the emitted maps are the scored artifact.
 *
 * Imported by {@link AssetResultSection}, which mounts it when the run carries
 * `validation.material`.
 */
export function MaterialResultSection({ view }: { view: MaterialResultView }) {
  return (
    <>
      <h3 className={`${styles.section} ${styles.leadHeading}`}>PBR material</h3>
      <p className={styles.secondary}>
        {view.size}×{view.size} px maps
        {view.tiling !== null ? ` · tiling ${view.tiling}` : ""}. The material is
        judged per map, as a 2×2 tiling (so seams show), and on the lit 3D preview
        (drag to orbit).
      </p>
      <div
        style={{
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        <figure style={{ margin: 0, textAlign: "center" }}>
          <LitPreview view={view} />
          <figcaption className={styles.sequenceSub} style={{ marginTop: 6 }}>
            lit preview
          </figcaption>
        </figure>
        {view.baseColorUrl ? (
          <figure style={{ margin: 0, textAlign: "center" }}>
            <TilingPreview url={view.baseColorUrl} />
            <figcaption className={styles.sequenceSub} style={{ marginTop: 6 }}>
              2×2 tiling (base color)
            </figcaption>
          </figure>
        ) : null}
      </div>

      <h3 className={styles.section}>Maps</h3>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {view.maps.map((map) => (
          <figure key={map.name} style={{ margin: 0, textAlign: "center" }}>
            {map.imageUrl ? (
              <img src={map.imageUrl} alt={map.name} style={MAP_THUMB} />
            ) : (
              <UnavailableBox label={map.name} />
            )}
            <figcaption className={styles.sequenceSub} style={{ marginTop: 4 }}>
              {map.name}
              <br />
              <span className={styles.secondary}>{map.colorSpace}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      {view.detail ? <p className={styles.secondary}>{view.detail}</p> : null}
    </>
  );
}
