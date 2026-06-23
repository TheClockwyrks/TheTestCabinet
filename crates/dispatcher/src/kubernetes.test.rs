//! Unit tests for the pure status-derivation helpers. The cluster-driving paths
//! (`create_job`, `list_managed`, the log tail) need a live API server and are
//! exercised by the k3d e2e in the cutover task; everything below is deterministic
//! `Job`/`Pod` status interpretation.

use super::*;

use std::collections::BTreeMap;

use k8s_openapi::api::batch::v1::{Job, JobCondition, JobStatus};
use k8s_openapi::api::core::v1::{
    ContainerState, ContainerStateTerminated, ContainerStateWaiting, ContainerStatus, Pod,
    PodStatus,
};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;

use crate::job::JOB_ID_LABEL;

fn job_with_conditions(conditions: Vec<JobCondition>) -> Job {
    Job {
        status: Some(JobStatus {
            conditions: Some(conditions),
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn condition(type_: &str, status: &str) -> JobCondition {
    JobCondition {
        type_: type_.to_string(),
        status: status.to_string(),
        ..Default::default()
    }
}

#[test]
fn job_with_no_status_is_active() {
    assert_eq!(job_phase(&Job::default()), JobPhase::Active);
}

#[test]
fn failed_condition_wins() {
    let job = job_with_conditions(vec![condition("Failed", "True")]);
    assert_eq!(job_phase(&job), JobPhase::Failed);
}

#[test]
fn complete_condition_is_complete() {
    let job = job_with_conditions(vec![condition("Complete", "True")]);
    assert_eq!(job_phase(&job), JobPhase::Complete);
}

#[test]
fn a_false_condition_is_not_terminal() {
    let job = job_with_conditions(vec![condition("Failed", "False")]);
    assert_eq!(job_phase(&job), JobPhase::Active);
}

#[test]
fn managed_job_reads_the_job_id_label() {
    let job = Job {
        metadata: ObjectMeta {
            name: Some("tcab-driver-job-9".to_string()),
            labels: Some(BTreeMap::from([(
                JOB_ID_LABEL.to_string(),
                "job-9".to_string(),
            )])),
            ..Default::default()
        },
        status: Some(JobStatus {
            conditions: Some(vec![condition("Failed", "True")]),
            ..Default::default()
        }),
        ..Default::default()
    };
    let managed = managed_job(&job);
    assert_eq!(managed.job_id.as_deref(), Some("job-9"));
    assert_eq!(managed.name, "tcab-driver-job-9");
    assert_eq!(managed.phase, JobPhase::Failed);
}

fn pod_with_container_state(state: ContainerState) -> Pod {
    Pod {
        status: Some(PodStatus {
            container_statuses: Some(vec![ContainerStatus {
                name: "driver".to_string(),
                state: Some(state),
                ..Default::default()
            }]),
            ..Default::default()
        }),
        ..Default::default()
    }
}

#[test]
fn terminated_reason_and_exit_code_are_surfaced() {
    let pod = pod_with_container_state(ContainerState {
        terminated: Some(ContainerStateTerminated {
            reason: Some("OOMKilled".to_string()),
            exit_code: 137,
            ..Default::default()
        }),
        ..Default::default()
    });
    assert_eq!(
        container_failure_reason(&pod).as_deref(),
        Some("OOMKilled (exit 137)"),
    );
}

#[test]
fn waiting_reason_describes_an_image_pull_failure() {
    let pod = pod_with_container_state(ContainerState {
        waiting: Some(ContainerStateWaiting {
            reason: Some("ImagePullBackOff".to_string()),
            message: Some("can't pull image".to_string()),
        }),
        ..Default::default()
    });
    assert_eq!(
        container_failure_reason(&pod).as_deref(),
        Some("ImagePullBackOff: can't pull image"),
    );
}

#[test]
fn no_container_status_yields_no_reason() {
    assert!(container_failure_reason(&Pod::default()).is_none());
}
