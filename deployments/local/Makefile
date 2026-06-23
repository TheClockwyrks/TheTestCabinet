# Local Kubernetes stack on k3d — the development mirror of a deployment.
#
# `make local-up` stands the whole set of services up on a throwaway k3d cluster
# (k3s-in-Docker) using the SAME manifests staging/prod use, so runs are handled
# the way they will be in the cloud. `make local-down` tears it all down.
#
# Requirements on the host: docker (or a docker-compatible runtime), k3d, and
# kubectl. Unlike the compose template, this needs no worker-on-host wiring —
# everything runs in the cluster (run execution joins once the dispatcher lands).
#
# Targets:
#   local-up        create the cluster, build+import images, apply, ingest catalog
#   local-down      delete the cluster (and everything in it)
#   local-rebuild   rebuild+import images and restart the services (after a code change)
#   local-forward   foreground-forward backend→:8787 and auth→:8789 to localhost
#   local-ingest    re-ingest the catalog (force) — run after editing a test case
#   local-status    show pods, services, and volumes in the namespace

# Resolve the repo root from this Makefile's location so the targets work no
# matter where `make` is invoked from.
MAKEFILE_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
REPO         := $(abspath $(MAKEFILE_DIR)../..)

CLUSTER ?= tcab
NS      ?= tcab-local
OVERLAY := $(REPO)/deployments/k8s/overlays/local

BACKEND_IMG := tcab-backend:local
AUTH_IMG    := tcab-auth-service:local

.PHONY: local-up local-down local-rebuild local-forward local-ingest local-status cluster images apply

local-up: cluster images apply local-ingest
	@echo ""
	@echo "Stack is up in namespace '$(NS)'."
	@echo "Reach it with:  make -C deployments/local local-forward"
	@echo "  backend → http://127.0.0.1:8787   auth → http://127.0.0.1:8789"

# Create the k3d cluster if it does not already exist, mapping the repository to
# /repo on the server node so the backend can ingest from a read-only mount of it
# (see the local overlay's patch-backend.yaml).
cluster:
	@if k3d cluster list 2>/dev/null | grep -qw '$(CLUSTER)'; then \
	  echo "k3d cluster '$(CLUSTER)' already exists."; \
	else \
	  echo "Creating k3d cluster '$(CLUSTER)'…"; \
	  k3d cluster create '$(CLUSTER)' --volume '$(REPO):/repo@server:0' --wait; \
	fi
	@k3d kubeconfig merge '$(CLUSTER)' --kubeconfig-switch-context >/dev/null

# Build the service images from the same Dockerfiles the cluster uses, then load
# them into the cluster's nodes (no registry needed for local development).
images:
	docker build -t '$(BACKEND_IMG)' -f '$(REPO)/deployments/images/backend.Dockerfile' '$(REPO)'
	docker build -t '$(AUTH_IMG)'    -f '$(REPO)/deployments/images/auth.Dockerfile'    '$(REPO)'
	k3d image import '$(BACKEND_IMG)' '$(AUTH_IMG)' -c '$(CLUSTER)'

# Apply the local overlay and wait for both services to become ready.
apply:
	kubectl apply -k '$(OVERLAY)'
	kubectl -n '$(NS)' rollout status statefulset/tcab-backend --timeout=300s
	kubectl -n '$(NS)' rollout status statefulset/tcab-auth    --timeout=300s

# Ingest (force) the test-case catalog from the repo the backend has mounted.
# Uses an ephemeral port-forward that is torn down when the recipe exits.
local-ingest:
	@echo "Ingesting the test-case catalog…"
	@kubectl -n '$(NS)' port-forward svc/tcab-backend 8787:8787 >/dev/null 2>&1 & \
	  pf=$$!; trap 'kill $$pf 2>/dev/null' EXIT; \
	  for i in $$(seq 1 30); do curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1 && break; sleep 1; done; \
	  curl -fsS -X POST http://127.0.0.1:8787/ingest \
	    -H 'content-type: application/json' -d '{"force": true}' \
	  && echo " catalog ingested."

# Hold the services open on localhost until interrupted (Ctrl-C).
local-forward:
	@echo "Forwarding backend→127.0.0.1:8787 and auth→127.0.0.1:8789 (Ctrl-C to stop)…"
	@kubectl -n '$(NS)' port-forward svc/tcab-backend 8787:8787 & \
	  kubectl -n '$(NS)' port-forward svc/tcab-auth 8789:8789 & \
	  wait

# Rebuild after a code change: new images, re-import, rolling restart.
local-rebuild: images
	kubectl -n '$(NS)' rollout restart statefulset/tcab-backend statefulset/tcab-auth
	kubectl -n '$(NS)' rollout status statefulset/tcab-backend --timeout=300s
	kubectl -n '$(NS)' rollout status statefulset/tcab-auth    --timeout=300s

local-status:
	kubectl -n '$(NS)' get pods,svc,pvc

local-down:
	-k3d cluster delete '$(CLUSTER)'
