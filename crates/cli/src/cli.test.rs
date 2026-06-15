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
        }
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
fn publish_accepts_a_batch_of_run_records() {
    let cli = Cli::try_parse_from(["tcab", "publish", "a.json", "b.json", "c.json"])
        .expect("multiple run records should parse for batch publishing");

    match cli.command {
        Command::Publish(args) => {
            assert_eq!(args.run_records.len(), 3);
            assert!(!args.force);
        }
        other => panic!("expected a publish command, got {other:?}"),
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
fn catalog_parses_with_defaults() {
    let cli = Cli::try_parse_from(["tcab", "catalog"])
        .expect("the catalog subcommand should parse with no arguments");

    match cli.command {
        Command::Catalog(args) => {
            // The catalog reads the model catalog from `models` and writes the
            // datasets under `apps/site` unless told otherwise.
            assert_eq!(args.models_dir, std::path::PathBuf::from("models"));
            assert_eq!(args.site_dir, std::path::PathBuf::from("apps/site"));
        }
        other => panic!("expected a catalog command, got {other:?}"),
    }
}

#[test]
fn catalog_accepts_directory_overrides() {
    let cli = Cli::try_parse_from([
        "tcab",
        "catalog",
        "--models-dir",
        "/tmp/models",
        "--site-dir",
        "/tmp/site",
    ])
    .expect("explicit catalog directories should parse");

    match cli.command {
        Command::Catalog(args) => {
            assert_eq!(args.models_dir.to_str(), Some("/tmp/models"));
            assert_eq!(args.site_dir.to_str(), Some("/tmp/site"));
        }
        other => panic!("expected a catalog command, got {other:?}"),
    }
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
