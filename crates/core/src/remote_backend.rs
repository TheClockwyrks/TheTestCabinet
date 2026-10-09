//! A deployed backend, reached through `az aks command invoke`.
//!
//! The staging and production clusters are private: their API servers and backends
//! answer only on the cluster network. What reaches them from a development machine
//! is an authenticated `az`, whose `aks command invoke` runs a shell command in a
//! helper pod inside the cluster and returns once it has finished, with everything the
//! command printed. Every operation here is one such command, which execs into the
//! backend pod's `ingest` sidecar and talks to the backend over localhost, the only
//! traffic the cluster's network policy admits.
//!
//! - [`RemoteBackend::ingest`] refreshes the sidecar's checkout, with its submodules,
//!   to the tip of the branch the target ingests, then posts `POST /ingest` asking
//!   for the NDJSON feed. The feed's lines are read out of the command's logs once
//!   the invoke returns.
//! - [`RemoteBackend::stored_versions`] reads the backend's suite detail of each
//!   named version.
//! - [`RemoteBackend::upload_reference_builds`] attaches each archive to the invoke
//!   and posts it to the backend from the sidecar.
//!
//! The targets are read from `crates/core/publish-targets.toml`, which
//! `scripts/generate-publish-targets.sh` renders from `scripts/lib/env.sh`, so a
//! target resolves to exactly the resources the shell scripts act on.
//!
//! `az` is run through [`AzRunner`], so every command line is asserted in tests
//! against a stand-in executable rather than a cluster.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};

use serde::Deserialize;

use crate::backend_client::{
    IngestFeed, IngestMode, IngestProgress, IngestSummary, ReferenceBuildUpload, ingest_body,
};

/// The committed targets file.
pub const TARGETS_TOML: &str = include_str!("../publish-targets.toml");

/// The program run for every `az` invocation.
pub const AZ: &str = "az";

/// The command that signs `az` in.
pub const AZ_LOGIN: &str = "az login";

/// The checkout the ingest sidecar refreshes and the backend ingests.
const CHECKOUT: &str = "/state/checkout";

/// The address the backend answers at from inside its pod.
const BACKEND: &str = "http://127.0.0.1:8787";

/// The start of a logged line carrying one stored version's detail.
const DETAIL_MARKER: &str = "tcab-detail";

/// The start of a logged line carrying one upload's answer.
const UPLOAD_MARKER: &str = "tcab-upload";

/// The longest excerpt of a failed command's logs carried into an error.
const LOG_EXCERPT_LINES: usize = 20;

/// A deployed environment a backend runs in.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct RemoteTarget {
    /// The name it is addressed by: `staging`, `prod`.
    pub name: String,
    /// The Azure resource group holding its cluster.
    pub resource_group: String,
    /// The AKS cluster.
    pub cluster: String,
    /// The namespace the services run in.
    pub namespace: String,
    /// The superproject branch whose tip its backend ingests.
    pub ingest_branch: String,
}

#[derive(Deserialize)]
struct TargetsFile {
    target: Vec<RemoteTarget>,
}

static TARGETS: LazyLock<Vec<RemoteTarget>> = LazyLock::new(|| {
    parse_targets(TARGETS_TOML)
        .unwrap_or_else(|error| panic!("crates/core/publish-targets.toml does not parse: {error}"))
});

/// Parse a targets file.
pub fn parse_targets(text: &str) -> Result<Vec<RemoteTarget>, toml::de::Error> {
    toml::from_str::<TargetsFile>(text).map(|file| file.target)
}

/// Every remote target, in the order they are offered.
pub fn remote_targets() -> &'static [RemoteTarget] {
    &TARGETS
}

/// The remote target addressed as `name`.
pub fn remote_target(name: &str) -> Option<&'static RemoteTarget> {
    remote_targets().iter().find(|target| target.name == name)
}

/// What one `az` invocation produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AzOutput {
    /// Whether `az` exited zero.
    pub success: bool,
    /// Everything it wrote to stdout.
    pub stdout: String,
    /// Everything it wrote to stderr.
    pub stderr: String,
}

/// Running `az`, behind a trait so its command lines are testable.
#[async_trait::async_trait]
pub trait AzRunner: Send + Sync + std::fmt::Debug {
    /// Run `az` with `args`, in `cwd` when one is given, and capture its output. An
    /// `az` that cannot be started is the I/O error starting it gave.
    async fn run(&self, args: &[String], cwd: Option<&Path>) -> std::io::Result<AzOutput>;
}

/// The [`AzRunner`] that starts the real program.
#[derive(Debug, Clone)]
pub struct SystemAzRunner {
    program: PathBuf,
    path: Option<OsString>,
}

impl Default for SystemAzRunner {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemAzRunner {
    /// Run `az` from `PATH`.
    pub fn new() -> Self {
        Self {
            program: PathBuf::from(AZ),
            path: None,
        }
    }

    /// Run the program at `program` in place of `az`.
    pub fn with_program(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            path: None,
        }
    }

    /// Run the `az` found on `path`, which is searched ahead of the process's own
    /// `PATH` and is prepended to the `PATH` `az` itself runs with.
    pub fn with_path(path: impl Into<OsString>) -> Self {
        Self {
            program: PathBuf::from(AZ),
            path: Some(path.into()),
        }
    }
}

#[async_trait::async_trait]
impl AzRunner for SystemAzRunner {
    async fn run(&self, args: &[String], cwd: Option<&Path>) -> std::io::Result<AzOutput> {
        let search = self.path.as_ref().map(|path| {
            let mut dirs: Vec<PathBuf> = std::env::split_paths(path).collect();
            if let Some(inherited) = std::env::var_os("PATH") {
                dirs.extend(std::env::split_paths(&inherited));
            }
            std::env::join_paths(dirs).unwrap_or_else(|_| path.clone())
        });
        let program = match &search {
            Some(search) => which::which_in(&self.program, Some(search), std::env::temp_dir())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::NotFound, error))?,
            None => self.program.clone(),
        };
        let mut command = tokio::process::Command::new(program);
        command.args(args).kill_on_drop(true);
        if let Some(search) = &search {
            command.env("PATH", search);
        }
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        let output = command.output().await?;
        Ok(AzOutput {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

/// Whether `az` can act on a cluster.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AzLogin {
    /// `az` is signed in.
    Authenticated {
        /// The account it is signed in as.
        user: Option<String>,
        /// The subscription it acts in.
        subscription: Option<String>,
    },
    /// `az` is installed and not signed in.
    Unauthenticated {
        /// What `az` said.
        message: String,
    },
    /// `az` could not be started.
    Missing {
        /// Why.
        message: String,
    },
}

#[derive(Deserialize)]
struct AccountBody {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    user: Option<AccountUser>,
}

#[derive(Deserialize)]
struct AccountUser {
    #[serde(default)]
    name: Option<String>,
}

/// Ask `az` which account it is signed in as.
pub async fn az_login(runner: &dyn AzRunner) -> AzLogin {
    let args = strings(&["account", "show", "--output", "json"]);
    match runner.run(&args, None).await {
        Err(error) => AzLogin::Missing {
            message: format!("`{AZ}` could not be run: {error}"),
        },
        Ok(output) if !output.success => AzLogin::Unauthenticated {
            message: first_line(&output.stderr)
                .unwrap_or_else(|| format!("`{AZ} account show` failed")),
        },
        Ok(output) => {
            let account = serde_json::from_str::<AccountBody>(&output.stdout).ok();
            AzLogin::Authenticated {
                user: account
                    .as_ref()
                    .and_then(|account| account.user.as_ref())
                    .and_then(|user| user.name.clone()),
                subscription: account.and_then(|account| account.name),
            }
        }
    }
}

/// Why an operation on a deployed backend failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RemoteError {
    /// `az` could not be started.
    #[error("`{AZ}` could not be run ({detail}); install the Azure CLI and run `{AZ_LOGIN}`")]
    AzMissing {
        /// Why.
        detail: String,
    },
    /// `az` refused or failed the invoke itself.
    #[error("`{AZ} aks command invoke` against `{cluster}` failed: {message}")]
    Invoke {
        /// The cluster.
        cluster: String,
        /// What `az` said.
        message: String,
    },
    /// The command ran in the cluster and exited non-zero.
    #[error("the command run in `{cluster}` exited {exit_code}: {logs}")]
    Command {
        /// The cluster.
        cluster: String,
        /// Its exit code.
        exit_code: i64,
        /// The end of what it printed.
        logs: String,
    },
    /// The ingest did not finish.
    #[error("the ingest on `{cluster}` did not finish: {message}")]
    Ingest {
        /// The cluster.
        cluster: String,
        /// Why.
        message: String,
    },
}

/// What an invoke's command left behind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvokeResult {
    /// The command's exit code.
    pub exit_code: i64,
    /// Everything it printed.
    pub logs: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvokeBody {
    #[serde(default)]
    exit_code: Option<i64>,
    #[serde(default)]
    logs: Option<String>,
}

/// What the backend holds of one suite version, as its suite detail answered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoredDetail {
    /// It holds the version, with this detail body.
    Stored(serde_json::Value),
    /// It holds no record of the version.
    Absent,
    /// It answered with a failure, or not at all.
    Failed(String),
}

/// One reference build to upload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceBuildArchive {
    /// The suite.
    pub slug: String,
    /// The version folder name, with its leading `v`.
    pub version: String,
    /// The engine.
    pub engine: String,
    /// The gzipped tar of the build.
    pub archive: Vec<u8>,
}

/// A deployed backend, reached through `az aks command invoke`.
#[derive(Debug, Clone)]
pub struct RemoteBackend {
    target: RemoteTarget,
    runner: Arc<dyn AzRunner>,
}

impl RemoteBackend {
    /// The backend of `target`, invoked through `runner`.
    pub fn new(target: RemoteTarget, runner: Arc<dyn AzRunner>) -> Self {
        Self { target, runner }
    }

    /// The target.
    pub fn target(&self) -> &RemoteTarget {
        &self.target
    }

    /// Refresh the sidecar's checkout to the tip of the target's ingest branch,
    /// updating the test suites submodule to the commit that tip names, then scan it.
    ///
    /// Each line the command printed is reported once the invoke returns: an event of
    /// the ingest feed to `on_progress`, and every other line to `on_log`.
    pub async fn ingest(
        &self,
        targets: &[String],
        force: bool,
        mode: IngestMode,
        on_log: &mut (dyn FnMut(&str) + Send),
        on_progress: &mut (dyn FnMut(&IngestProgress) + Send),
    ) -> Result<IngestSummary, RemoteError> {
        let body = serde_json::to_string(&ingest_body(targets, force, mode)).map_err(|error| {
            RemoteError::Ingest {
                cluster: self.target.cluster.clone(),
                message: format!("encoding the request body: {error}"),
            }
        })?;
        let script = self.ingest_script(&body);
        let result = self.invoke(&script, None).await?;
        let mut feed = IngestFeed::default();
        for line in result.logs.lines() {
            let trimmed = line.trim();
            match feed.line(trimmed) {
                Some(progress) => on_progress(&progress),
                None if !trimmed.is_empty() => on_log(line),
                None => {}
            }
        }
        if result.exit_code != 0 {
            return Err(RemoteError::Command {
                cluster: self.target.cluster.clone(),
                exit_code: result.exit_code,
                logs: excerpt(&result.logs),
            });
        }
        feed.finish(&format!("the ingest sidecar on `{}`", self.target.cluster))
            .map_err(|error| RemoteError::Ingest {
                cluster: self.target.cluster.clone(),
                message: error.to_string(),
            })
    }

    /// What the backend holds of each `(slug, version)`, read in one invoke.
    pub async fn stored_versions(
        &self,
        versions: &[(String, String)],
    ) -> Result<BTreeMap<(String, String), StoredDetail>, RemoteError> {
        if versions.is_empty() {
            return Ok(BTreeMap::new());
        }
        let script = self.detail_script(versions);
        let result = self.invoke(&script, None).await?;
        let mut details = BTreeMap::new();
        for line in result.logs.lines() {
            let Some(rest) = line.trim().strip_prefix(DETAIL_MARKER) else {
                continue;
            };
            let mut fields = rest.trim_start().splitn(3, ' ');
            let (Some(path), Some(status)) = (fields.next(), fields.next()) else {
                continue;
            };
            let body = fields.next().unwrap_or("").trim();
            let Some((slug, version)) = path.split_once('/') else {
                continue;
            };
            let detail = match status {
                "200" => match serde_json::from_str(body) {
                    Ok(value) => StoredDetail::Stored(value),
                    Err(error) => {
                        StoredDetail::Failed(format!("the detail could not be read: {error}"))
                    }
                },
                "404" => StoredDetail::Absent,
                "000" => StoredDetail::Failed("the backend did not answer".to_owned()),
                other => StoredDetail::Failed(format!(
                    "the backend answered HTTP {other}: {}",
                    error_message(body)
                )),
            };
            details.insert((slug.to_owned(), version.to_owned()), detail);
        }
        for (slug, version) in versions {
            details
                .entry((slug.clone(), version.clone()))
                .or_insert_with(|| {
                    StoredDetail::Failed(if result.exit_code == 0 {
                        "the command printed no detail for it".to_owned()
                    } else {
                        format!(
                            "the command exited {}: {}",
                            result.exit_code,
                            excerpt(&result.logs)
                        )
                    })
                });
        }
        Ok(details)
    }

    /// Upload every archive in one invoke, answering with each one's outcome in the
    /// order given: the URL the backend plays it at, or why it was not stored.
    pub async fn upload_reference_builds(
        &self,
        archives: &[ReferenceBuildArchive],
    ) -> Result<Vec<Result<ReferenceBuildUpload, String>>, RemoteError> {
        if archives.is_empty() {
            return Ok(Vec::new());
        }
        let directory = tempfile::tempdir().map_err(|error| RemoteError::Invoke {
            cluster: self.target.cluster.clone(),
            message: format!("the archives could not be staged: {error}"),
        })?;
        for (index, archive) in archives.iter().enumerate() {
            std::fs::write(directory.path().join(archive_name(index)), &archive.archive).map_err(
                |error| RemoteError::Invoke {
                    cluster: self.target.cluster.clone(),
                    message: format!("the archives could not be staged: {error}"),
                },
            )?;
        }
        let script = self.upload_script(archives);
        let result = self.invoke(&script, Some(directory.path())).await?;
        let mut answers: BTreeMap<usize, Result<ReferenceBuildUpload, String>> = BTreeMap::new();
        for line in result.logs.lines() {
            let Some(rest) = line.trim().strip_prefix(UPLOAD_MARKER) else {
                continue;
            };
            let mut fields = rest.trim_start().splitn(3, ' ');
            let (Some(index), Some(status)) = (
                fields.next().and_then(|index| index.parse::<usize>().ok()),
                fields.next(),
            ) else {
                continue;
            };
            let body = fields.next().unwrap_or("").trim();
            let answer = if status.starts_with('2') {
                serde_json::from_str::<ReferenceBuildUpload>(body)
                    .map_err(|error| format!("the backend's answer could not be read: {error}"))
            } else if status == "000" {
                Err("the backend did not answer the upload".to_owned())
            } else {
                Err(format!(
                    "the backend answered HTTP {status}: {}",
                    error_message(body)
                ))
            };
            answers.insert(index, answer);
        }
        Ok((0..archives.len())
            .map(|index| {
                answers.remove(&index).unwrap_or_else(|| {
                    Err(format!(
                        "the command in `{}` printed no answer for the upload (exit {}): {}",
                        self.target.cluster,
                        result.exit_code,
                        excerpt(&result.logs)
                    ))
                })
            })
            .collect())
    }

    /// Run `script` in the cluster, attaching every file in `files` when given.
    pub async fn invoke(
        &self,
        script: &str,
        files: Option<&Path>,
    ) -> Result<InvokeResult, RemoteError> {
        let args = self.invoke_args(script, files.is_some());
        let output =
            self.runner
                .run(&args, files)
                .await
                .map_err(|error| RemoteError::AzMissing {
                    detail: error.to_string(),
                })?;
        let body = serde_json::from_str::<InvokeBody>(output.stdout.trim()).ok();
        match body {
            Some(InvokeBody {
                exit_code,
                logs: Some(logs),
            }) => Ok(InvokeResult {
                exit_code: exit_code.unwrap_or(if output.success { 0 } else { 1 }),
                logs,
            }),
            _ if !output.success => Err(RemoteError::Invoke {
                cluster: self.target.cluster.clone(),
                message: invoke_failure(&output.stderr),
            }),
            _ => Err(RemoteError::Invoke {
                cluster: self.target.cluster.clone(),
                message: "its answer carried no command logs".to_owned(),
            }),
        }
    }

    /// The arguments `az` is run with to invoke `script`.
    ///
    /// The script is handed over as `sh -c '<script>'`, so its redirections, pipes,
    /// and newlines are a shell's to read in the helper pod however `az` passes the
    /// command on.
    pub fn invoke_args(&self, script: &str, files: bool) -> Vec<String> {
        let command = format!("sh -c {}", shell_quote(script));
        let mut args = strings(&[
            "aks",
            "command",
            "invoke",
            "--resource-group",
            &self.target.resource_group,
            "--name",
            &self.target.cluster,
            "--command",
            &command,
            "--output",
            "json",
        ]);
        if files {
            args.extend(strings(&["--file", "."]));
        }
        args
    }

    /// `kubectl exec` into the ingest sidecar, running `inner` with `args` as its
    /// positional parameters.
    fn exec(&self, stdin: bool, inner: &str, args: &[&str]) -> String {
        let mut line = format!(
            "kubectl -n {} exec{} deploy/the-test-cabinet-backend -c ingest -- sh -c {} sh",
            shell_quote(&self.target.namespace),
            if stdin { " -i" } else { "" },
            shell_quote(inner),
        );
        for arg in args {
            line.push(' ');
            line.push_str(arg);
        }
        line
    }

    /// The command refreshing the checkout and posting the ingest `body`.
    pub fn ingest_script(&self, body: &str) -> String {
        let inner = format!(
            "set -e\n\
             export GIT_TERMINAL_PROMPT=0\n\
             {refresh}\n\
             echo \"ingest: triggering the ingest\"\n\
             curl -sS -N --fail-with-body -X POST {BACKEND}/ingest \
             -H \"content-type: application/json\" -H \"accept: application/x-ndjson\" \
             --data \"$2\"\n\
             echo",
            refresh = refresh_commands("$1"),
        );
        format!(
            "set -e\n{}\n",
            self.exec(
                false,
                &inner,
                &[&shell_quote(&self.target.ingest_branch), &shell_quote(body)]
            )
        )
    }

    /// The command printing the suite detail of each version.
    pub fn detail_script(&self, versions: &[(String, String)]) -> String {
        let inner = format!(
            "for path in \"$@\"; do \
             status=$(curl -sS -o /tmp/tcab-detail -w \"%{{http_code}}\" \"{BACKEND}/test-suites/$path\") || status=000; \
             printf \"{DETAIL_MARKER} %s %s \" \"$path\" \"$status\"; \
             tr -d \"\\n\" < /tmp/tcab-detail 2>/dev/null || true; \
             echo; \
             done"
        );
        let paths: Vec<String> = versions
            .iter()
            .map(|(slug, version)| shell_quote(&format!("{slug}/{version}")))
            .collect();
        let paths: Vec<&str> = paths.iter().map(String::as_str).collect();
        format!("{}\n", self.exec(false, &inner, &paths))
    }

    /// The command posting each attached archive.
    pub fn upload_script(&self, archives: &[ReferenceBuildArchive]) -> String {
        let inner = format!(
            "status=$(curl -sS -o /tmp/tcab-upload -w \"%{{http_code}}\" -X PUT \
             -H \"content-type: application/gzip\" --data-binary @- \
             \"{BACKEND}/suites/$2/versions/$3/reference-builds/$4\") || status=000; \
             printf \"{UPLOAD_MARKER} %s %s \" \"$1\" \"$status\"; \
             tr -d \"\\n\" < /tmp/tcab-upload 2>/dev/null || true; \
             echo"
        );
        let mut script = String::new();
        for (index, archive) in archives.iter().enumerate() {
            let index_text = index.to_string();
            let line = self.exec(
                true,
                &inner,
                &[
                    &index_text,
                    &shell_quote(&archive.slug),
                    &shell_quote(&archive.version),
                    &shell_quote(&archive.engine),
                ],
            );
            script.push_str(&format!(
                "{line} < {} || echo \"{UPLOAD_MARKER} {index} 000 kubectl exec failed\"\n",
                archive_name(index)
            ));
        }
        script
    }
}

/// The shell commands bringing the sidecar's checkout to the tip of the branch named
/// by `branch` (a shell word), with its submodules at the commits that tip names.
///
/// The superproject is fetched alone, then each submodule in its own step:
/// cold-storage shallowly, since its history is about 2 GB of baseline media and
/// ingest needs only the pinned commit, and the test suites after it.
///
/// The test suites step is the only one allowed to fail. It is the one that needs the
/// read-only test suites credential, and a credential not yet uploaded, expired or
/// refused must not keep the test cases and the reference-build lockfile from being
/// republished: the refresh names the failure and the ingest goes on without the
/// suites' changes, as the sidecar's own start does. Every other step fails the
/// refresh before anything is posted.
///
/// The patch-backend-ingest.yaml of each `azure-*` overlay runs the same commands
/// when its sidecar starts, where each step is allowed to fail so a fresh pod always
/// ingests what it has.
pub fn refresh_commands(branch: &str) -> String {
    format!(
        "echo \"ingest: refreshing {CHECKOUT} to origin/{branch} with its submodules\"\n\
         git -C {CHECKOUT} fetch --depth 1 origin \"{branch}\"\n\
         git -C {CHECKOUT} reset --hard FETCH_HEAD\n\
         git -C {CHECKOUT} submodule sync --recursive\n\
         git -C {CHECKOUT} submodule update --init --depth 1 cold-storage\n\
         git -C {CHECKOUT} submodule update --init --recursive --force test-suites \
         || echo \"{SUITES_UPDATE_FAILED}\"\n\
         git -C {CHECKOUT} submodule status --recursive"
    )
}

/// The line the refresh prints when the test suites submodule could not be updated.
pub const SUITES_UPDATE_FAILED: &str = "ingest: test suites update failed; ingesting without them";

/// The name an archive is attached under.
fn archive_name(index: usize) -> String {
    format!("build-{index}.tar.gz")
}

/// `value` as one single-quoted shell word.
pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn first_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_owned)
}

/// Why `az` failed an invoke, with how to sign in when it is not signed in.
fn invoke_failure(stderr: &str) -> String {
    let said = stderr.trim();
    let said = if said.is_empty() {
        "it exited non-zero and said nothing".to_owned()
    } else {
        excerpt(said)
    };
    if said.contains("az login") || said.to_ascii_lowercase().contains("please run") {
        said
    } else {
        format!("{said} (is `{AZ}` signed in? run `{AZ_LOGIN}`)")
    }
}

/// The message of an error envelope, or the body itself.
fn error_message(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value["error"]["message"].as_str().map(str::to_owned))
        .unwrap_or_else(|| body.chars().take(240).collect())
}

/// The last lines of `logs`.
fn excerpt(logs: &str) -> String {
    let lines: Vec<&str> = logs
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let start = lines.len().saturating_sub(LOG_EXCERPT_LINES);
    lines[start..].join("\n")
}

#[cfg(test)]
#[path = "remote_backend.test.rs"]
mod tests;
