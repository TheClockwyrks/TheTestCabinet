//! The suite validator runner over a real Vitest, against a served build.
//!
//! The committed fixture version's validator project is the one The Spec Cabinet
//! generates — its `vitest.config.ts` and every module's `.test.ts` are held equal to
//! the generator's output by The Spec Cabinet's own tests — so running it here proves
//! the runner decides a draft authored in the app the way that app's verification
//! does: the project runs unchanged from the produced tree's root, loads the served
//! build into the document its tests run in, and reaches the debug API root through
//! the handle the runner names.
//!
//! Only the validator modules are replaced, with the conditions an author writes in
//! place of a created module's placeholder: one that does not hold against the
//! served build, and the rest that do.
//!
//! Vitest, `@vitest/browser-playwright` and Playwright's Chromium come from the
//! repository's npm workspace, found and checked by [`crate::test_browser`]. A
//! machine without them says so and skips, and one where `TCAB_REQUIRE_BROWSER=1`
//! says they are meant to be present fails instead, rather than reporting a pass it
//! did not earn.

use std::path::{Path, PathBuf};

use super::*;
use crate::test_browser;
use crate::test_suite::TestSuiteCatalog;

/// Copy a directory tree, so nothing is written into the committed fixture.
fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("the destination is created");
    for entry in std::fs::read_dir(from).expect("the source is readable") {
        let entry = entry.expect("the entry is readable");
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).expect("the file is copied");
        }
    }
}

/// Write `contents` at `relative` under `root`, creating its directories.
fn write(root: &Path, relative: &str, contents: &str) {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().expect("a parent")).expect("the directory is made");
    std::fs::write(path, contents).expect("the file is written");
}

/// A validator module whose one assertion is `condition`, read after placing the
/// ball at (3, 4).
fn validator(name: &str, assertion: &str, condition: &str) -> String {
    format!(
        "export default function {name}(debug: any) {{\n  \
         debug.ball.place({{ x: 3, y: 4 }});\n  \
         const state = debug.ball.state(0);\n  \
         return [{{ name: \"{assertion}\", passed: {condition}, detail: `the ball is at (${{state.x}}, ${{state.y}})` }}];\n\
         }}\n",
    )
}

#[test]
fn the_generated_project_decides_requirements_against_a_served_build() {
    let node_modules = match test_browser::browser_workspace(
        Path::new(env!("CARGO_MANIFEST_DIR")),
        &["vitest", "@vitest/browser-playwright"],
    ) {
        Ok(node_modules) => node_modules,
        Err(missing) => {
            test_browser::skip_without_browser(&missing);
            return;
        }
    };
    let scratch = tempfile::tempdir().expect("a temporary directory");

    let checkout = scratch.path().join("test-suites");
    copy_tree(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/testdata/test-suite"),
        &checkout,
    );
    let validators = checkout.join("carom/versions/v1.0.0/validators");
    for (module, name, assertion, condition) in [
        (
            "ball/constant-speed.ts",
            "constantSpeed",
            "the ball is where it was placed",
            "state.x === 3 && state.y === 4",
        ),
        (
            "ball/constant-speed-after-cushion.ts",
            "constantSpeedAfterCushion",
            "the table is in this document",
            "document.getElementById(\"table\") !== null",
        ),
        (
            "ball/constant-speed-after-pocket-rim.ts",
            "constantSpeedAfterPocketRim",
            "the ball's row is where it was placed",
            "state.y === 4",
        ),
        (
            "ball/cushion-reflection.ts",
            "cushionReflection",
            "the ball is somewhere it was not placed",
            "state.x === 99",
        ),
        (
            "ball/spin-decay.ts",
            "spinDecay",
            "the ball's column is where it was placed",
            "state.x === 3",
        ),
    ] {
        write(&validators, module, &validator(name, assertion, condition));
    }
    let materials = scratch.path().join("materials");
    let test_case = TestSuiteCatalog::with_materials(checkout, &materials)
        .resolve("carom", "v1.0.0", "end-to-end")
        .expect("the fixture definition resolves");

    // The tree a run collected: the model's install, and the static build it produced,
    // which sets the root once it has finished starting.
    let repo = scratch.path().join("impl");
    std::fs::create_dir_all(&repo).expect("the tree");
    std::os::unix::fs::symlink(&node_modules, repo.join("node_modules"))
        .expect("the tree's install");
    let output = repo.join("dist");
    write(
        &output,
        "index.html",
        "<!doctype html>\n<html>\n  <body>\n    <canvas id=\"table\"></canvas>\n    \
         <script type=\"module\" src=\"./assets/main.js\"></script>\n  </body>\n</html>\n",
    );
    write(
        &output,
        "assets/main.js",
        "const ball = { x: 0, y: 0 };\n\
         setTimeout(() => {\n  \
         globalThis.__carom = {\n    \
         ball: {\n      \
         state: () => ({ ...ball }),\n      \
         place: (position) => { ball.x = position.x; ball.y = position.y; },\n    \
         },\n  \
         };\n\
         }, 50);\n",
    );

    let outcomes = run_suite_validators(
        &test_case,
        &ArtifactCollection::new(repo.clone()),
        &output,
        "npm ci",
    );
    let outcome = |id: &str| {
        outcomes
            .iter()
            .find(|outcome| outcome.id == id)
            .unwrap_or_else(|| panic!("`{id}` is recorded: {outcomes:#?}"))
    };

    let constant_speed = outcome("ball-physics/constant-speed");
    assert_eq!(
        constant_speed.status,
        RequirementStatus::Passed,
        "{constant_speed:#?}"
    );
    assert_eq!(
        constant_speed.assertions.len(),
        3,
        "one assertion from each validator it claims: {constant_speed:#?}",
    );

    let cushion = outcome("ball-physics/cushion-reflection");
    assert_eq!(cushion.status, RequirementStatus::Failed, "{cushion:#?}");
    let detail = cushion.assertions[0].detail.as_deref().unwrap_or_default();
    assert!(
        detail.contains("the ball is at (3, 4)"),
        "the failure carries what the validator read from the build: {detail}",
    );

    let spin = outcome("ball-spin/spin-decay");
    assert_eq!(spin.status, RequirementStatus::Passed, "{spin:#?}");

    assert!(
        !repo.join(VALIDATORS_DIR).exists(),
        "the project is taken back out of the tree",
    );
}
