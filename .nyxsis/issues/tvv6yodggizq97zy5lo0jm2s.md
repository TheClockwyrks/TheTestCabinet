---
format: nyxsis-issue
version: 2
id: tvv6yodggizq97zy5lo0jm2s
zone: DEPLOY
number: 1
title: Hold node drains for run pods with a budget and pool settings
type: generic
state: open
created: 2026-10-19T00:38:11.966575017Z
---

An upgrade drain evicts driver and sandbox pods mid-run. Neither is ever
recreated, so the run is lost along with the model spend it had incurred. The
run plane documentation makes a drain wait for the run pods on a node to
finish: a `PodDisruptionBudget` refuses their eviction, and every node pool that
can seat a run pod carries a drain timeout above the longest run, with a node
that outlasts it returned to service for the next scheduled upgrade. See
`apps/docs/src/content/docs/deployment/kubernetes/run-plane.md`, section
"Node drains" and its subsections "The run pod budget", "Node pool upgrade
settings" and "What each guard covers", and
`apps/docs/src/content/docs/deployment/kubernetes/overview.md`, section
"Cluster prerequisites", step 5.

The run pods carry the `cluster-autoscaler.kubernetes.io/safe-to-evict: "false"`
annotation (`crates/dispatcher/src/job.rs`, `pod_annotations`, and
`crates/driver/src/kubernetes.rs`, the sandbox pod spec), which the autoscaler
alone reads. Nothing in the namespace refuses an upgrade drain's eviction, and
the pools run the AKS default drain timeout of 30 minutes.

## What is missing

- `deployments/k8s/base/run-pods-pdb.yaml`, the `tcab-run-pods` budget exactly
  as the page shows it, listed in `deployments/k8s/base/kustomization.yaml` so
  the `local`, `staging` and `prod` overlays all render it.
- `scripts/configure-node-pools.sh --env <prod|staging>`, which sets
  `drainTimeoutInMinutes` to `1440`, `undrainableNodeBehavior` to `Schedule`,
  `maxSurge` to `10%` and `maxUnavailable` to `0` on every user node pool of
  the environment's cluster with `az aks nodepool update`, and is idempotent.
- A `*.test.sh` beside the script covering the arguments it passes to `az` for
  each environment, run by the `shell-tests` gate.
- The settings applied to both clusters' user pools.

## Verify

- `kubectl kustomize deployments/k8s/overlays/prod` renders `tcab-run-pods`,
  and the `k8s-manifests` and `k8s-deploy-sets` gates pass.
- On staging, with a run in progress, `kubectl get pdb tcab-run-pods` reports
  `ALLOWED DISRUPTIONS 0`, and an eviction of its sandbox pod or its driver pod
  (`kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
  --timeout=60s`) is refused with "would violate the pod's disruption budget"
  while the run continues to a scored result. Uncordon the node afterwards.
- A drain of a node whose run has finished proceeds, including a node holding a
  completed driver pod waiting for its TTL.
- `az aks nodepool show` on every user pool of both clusters reports
  `drainTimeoutInMinutes: 1440`, `undrainableNodeBehavior: Schedule`,
  `maxSurge: 10%` and `maxUnavailable: 0`.
- On staging, a node-image upgrade started while a run is in progress
  completes once the run ends, with the run scored and the node on the new
  image.
- `uv run --quiet --project ci gate run shell-tests` passes.
