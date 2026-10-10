import styles from "./suite-detail-pages.module.scss";
import { MediaView } from "../../../components/MediaView";
import { useGalleryData } from "../../../data/galleryContext";
import { showcaseMediaKind } from "../../../data/showcase-media-kind";
import { SuiteDetailLayout } from "../../../layouts/testsuites/suite-detail-layout";
import type { SuiteTabContext } from "../../../layouts/testsuites/suite-detail-layout";
import { Panel } from "@clockwyrks/ui";

// The Assets tab (`/test-cases/suites/:suiteSlug/assets`): the finished asset set
// the anchored version bundles — what an end-to-end run is seeded with, and what
// each of the suite's asset generation test cases targets.
//
// Each asset presents its id, display name, kind, the specification describing it
// and the files it declares. A `sprite` or `sprite-sheet` is previewed from its
// declared image files, served by the backend's suite asset route: those two
// kinds are pictures the browser renders directly, where the rest (a voxel model,
// a particle system, a score) need a runtime of their own and are named rather
// than staged.
export function SuiteAssetsPage() {
  return (
    <SuiteDetailLayout tab="assets">
      {(ctx) => <SuiteAssets {...ctx} />}
    </SuiteDetailLayout>
  );
}

/** The asset kinds this tab previews inline. */
const PREVIEWED = new Set(["sprite", "sprite-sheet"]);

function SuiteAssets({ slug, version, suite }: SuiteTabContext) {
  const { suiteAssetMediaUrl } = useGalleryData();

  return suite.assets.length === 0 ? (
    <Panel>
      <p className={styles.note}>This version bundles no assets.</p>
    </Panel>
  ) : (
    <div className={styles.stack}>
      {suite.assets.map((asset) => {
        const manifest = asset.manifest;
        const specification = suite.specifications.find(
          (spec) => spec.manifest.id === manifest.specification,
        );
        return (
          <Panel key={manifest.id}>
            <div className={styles.entryHeader}>
              <h2 className={styles.entryTitle}>{manifest.name}</h2>
              <span className={styles.badge}>{manifest.kind}</span>
            </div>
            <dl className={styles.facts}>
              <dt>Id</dt>
              <dd>{manifest.id}</dd>
              <dt>Specification</dt>
              <dd>
                {specification
                  ? `${specification.manifest.name} (${manifest.specification})`
                  : manifest.specification}
              </dd>
              <dt>Files</dt>
              <dd>
                <ul className={styles.files}>
                  {manifest.files.map((file) => (
                    <li key={file} className={styles.file}>
                      {file}
                    </li>
                  ))}
                </ul>
              </dd>
            </dl>
            {PREVIEWED.has(manifest.kind) && (
              <div className={styles.previews}>
                {manifest.files.map((file) => {
                  const kind = showcaseMediaKind(file);
                  const url = suiteAssetMediaUrl?.(
                    slug,
                    version,
                    manifest.id,
                    file,
                  );
                  // A host that serves no suite bytes, or a declared file that is
                  // no picture, is named above rather than staged as a broken
                  // viewer — the same degradation a showcase entry gets.
                  return kind !== "image" || !url ? null : (
                    <figure key={file} className={styles.preview}>
                      <MediaView kind={kind} url={url} alt={manifest.name} />
                      <figcaption className={styles.caption}>{file}</figcaption>
                    </figure>
                  );
                })}
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
