//! The driver-`Job` builder: a claimed run → one Kubernetes `Job`.
//!
//! The dispatcher's whole product is a `batch/v1` `Job` per claimed run. Its pod
//! template runs the **driver** image with exactly the env the driver's `config`
//! reads (see the driver crate's `config.rs`): the backend URL, the job id, the
//! per-job token, the serialized launch request, `TCAB_DRIVER_RUNTIME=kubernetes`,
//! and the `TCAB_K8S_*` sandbox-pod passthroughs — plus `TCAB_K8S_POD_IP` wired to
//! the driver pod's own IP through the downward API, so the driver routes a
//! sandbox's live-preview frames back to itself. Any configured driver `Secret`s
//! (the harness provider API key) are mounted into the pod's env via `envFrom`.
//!
//! When a subscription `Secret` is configured, it is mounted as a **read-only
//! volume** (not env) at the configured directory, with `optional: true` so a
//! missing Secret never wedges an API-key-only driver pod, and the driver is told
//! where to find it via `TCAB_DRIVER_SUBSCRIPTION_DIR`. This is an additive,
//! parallel path to the API-key `envFrom` path — the two are independent. The
//! kubelet projects the Secret as files itself, so the dispatcher's
//! ServiceAccount needs **no** Secret-read RBAC for the volume mount (only an
//! API-read of a Secret would); none is added. Because those projected files are
//! **root-owned** but the driver runs unprivileged as the image's `node` user, the
//! pod also carries an `fsGroup` (see [`SUBSCRIPTION_FS_GROUP`]) and the volume is
//! mounted group-readable — without it the driver's own credential read fails with
//! `EACCES` and the run reports the subscription as unavailable.
//!
//! [`build_driver_job`] is **pure** given a [`ClaimedJob`] and the [`Config`], so
//! the manifest shape is unit-tested without a cluster — the same discipline the
//! driver/worker apply to their pod builders.
//!
//! The `Job` is deliberately a one-and-done: `restartPolicy: Never` and
//! `backoffLimit: 0` so a failed driver is **not** retried (the driver itself owns
//! reporting a specific failure to the backend; a silent retry would race that),
//! and `ttlSecondsAfterFinished` so a terminated `Job` and its pod are reaped
//! automatically. Every `Job` carries the [`MANAGED_BY`] label so the dispatcher
//! can list exactly the `Job`s it owns on restart, and the [`JOB_ID_LABEL`] so one
//! `Job` maps back to its backend job id without parsing its name.

use std::collections::BTreeMap;

use k8s_openapi::api::batch::v1::{Job, JobSpec};
use k8s_openapi::api::core::v1::{
    Container, EnvFromSource, EnvVar, EnvVarSource, ObjectFieldSelector, PodSecurityContext,
    PodSpec, PodTemplateSpec, ResourceRequirements, SecretEnvSource, SecretVolumeSource, Volume,
    VolumeMount,
};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;

use test_cabinet_core::ClaimedJob;

use crate::config::Config;

/// The value of the `app.kubernetes.io/managed-by` label every driver `Job` the
/// dispatcher creates carries. The dispatcher selects on it to find exactly the
/// `Job`s it owns — both to count in-flight work and to reconcile after a restart.
pub const MANAGED_BY: &str = "tcab-dispatcher";

/// The label key carrying the backend job id on each driver `Job`, so a listed
/// `Job` maps back to its job without parsing its generated name.
pub const JOB_ID_LABEL: &str = "tcab.dev/job-id";

/// The name of the single container in each driver `Job`'s pod.
const DRIVER_CONTAINER: &str = "driver";

/// The volume name the subscription `Secret` is mounted under, when configured.
const SUBSCRIPTION_VOLUME: &str = "subscription-creds";

/// The `fsGroup` applied to the driver pod when a subscription `Secret` is mounted.
///
/// A `Secret` volume is projected **root-owned**, so a credential file mounted
/// owner-only (mode `0o600`) is unreadable by the driver, which runs unprivileged
/// as the image's non-root `node` user — the read fails with `EACCES` and the run
/// reports the subscription as unavailable. Setting `fsGroup` makes the kubelet
/// change the projected files' group to this id (and grant the group read) *and*
/// adds it to the pod's processes as a supplementary group, so the `node` user can
/// read them while the files stay non-world-readable. The value need only be
/// consistent (any gid works, since it is added as a supplementary group); `1000`
/// matches the image's `node` group for legibility.
const SUBSCRIPTION_FS_GROUP: i64 = 1000;

/// The label selector that matches exactly the driver `Job`s this dispatcher owns.
pub fn managed_selector() -> String {
    format!("app.kubernetes.io/managed-by={MANAGED_BY}")
}

/// The `Job` name for a claimed run. Kubernetes names must be DNS-1123 labels, and
/// the backend mints job ids as lowercase UUIDs (already valid), so this is a plain
/// prefix + the job id.
pub fn job_name(job_id: &str) -> String {
    format!("tcab-driver-{job_id}")
}

/// Build the driver `Job` for a claimed run. Pure given the claim and config, so
/// the manifest is unit-tested without a cluster.
///
/// Returns an error only if the launch request cannot be serialized to JSON for
/// `TCAB_RUN_REQUEST` (it round-tripped through the backend's store as JSON, so
/// this is effectively unreachable, but is surfaced rather than panicked).
pub fn build_driver_job(claim: &ClaimedJob, config: &Config) -> Result<Job, serde_json::Error> {
    let request_json = serde_json::to_string(&claim.request)?;
    let mut env = base_env(claim, config, &request_json);
    // Pass the sandbox-pod settings through verbatim; the driver reads them, the
    // dispatcher only forwards the ones that are set.
    for (key, value) in &config.passthrough_k8s_env {
        env.push(plain_env(key, value));
    }
    // The driver's own pod IP, from the downward API: the sandbox connects back to
    // it for live preview, so the driver needs to know the address Kubernetes
    // assigned its pod.
    env.push(pod_ip_env());

    // Mount each configured Secret's keys into the driver's env. This is how the
    // harness provider API key reaches the run engine, which reads it from the
    // driver pod's own environment exactly as the worker did. Omitted (`None`) when
    // no driver secrets are configured.
    let env_from = (!config.driver_secrets.is_empty()).then(|| {
        config
            .driver_secrets
            .iter()
            .map(|name| EnvFromSource {
                secret_ref: Some(SecretEnvSource {
                    name: name.clone(),
                    optional: None,
                }),
                ..Default::default()
            })
            .collect()
    });

    // Subscription auth (additive, parallel to the API-key `envFrom` path above):
    // when a subscription Secret is configured, mount it read-only as a volume of
    // credential files and tell the driver where to find it. `optional: true` keeps
    // the pod schedulable when no such Secret exists, and `TCAB_AUTH_MODE` is
    // forwarded only when the operator locked a mode.
    let (volumes, volume_mounts) = subscription_volumes(config);
    if config.driver_subscription_secret.is_some() {
        env.push(plain_env(
            "TCAB_DRIVER_SUBSCRIPTION_DIR",
            &config.subscription_dir,
        ));
    }
    if let Some(mode) = &config.driver_auth_mode {
        env.push(plain_env("TCAB_AUTH_MODE", mode));
    }

    let container = Container {
        name: DRIVER_CONTAINER.to_string(),
        image: Some(config.driver_image.clone()),
        env: Some(env),
        env_from,
        volume_mounts,
        // The driver pod needs no resource requests of its own here; it is a thin
        // control process. Leaving `resources` unset omits the field.
        resources: None::<ResourceRequirements>,
        ..Default::default()
    };

    let pod_spec = PodSpec {
        containers: vec![container],
        volumes,
        // When the subscription Secret is mounted, set `fsGroup` so the unprivileged
        // `node` user can actually read the root-owned, group-readable credential
        // files (see `SUBSCRIPTION_FS_GROUP`). Omitted entirely for an API-key-only
        // pod, which mounts no such volume.
        security_context: config
            .driver_subscription_secret
            .is_some()
            .then(|| PodSecurityContext {
                fs_group: Some(SUBSCRIPTION_FS_GROUP),
                ..Default::default()
            }),
        // A driver that fails has already reported (or will be reported by the
        // dispatcher's death detection); never restart its container in place.
        restart_policy: Some("Never".to_string()),
        // The driver is the trusted pod: it must reach the Kubernetes API to create
        // the sandbox, so it keeps its service-account token (unlike the sandbox).
        service_account_name: config.driver_service_account.clone(),
        ..Default::default()
    };

    let labels = job_labels(&claim.job_id);

    let job_spec = JobSpec {
        // Do not retry a failed driver Job: the driver owns reporting a specific
        // failure, and a retry would both race that and re-execute the run.
        backoff_limit: Some(0),
        // Reap the Job (and its pod) automatically once it terminates.
        ttl_seconds_after_finished: Some(config.job_ttl_seconds),
        template: PodTemplateSpec {
            metadata: Some(ObjectMeta {
                labels: Some(labels.clone()),
                ..Default::default()
            }),
            spec: Some(pod_spec),
        },
        ..Default::default()
    };

    Ok(Job {
        metadata: ObjectMeta {
            name: Some(job_name(&claim.job_id)),
            namespace: Some(config.namespace.clone()),
            labels: Some(labels),
            ..Default::default()
        },
        spec: Some(job_spec),
        status: None,
    })
}

/// The labels every driver `Job` (and its pod template) carries: the ownership
/// label the dispatcher selects on, the shared part-of label, and the backend job
/// id for mapping a `Job` back to its job.
fn job_labels(job_id: &str) -> BTreeMap<String, String> {
    BTreeMap::from([
        (
            "app.kubernetes.io/managed-by".to_string(),
            MANAGED_BY.to_string(),
        ),
        (
            "app.kubernetes.io/part-of".to_string(),
            "test-cabinet".to_string(),
        ),
        (JOB_ID_LABEL.to_string(), job_id.to_string()),
    ])
}

/// The fixed driver env every Job carries: the backend URL, the job id and token,
/// the serialized launch request, and the kubernetes runtime selector.
fn base_env(claim: &ClaimedJob, config: &Config, request_json: &str) -> Vec<EnvVar> {
    vec![
        plain_env("TCAB_BACKEND_URL", &config.backend_url),
        plain_env("TCAB_JOB_ID", &claim.job_id),
        plain_env("TCAB_JOB_TOKEN", &claim.job_token),
        plain_env("TCAB_RUN_REQUEST", request_json),
        plain_env("TCAB_DRIVER_RUNTIME", "kubernetes"),
    ]
}

/// A literal-value `EnvVar`.
fn plain_env(name: &str, value: &str) -> EnvVar {
    EnvVar {
        name: name.to_string(),
        value: Some(value.to_string()),
        value_from: None,
    }
}

/// The read-only subscription-Secret volume and its mount, when a subscription
/// Secret is configured — else `(None, None)` so the fields are omitted entirely
/// (an API-key-only driver pod carries no extra volume). The Secret is mounted
/// group-readable (mode `0o640`) — never world-readable — and paired with the
/// pod's `fsGroup` (see `SUBSCRIPTION_FS_GROUP`) so the unprivileged `node` user
/// can read the otherwise root-owned files; `optional: true` keeps a missing
/// Secret from blocking the pod from scheduling.
fn subscription_volumes(config: &Config) -> (Option<Vec<Volume>>, Option<Vec<VolumeMount>>) {
    let Some(secret_name) = &config.driver_subscription_secret else {
        return (None, None);
    };
    let volume = Volume {
        name: SUBSCRIPTION_VOLUME.to_string(),
        secret: Some(SecretVolumeSource {
            secret_name: Some(secret_name.clone()),
            // 0o640 in decimal: owner + group read, never world-readable. The
            // projected files are root-owned, so the driver — running as the
            // non-root `node` user — reads them via the pod's `fsGroup`
            // (`SUBSCRIPTION_FS_GROUP`), which owns the group bit. A bare `0o600`
            // would lock the driver out of its own credentials.
            default_mode: Some(0o640),
            // A missing Secret must not wedge non-subscription driver pods.
            optional: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    let mount = VolumeMount {
        name: SUBSCRIPTION_VOLUME.to_string(),
        mount_path: config.subscription_dir.clone(),
        read_only: Some(true),
        ..Default::default()
    };
    (Some(vec![volume]), Some(vec![mount]))
}

/// The `TCAB_K8S_POD_IP` env var sourced from the downward API
/// (`fieldRef: status.podIP`) — the driver pod's own IP, which it cannot know any
/// other way.
fn pod_ip_env() -> EnvVar {
    EnvVar {
        name: "TCAB_K8S_POD_IP".to_string(),
        value: None,
        value_from: Some(EnvVarSource {
            field_ref: Some(ObjectFieldSelector {
                field_path: "status.podIP".to_string(),
                ..Default::default()
            }),
            ..Default::default()
        }),
    }
}

#[cfg(test)]
#[path = "job.test.rs"]
mod tests;
