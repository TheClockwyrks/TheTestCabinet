//! Tests for the crate's outermost surface: the identity this binary ships under.
//!
//! `gg`'s version is not decoration. `core` reads it out of the run container
//! (`gg --version`) and records it as a run's
//! [`harness_version`](test_cabinet_core::run_record::RunSubject::harness_version) —
//! the only field that says which harness build produced a result — and, in a cluster
//! run, `core` also *downloads* a release named by its own version. Those two
//! crates are versioned independently, nothing at the type level ties them together,
//! and every way they can disagree fails silently. So the coupling is asserted here,
//! from the side that knows what the binary really is.

use test_cabinet_core::gg_exec::{
    DEFAULT_RELEASE_BASE_URL, DEFAULT_RELEASE_VERSION, release_asset_url,
};

/// The version this binary reports — what lands in a run record — and what `core`
/// will download must be the same string.
///
/// Drift is invisible until a cluster run: `core` would request a release that was
/// never published (the run dies at gg's install step), or one that was published for a
/// *different* build than the corpus is about to attribute its results to. Bumping one crate's
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

/// The URL `core` resolves for a default cluster install names *this* build, under the
/// `v{version}/` prefix and with the object name (`gg-{target}`) that the Azure
/// pipeline's gg upload (`scripts/ci/publish-gg.sh`) publishes to the release container.
///
/// The publish leg cannot be exercised here, so this is the standing check that the
/// download side still agrees with the publish side: if the upload's object layout
/// changes, this string is what has to change with it.
#[test]
fn the_resolved_download_url_names_this_binarys_release_asset() {
    assert_eq!(
        release_asset_url(
            DEFAULT_RELEASE_BASE_URL,
            DEFAULT_RELEASE_VERSION,
            "x86_64-unknown-linux-musl"
        ),
        format!(
            "https://testcabinetartifacts.blob.core.windows.net/gg-releases/v{}/gg-x86_64-unknown-linux-musl",
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
/// Short on purpose — one entry. Every entry is a place where the string is *not* a description of
/// the SDK being read by a model, and each one is a claim a reader can check.
///
/// `sandbox/language/` is not exempt, even though a language's own module is where its syntax
/// belongs: what those modules really
/// hold is Handlebars *references* (`{{api.view.open_text.call}}`), which resolve through the
/// catalogue and are the exact shape this gate wants — they only look like spellings to a
/// substring search. [`without_template_references`] answers that directly, so the directory that
/// holds every language's implementation, and with it the likeliest home for a hand-written
/// spelling, is now covered like the rest of the crate.
const SPELLING_EXEMPT: &[(&str, &str)] = &[
    (
        "client.rs",
        "the mock model's canned programs, which are developer-facing fixtures rather than \
         anything gg says to a model",
    ),
    (
        "sandbox/signatures.fixture.rs",
        "a catalogue rather than a sentence about one. This rule exists because a spelling gg \
         writes by hand drifts from the SDK that decides it — and what this file holds is the \
         artifact a spelling is *read from*, in both schemas, so that the two can be compared. Its \
         operation ids collide with the rule textually and not in substance: `programs.get` is gg's \
         id for an operation and, on the arms that spell functions the way Rust spells its methods, \
         also how one of them writes the call",
    ),
];

/// **No sentence gg puts in front of a model spells an SDK call by hand.**
///
/// Every function name, signature and description a model reads is reflected out of the declaration
/// it describes and arrives in that language's catalogue; gg reaches for one by
/// [identity](crate::sandbox::OperationId) and resolves it with
/// [`spell`](crate::sandbox::spell). A `&'static str` or a `format!` in this crate that writes
/// `view.openFile` instead is the defect that rule exists to remove, and it is invisible in review:
/// it reads correctly, it is correct *today*, and it becomes a lie the moment the SDK renames the
/// function — or the moment a second language is registered, for which it was never true at all.
///
/// The rule is therefore the blunt one, and it is the only mechanism there is: outside the
/// [exemptions](SPELLING_EXEMPT), **no string literal in gg's non-test source contains
/// `<catalogued object>.<function name>`**. It is a **textual** check rather than a semantic one, so
/// it cannot see a spelling assembled from two constants and joined with a `format!` — that shape is
/// what [`no_object_name_is_a_constant_waiting_to_be_joined`] covers.
///
/// Both halves come from the registered catalogues rather than from a list here, so a call renamed
/// in the SDK renames what this looks for.
///
/// # Why it reads string literals rather than whole lines
///
/// Because a spelling only reaches a model through one, and because a rule that judged whole lines
/// judged something else as well. Were every registered language to spell its functions in
/// `lowerCamelCase`, which no Rust identifier is, "somewhere on this line" and "inside a string"
/// would be the same set by accident. [Python](crate::sandbox::language) spells them the way Rust spells
/// its own methods, and the accident ended: `context.archive_thread(&ranges)` — gg calling its own
/// `ContextModel` through a binding named for the window it manages — reads as an SDK spelling to a
/// substring search and is not one.
///
/// Renaming gg's own code to dodge a textual test would be the tail wagging the dog, and the
/// collision recurs for every `snake_case` arm the seam registers. So the rule is stated as what it
/// has always meant: what a model reads is a string, and a string is what this reads.
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
        // A doc comment is a developer's, and a `///` naming `view.openFile` in an explanation is
        // exactly the kind of prose that should be able to name it.
        let code = line.trim_start();
        if code.starts_with("//") {
            continue;
        }
        let quoted: Vec<String> = string_literals(code)
            .into_iter()
            .map(without_template_references)
            .collect();
        for spelling in &spellings {
            if quoted.iter().any(|text| text.contains(spelling.as_str())) {
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

/// `text` with every Handlebars reference (`{{api.view.open_text.call}}`) removed — what is left is
/// what a model could actually be shown.
///
/// A mustache is the **correct** shape: it is a reference to the run language's catalogue that a
/// render replaces with that language's own spelling, which is the mechanism this whole gate exists
/// to enforce. It is only a substring search that cannot tell the two apart, because
/// `api.view.open_text.call` contains `view.open_text`. Removing the references before the search is
/// what lets the gate cover the directory holding every language's implementation, which is the
/// likeliest place for a hand-written spelling to be introduced.
fn without_template_references(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find("{{") {
        out.push_str(&rest[..open]);
        // An unclosed `{{` is not a reference; keep the remainder so nothing hides behind one.
        match rest[open..].find("}}") {
            Some(close) => rest = &rest[open + close + 2..],
            None => {
                out.push_str(&rest[open..]);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The text inside each double-quoted string `line` opens, in order — what a model could actually be
/// shown.
///
/// A line scan rather than a lexer, and deliberately over-approximating on the input it cannot read:
/// a line that opens a multi-line or raw string is handed back **whole**, so a spelling hiding in
/// one is still caught. Under-reading would make the gate silently miss; over-reading only costs a
/// false positive that an author can see and fix.
fn string_literals(line: &str) -> Vec<&str> {
    // A raw string's escapes are not escapes, and a string opened here may close many lines below.
    // Either way the honest answer is "the whole line might be string", which is what a caller
    // searching for a substring wants.
    if line.contains("r\"") || line.contains("r#\"") {
        return vec![line];
    }
    let bytes = line.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'"' {
            index += 1;
            continue;
        }
        let start = index + 1;
        let mut end = start;
        while end < bytes.len() {
            match bytes[end] {
                b'\\' => end += 2,
                b'"' => break,
                _ => end += 1,
            }
        }
        if end >= bytes.len() {
            // Unterminated on this line: it continues below, so the rest of the line is string.
            out.push(&line[start..]);
            break;
        }
        out.push(&line[start..end]);
        index = end + 1;
    }
    out
}

/// **No module path an arm groups its surface under is a `const` in gg's own code.**
///
/// The weaker, shape-based half of
/// [`no_sdk_spelling_is_written_by_hand_in_ggs_own_code`], and it exists because the strong half is
/// textual: `const OBJECT: &str = "gg.context"` beside `const FUNCTION: &str = "compact"`, joined at
/// the call site with a `format!`, is a hand-written spelling that no substring search can see. That
/// is not a hypothetical shape — it is the one [compaction](crate::compaction) actually had.
///
/// So the rule is about the ingredient rather than the product: the half of a model-facing name that
/// says *where* a call lives has no business being a constant in this crate. gg names a call by
/// [identity](crate::sandbox::OperationId) and resolves it to what a model reads with
/// [`spell`](crate::sandbox::spell).
///
/// # Why the needles are the arms' spellings and not gg's own namespaces
///
/// Because only one of the two is something a model ever reads. An
/// [operation id](crate::sandbox::OperationId) is gg's *internal* vocabulary — what a
/// configuration's [allowlist](test_cabinet_core::gg::GgAgentConfig::operations) is written in and
/// what a call is recorded under — and a `format!` that assembled one would have assembled something
/// no model is ever shown. It is also a vocabulary that collides with the *other* surface's by
/// design: gg's `shell` namespace and gg's `shell` tool are the same word for the same thing said on
/// two independent surfaces, so needles taken from there would flag every tool-name constant in the
/// crate for a spelling hazard that does not exist.
///
/// A [module path](crate::sandbox::CatalogueFunction::object) is the other thing entirely: it is
/// what the model types, it differs per arm by design, and half of it in a `const` here is half of a
/// sentence that will be false the moment an SDK is reshaped or a twelfth arm is registered.
#[test]
fn no_object_name_is_a_constant_waiting_to_be_joined() {
    let mut objects: Vec<&str> = Vec::new();
    for language in crate::sandbox::all_languages() {
        for function in crate::sandbox::catalogue_functions(language) {
            objects.push(function.object);
        }
    }
    objects.sort_unstable();
    objects.dedup();
    assert!(
        !objects.is_empty(),
        "no registered arm groups its surface under anything, so this rule has nothing to search for"
    );

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
        "an arm's module path is a constant in gg's own code, which is half of a hand-written \
         spelling waiting for a `format!`. Name the call by its `OperationId` and resolve it with \
         `spell` instead:\n{}",
        offenders.join("\n"),
    );
}

// ---------------------------------------------------------------------------
// The command-line surface — the bare `--config` form is a compatibility contract
// ---------------------------------------------------------------------------

use clap::{CommandFactory, Parser};

use super::{Cli, Command, write_reference};

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

/// `gg reference --out <DIR>` parses to the directory it was given.
///
/// The flag is the whole interface between this binary and every consumer of the reference — two
/// image builds and the release workflow spell it on a `RUN` line, where a rename would surface as
/// a clap error inside a container build and nowhere else. It is asserted here for the same reason
/// the bare `--config` form above is: a shell is not a type system.
#[test]
fn the_reference_subcommand_takes_an_output_directory() {
    let cli = Cli::try_parse_from(["gg", "reference", "--out", "/tmp/gg-reference"])
        .expect("`gg reference --out` parses");
    match cli.command {
        Some(Command::Reference(args)) => assert_eq!(
            args.out,
            Some(std::path::PathBuf::from("/tmp/gg-reference"))
        ),
        other => panic!("expected the reference subcommand, got {other:?}"),
    }
    let bare = Cli::try_parse_from(["gg", "reference"]).expect("`gg reference` parses");
    match bare.command {
        Some(Command::Reference(args)) => assert!(
            args.out.is_none(),
            "no --out is the stdout form, not a default directory"
        ),
        other => panic!("expected the reference subcommand, got {other:?}"),
    }
}

/// **The writer produces the files the reader looks for.**
///
/// This is the one assertion nothing else in the workspace can make. The projection is written by
/// this crate and read by `test-cabinet-backend`, which does not depend on it (and must not — see
/// [`Command::Reference`]); no test can therefore run the real writer into the real reader. What
/// closes the gap is that both sides take the filenames from
/// [`test_cabinet_core::gg_reference`](test_cabinet_core::gg_reference::index_file) rather than
/// spelling them, and this test runs the real writer and checks the directory it leaves behind
/// against those same functions — with the backend's own loader checked against them from its side.
///
/// It decodes every document rather than merely stat-ing it, because a file that is present and not
/// a `GgReferenceApi` costs the reader that arm, silently, in a built image.
#[test]
fn writing_the_reference_leaves_the_documents_the_backend_reads() {
    use test_cabinet_core::gg::GgProgramLanguage;
    use test_cabinet_core::gg_reference::{GgReference, GgReferenceApi, document_file, index_file};

    let dir = tempfile::tempdir().expect("a scratch directory");
    let out = dir.path().join("gg-reference");
    write_reference(&out).expect("the reference is written");

    let index: GgReference =
        serde_json::from_slice(&std::fs::read(out.join(index_file())).expect("the index is there"))
            .expect("the index decodes as the contract type");
    assert_eq!(
        index.languages.len(),
        GgProgramLanguage::ALL.len(),
        "the index lists every registered arm"
    );

    for language in GgProgramLanguage::ALL {
        let path = out.join(document_file(*language));
        let document: GgReferenceApi = serde_json::from_slice(
            &std::fs::read(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display())),
        )
        .unwrap_or_else(|err| panic!("{} decodes as the contract type: {err}", path.display()));
        assert_eq!(
            document.language,
            *language,
            "{} carries the arm it is named after",
            path.display()
        );
        assert!(
            !document.entries.is_empty(),
            "{} carries an arm's surface rather than an empty document",
            path.display()
        );
    }
}

/// A write that fails says **which path** failed.
///
/// The failure lands in a `RUN` line of two image builds and of the release workflow, where an
/// operator sees the message and nothing else. `std::io::Error` carries no path, so this asserts the
/// wrapper that adds one has not been quietly unwrapped back to a bare errno.
#[test]
fn a_failed_reference_write_names_the_path() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let occupied = dir.path().join("not-a-directory");
    std::fs::write(&occupied, "").expect("the blocking file is written");

    let err = write_reference(&occupied).expect_err("a directory cannot be created over a file");
    assert!(
        err.to_string().contains("not-a-directory"),
        "the failure names the path it was attempting: {err}"
    );
}
