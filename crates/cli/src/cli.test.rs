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
fn a_subcommands_help_parses() {
    // `tcab validate --help` is a parse "error" of the help kind; clap signals it via
    // `ErrorKind::DisplayHelp` rather than a real failure.
    let err = Cli::try_parse_from(["tcab", "validate", "--help"])
        .expect_err("--help should short-circuit parsing");
    assert_eq!(err.kind(), clap::error::ErrorKind::DisplayHelp);
}

/// The commands the CLI overview documents, in the order `tcab --help` lists them.
const DOCUMENTED_COMMANDS: [&str; 8] = [
    "validate",
    "seed",
    "prompt",
    "publish-reference",
    "publish-asset-reference",
    "capture-baselines",
    "ingest",
    "analyze",
];

#[test]
fn the_cli_declares_exactly_the_documented_commands() {
    let command = Cli::command();
    let declared: Vec<&str> = command
        .get_subcommands()
        .map(|sub| sub.get_name())
        .collect();
    assert_eq!(declared, DOCUMENTED_COMMANDS);
}

#[test]
fn the_run_side_commands_are_gone() {
    // Launching, reviewing and publishing a run, and listing the harnesses,
    // orchestrators, engines and groups a run is launched with, all happen in the
    // console; the CLI launches nothing.
    for command in [
        "run",
        "review",
        "publish",
        "harnesses",
        "orchestrators",
        "engines",
        "test-case-groups",
    ] {
        let err =
            Cli::try_parse_from(["tcab", command]).expect_err("a removed command should not parse");
        assert_eq!(
            err.kind(),
            clap::error::ErrorKind::InvalidSubcommand,
            "`tcab {command}` should be an unknown subcommand"
        );
    }
}

#[test]
fn top_level_help_parses() {
    let err =
        Cli::try_parse_from(["tcab", "--help"]).expect_err("--help should short-circuit parsing");
    assert_eq!(err.kind(), clap::error::ErrorKind::DisplayHelp);
}

#[test]
fn seed_prompt_and_validate_default_the_variant_to_base() {
    let seed = Cli::try_parse_from([
        "tcab",
        "seed",
        "--test-case",
        "carom-end-to-end",
        "--version",
        "v1.0.0",
    ])
    .expect("omitting --variant parses");
    match seed.command {
        Command::Seed(args) => assert_eq!(args.variant, "base"),
        other => panic!("expected seed, got {other:?}"),
    }

    let prompt = Cli::try_parse_from([
        "tcab",
        "prompt",
        "--test-case",
        "carom-end-to-end",
        "--version",
        "v1.0.0",
    ])
    .expect("omitting --variant parses");
    match prompt.command {
        Command::Prompt(args) => assert_eq!(args.variant, "base"),
        other => panic!("expected prompt, got {other:?}"),
    }

    let validate = Cli::try_parse_from([
        "tcab",
        "validate",
        "--implementation",
        "impl",
        "--test-case",
        "carom-end-to-end",
        "--version",
        "v1.0.0",
    ])
    .expect("omitting --variant parses");
    match validate.command {
        Command::Validate(args) => assert_eq!(args.variant, "base"),
        other => panic!("expected validate, got {other:?}"),
    }
}

#[test]
fn ingest_takes_positional_targets_and_force() {
    let cli = Cli::try_parse_from(["tcab", "ingest", "carom", "carom-suite@v1.0.0", "--force"])
        .expect("targets and --force parse");
    match cli.command {
        Command::Ingest(args) => {
            assert_eq!(args.targets, vec!["carom", "carom-suite@v1.0.0"]);
            assert!(args.force);
        }
        other => panic!("expected ingest, got {other:?}"),
    }
}

#[test]
fn ingest_with_no_targets_is_a_whole_checkout_scan() {
    let cli = Cli::try_parse_from(["tcab", "ingest"]).expect("a bare ingest parses");
    match cli.command {
        Command::Ingest(args) => {
            assert!(args.targets.is_empty());
            assert!(!args.force);
            assert!(!args.changed);
        }
        other => panic!("expected ingest, got {other:?}"),
    }
}

#[test]
fn ingest_takes_changed() {
    let cli = Cli::try_parse_from(["tcab", "ingest", "--changed"]).expect("--changed parses");
    match cli.command {
        Command::Ingest(args) => {
            assert!(args.changed);
            assert!(!args.force);
        }
        other => panic!("expected ingest, got {other:?}"),
    }
}

#[test]
fn ingest_refuses_changed_with_force() {
    // `--force` rewrites every target, so asking for only the changed ones as well
    // is a contradiction rather than a refinement.
    Cli::try_parse_from(["tcab", "ingest", "--changed", "--force"])
        .expect_err("--changed and --force conflict");
}

#[test]
fn the_account_commands_are_gone() {
    for command in ["login", "logout", "register"] {
        assert!(
            Cli::try_parse_from(["tcab", command]).is_err(),
            "`tcab {command}` still parses"
        );
    }
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
            // Omitting --engine validates the build as an engineless one, the
            // same default a run takes.
            assert_eq!(args.engine, "none");
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
            // And with no engine named, nothing is vendored into it.
            assert_eq!(args.engine, "none");
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
            // The prompt renders for `none` unless an engine is named, which is
            // the text a run without `--engine` would hand the harness.
            assert_eq!(args.engine, "none");
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
fn local_commands_accept_an_engine_selection() {
    // The three commands that reproduce a run's inputs locally take the same
    // `--engine` a run is launched with, because each of them renders or materializes
    // something the engine changes: the seeded tree, the prompt, and what the
    // build is validated against.
    let seed = Cli::try_parse_from([
        "tcab",
        "seed",
        "--test-case",
        "carom",
        "--version",
        "3.0.0",
        "--variant",
        "base",
        "--engine",
        "simple-2d",
    ])
    .expect("a seed invocation with an engine selection should parse");
    match seed.command {
        Command::Seed(args) => assert_eq!(args.engine, "simple-2d"),
        other => panic!("expected a seed command, got {other:?}"),
    }

    let validate = Cli::try_parse_from([
        "tcab",
        "validate",
        "--implementation",
        "/tmp/impl",
        "--test-case",
        "carom",
        "--version",
        "3.0.0",
        "--variant",
        "base",
        "--engine",
        "simple-2d",
    ])
    .expect("a validate invocation with an engine selection should parse");
    match validate.command {
        Command::Validate(args) => assert_eq!(args.engine, "simple-2d"),
        other => panic!("expected a validate command, got {other:?}"),
    }

    let prompt = Cli::try_parse_from([
        "tcab",
        "prompt",
        "--test-case",
        "carom",
        "--version",
        "3.0.0",
        "--variant",
        "base",
        "--engine",
        "simple-2d",
    ])
    .expect("a prompt invocation with an engine selection should parse");
    match prompt.command {
        Command::Prompt(args) => assert_eq!(args.engine, "simple-2d"),
        other => panic!("expected a prompt command, got {other:?}"),
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
    let cli = Cli::try_parse_from(["tcab", "analyze", "crates/driver"])
        .expect("a directory is the only required argument");

    match cli.command {
        Command::Analyze(args) => {
            assert_eq!(args.path, "crates/driver");
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

#[test]
fn ingest_names_a_deployed_environment() {
    let cli = Cli::try_parse_from(["tcab", "ingest", "--env", "staging", "--changed"])
        .expect("--env staging parses");
    match cli.command {
        Command::Ingest(args) => assert_eq!(args.env, Some(DeployEnv::Staging)),
        other => panic!("expected ingest, got {other:?}"),
    }
    Cli::try_parse_from(["tcab", "ingest", "--env", "dev"])
        .expect_err("an unknown environment is refused");
}

#[test]
fn an_environment_maps_to_its_origin_with_the_backend_under_api() {
    assert_eq!(
        DeployEnv::Prod.backend_url(),
        "https://console.testcabinet.ai/api"
    );
    assert_eq!(
        DeployEnv::Staging.backend_url(),
        "https://console.staging.testcabinet.ai/api"
    );
}

#[test]
fn publish_asset_reference_parses_slug_only_and_defaults_version_and_selectors() {
    let cli = Cli::try_parse_from([
        "tcab",
        "publish-asset-reference",
        "--env",
        "staging",
        "sprite",
    ])
    .expect("a bare slug with --env parses");
    match cli.command {
        Command::PublishAssetReference(args) => {
            assert_eq!(args.env, DeployEnv::Staging);
            assert_eq!(args.slug, "sprite");
            assert_eq!(args.version, None);
            assert_eq!(args.variant, None);
            assert!(!args.all_variants);
        }
        other => panic!("expected a publish-asset-reference command, got {other:?}"),
    }
}

#[test]
fn publish_asset_reference_accepts_a_positional_version_and_a_selector() {
    let cli = Cli::try_parse_from([
        "tcab",
        "publish-asset-reference",
        "--env",
        "prod",
        "sprite",
        "v1.0.0",
        "--variant",
        "base",
    ])
    .expect("a version and --variant parse");
    match cli.command {
        Command::PublishAssetReference(args) => {
            assert_eq!(args.env, DeployEnv::Prod);
            assert_eq!(args.version.as_deref(), Some("v1.0.0"));
            assert_eq!(args.variant.as_deref(), Some("base"));
        }
        other => panic!("expected a publish-asset-reference command, got {other:?}"),
    }

    let cli = Cli::try_parse_from([
        "tcab",
        "publish-asset-reference",
        "--env",
        "prod",
        "sprite",
        "--all-variants",
    ])
    .expect("--all-variants parses");
    match cli.command {
        Command::PublishAssetReference(args) => assert!(args.all_variants),
        other => panic!("expected a publish-asset-reference command, got {other:?}"),
    }
}

#[test]
fn publish_asset_reference_rejects_variant_with_all_variants() {
    let err = Cli::try_parse_from([
        "tcab",
        "publish-asset-reference",
        "--env",
        "prod",
        "sprite",
        "--variant",
        "base",
        "--all-variants",
    ])
    .expect_err("the two selectors are mutually exclusive");
    assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
}

#[test]
fn publish_asset_reference_requires_an_env_and_a_slug() {
    let err = Cli::try_parse_from(["tcab", "publish-asset-reference", "sprite"])
        .expect_err("--env is required");
    assert_eq!(err.kind(), clap::error::ErrorKind::MissingRequiredArgument);
    let err = Cli::try_parse_from(["tcab", "publish-asset-reference", "--env", "prod"])
        .expect_err("the slug is required");
    assert_eq!(err.kind(), clap::error::ErrorKind::MissingRequiredArgument);
}

#[test]
fn publish_asset_reference_takes_only_its_documented_flags() {
    // An asset reference is drawn, not built: there is no engine to pick, no baseline
    // to capture and no plan to print.
    for flag in ["--engine", "--skip-baselines", "--dry-run"] {
        let mut argv = vec![
            "tcab",
            "publish-asset-reference",
            "--env",
            "prod",
            "sprite",
            flag,
        ];
        if flag == "--engine" {
            argv.push("none");
        }
        let err = Cli::try_parse_from(argv).expect_err("an undocumented flag should not parse");
        assert_eq!(
            err.kind(),
            clap::error::ErrorKind::UnknownArgument,
            "`{flag}` should be unknown"
        );
    }
}
