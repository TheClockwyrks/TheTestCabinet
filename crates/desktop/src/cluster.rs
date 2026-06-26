//! The self-contained local cluster the shipped desktop app stands up on launch.
//!
//! The desktop app is meant to be the lowest-friction way to use The Test Cabinet:
//! no git checkout, no image builds, no `make`. So — unless the shell is pointed at
//! an external backend (`TCAB_BACKEND_URL`, the path TTC developers take) — it
//! brings up the *whole* run topology itself on a throwaway **k3d** cluster, the
//! same way [`deployments/local/Makefile`](../../../deployments/local/Makefile)
//! does, but from the **published GHCR images** rather than locally-built ones, and
//! ingesting the test-case catalog the app **bundles** rather than a repo mount.
//!
//! The bootstrap runs as one straight-line routine on its own OS thread, emitting a
//! [`ClusterStatus`] on the `cluster://progress` event after every step so the
//! webview can hold a loading screen until the stack is [`ready`](Phase). The only
//! host prerequisite is a running container runtime (Docker, or a Docker-compatible
//! one); `k3d` and `kubectl` ship with the app as sidecars (falling back to `PATH`
//! in development).
//!
//! Resolved service URLs (the forwarded `127.0.0.1` backend) and the live
//! `kubectl port-forward` child processes are kept in the Tauri-managed
//! [`ClusterState`] so [`backend_url`](crate::backend_url) can report them and
//! [`shutdown`] can tear the forwards down on exit.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// The k3d cluster (and namespace) the app owns. Deliberately distinct from the
/// Makefile's `tcab`/`tcab-local` so a TTC developer's `make local-up` cluster and
/// the app's cluster never collide on one machine.
const CLUSTER_NAME: &str = "tcab-desktop";
const NAMESPACE: &str = "tcab-desktop";

/// The GHCR namespace the published service images live under (see
/// `.github/workflows/build-service-images.yml`). Substituted into the bundled
/// `overlays/app` `REPLACE_OWNER` placeholders at stage time.
const GHCR_OWNER: &str = "theclockwyrks";

/// The shared dispatcher↔backend claim token. A fixed local value: it never leaves
/// this machine (the cluster is loopback-only), so there is nothing to protect.
const SERVICE_TOKEN: &str = "tcab-desktop-service-token";

/// Harness provider keys lifted from the environment into `tcab-driver-secrets`
/// when present. The catalog comes up without any; only *launching* a run needs one.
const HARNESS_KEYS: &[&str] = &["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];

/// The event the webview's boot gate listens on for live bootstrap progress.
const PROGRESS_EVENT: &str = "cluster://progress";

/// The forwarded backend URL the webview talks to once the stack is up. Matches the
/// Makefile's `local-forward` backend port; the auth service's forwarded port
/// (8789) is already the shell's [`crate::config::auth_url`] default, so that needs
/// no override.
const BACKEND_URL: &str = "http://127.0.0.1:8787";

/// `(service, localhost port)` forwards the shell holds open — the same set
/// `make local-forward` exposes. Backend and auth let the console talk to the
/// stack; artifacts and arena back the build/media `<img>`/`<iframe>` loads and the
/// arena UI (the backend advertises their URLs via `GET /config`).
const FORWARDS: &[(&str, u16)] = &[
    ("tcab-backend", 8787),
    ("tcab-auth", 8789),
    ("tcab-artifacts", 8790),
    ("tcab-arena", 8791),
];

/// The image tag the app pulls its services at. Stamped at build time by the
/// release workflow to the `:<git-sha>` of the matching service-image build so an
/// installer pins a known-good image set; falls back to `latest` for local builds.
fn image_tag() -> &'static str {
    option_env!("TCAB_DESKTOP_IMAGE_TAG").unwrap_or("latest")
}

/// A coarse bootstrap phase, surfaced to the webview as `ClusterStatus.phase`. The
/// boot gate keys its copy off these strings, so keep them stable.
mod phase {
    pub const PREFLIGHT: &str = "preflight";
    pub const CLUSTER: &str = "cluster";
    pub const SERVICES: &str = "services";
    pub const INGEST: &str = "ingest";
    pub const READY: &str = "ready";
    pub const ERROR: &str = "error";
    /// The dev path: an external backend is configured, so no cluster is stood up.
    pub const SKIPPED: &str = "skipped";
}

/// A snapshot of the bootstrap, mirrored to the webview. `done` marks a terminal
/// state (ready, skipped, or error); `error` distinguishes a failure from success.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterStatus {
    /// One of the `phase::*` ids.
    pub phase: String,
    /// A human-readable line for the loading screen.
    pub detail: String,
    /// True once the bootstrap has reached a terminal state.
    pub done: bool,
    /// True when that terminal state is a failure.
    pub error: bool,
}

/// The Tauri-managed cluster lifecycle state: the latest status, the resolved
/// backend URL (once forwarded), and the live port-forward children to reap on exit.
pub struct ClusterState {
    inner: Mutex<Inner>,
}

struct Inner {
    status: ClusterStatus,
    backend_url: Option<String>,
    forwards: Vec<Child>,
}

impl Default for ClusterState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                status: ClusterStatus {
                    phase: phase::PREFLIGHT.to_string(),
                    detail: "Starting…".to_string(),
                    done: false,
                    error: false,
                },
                backend_url: None,
                forwards: Vec::new(),
            }),
        }
    }
}

impl ClusterState {
    /// The latest bootstrap status (the boot gate's initial read).
    pub fn status(&self) -> ClusterStatus {
        self.inner.lock().unwrap().status.clone()
    }

    /// The forwarded backend URL, once the stack is up (else `None`).
    pub fn backend_url(&self) -> Option<String> {
        self.inner.lock().unwrap().backend_url.clone()
    }
}

/// Record + broadcast a status. Updating the managed snapshot before emitting means
/// a late-subscribing webview still reads the current phase via `cluster_status`.
fn publish(app: &AppHandle, phase: &str, detail: impl Into<String>, done: bool, error: bool) {
    let status = ClusterStatus {
        phase: phase.to_string(),
        detail: detail.into(),
        done,
        error,
    };
    if let Some(state) = app.try_state::<ClusterState>() {
        state.inner.lock().unwrap().status = status.clone();
    }
    let _ = app.emit(PROGRESS_EVENT, status);
}

/// Mark the dev path: an external backend is configured, so the app does not stand
/// up its own cluster. The boot gate treats this terminal-non-error state as "go".
pub fn mark_skipped(app: &AppHandle) {
    publish(
        app,
        phase::SKIPPED,
        "Using the configured backend.",
        true,
        false,
    );
}

/// Spawn the bootstrap on its own OS thread (it shells out to k3d/kubectl and waits
/// on rollouts, so it must never run on the UI or async runtime). Re-invokable for a
/// retry after a failure.
pub fn spawn_bootstrap(app: AppHandle) {
    std::thread::spawn(move || {
        if let Err(message) = bootstrap(&app) {
            publish(&app, phase::ERROR, message, true, true);
        }
    });
}

/// Reap the port-forward children on app exit so no `kubectl` processes leak. The
/// cluster itself is intentionally left running for a fast next launch.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<ClusterState>() {
        let mut inner = state.inner.lock().unwrap();
        for mut child in inner.forwards.drain(..) {
            let _ = child.kill();
        }
    }
}

/// The whole bootstrap, step by step. Any step's `Err` becomes the terminal error
/// status (with its message shown on the loading screen).
fn bootstrap(app: &AppHandle) -> Result<(), String> {
    publish(
        app,
        phase::PREFLIGHT,
        "Checking prerequisites…",
        false,
        false,
    );
    preflight()?;

    publish(
        app,
        phase::CLUSTER,
        "Preparing the test-case catalog…",
        false,
        false,
    );
    let checkout = stage_checkout(app)?;
    let overlay = stage_overlay(app)?;
    let kubeconfig = app_data(app)?.join("kubeconfig");

    publish(
        app,
        phase::CLUSTER,
        "Starting the local cluster…",
        false,
        false,
    );
    ensure_cluster(&checkout, &kubeconfig)?;

    publish(app, phase::SERVICES, "Configuring services…", false, false);
    ensure_namespace(&kubeconfig)?;
    apply_secrets(&kubeconfig)?;

    publish(
        app,
        phase::SERVICES,
        "Deploying services (pulling images)…",
        false,
        false,
    );
    apply_overlay(&kubeconfig, &overlay)?;

    publish(
        app,
        phase::SERVICES,
        "Waiting for services to become ready…",
        false,
        false,
    );
    wait_for_services(&kubeconfig)?;

    publish(app, phase::INGEST, "Connecting…", false, false);
    start_forwards(app, &kubeconfig)?;
    wait_healthz(BACKEND_URL)?;

    publish(
        app,
        phase::INGEST,
        "Loading the test-case catalog…",
        false,
        false,
    );
    ingest(BACKEND_URL)?;

    // The backend is reachable and ingested: publish its URL so `backend_url`
    // reports it, then signal the boot gate to reveal the console.
    if let Some(state) = app.try_state::<ClusterState>() {
        state.inner.lock().unwrap().backend_url = Some(BACKEND_URL.to_string());
    }
    publish(app, phase::READY, "Ready.", true, false);
    Ok(())
}

// --- Steps ------------------------------------------------------------------

/// Confirm the host prerequisites: a reachable container runtime (k3d's backing
/// daemon) and the k3d/kubectl tools. Each failure carries actionable remediation —
/// it is the most common reason the app can't start.
fn preflight() -> Result<(), String> {
    run_quiet(tool("docker").arg("info")).map_err(|_| {
        "No running container runtime found. The Test Cabinet runs its services on a \
         local cluster, which needs Docker (or a Docker-compatible runtime) running. \
         Start Docker and reopen the app."
            .to_string()
    })?;
    run_quiet(tool("k3d").arg("version")).map_err(|e| format!("k3d is unavailable: {e}"))?;
    run_quiet(tool("kubectl").arg("version").arg("--client"))
        .map_err(|e| format!("kubectl is unavailable: {e}"))?;
    Ok(())
}

/// Stage the bundled `test-cases/` under `<app-data>/checkout/test-cases` and return
/// the `checkout` dir. k3d maps this dir to `/checkout` on the node, where the
/// backend (`TCAB_BACKEND_CHECKOUT=/checkout`) ingests it.
fn stage_checkout(app: &AppHandle) -> Result<PathBuf, String> {
    let checkout = app_data(app)?.join("checkout");
    let src = bundled(app, "test-cases", "", &[Path::new("test-cases")])?;
    mirror_dir(&src, &checkout.join("test-cases"))?;
    Ok(checkout)
}

/// Stage the bundled k8s manifests under `<app-data>/k8s`, substitute the GHCR
/// owner/tag placeholders into the `overlays/app` files, and return the overlay dir
/// to `kubectl apply -k`. The whole tree is copied so the overlay's `../../base`
/// reference resolves.
fn stage_overlay(app: &AppHandle) -> Result<PathBuf, String> {
    let dst = app_data(app)?.join("k8s");
    let src = bundled(
        app,
        "k8s",
        "overlays/app/kustomization.yaml",
        &[Path::new("deployments/k8s")],
    )?;
    mirror_dir(&src, &dst)?;
    let overlay = dst.join("overlays").join("app");
    substitute_dir(&overlay)?;
    Ok(overlay)
}

/// Create the k3d cluster if it does not already exist (idempotent across launches),
/// mapping the staged checkout to `/checkout` on the node, then write a dedicated
/// kubeconfig the shell uses for every `kubectl` call (never touching the user's).
fn ensure_cluster(checkout: &Path, kubeconfig: &Path) -> Result<(), String> {
    if !cluster_exists()? {
        let volume = format!("{}:/checkout@server:0", checkout.display());
        run_quiet(
            tool("k3d")
                .args(["cluster", "create", CLUSTER_NAME, "--volume"])
                .arg(&volume)
                .arg("--wait"),
        )
        .map_err(|e| format!("creating the local cluster: {e}"))?;
    }
    let out = run(tool("k3d").args(["kubeconfig", "get", CLUSTER_NAME]))
        .map_err(|e| format!("reading the cluster kubeconfig: {e}"))?;
    std::fs::write(kubeconfig, &out)
        .map_err(|e| format!("writing the kubeconfig to {}: {e}", kubeconfig.display()))?;
    Ok(())
}

/// Whether the app's k3d cluster already exists (parsed from `k3d cluster list`).
fn cluster_exists() -> Result<bool, String> {
    let out = run(tool("k3d").args(["cluster", "list", "-o", "json"]))
        .map_err(|e| format!("listing k3d clusters: {e}"))?;
    let parsed: serde_json::Value =
        serde_json::from_slice(&out).map_err(|e| format!("parsing the k3d cluster list: {e}"))?;
    Ok(parsed
        .as_array()
        .map(|clusters| {
            clusters
                .iter()
                .any(|c| c.get("name").and_then(|n| n.as_str()) == Some(CLUSTER_NAME))
        })
        .unwrap_or(false))
}

/// Create the namespace if absent (idempotent: an existing one is not an error).
fn ensure_namespace(kubeconfig: &Path) -> Result<(), String> {
    let out = kubectl(kubeconfig)
        .args(["create", "namespace", NAMESPACE])
        .output()
        .map_err(|e| format!("creating the namespace: {e}"))?;
    if out.status.success() || String::from_utf8_lossy(&out.stderr).contains("AlreadyExists") {
        return Ok(());
    }
    Err(format!(
        "creating the namespace: {}",
        String::from_utf8_lossy(&out.stderr).trim()
    ))
}

/// Create the cluster Secrets the manifests reference, by fixed name, from local
/// values: the shared service token (backend + dispatcher) and — only when a key is
/// present in the environment — the harness provider keys for driver Jobs.
fn apply_secrets(kubeconfig: &Path) -> Result<(), String> {
    apply_secret(
        kubeconfig,
        "tcab-backend-secrets",
        &[("TCAB_BACKEND_SERVICE_TOKEN", SERVICE_TOKEN)],
    )?;
    apply_secret(
        kubeconfig,
        "tcab-dispatcher-secrets",
        &[("TCAB_BACKEND_SERVICE_TOKEN", SERVICE_TOKEN)],
    )?;
    let harness = harness_literals();
    if !harness.is_empty() {
        let literals: Vec<(&str, &str)> = harness
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        apply_secret(kubeconfig, "tcab-driver-secrets", &literals)?;
    }
    Ok(())
}

/// Render one Secret with `--dry-run=client` and `kubectl apply -f -` it, so the
/// call is idempotent (created or updated in place) and no value is ever written to
/// disk.
fn apply_secret(kubeconfig: &Path, name: &str, literals: &[(&str, &str)]) -> Result<(), String> {
    let mut render = kubectl(kubeconfig);
    render.args([
        "create",
        "secret",
        "generic",
        name,
        "-n",
        NAMESPACE,
        "--dry-run=client",
        "-o",
        "yaml",
    ]);
    for (key, value) in literals {
        render.arg(format!("--from-literal={key}={value}"));
    }
    let manifest = run(&mut render).map_err(|e| format!("rendering secret {name}: {e}"))?;

    let mut apply = kubectl(kubeconfig);
    apply
        .args(["apply", "-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = apply
        .spawn()
        .map_err(|e| format!("applying secret {name}: {e}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| format!("applying secret {name}: no stdin"))?
        .write_all(&manifest)
        .map_err(|e| format!("applying secret {name}: {e}"))?;
    let out = child
        .wait_with_output()
        .map_err(|e| format!("applying secret {name}: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "applying secret {name}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// Apply the staged, substituted desktop overlay.
fn apply_overlay(kubeconfig: &Path, overlay: &Path) -> Result<(), String> {
    run_quiet(kubectl(kubeconfig).arg("apply").arg("-k").arg(overlay))
        .map_err(|e| format!("deploying the services: {e}"))?;
    Ok(())
}

/// Block until every always-on workload reports ready (driver Jobs are per-run, so
/// they are not awaited here). Mirrors the Makefile's `apply` rollout waits.
fn wait_for_services(kubeconfig: &Path) -> Result<(), String> {
    const STATEFULSETS: &[&str] = &["tcab-backend", "tcab-auth", "tcab-artifacts"];
    const DEPLOYMENTS: &[&str] = &["tcab-arena", "tcab-dispatcher"];
    for name in STATEFULSETS {
        rollout(kubeconfig, "statefulset", name)?;
    }
    for name in DEPLOYMENTS {
        rollout(kubeconfig, "deployment", name)?;
    }
    Ok(())
}

fn rollout(kubeconfig: &Path, kind: &str, name: &str) -> Result<(), String> {
    run_quiet(kubectl(kubeconfig).args([
        "-n",
        NAMESPACE,
        "rollout",
        "status",
        &format!("{kind}/{name}"),
        "--timeout=300s",
    ]))
    .map_err(|e| format!("waiting for {name}: {e}"))
}

/// Start (and record) the port-forwards. Recording each child as it spawns means a
/// later-step failure still leaves them reapable by [`shutdown`].
fn start_forwards(app: &AppHandle, kubeconfig: &Path) -> Result<(), String> {
    for (service, port) in FORWARDS {
        let mut cmd = kubectl(kubeconfig);
        cmd.args(["-n", NAMESPACE, "port-forward", &format!("svc/{service}")])
            .arg(format!("{port}:{port}"))
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = cmd
            .spawn()
            .map_err(|e| format!("forwarding {service}: {e}"))?;
        if let Some(state) = app.try_state::<ClusterState>() {
            state.inner.lock().unwrap().forwards.push(child);
        }
    }
    Ok(())
}

/// Poll the backend's `/healthz` until it answers (the port-forward needs a moment),
/// bounded so a stuck forward fails legibly instead of hanging the loading screen.
fn wait_healthz(base: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| format!("building the HTTP client: {e}"))?;
    let url = format!("{base}/healthz");
    for _ in 0..45 {
        if let Ok(resp) = client.get(&url).send()
            && resp.status().is_success()
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    Err("the backend did not become reachable in time".to_string())
}

/// Force-ingest the catalog from the mounted checkout (the backend does not ingest
/// on boot). The default JSON response blocks until the scan completes, so a
/// generous timeout covers a first full render of the reference mockups.
fn ingest(base: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("building the HTTP client: {e}"))?;
    let resp = client
        .post(format!("{base}/ingest"))
        .json(&serde_json::json!({ "force": true }))
        .send()
        .map_err(|e| format!("triggering catalog ingest: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("catalog ingest failed: HTTP {}", resp.status()));
    }
    Ok(())
}

// --- Commands ---------------------------------------------------------------

/// The current bootstrap status (the boot gate's initial read before its
/// `cluster://progress` subscription takes over).
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn cluster_status(state: State<ClusterState>) -> ClusterStatus {
    state.status()
}

/// Re-run the bootstrap after a failure (the loading screen's "Try again").
#[tauri::command]
#[tracing::instrument(skip_all)]
pub fn cluster_retry(app: AppHandle) {
    spawn_bootstrap(app);
}

// --- Helpers ----------------------------------------------------------------

/// The harness provider keys present in the environment, as owned pairs.
fn harness_literals() -> Vec<(String, String)> {
    HARNESS_KEYS
        .iter()
        .filter_map(|key| {
            std::env::var(key)
                .ok()
                .filter(|value| !value.is_empty())
                .map(|value| (key.to_string(), value))
        })
        .collect()
}

/// The app-data dir (created if missing), where the staged checkout, manifests, and
/// kubeconfig live.
fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolving the app-data directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("creating {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Resolve a bundled input directory. In a packaged app it sits under the resource
/// dir as `rel`; in development it is read from the repo via one of `dev_rel`
/// (searched from the working dir up through its ancestors).
///
/// `marker` confirms a candidate really holds the expected tree (a relative path
/// that must exist beneath it, or empty to accept any directory) — so a differing
/// bundle layout can't yield a wrong, empty match. A defensive `rel/rel` candidate
/// covers bundlers that nest a directory resource under its own name.
fn bundled(app: &AppHandle, rel: &str, marker: &str, dev_rel: &[&Path]) -> Result<PathBuf, String> {
    let holds = |dir: &Path| -> bool {
        if marker.is_empty() {
            dir.is_dir()
        } else {
            dir.join(marker).exists()
        }
    };
    if let Ok(resources) = app.path().resource_dir() {
        for candidate in [resources.join(rel), resources.join(rel).join(rel)] {
            if holds(&candidate) {
                return Ok(candidate);
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for base in std::iter::once(cwd.as_path()).chain(cwd.ancestors()) {
            for dev in dev_rel {
                let candidate = base.join(dev);
                if holds(&candidate) {
                    return Ok(candidate);
                }
            }
        }
    }
    Err(format!(
        "bundled resource `{rel}` not found (and no development copy on disk)"
    ))
}

/// Replace each file's GHCR owner/tag placeholders in place (the overlay only).
fn substitute_dir(dir: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(dir)
        .map_err(|e| format!("reading {}: {e}", dir.display()))?
        .flatten()
    {
        let path = entry.path();
        if path.is_file() {
            let text = std::fs::read_to_string(&path)
                .map_err(|e| format!("reading {}: {e}", path.display()))?;
            std::fs::write(&path, substitute(&text))
                .map_err(|e| format!("writing {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

/// Substitute the overlay's GHCR owner/tag placeholders. (`REPLACE_REGISTRY` image
/// *names* are left alone — they are kustomize match keys, not values to fill.)
fn substitute(text: &str) -> String {
    text.replace("REPLACE_OWNER", GHCR_OWNER)
        .replace("REPLACE_TAG", image_tag())
}

/// Recursively mirror `src` onto `dst`, replacing any prior contents so a re-launch
/// always stages the current bundled inputs.
fn mirror_dir(src: &Path, dst: &Path) -> Result<(), String> {
    if dst.exists() {
        std::fs::remove_dir_all(dst).map_err(|e| format!("clearing {}: {e}", dst.display()))?;
    }
    copy_tree(src, dst)
}

fn copy_tree(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("creating {}: {e}", dst.display()))?;
    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("reading {}: {e}", src.display()))?
        .flatten()
    {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_tree(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)
                .map_err(|e| format!("copying {} → {}: {e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

/// Resolve a bundled tool (`k3d`/`kubectl`/`docker`) to a `Command`: a sidecar
/// beside the executable when packaged, else the name on `PATH` (development, where
/// these are installed). `docker` is never bundled — it is the host prerequisite.
fn tool(name: &str) -> Command {
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        let mut candidate = dir.join(name);
        if cfg!(windows) {
            candidate.set_extension("exe");
        }
        if candidate.is_file() {
            return Command::new(candidate);
        }
    }
    Command::new(name)
}

/// A `kubectl` command pinned to the app's own kubeconfig, so it never reads or
/// mutates the user's current context.
fn kubectl(kubeconfig: &Path) -> Command {
    let mut cmd = tool("kubectl");
    cmd.arg("--kubeconfig").arg(kubeconfig);
    cmd
}

/// Run a command, returning its captured stdout on success or a message built from
/// its stderr/stdout on failure.
fn run(cmd: &mut Command) -> Result<Vec<u8>, String> {
    let out = cmd.output().map_err(|e| format!("failed to launch: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(detail.to_string());
    }
    Ok(out.stdout)
}

/// As [`run`], discarding the captured output.
fn run_quiet(cmd: &mut Command) -> Result<(), String> {
    run(cmd).map(|_| ())
}

#[cfg(test)]
#[path = "cluster.test.rs"]
mod tests;
