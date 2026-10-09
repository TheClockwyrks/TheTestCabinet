import type { StoredSuite } from "@clockwyrks/backend-api";
import type { SuiteTestCaseDefinition } from "@clockwyrks/run-record/test-suite";
import { Link } from "react-router";

import styles from "./suite-detail-pages.module.scss";
import { SuiteRequirementList } from "./suite-requirement-list";
import { engineName } from "../../../data/engines";
import { useGalleryData } from "../../../data/galleryContext";
import { SuiteDetailLayout } from "../../../layouts/testsuites/suite-detail-layout";
import { routes } from "../../../routes";
import { Panel } from "@clockwyrks/ui";

// The Test cases tab (`/test-cases/suites/:suiteSlug/definitions`): the
// definitions the anchored version offers — the individually runnable segments of
// the suite — each expanded into exactly what it grades.
//
// A definition shows its display name, type and difficulty, and the
// specifications it covers expanded into the requirements those specifications
// hold, because "this definition grades these requirements" is the fact a reader
// comes here for and the ids alone do not state it. A code-producing definition
// also shows the engines a run may select from; an asset-producing one shows the
// asset its type table targets.
//
// Each definition links to the test case it was ingested as, which is how a
// reader moves from the definition to its runs in one step.
export function SuiteDefinitionsPage() {
  return (
    <SuiteDetailLayout tab="definitions">
      {({ suite }) => <Definitions suite={suite} />}
    </SuiteDetailLayout>
  );
}

/** The asset a definition targets, read off the one type table its type
 * declares: every asset-producing type owns a table named for the type, and each
 * carries the `id` of an asset under `assets/`. Null for a definition whose type
 * produces code rather than an asset. */
function targetAsset(
  definition: SuiteTestCaseDefinition,
): { id: string; note: string | null } | null {
  if (definition.sprite) {
    return {
      id: definition.sprite.id,
      note: definition.sprite.sheet ? "sprite sheet" : null,
    };
  }
  if (definition.voxel) {
    return {
      id: definition.voxel.id,
      note: definition.voxel.animated ? "rigid-body animation" : null,
    };
  }
  const asset =
    definition.blender ??
    definition.particle ??
    definition.music ??
    definition["audio-fx"];
  return asset ? { id: asset.id, note: null } : null;
}

function Definitions({ suite }: { suite: StoredSuite }) {
  const { testCases, testCasesStatus } = useGalleryData();
  const catalog = new Set(testCases.map((entry) => entry.slug));

  return suite.testCases.length === 0 ? (
    <Panel>
      <p className={styles.note}>This version offers no test cases.</p>
    </Panel>
  ) : (
    <div className={styles.stack}>
      {suite.testCases.map((entry) => {
        const definition = entry.definition;
        const engines = definition.engines ?? [];
        const asset = targetAsset(definition);
        // An omitted `specifications` key covers EVERY specification in the
        // suite, which is not the same value as an empty list — so the key's
        // absence is expanded here rather than read as "none".
        const covered =
          definition.specifications ??
          suite.specifications.map((spec) => spec.manifest.id);
        // A definition is ingested under a catalog identity; whether the catalog
        // holds it is what decides between the link and the note. The link stands
        // while the catalog is still being read or could not be read at all —
        // saying the case is absent is a claim only a settled read supports.
        const ingested = catalog.has(entry.id) || testCasesStatus !== "ready";
        return (
          <Panel key={entry.slug}>
            <div className={styles.entryHeader}>
              <h2 className={styles.entryTitle}>{definition.name}</h2>
              <span className={styles.badge}>{definition.type}</span>
              <span className={styles.badge} data-level={definition.difficulty}>
                {definition.difficulty}
              </span>
            </div>
            <dl className={styles.facts}>
              <dt>Definition</dt>
              <dd>{entry.slug}</dd>
              <dt>Test case</dt>
              <dd>
                {ingested ? (
                  <Link to={routes.testCaseDetail(entry.id)}>{entry.id}</Link>
                ) : (
                  <span className={styles.note}>
                    {entry.id} is not in this deployment&apos;s catalog.
                  </span>
                )}
              </dd>
              {engines.length > 0 && (
                <>
                  <dt>Engines</dt>
                  <dd>{engines.map((slug) => engineName(slug)).join(", ")}</dd>
                </>
              )}
              {asset && (
                <>
                  <dt>Asset</dt>
                  <dd>
                    {asset.id}
                    {asset.note && (
                      <span className={styles.note}> ({asset.note})</span>
                    )}
                  </dd>
                </>
              )}
            </dl>
            <h3 className={styles.entryTitle}>What it grades</h3>
            {covered.length === 0 ? (
              <p className={styles.note}>
                This definition covers no specifications.
              </p>
            ) : (
              covered.map((id) => {
                const spec = suite.specifications.find(
                  (candidate) => candidate.manifest.id === id,
                );
                return spec ? (
                  <section key={id} className={styles.covered}>
                    <h4 className={styles.entrySubtitle}>
                      {spec.manifest.name}{" "}
                      <span className={styles.note}>({id})</span>
                    </h4>
                    <SuiteRequirementList specification={spec.manifest} />
                  </section>
                ) : (
                  <p key={id} className={styles.note}>
                    {id} is not declared by this version.
                  </p>
                );
              })
            )}
          </Panel>
        );
      })}
    </div>
  );
}
