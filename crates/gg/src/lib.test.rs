//! Tests for the crate's outermost surface: the identity this binary ships under.
//!
//! `gg`'s version is not decoration. `core` reads it out of the run container
//! (`gg --version`) and records it as a run's
//! [`harness_version`](test_cabinet_core::run_record::RunSubject::harness_version) —
//! the only field that says which harness build produced a result — and, in a cluster
//! run, `core` also *asks GitHub for* a release named by its own version. Those two
//! crates are versioned independently, nothing at the type level ties them together,
//! and every way they can disagree fails silently. So the coupling is asserted here,
//! from the side that knows what the binary really is.

use test_cabinet_core::gg_exec::{DEFAULT_RELEASE_VERSION, release_asset_url};

/// The version this binary reports — what lands in a run record — and what `core`
/// will fetch from GitHub must be the same string.
///
/// Drift is invisible until a cluster run: `core` would request an asset tag that was
/// never cut (the run dies at gg's install step), or one that was cut for a *different*
/// build than the corpus is about to attribute its results to. Bumping one crate's
/// `version` and not the other's is exactly the mistake this catches, at compile-and-test
/// time rather than in production.
#[test]
fn the_default_release_version_matches_this_binary() {
    assert_eq!(env!("CARGO_PKG_VERSION"), DEFAULT_RELEASE_VERSION);
}

/// The version must be a real one. `0.0.0` — the workspace default every member crate
/// inherited before gg had a release pipeline — makes `harness_version` a constant
/// across the entire recorded corpus and names a release tag that will never exist.
#[test]
fn this_binary_reports_a_real_version() {
    assert_ne!(env!("CARGO_PKG_VERSION"), "0.0.0");
}

/// The URL `core` resolves for a default cluster install names *this* build, at the
/// tag `.github/workflows/release.yml` cuts (`v{version}`), with the asset name that
/// workflow's gg job uploads (`gg-{target}`).
///
/// The release legs cannot be exercised here, so this is the standing check that the
/// download side still agrees with the publish side: if the workflow's asset naming or
/// tag scheme changes, this string is what has to change with it.
#[test]
fn the_resolved_download_url_names_this_binarys_release_asset() {
    assert_eq!(
        release_asset_url(
            "TheClockwyrks/test-cabinet",
            DEFAULT_RELEASE_VERSION,
            "x86_64-unknown-linux-musl"
        ),
        format!(
            "https://github.com/TheClockwyrks/test-cabinet/releases/download/v{}/gg-x86_64-unknown-linux-musl",
            env!("CARGO_PKG_VERSION")
        )
    );
}

/// gg's own code holds **no unordered map or set**.
///
/// `HashMap`/`HashSet` iterate in an order `RandomState` reseeds every process, so any one of them
/// that is ever walked — rather than only looked up in — is a per-process non-determinism source
/// inside a harness whose whole product is a *comparable* recorded run. The failure is not
/// theoretical: the orchestrator walks its issue-wait registry to decide which blocked agents to
/// wake, so the wake order of a multi-agent run was a coin flip. And it is the kind of defect that
/// hides, because run-global state is rendered into every agent's pinned prompt each turn: two runs
/// of the same configuration diverge in their prompts without anything having changed.
///
/// Auditing "is *this* one order-visible?" at each of a dozen sites is how the next one gets
/// missed, so the rule is the blunt one: gg's non-test code keys its maps and sets on `Ord` and
/// gets a stable order for free. Every collection here is small (a run's agents, issues, profiles,
/// enabled tools), so the ordered containers cost nothing measurable.
///
/// Tests are exempt: a test-local aggregation that is compared as a whole cannot leak an order into
/// a run.
#[test]
fn no_unordered_map_or_set_survives_in_ggs_own_code() {
    fn walk(dir: &std::path::Path, offenders: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).expect("gg's source tree is readable") {
            let path = entry.expect("a source entry").path();
            if path.is_dir() {
                walk(&path, offenders);
                continue;
            }
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            // `foo.test.rs` — this crate's sibling-file test convention.
            if !name.ends_with(".rs") || name.ends_with(".test.rs") {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("a readable source file");
            for (number, line) in source.lines().enumerate() {
                // `hash_map::DefaultHasher` is a hasher, not a collection: `message_log` uses it to
                // fingerprint a message body, which is a pure function of that body.
                if line.contains("HashMap<")
                    || line.contains("HashSet<")
                    || line.contains("HashMap::")
                    || line.contains("HashSet::")
                {
                    offenders.push(format!("{}:{}: {}", name, number + 1, line.trim()));
                }
            }
        }
    }

    let mut offenders = Vec::new();
    walk(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut offenders,
    );
    assert!(
        offenders.is_empty(),
        "gg's non-test code must key its maps and sets on `Ord` so iteration order is stable — \
         use `BTreeMap`/`BTreeSet`:\n{}",
        offenders.join("\n"),
    );
}

// ---------------------------------------------------------------------------
// No SDK spelling is written in gg's own source
// ---------------------------------------------------------------------------

/// The paths under `src/` a spelling is allowed to appear in, each with the reason it is allowed.
///
/// Short on purpose. Every entry is a place where the string is *not* a description of the SDK being
/// read by a model, and each one is a claim a reader can check.
const SPELLING_EXEMPT: &[(&str, &str)] = &[
    (
        "sandbox/language/",
        "a language's own module is where its syntax belongs: the statements gg generates are \
         written here, and each resolves its call's name through `spell` even so",
    ),
    (
        "client.rs",
        "the mock model's canned programs, which are developer-facing fixtures rather than \
         anything gg says to a model",
    ),
    (
        "skills.builtin.rs",
        "a built-in skill family's own `id` — `gg-project` names a grouping of gg capabilities, \
         not a function on an API object",
    ),
];

/// **No sentence gg puts in front of a model spells an SDK call by hand.**
///
/// Every function name, signature and description a model reads is reflected out of the declaration
/// it describes and arrives in that language's committed catalogue; gg reaches for one by
/// [identity](crate::sandbox::SurfaceCall) and resolves it with
/// [`spell`](crate::sandbox::spell). A `&'static str` or a `format!` in this crate that writes
/// `view.openFile` instead is the defect that rule exists to remove, and it is invisible in review:
/// it reads correctly, it is correct *today*, and it becomes a lie the moment the SDK renames the
/// function — or the moment a second language is registered, for which it was never true at all.
///
/// The rule is therefore the blunt one, and it is the only mechanism there is: outside the
/// [exemptions](SPELLING_EXEMPT), no line of gg's non-test source may contain
/// `<catalogued object>.<lowerCamelName>`. It is a **textual** check rather than a semantic one, so
/// it cannot see a spelling assembled from two constants and joined with a `format!` — that shape is
/// what [`no_object_name_is_a_constant_waiting_to_be_joined`] covers.
///
/// Both halves come from the registered catalogues rather than from a list here, so a call renamed
/// in the SDK renames what this looks for.
#[test]
fn no_sdk_spelling_is_written_by_hand_in_ggs_own_code() {
    // Every `object.name` pair any registered language's SDK binds — the exact strings a hand-typed
    // spelling would have to be one of.
    let mut spellings: Vec<String> = Vec::new();
    for language in crate::sandbox::all_languages() {
        for function in crate::sandbox::catalogue_functions(language) {
            spellings.push(format!("{}.{}", function.object, function.name));
        }
    }
    spellings.sort();
    spellings.dedup();

    fn walk(dir: &std::path::Path, root: &std::path::Path, found: &mut Vec<(String, String)>) {
        for entry in std::fs::read_dir(dir).expect("gg's source tree is readable") {
            let path = entry.expect("a source entry").path();
            if path.is_dir() {
                walk(&path, root, found);
                continue;
            }
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if !name.ends_with(".rs") || name.ends_with(".test.rs") {
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .expect("a path under the source root")
                .to_string_lossy()
                .to_string();
            if SPELLING_EXEMPT
                .iter()
                .any(|(prefix, _)| relative.starts_with(prefix))
            {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("a readable source file");
            for (number, line) in source.lines().enumerate() {
                found.push((format!("{relative}:{}", number + 1), line.to_string()));
            }
        }
    }

    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut lines = Vec::new();
    walk(&root, &root, &mut lines);

    let mut offenders = Vec::new();
    for (where_, line) in lines {
        // A doc comment is a developer's; only a string literal or a `format!` reaches a model, and
        // a `///` naming `view.openFile` in an explanation is exactly the kind of prose that should
        // be able to name it.
        let code = line.trim_start();
        if code.starts_with("//") {
            continue;
        }
        for spelling in &spellings {
            if code.contains(spelling.as_str()) {
                offenders.push(format!("{where_}: {}", line.trim()));
                break;
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "gg's own source names an SDK call by hand. Every spelling a model reads must be resolved \
         from the run's language with `spell(language, SURFACE_CALL)`, so that a renamed function \
         renames it everywhere and a second language spells it its own way:\n{}",
        offenders.join("\n"),
    );
}

/// **No API object's name is a `const` in gg's own code.**
///
/// The weaker, shape-based half of
/// [`no_sdk_spelling_is_written_by_hand_in_ggs_own_code`], and it exists because the strong half is
/// textual: `const OBJECT: &str = "context"` beside `const FUNCTION: &str = "compact"`, joined at
/// the call site with a `format!`, is a hand-written spelling that no substring search can see. That
/// is not a hypothetical shape — it is the one [compaction](crate::compaction) actually had.
///
/// So the rule is about the ingredient rather than the product: an API object's name has no business
/// being a constant in this crate at all. gg names a call by
/// [identity](crate::sandbox::SurfaceCall), which carries the object already.
#[test]
fn no_object_name_is_a_constant_waiting_to_be_joined() {
    let objects: Vec<&str> = crate::sandbox::all_languages()
        .flat_map(crate::sandbox::catalogue_objects)
        .map(|object| object.object.as_str())
        .collect();

    fn walk(dir: &std::path::Path, root: &std::path::Path, out: &mut Vec<(String, String)>) {
        for entry in std::fs::read_dir(dir).expect("gg's source tree is readable") {
            let path = entry.expect("a source entry").path();
            if path.is_dir() {
                walk(&path, root, out);
                continue;
            }
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if !name.ends_with(".rs") || name.ends_with(".test.rs") {
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .expect("a path under the source root")
                .to_string_lossy()
                .to_string();
            if SPELLING_EXEMPT
                .iter()
                .any(|(prefix, _)| relative.starts_with(prefix))
            {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("a readable source file");
            for (number, line) in source.lines().enumerate() {
                out.push((format!("{relative}:{}", number + 1), line.to_string()));
            }
        }
    }

    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut lines = Vec::new();
    walk(&root, &root, &mut lines);

    let mut offenders = Vec::new();
    for (where_, line) in lines {
        let code = line.trim_start();
        if code.starts_with("//") || !code.contains("const ") {
            continue;
        }
        for object in &objects {
            if code.contains(&format!("= \"{object}\";")) {
                offenders.push(format!("{where_}: {}", line.trim()));
                break;
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "an API object's name is a constant in gg's own code, which is half of a hand-written \
         spelling waiting for a `format!`. Name the call by its `SurfaceCall` identity and resolve \
         it with `spell` instead:\n{}",
        offenders.join("\n"),
    );
}

// ---------------------------------------------------------------------------
// The command-line surface — the bare `--config` form is a compatibility contract
// ---------------------------------------------------------------------------

use clap::{CommandFactory, Parser};

use super::{Cli, Command};

/// Catches structural mistakes in the derive (duplicate args, bad groups) — including the
/// `args_conflicts_with_subcommands`/`subcommand_negates_reqs` pair that lets a required top-level
/// `--config` coexist with subcommands.
#[test]
fn the_command_line_definition_is_valid() {
    Cli::command().debug_assert();
}

/// **`gg --config <PATH>` must keep working, forever.**
///
/// This is the entire invocation contract `core` has ever used — `gg_exec` launches exactly
/// `gg --config <path>` — so every released gg accepts it and every deployment's baked binary is
/// invoked by it. Adding subcommands is only safe because the bare form stays an implied `run`; if
/// this test ever fails, every cluster run whose driver and binary are a generation apart dies at
/// the launch step.
#[test]
fn the_bare_config_form_is_an_implied_run() {
    let cli = Cli::try_parse_from(["gg", "--config", "/tmp/invocation.json"])
        .expect("the bare form parses");
    assert!(cli.command.is_none(), "no subcommand was named");
    assert_eq!(
        cli.config,
        Some(std::path::PathBuf::from("/tmp/invocation.json")),
    );
}

/// The explicit spelling parses to the same thing, so a caller may say what it means.
#[test]
fn the_run_subcommand_takes_the_same_config() {
    let cli = Cli::try_parse_from(["gg", "run", "--config", "/tmp/invocation.json"])
        .expect("`gg run --config` parses");
    match cli.command {
        Some(Command::Run(args)) => {
            assert_eq!(
                args.config,
                std::path::PathBuf::from("/tmp/invocation.json")
            );
        }
        other => panic!("expected the run subcommand, got {other:?}"),
    }
}

/// `gg` with nothing at all is an error naming the missing `--config`, not a silent no-op — the
/// required flag survives the subcommands being added around it.
#[test]
fn a_bare_gg_still_requires_a_config() {
    let err = Cli::try_parse_from(["gg"]).expect_err("`gg` alone is not a valid invocation");
    assert_eq!(
        err.kind(),
        clap::error::ErrorKind::MissingRequiredArgument,
        "{err}"
    );
}

/// A subcommand and a top-level `--config` are mutually exclusive rather than both-applied: naming
/// both is a mistake, and a parse error is the only reading of it that cannot silently run the
/// wrong thing.
#[test]
fn a_subcommand_and_a_bare_config_conflict() {
    let err = Cli::try_parse_from(["gg", "--config", "/tmp/invocation.json", "reference"])
        .expect_err("a bare --config alongside a subcommand is rejected");
    assert_eq!(
        err.kind(),
        clap::error::ErrorKind::ArgumentConflict,
        "{err}"
    );
}
