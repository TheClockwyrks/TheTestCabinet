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
        "--orchestrator",
        "ralph",
        "--auth-mode",
        "subscription",
    ])
    .expect("a run invocation with orchestrator and auth-mode selection should parse");

    match cli.command {
        Command::Run(args) => {
            assert_eq!(args.orchestrator, "ralph");
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
        "600",
    ])
    .expect("a run invocation with --max-runtime should parse");

    match cli.command {
        Command::Run(args) => assert_eq!(args.max_runtime, Some(600)),
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
fn push_and_review_parse() {
    let cli = Cli::try_parse_from(["tcab", "push", "run-a", "run-b"]).expect("push parses");
    match cli.command {
        Command::Push(args) => assert_eq!(args.run_ids.len(), 2),
        other => panic!("expected a push command, got {other:?}"),
    }

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
fn catalog_parses_with_defaults() {
    let cli = Cli::try_parse_from(["tcab", "catalog"])
        .expect("the catalog subcommand should parse with no arguments");

    match cli.command {
        Command::Catalog(args) => {
            // The catalog reads the model catalog from `models` and writes
            // `models.json` into the shared UI package unless told otherwise.
            assert_eq!(args.models_dir, std::path::PathBuf::from("models"));
            assert_eq!(
                args.data_dir,
                std::path::PathBuf::from("packages/ui/src/app/data")
            );
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
        "--data-dir",
        "/tmp/data",
    ])
    .expect("explicit catalog directories should parse");

    match cli.command {
        Command::Catalog(args) => {
            assert_eq!(args.models_dir.to_str(), Some("/tmp/models"));
            assert_eq!(args.data_dir.to_str(), Some("/tmp/data"));
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

#[test]
fn orchestrators_parses_with_json_flag() {
    let cli = Cli::try_parse_from(["tcab", "orchestrators", "--json"])
        .expect("the orchestrators subcommand should parse");

    match cli.command {
        Command::Orchestrators(args) => assert!(args.json),
        other => panic!("expected an orchestrators command, got {other:?}"),
    }
}
