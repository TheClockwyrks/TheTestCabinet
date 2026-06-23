# Kubernetes deployment manifests

Copy-pasteable manifests for deploying The Test Cabinet's three services to a
Kubernetes namespace, where the worker spawns each run as a **separate pod via the
Kubernetes API**.

Read the docs first — these files are the *assets*; the narrative lives at
[`deployment/kubernetes.md`](../../apps/docs/src/content/docs/deployment/kubernetes.md)
(published at <https://docs.testcabinet.ai/deployment/kubernetes/>). Everything
here uses **placeholder values** (`REPLACE_REGISTRY`, `REPLACE_ME`, the
`tcab-prod` namespace); adapt them, don't apply them blind.

## Files

| File | What it is |
| --- | --- |
| `namespace.yaml` | The per-environment namespace (`tcab-staging` / `tcab-prod`). |
| `rbac.yaml` | The `tcab-worker` ServiceAccount + a namespaced Role granting exactly pod create/get/list/watch/delete, pods/exec, pods/log. |
| `secrets.example.yaml` | Secret/ConfigMap templates (R2 creds, harness keys, publish creds, registry pull secret) — **placeholders only**. |
| `backend.yaml` | Backend StatefulSet (1 replica) + PVC + ClusterIP Service. |
| `auth.yaml` | Auth-service StatefulSet (1 replica) + PVC + ClusterIP Service. |
| `worker.yaml` | Worker StatefulSet + **headless** Service; runs under the `tcab-worker` ServiceAccount with `TCAB_WORKER_RUNTIME=kubernetes`. |
| `ingest-cronjob.yaml` | Periodic `POST /ingest` to refresh the catalog. |
| `networkpolicy.yaml` | Optional default-deny-ingress + explicit allows (needs a NetworkPolicy-enforcing CNI). |

The service container images are built from
[`../images/`](../images/) (`backend.Dockerfile`, `auth.Dockerfile`,
`worker.Dockerfile`) and published to GHCR by the
[`build-service-images.yml`](../../.github/workflows/build-service-images.yml)
workflow as `ghcr.io/<owner>/tcab-backend`, `…/tcab-auth-service`, and
`…/tcab-worker`. Point each manifest's `image:` field (`REPLACE_REGISTRY`) at that
namespace — pin the immutable `:<git-sha>` tag rather than `:latest` in a real
deployment. The **run-container** images the worker launches are separate — see
[`containers/`](../../containers/README.md).

## Apply order

```sh
NS=tcab-prod   # or tcab-staging
kubectl apply -f namespace.yaml
kubectl apply -n $NS -f rbac.yaml
kubectl apply -n $NS -f secrets.example.yaml   # after filling in real values
kubectl apply -n $NS -f auth.yaml
kubectl apply -n $NS -f backend.yaml
kubectl apply -n $NS -f worker.yaml
kubectl apply -n $NS -f ingest-cronjob.yaml
kubectl apply -n $NS -f networkpolicy.yaml     # optional
```

## Per environment

Staging and prod are the same manifests; only the namespace, `TCAB_ENV`, worker
`replicas`, and secrets differ. Keep them otherwise identical so staging
rehearses prod. The worker's `TCAB_K8S_*` settings are documented in
[`deployment/kubernetes.md`](../../apps/docs/src/content/docs/deployment/kubernetes.md#worker)
and the repo-root [`.env.worker.example`](../../.env.worker.example).

## Secrets

Never commit a real secret. `secrets.example.yaml` is a template; in a real
deployment create the Secrets from your secret manager (`kubectl create secret`,
External Secrets, Sealed Secrets, …). The repo-root `.env.backend.example`,
`.env.auth.example`, and `.env.worker.example` remain the authoritative reference
for every variable each service reads.
