import type { SpecificationManifest } from "@clockwyrks/run-record/test-suite";

import styles from "./suite-detail-pages.module.scss";

/**
 * The requirements one specification declares, in declaration order.
 *
 * Each is shown by the identity results record it under —
 * `<specification id>/<requirement id>` — with its `kind`, its RFC 2119
 * statement, and the validator module paths it claims. A non-functional
 * requirement claims none: it is graded by review rather than by a validator, so
 * the absence is stated rather than left blank.
 *
 * Shared by the Specifications tab, which lists a specification's requirements
 * under it, and the Test cases tab, which expands each definition's covered
 * specifications into the requirements the definition grades.
 */
export function SuiteRequirementList({
  specification,
}: {
  specification: SpecificationManifest;
}) {
  const requirements = specification.requirement ?? [];
  return requirements.length === 0 ? (
    <p className={styles.note}>
      {specification.name} declares no requirements.
    </p>
  ) : (
    <ul className={styles.requirements}>
      {requirements.map((requirement) => (
        <li key={requirement.id} className={styles.requirement}>
          <div className={styles.requirementHeader}>
            <span className={styles.requirementId}>
              {specification.id}/{requirement.id}
            </span>
            <span className={styles.badge} data-kind={requirement.kind}>
              {requirement.kind}
            </span>
          </div>
          <p className={styles.requirementText}>{requirement.text}</p>
          {requirement.validators && requirement.validators.length > 0 ? (
            <ul className={styles.validators}>
              {requirement.validators.map((path) => (
                <li key={path} className={styles.validator}>
                  {path}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.note}>
              No validators — decided by review rather than by a test result.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
