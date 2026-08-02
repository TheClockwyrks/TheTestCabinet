//! Argument-parsing tests for the `tcab` CLI.
//!
//! These exercise the clap derive model directly, without running any handler,
//! so they verify the surface stays well-formed and that representative
//! invocations parse as intended.

use clap::CommandFactory;

use super::*;

#[test]
fn cli_definition_is_valid() {
    // Catches structural mistakes in the derive (duplicate args, bad groups).
    Cli::command().debug_assert();
}

#[test]
fn run_help_parses() {
    // `tcab run --help` is a parse "error" of the help kind; clap signals it via
    // `ErrorKind::DisplayHelp` rather than a real failure.
    let err = Cli::try_parse_from(["tcab", "run", "--help"])
        .expect_err("--help should short-circuit parsing");
    assert_eq!(err.kind(), clap::error::ErrorKind::DisplayHelp);
}

#[test]
fn top_level_help_parses() {
    let err =
        Cli::try_parse_from(["tcab", "--help"]).expect_err("--help should short-circuit parsing");
    assert_eq!(err.kind(), clap::error::ErrorKind::DisplayHelp);
}

#[test]
fn run_parses_required_arguments() {
    let cli = Cli::try_parse_from([
        "tcab",
        "run",
        "--test-case",
        "pong",
        "--version",
        "1.0.0",
        "--variant",
        "base",
        "--harness",
        "claude",
        "--model",
        "some-model-id",
    ])
    .expect("a fully specified run invocation should parse");

    match cli.command {
        Command::Run(args) => {
            assert_eq!(args.test_case, "pong");
            assert_eq!(args.version, "1.0.0");
            assert_eq!(args.variant, "base");
            assert_eq!(args.harness, HarnessArg::Claude);
            assert_eq!(args.model, "some-model-id");
            assert!(args.out_dir.is_none());
            // Omitting --max-runtime leaves the override unset, so the run uses
            // the test case's own default cap.
            assert!(args.max_runtime.is_none());
            // Omitting --orchestrator defaults to the single-session one-shot
            // orchestrator.
            assert_eq!(args.orchestrator, "one-shot");
            // Omitting --auth-mode keeps the backend's default auth behavior.
            assert!(args.auth_mode.is_none());
        }
        other => panic!("expected a run command, got {other:?}"),
    }
}

#[test]
fn run_accepts_an_orchestrator_and_auth_mode_selection() {
    let cli = Cli::try_parse_from([
        "tcab",
        "run",
        "--test-case",
        "pong",
        "--version",
        "1.0.0",
        "--variant",
        "base",
        "--harness",
        "claude",
        "--model",
        "some-model-id",
        // Any slug parses here — the flag is free-form and resolution (built-in or
        // external) happens later, so an unknown one is rejected by the catalog,
        // not by the parser.
        "--orchestrator",
        "looper",
        "--auth-mode",
        "subscription",
    ])
    .expect("a run invocation with orchestrator and auth-mode selection should parse");

    match cli.command {
        Command::Run(args) => {
            assert_eq!(args.orchestrator, "looper");
            assert_eq!(args.auth_mode.as_deref(), Some("subscription"));
        }
        other => panic!("expected a run command, got {other:?}"),
    }
}

#[test]
fn run_accepts_a_max_runtime_override() {
    let cli = Cli::try_parse_from([
        "tcab",
        "run",
        "--test-case",
        "pong",
        "--version",
        "1.0.0",
        "--variant",
        "base",
        "--harness",
        "claude",
        "--model",
        "some-model-id",
        "--max-runtime",
        "1.5",
    ])
    .expect("a run invocation with --max-runtime should parse");

    match cli.command {
        Command::Run(args) => assert_eq!(args.max_runtime, Some(1.5)),
        other => panic!("expected a run command, got {other:?}"),
    }
}

#[test]
fn run_requires_a_harness() {
    let err = Cli::try_parse_from([
        "tcab",
        "run",
        "--test-case",
        "pong",
        "--version",
        "1.0.0",
        "--variant",
        "base",
        "--model",
        "some-model-id",
    ])
    .expect_err("omitting --harness should be a parse error");
    assert_eq!(err.kind(), clap::error::ErrorKind::MissingRequiredArgument);
}

#[test]
fn run_requires_a_variant() {
    let err = Cli::try_parse_from([
        "tcab",
        "run",
        "--test-case",
        "pong",
        "--version",
        "1.0.0",
        "--harness",
        "claude",
        "--model",
        "some-model-id",
    ])
    .expect_err("omitting --variant should be a parse error");
    assert_eq!(err.kind(), clap::error::ErrorKind::MissingRequiredArgument);
}

#[test]
fn run_rejects_unknown_harness() {
    let err = Cli::try_parse_from([
        "tcab",
        "run",
        "--test-case",
        "pong",
        "--version",
        "1.0.0",
        "--variant",
        "base",
        "--harness",
        "not-a-harness",
        "--model",
        "some-model-id",
    ])
    .expect_err("an unknown harness value should be rejected");
    assert_eq!(err.kind(), clap::error::ErrorKind::InvalidValue);
}

#[test]
fn every_harness_slug_is_accepted() {
    use test_cabinet_core::run_record::HarnessSlug;

    for slug in HarnessSlug::ALL {
        let cli = Cli::try_parse_from([
            "tcab",
            "run",
            "--test-case",
            "pong",
            "--version",
            "1.0.0",
            "--variant",
            "base",
            "--harness",
            slug.as_str(),
            "--model",
            "m",
        ])
        .unwrap_or_else(|e| panic!("harness `{}` should parse: {e}", slug.as_str()));

        match cli.command {
            Command::Run(args) => {
                let parsed: HarnessSlug = args.harness.into();
                assert_eq!(parsed, slug);
            }
            other => panic!("expected a run command, got {other:?}"),
        }
    }
}

#[test]
fn publish_accepts_a_batch_of_run_ids() {
    let cli = Cli::try_parse_from(["tcab", "publish", "run-a", "run-b", "run-c"])
        .expect("multiple run ids should parse for batch publishing");

    match cli.command {
        Command::Publish(args) => {
            assert_eq!(args.run_ids.len(), 3);
            assert!(!args.dry_run);
        }
        other => panic!("expected a publish command, got {other:?}"),
    }
}

#[test]
fn review_parses() {
    let cli = Cli::try_parse_from(["tcab", "review", "run-a", "--writeup", "w.md"])
        .expect("review parses");
    match cli.command {
        Command::Review(args) => {
            assert_eq!(args.run_id, "run-a");
            assert_eq!(args.writeup, Some(std::path::PathBuf::from("w.md")));
        }
        other => panic!("expected a review command, got {other:?}"),
    }
}

#[test]
fn login_and_register_parse() {
    let cli = Cli::try_parse_from(["tcab", "login", "--username", "ada", "--password", "secret"])
        .expect("login parses");
    match cli.command {
        Command::Login(args) => {
            assert_eq!(args.username, "ada");
            assert_eq!(args.password.as_deref(), Some("secret"));
        }
        other => panic!("expected a login command, got {other:?}"),
    }

    let cli = Cli::try_parse_from([
        "tcab",
        "register",
        "--username",
        "ada",
        "--display-name",
        "Ada L.",
    ])
    .expect("register parses");
    match cli.command {
        Command::Register(args) => {
            assert_eq!(args.username, "ada");
            assert_eq!(args.display_name, "Ada L.");
            assert!(args.password.is_none());
        }
        other => panic!("expected a register command, got {other:?}"),
    }
}

#[test]
fn publish_requires_at_least_one_run_record() {
    let err = Cli::try_parse_from(["tcab", "publish"])
        .expect_err("publish with no run records should be a parse error");
    assert_eq!(err.kind(), clap::error::ErrorKind::MissingRequiredArgument);
}

#[test]
fn validate_parses_required_arguments() {
    let cli = Cli::try_parse_from([
        "tcab",
        "validate",
        "--implementation",
        "/tmp/impl",
        "--test-case",
        "pong",
        "--version",
        "1.0.0",
        "--variant",
        "base",
    ])
    .expect("a fully specified validate invocation should parse");

    match cli.command {
        Command::Validate(args) => {
            assert_eq!(args.implementation.to_str(), Some("/tmp/impl"));
            assert_eq!(args.test_case, "pong");
            assert_eq!(args.version, "1.0.0");
            assert_eq!(args.variant, "base");
        }
        other => panic!("expected a validate command, got {other:?}"),
    }
}

#[test]
fn seed_parses_required_arguments_and_defaults_out_dir() {
    let cli = Cli::try_parse_from([
        "tcab",
        "seed",
        "--test-case",
        "pong",
        "--version",
        "1.0.0",
        "--variant",
        "base",
    ])
    .expect("a seed invocation should parse with only its required arguments");

    match cli.command {
        Command::Seed(args) => {
            assert_eq!(args.test_case, "pong");
            assert_eq!(args.version, "1.0.0");
            assert_eq!(args.variant, "base");
            // With no override, the seeded repository lands under `tmp/`.
            assert_eq!(args.out_dir, std::path::PathBuf::from("tmp"));
        }
        other => panic!("expected a seed command, got {other:?}"),
    }
}

#[test]
fn seed_accepts_an_out_dir_override() {
    let cli = Cli::try_parse_from([
        "tcab",
        "seed",
        "--test-case",
        "pong",
        "--version",
        "1.0.0",
        "--variant",
        "base",
        "--out-dir",
        "/tmp/inspect",
    ])
    .expect("an explicit --out-dir should parse");

    match cli.command {
        Command::Seed(args) => assert_eq!(args.out_dir.to_str(), Some("/tmp/inspect")),
        other => panic!("expected a seed command, got {other:?}"),
    }
}

#[test]
fn seed_requires_a_test_case() {
    let err = Cli::try_parse_from(["tcab", "seed", "--version", "1.0.0", "--variant", "base"])
        .expect_err("omitting --test-case should be a parse error");
    assert_eq!(err.kind(), clap::error::ErrorKind::MissingRequiredArgument);
}

#[test]
fn prompt_parses_required_arguments() {
    let cli = Cli::try_parse_from([
        "tcab",
        "prompt",
        "--test-case",
        "pong",
        "--version",
        "1.0.0",
        "--variant",
        "frenzy",
    ])
    .expect("a fully specified prompt invocation should parse");

    match cli.command {
        Command::Prompt(args) => {
            assert_eq!(args.test_case, "pong");
            assert_eq!(args.version, "1.0.0");
            assert_eq!(args.variant, "frenzy");
        }
        other => panic!("expected a prompt command, got {other:?}"),
    }
}

#[test]
fn removed_catalog_subcommand_no_longer_parses() {
    // `tcab catalog` was retired when the model catalog moved into the backend
    // store (curated in the app, no longer a bundled `models.json`).
    assert!(
        Cli::try_parse_from(["tcab", "catalog"]).is_err(),
        "the catalog subcommand should no longer exist"
    );
}

#[test]
fn harnesses_parses_with_json_flag() {
    let cli = Cli::try_parse_from(["tcab", "harnesses", "--json"])
        .expect("the harnesses subcommand should parse");

    match cli.command {
        Command::Harnesses(args) => assert!(args.json),
        other => panic!("expected a harnesses command, got {other:?}"),
    }
}

#[test]
fn orchestrators_parses_with_json_flag() {
    let cli = Cli::try_parse_from(["tcab", "orchestrators", "--json"])
        .expect("the orchestrators subcommand should parse");

    match cli.command {
        Command::Orchestrators(args) => assert!(args.json),
        other => panic!("expected an orchestrators command, got {other:?}"),
    }
}

#[test]
fn publish_reference_parses_slug_only_and_defaults_version_and_selectors() {
    // Only the positional slug is required; version is optional (newest), and
    // neither variant selector is set (defaulting to all variants with a
    // reference).
    let cli = Cli::try_parse_from(["tcab", "publish-reference", "--env", "prod", "carom"])
        .expect("a slug-only publish-reference invocation should parse");

    match cli.command {
        Command::PublishReference(args) => {
            assert_eq!(args.slug, "carom");
            assert_eq!(args.env, DeployEnv::Prod);
            assert_eq!(args.version, None);
            assert_eq!(args.variant, None);
            assert!(!args.all_variants);
            assert!(!args.dry_run);
        }
        other => panic!("expected a publish-reference command, got {other:?}"),
    }
}

#[test]
fn publish_reference_accepts_a_positional_version_and_variant() {
    let cli = Cli::try_parse_from([
        "tcab",
        "publish-reference",
        "--env",
        "staging",
        "carom",
        "v1.0.1",
        "--variant",
        "base",
    ])
    .expect("a slug + version + variant invocation should parse");

    match cli.command {
        Command::PublishReference(args) => {
            assert_eq!(args.slug, "carom");
            assert_eq!(args.env, DeployEnv::Staging);
            assert_eq!(args.version.as_deref(), Some("v1.0.1"));
            assert_eq!(args.variant.as_deref(), Some("base"));
            assert!(!args.all_variants);
        }
        other => panic!("expected a publish-reference command, got {other:?}"),
    }
}

#[test]
fn publish_reference_accepts_all_variants_and_dry_run() {
    let cli = Cli::try_parse_from([
        "tcab",
        "publish-reference",
        "--env",
        "prod",
        "carom",
        "--all-variants",
        "--dry-run",
    ])
    .expect("--all-variants --dry-run should parse");

    match cli.command {
        Command::PublishReference(args) => {
            assert!(args.all_variants);
            assert!(args.dry_run);
            assert_eq!(args.variant, None);
        }
        other => panic!("expected a publish-reference command, got {other:?}"),
    }
}

#[test]
fn publish_reference_rejects_variant_with_all_variants() {
    // The two variant selectors are mutually exclusive (`--env` supplied so the
    // conflict is the only reason the parse fails).
    assert!(
        Cli::try_parse_from([
            "tcab",
            "publish-reference",
            "--env",
            "prod",
            "carom",
            "--variant",
            "base",
            "--all-variants",
        ])
        .is_err(),
        "--variant and --all-variants should conflict"
    );
}

#[test]
fn publish_reference_requires_a_slug() {
    assert!(
        Cli::try_parse_from(["tcab", "publish-reference", "--env", "prod"]).is_err(),
        "the case slug is required"
    );
}

#[test]
fn publish_reference_requires_an_env() {
    // `--env` has no default so a publish can never silently target prod.
    assert!(
        Cli::try_parse_from(["tcab", "publish-reference", "carom"]).is_err(),
        "--env is required"
    );
}

#[test]
fn publish_reference_accepts_skip_baselines_and_defaults_it_off() {
    // Skipping the baseline capture is opt-in: by default a publish keeps the
    // committed media in lockstep with the build it deploys.
    let cli = Cli::try_parse_from(["tcab", "publish-reference", "--env", "prod", "carom"])
        .expect("a plain publish-reference invocation should parse");
    match cli.command {
        Command::PublishReference(args) => assert!(!args.skip_baselines),
        other => panic!("expected a publish-reference command, got {other:?}"),
    }

    let cli = Cli::try_parse_from([
        "tcab",
        "publish-reference",
        "--env",
        "prod",
        "carom",
        "--skip-baselines",
    ])
    .expect("--skip-baselines should parse");
    match cli.command {
        Command::PublishReference(args) => assert!(args.skip_baselines),
        other => panic!("expected a publish-reference command, got {other:?}"),
    }
}

#[test]
fn removed_baselines_only_flag_no_longer_parses() {
    // Capturing baselines without deploying is now its own command, so the old
    // `--baselines-only` flag is gone rather than silently ignored.
    assert!(
        Cli::try_parse_from([
            "tcab",
            "publish-reference",
            "--env",
            "prod",
            "carom",
            "--baselines-only",
        ])
        .is_err(),
        "--baselines-only should no longer be accepted"
    );
}

#[test]
fn capture_baselines_parses_slug_only_and_defaults_version_and_selectors() {
    let cli = Cli::try_parse_from(["tcab", "capture-baselines", "carom"])
        .expect("a slug-only capture-baselines invocation should parse");

    match cli.command {
        Command::CaptureBaselines(args) => {
            assert_eq!(args.slug, "carom");
            assert_eq!(args.version, None);
            assert_eq!(args.variant, None);
            assert!(!args.all_variants);
            assert!(!args.dry_run);
        }
        other => panic!("expected a capture-baselines command, got {other:?}"),
    }
}

#[test]
fn capture_baselines_accepts_a_positional_version_variant_and_dry_run() {
    let cli = Cli::try_parse_from([
        "tcab",
        "capture-baselines",
        "carom",
        "v2.0.0",
        "--variant",
        "gyre",
        "--dry-run",
    ])
    .expect("version + variant + dry-run should parse");

    match cli.command {
        Command::CaptureBaselines(args) => {
            assert_eq!(args.version.as_deref(), Some("v2.0.0"));
            assert_eq!(args.variant.as_deref(), Some("gyre"));
            assert!(args.dry_run);
        }
        other => panic!("expected a capture-baselines command, got {other:?}"),
    }
}

#[test]
fn capture_baselines_takes_no_env() {
    // Regenerating committed media is a purely local step — accepting `--env`
    // would imply it publishes something.
    assert!(
        Cli::try_parse_from(["tcab", "capture-baselines", "--env", "prod", "carom"]).is_err(),
        "capture-baselines should reject --env"
    );
}

#[test]
fn capture_baselines_rejects_variant_with_all_variants() {
    assert!(
        Cli::try_parse_from([
            "tcab",
            "capture-baselines",
            "carom",
            "--variant",
            "base",
            "--all-variants",
        ])
        .is_err(),
        "--variant and --all-variants should conflict"
    );
}

#[test]
fn capture_baselines_requires_a_slug() {
    assert!(
        Cli::try_parse_from(["tcab", "capture-baselines"]).is_err(),
        "the case slug is required"
    );
}

#[test]
fn analyze_parses_a_bare_directory() {
    let cli = Cli::try_parse_from(["tcab", "analyze", "crates/gg"])
        .expect("a directory is the only required argument");

    match cli.command {
        Command::Analyze(args) => {
            assert_eq!(args.path, "crates/gg");
            assert!(args.seed_commit.is_none());
            assert!(!args.json);
            assert_eq!(args.top, 10);
            // An arbitrary directory cannot honestly claim nothing has built in it, so the
            // recorded basis defaults to the conservative one.
            assert_eq!(args.tree_basis, TreeBasisArg::PostValidation);
        }
        other => panic!("expected an analyze command, got {other:?}"),
    }
}

#[test]
fn analyze_parses_its_options() {
    let cli = Cli::try_parse_from([
        "tcab",
        "analyze",
        "/runs/abc/implementation",
        "--seed-commit",
        "6f03bfee",
        "--tree-basis",
        "pre-validation",
        "--top",
        "3",
        "--json",
    ])
    .expect("a fully specified analyze invocation should parse");

    match cli.command {
        Command::Analyze(args) => {
            assert_eq!(args.seed_commit.as_deref(), Some("6f03bfee"));
            assert_eq!(args.tree_basis, TreeBasisArg::PreValidation);
            assert_eq!(args.top, 3);
            assert!(args.json);
        }
        other => panic!("expected an analyze command, got {other:?}"),
    }
}

#[test]
fn analyze_requires_a_directory() {
    assert!(
        Cli::try_parse_from(["tcab", "analyze"]).is_err(),
        "the directory is required — there is no useful default tree to analyse"
    );
}

/// `tcab gg-replay` accepts its whole flag set alongside the run-id positional.
///
/// The parser file carries this because the surface is a *contract with another binary*: `--record`
/// and `--steps` are forwarded verbatim to `gg replay` when `--gg` resolves an older release, so a
/// rename here silently breaks a delegation that has no other way to fail.
#[test]
fn gg_replay_parses_a_run_id_with_steps_and_an_older_gg() {
    let cli = Cli::try_parse_from([
        "tcab",
        "gg-replay",
        "run-abc",
        "--steps",
        "/tmp/steps.json",
        "--gg",
        "0.6.9",
    ])
    .expect("a fully specified gg-replay invocation should parse");

    match cli.command {
        Command::GgReplay(args) => {
            assert_eq!(args.run_id.as_deref(), Some("run-abc"));
            assert!(args.record.is_none());
            assert_eq!(
                args.steps,
                Some(std::path::PathBuf::from("/tmp/steps.json"))
            );
            assert_eq!(args.gg.as_deref(), Some("0.6.9"));
        }
        other => panic!("expected a gg-replay command, got {other:?}"),
    }
}

/// The shipped `--record` spelling still parses on its own, with everything else defaulted.
#[test]
fn gg_replay_still_parses_the_record_flag_alone() {
    let cli = Cli::try_parse_from(["tcab", "gg-replay", "--record", "/tmp/replay.json"])
        .expect("the shipped spelling should keep parsing");

    match cli.command {
        Command::GgReplay(args) => {
            assert_eq!(
                args.record,
                Some(std::path::PathBuf::from("/tmp/replay.json"))
            );
            assert!(args.run_id.is_none());
            assert!(args.steps.is_none());
            assert!(args.gg.is_none());
        }
        other => panic!("expected a gg-replay command, got {other:?}"),
    }
}

/// `tcab gg-playback` defaults to the **strict** reconstruction, and every relaxation has to be
/// typed.
///
/// The parser file carries this because the defaults *are* the safety property: a playback that
/// silently ran under `shape`, or without the ordering barrier, or with permission to execute an
/// unrecorded command, would report a session that did not happen and nothing downstream could
/// tell. The exit code stamps the mode for the same reason — this is where the mode is chosen.
#[test]
fn gg_playback_defaults_to_the_strict_reconstruction() {
    let cli = Cli::try_parse_from(["tcab", "gg-playback", "--record", "/tmp/replay.json.gz"])
        .expect("naming a record alone should parse");

    match cli.command {
        Command::GgPlayback(args) => {
            assert_eq!(
                args.record,
                Some(std::path::PathBuf::from("/tmp/replay.json.gz"))
            );
            assert!(args.run_id.is_none());
            assert_eq!(args.strictness, StrictnessArg::Exact);
            assert_eq!(args.ordering, OrderingArg::Seq);
            assert!(
                !args.execute_unrecorded,
                "a playback never starts a process unless asked by name",
            );
            assert!(!args.stop_on_unrecorded);
            assert!(
                args.workspace.is_none(),
                "with no workspace named, the reconstruction builds in a temporary one",
            );
        }
        other => panic!("expected a gg-playback command, got {other:?}"),
    }
}

/// The run-id positional and the whole relaxation set parse together.
#[test]
fn gg_playback_parses_a_run_id_with_every_relaxation() {
    let cli = Cli::try_parse_from([
        "tcab",
        "gg-playback",
        "run-abc",
        "--workspace",
        "/tmp/tree",
        "--report",
        "/tmp/report.json",
        "--events",
        "/tmp/events.ndjson",
        "--strictness",
        "shape",
        "--ordering",
        "free",
        "--execute-unrecorded",
    ])
    .expect("a fully specified gg-playback invocation should parse");

    match cli.command {
        Command::GgPlayback(args) => {
            assert_eq!(args.run_id.as_deref(), Some("run-abc"));
            assert_eq!(args.workspace, Some(std::path::PathBuf::from("/tmp/tree")));
            assert_eq!(
                args.report,
                Some(std::path::PathBuf::from("/tmp/report.json"))
            );
            assert_eq!(
                args.events,
                Some(std::path::PathBuf::from("/tmp/events.ndjson"))
            );
            assert_eq!(args.strictness, StrictnessArg::Shape);
            assert_eq!(args.ordering, OrderingArg::Free);
            assert!(args.execute_unrecorded);
        }
        other => panic!("expected a gg-playback command, got {other:?}"),
    }
}

/// A record must be named, exactly one way — and the two miss-policy escapes are mutually
/// exclusive, so "execute it, but also stop on it" is a parse error phrased in the flags the user
/// typed rather than a silent precedence rule in the handler.
#[test]
fn gg_playback_refuses_the_impossible_combinations() {
    assert!(
        Cli::try_parse_from(["tcab", "gg-playback"]).is_err(),
        "a playback needs a record: a run id, or --record",
    );
    assert!(
        Cli::try_parse_from(["tcab", "gg-playback", "run-abc", "--record", "/tmp/r.json"]).is_err(),
        "naming both a run id and a file is a parse error, not a precedence rule",
    );
    assert!(
        Cli::try_parse_from([
            "tcab",
            "gg-playback",
            "--record",
            "/tmp/r.json",
            "--execute-unrecorded",
            "--stop-on-unrecorded",
        ])
        .is_err(),
        "the two miss-policy escapes are opposites",
    );
}
