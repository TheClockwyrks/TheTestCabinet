//! The lockfile check: how the script's report is read, and what the script itself
//! decides about a tree.
//!
//! The script tests need the host's `node`; they skip with a message when there is
//! none rather than failing, so a machine without one still runs the rest.

use std::path::Path;

use super::*;

fn node_available() -> bool {
    which::which("node").is_ok()
}

fn write_lockfile(repo: &Path, packages: serde_json::Value) {
    let lock = serde_json::json!({
        "name": "fixture",
        "lockfileVersion": 3,
        "packages": packages,
    });
    std::fs::write(
        repo.join("package-lock.json"),
        serde_json::to_string(&lock).expect("json"),
    )
    .expect("write lockfile");
}

#[test]
fn a_report_of_a_checked_tree_lists_what_is_missing() {
    assert_eq!(
        parse_report(r#"{"checked":true,"missing":["node_modules/a","node_modules/b"]}"#),
        LockfileCheck::Checked {
            missing: vec!["node_modules/a".to_string(), "node_modules/b".to_string()]
        }
    );
    let complete = parse_report("{\"checked\":true,\"missing\":[]}\n");
    assert_eq!(
        complete,
        LockfileCheck::Checked {
            missing: Vec::new()
        }
    );
    assert!(!complete.found_missing());
    assert!(complete.missing().is_empty());
}

#[test]
fn a_report_of_an_uncheckable_tree_carries_its_reason() {
    let check = parse_report(r#"{"checked":false,"reason":"no package-lock.json in the tree"}"#);
    assert_eq!(
        check,
        LockfileCheck::NotChecked {
            reason: "no package-lock.json in the tree".to_string()
        }
    );
    assert!(!check.found_missing());
    assert!(check.missing().is_empty());
}

#[test]
fn anything_but_the_report_reads_as_not_checked() {
    assert!(matches!(parse_report(""), LockfileCheck::NotChecked { .. }));
    assert!(matches!(
        parse_report("   \n"),
        LockfileCheck::NotChecked { .. }
    ));
    let garbage = parse_report("node: bad option: --frobnicate");
    match garbage {
        LockfileCheck::NotChecked { reason } => {
            assert!(reason.contains("--frobnicate"), "{reason}")
        }
        other => panic!("{other:?}"),
    }
    // The report is the last line; a tool that shared stdout does not confuse it.
    assert_eq!(
        parse_report("some earlier noise\n{\"checked\":true,\"missing\":[]}"),
        LockfileCheck::Checked {
            missing: Vec::new()
        }
    );
}

#[tokio::test]
async fn a_tree_without_a_lockfile_is_not_checked() {
    if !node_available() {
        eprintln!("skipping: no `node` on PATH");
        return;
    }
    let repo = tempfile::tempdir().expect("repo");
    let check = check_tree(repo.path(), "npm ci").await;
    match check {
        LockfileCheck::NotChecked { reason } => {
            assert!(reason.contains("package-lock.json"), "{reason}")
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn a_lockfile_without_a_packages_map_is_not_checked() {
    if !node_available() {
        eprintln!("skipping: no `node` on PATH");
        return;
    }
    let repo = tempfile::tempdir().expect("repo");
    std::fs::write(
        repo.path().join("package-lock.json"),
        r#"{"lockfileVersion":1,"dependencies":{"a":{"version":"1.0.0"}}}"#,
    )
    .expect("write");
    let check = check_tree(repo.path(), "npm ci").await;
    match check {
        LockfileCheck::NotChecked { reason } => {
            assert!(reason.contains("lockfileVersion 1"), "{reason}")
        }
        other => panic!("{other:?}"),
    }

    std::fs::write(repo.path().join("package-lock.json"), "not json").expect("write");
    assert!(matches!(
        check_tree(repo.path(), "npm ci").await,
        LockfileCheck::NotChecked { .. }
    ));
}

/// The `missing` list of a check over a tree with nothing installed: exactly the
/// packages the script expects the install to have placed.
async fn wanted_in(repo: &Path, command: &str) -> Vec<String> {
    match check_tree(repo, command).await {
        LockfileCheck::Checked { missing } => missing,
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn the_script_wants_the_packages_the_graph_reaches_that_apply_to_this_host() {
    if !node_available() {
        eprintln!("skipping: no `node` on PATH");
        return;
    }
    let repo = tempfile::tempdir().expect("repo");
    let os = node_host::os();
    let cpu = node_host::arch();
    write_lockfile(
        repo.path(),
        serde_json::json!({
            "": {
                "name": "fixture",
                "dependencies": {
                    "present": "1", "absent": "1", "nested": "1", "not-here": "1",
                    "everywhere-else": "1", "a-file-not-a-dir": "1", "native": "1"
                }
            },
            "node_modules/present": { "version": "1.0.0" },
            "node_modules/absent": { "version": "1.0.0" },
            "node_modules/nested": { "version": "1.0.0", "dependencies": { "deep": "2" } },
            "node_modules/nested/node_modules/deep": { "version": "2.0.0" },
            "node_modules/native": {
                "version": "1.0.0",
                "optionalDependencies": {
                    "for-this-host": "1", "for-another-os": "1", "for-another-cpu": "1",
                    "for-a-string-os": "1"
                }
            },
            "node_modules/for-this-host": {
                "version": "1.0.0", "optional": true, "os": [os], "cpu": [cpu]
            },
            "node_modules/for-another-os": {
                "version": "1.0.0", "optional": true, "os": ["nonesuch"], "cpu": [cpu]
            },
            "node_modules/for-another-cpu": {
                "version": "1.0.0", "optional": true, "os": [os], "cpu": ["nonesuch"]
            },
            // npm reads a bare string as a one-element list.
            "node_modules/for-a-string-os": {
                "version": "1.0.0", "optional": true, "os": "nonesuch"
            },
            "node_modules/not-here": { "version": "1.0.0", "os": [format!("!{os}")] },
            "node_modules/everywhere-else": { "version": "1.0.0", "os": ["!nonesuch"] },
            "node_modules/a-file-not-a-dir": { "version": "1.0.0" },
            // Nothing reaches it: `npm ci` prunes it.
            "node_modules/extraneous": { "version": "1.0.0", "extraneous": true }
        }),
    );
    std::fs::create_dir_all(repo.path().join("node_modules/present")).expect("mkdir");
    std::fs::write(repo.path().join("node_modules/a-file-not-a-dir"), "").expect("write");

    // `not-here` is not optional, so npm itself refuses the install on this host;
    // an install that exited zero never placed it, and it is not wanted.
    assert_eq!(
        wanted_in(repo.path(), "npm ci").await,
        [
            "node_modules/a-file-not-a-dir",
            "node_modules/absent",
            "node_modules/everywhere-else",
            "node_modules/for-this-host",
            "node_modules/native",
            "node_modules/nested",
            "node_modules/nested/node_modules/deep",
        ]
    );
}

/// npm drops an optional package this host cannot take together with everything
/// reachable only through it (its `optionalSet`), even when those packages declare
/// no platform of their own. This is the shape of every wasm fallback binding —
/// `@rolldown/binding-wasm32-wasi`, `@img/sharp-wasm32` — and the tree is complete
/// without them.
#[tokio::test]
async fn packages_reachable_only_through_an_excluded_optional_package_are_not_wanted() {
    if !node_available() {
        eprintln!("skipping: no `node` on PATH");
        return;
    }
    let repo = tempfile::tempdir().expect("repo");
    let os = node_host::os();
    let cpu = node_host::arch();
    write_lockfile(
        repo.path(),
        serde_json::json!({
            "": { "name": "fixture", "dependencies": { "rolldown": "1", "sharp": "1" } },
            "node_modules/rolldown": {
                "version": "1.0.0",
                "optionalDependencies": { "@rolldown/binding-host": "1", "@rolldown/binding-wasm32-wasi": "1" }
            },
            "node_modules/@rolldown/binding-host": {
                "version": "1.0.0", "optional": true, "os": [os], "cpu": [cpu]
            },
            "node_modules/@rolldown/binding-wasm32-wasi": {
                "version": "1.0.0", "optional": true, "cpu": ["wasm32"],
                "dependencies": { "@napi-rs/wasm-runtime": "1" }
            },
            "node_modules/@napi-rs/wasm-runtime": {
                "version": "1.0.0", "optional": true, "dependencies": { "tslib": "2" }
            },
            // `tslib` is also wanted by a package the host keeps, so it stays wanted.
            "node_modules/tslib": { "version": "2.0.0" },
            "node_modules/sharp": {
                "version": "1.0.0",
                "dependencies": { "tslib": "2" },
                "optionalDependencies": { "@img/sharp-freebsd-wasm32": "1", "@img/sharp-host": "1" }
            },
            // Declares no platform at all, and is reached only through a package
            // the host excludes.
            "node_modules/@img/sharp-freebsd-wasm32": {
                "version": "1.0.0", "optional": true, "os": ["freebsd"], "cpu": ["wasm32"],
                "dependencies": { "@img/sharp-wasm32": "1" }
            },
            "node_modules/@img/sharp-wasm32": {
                "version": "1.0.0", "optional": true, "dependencies": { "@emnapi/runtime": "1" }
            },
            "node_modules/@emnapi/runtime": { "version": "1.0.0", "optional": true },
            "node_modules/@img/sharp-host": {
                "version": "1.0.0", "optional": true, "os": [os], "cpu": [cpu]
            }
        }),
    );

    assert_eq!(
        wanted_in(repo.path(), "npm ci").await,
        [
            "node_modules/@img/sharp-host",
            "node_modules/@rolldown/binding-host",
            "node_modules/rolldown",
            "node_modules/sharp",
            "node_modules/tslib",
        ]
    );
}

/// The set npm drops also walks the other way: an optional package that requires
/// an excluded one unconditionally cannot work without it, and npm leaves it out
/// too. The same goes for an optional package whose `engines.node` the running
/// node fails.
#[tokio::test]
async fn an_optional_package_that_requires_an_excluded_one_is_not_wanted_either() {
    if !node_available() {
        eprintln!("skipping: no `node` on PATH");
        return;
    }
    let repo = tempfile::tempdir().expect("repo");
    write_lockfile(
        repo.path(),
        serde_json::json!({
            "": {
                "name": "fixture",
                "dependencies": { "required-old-node": "1" },
                "optionalDependencies": { "needs-old-node": "1", "needs-other-cpu": "1", "fine": "1" }
            },
            "node_modules/needs-old-node": {
                "version": "1.0.0", "optional": true, "dependencies": { "old-node": "1" }
            },
            "node_modules/old-node": {
                "version": "1.0.0", "optional": true, "engines": { "node": "<1.0.0" }
            },
            "node_modules/needs-other-cpu": {
                "version": "1.0.0", "optional": true, "dependencies": { "other-cpu": "1" }
            },
            "node_modules/other-cpu": {
                "version": "1.0.0", "optional": true, "cpu": ["nonesuch"]
            },
            "node_modules/fine": {
                "version": "1.0.0", "optional": true, "engines": { "node": ">=0.10.0" }
            },
            // A required package whose engines the node fails is installed with a
            // warning, so it is wanted; only an optional one is dropped.
            "node_modules/required-old-node": {
                "version": "1.0.0", "engines": { "node": "<1.0.0" }
            }
        }),
    );

    assert_eq!(
        wanted_in(repo.path(), "npm ci").await,
        ["node_modules/fine", "node_modules/required-old-node"]
    );
}

/// Workspaces and other linked directories are source the install does not create;
/// their dependencies, dev ones included, are installed, and resolve from their own
/// `node_modules` before the project's.
#[tokio::test]
async fn a_workspaces_dependencies_are_wanted_and_the_link_itself_is_not() {
    if !node_available() {
        eprintln!("skipping: no `node` on PATH");
        return;
    }
    let repo = tempfile::tempdir().expect("repo");
    write_lockfile(
        repo.path(),
        serde_json::json!({
            "": { "name": "fixture", "workspaces": ["packages/*"], "dependencies": { "shared": "1" } },
            "packages/app": {
                "name": "app",
                "dependencies": { "shared": "2", "app-dep": "1" },
                "devDependencies": { "app-dev": "1" }
            },
            "node_modules/app": { "resolved": "packages/app", "link": true },
            "node_modules/shared": { "version": "1.0.0" },
            "packages/app/node_modules/shared": { "version": "2.0.0" },
            "node_modules/app-dep": { "version": "1.0.0" },
            "node_modules/app-dev": { "version": "1.0.0", "dev": true }
        }),
    );

    assert_eq!(
        wanted_in(repo.path(), "npm ci").await,
        [
            "node_modules/app-dep",
            "node_modules/app-dev",
            "node_modules/shared",
            "packages/app/node_modules/shared",
        ]
    );
}

#[tokio::test]
async fn the_install_commands_flags_decide_which_classes_are_wanted() {
    if !node_available() {
        eprintln!("skipping: no `node` on PATH");
        return;
    }
    let repo = tempfile::tempdir().expect("repo");
    write_lockfile(
        repo.path(),
        serde_json::json!({
            "": {
                "name": "fixture",
                "dependencies": { "prod": "1" },
                "devDependencies": { "dev": "1", "devopt-holder": "1" },
                "optionalDependencies": { "opt": "1", "devopt": "1" }
            },
            "node_modules/prod": { "version": "1.0.0", "peerDependencies": { "peer": "1" } },
            "node_modules/dev": { "version": "1.0.0", "dev": true },
            "node_modules/opt": { "version": "1.0.0", "optional": true },
            "node_modules/devopt-holder": {
                "version": "1.0.0", "dev": true, "dependencies": { "devopt": "1" }
            },
            "node_modules/devopt": { "version": "1.0.0", "devOptional": true },
            "node_modules/peer": { "version": "1.0.0", "peer": true }
        }),
    );
    let repo = repo.path();

    assert_eq!(
        wanted_in(repo, "npm ci").await,
        [
            "node_modules/dev",
            "node_modules/devopt",
            "node_modules/devopt-holder",
            "node_modules/opt",
            "node_modules/peer",
            "node_modules/prod",
        ]
    );
    for omit_dev in [
        "npm ci --omit=dev",
        "npm ci --omit dev",
        "npm install --production",
        "npm ci --only=prod",
        "NODE_ENV=production npm ci",
    ] {
        assert_eq!(
            wanted_in(repo, omit_dev).await,
            [
                "node_modules/devopt",
                "node_modules/opt",
                "node_modules/peer",
                "node_modules/prod",
            ],
            "{omit_dev}"
        );
    }
    for omit_optional in ["npm ci --omit=optional", "npm ci --no-optional"] {
        assert_eq!(
            wanted_in(repo, omit_optional).await,
            [
                "node_modules/dev",
                "node_modules/devopt",
                "node_modules/devopt-holder",
                "node_modules/peer",
                "node_modules/prod",
            ],
            "{omit_optional}"
        );
    }
    assert_eq!(
        wanted_in(repo, "npm ci --omit=peer").await,
        [
            "node_modules/dev",
            "node_modules/devopt",
            "node_modules/devopt-holder",
            "node_modules/opt",
            "node_modules/prod",
        ]
    );
    assert_eq!(
        wanted_in(
            repo,
            "npm ci --omit=dev --omit=optional && npx playwright install chromium"
        )
        .await,
        ["node_modules/peer", "node_modules/prod"],
        "devOptional is wanted unless both classes are omitted, and a compound line's flags count"
    );
    // `--include` wins over any omit, as it does in npm; and `NODE_ENV=production`
    // is only npm's default, displaced by an explicit omit of another class.
    for everything in [
        "npm ci --omit=dev --include=dev",
        "NODE_ENV=production npm ci --include=dev",
        "npm ci --omit=dev,optional",
    ] {
        assert_eq!(wanted_in(repo, everything).await.len(), 6, "{everything}");
    }
    assert_eq!(
        wanted_in(repo, "NODE_ENV=production npm ci --omit=optional").await,
        [
            "node_modules/dev",
            "node_modules/devopt",
            "node_modules/devopt-holder",
            "node_modules/peer",
            "node_modules/prod",
        ]
    );
}
