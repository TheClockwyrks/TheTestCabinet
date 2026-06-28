#!/usr/bin/env bash
# Enable secret AUTO-ROTATION on the AKS azure-keyvault-secrets-provider add-on, so
# the Secrets Store CSI driver reconciles changed Key Vault values into the synced
# Kubernetes Secrets on its own (within the poll interval) instead of only
# materialising a Secret once on first mount.
#
# Why this exists: without rotation the CSI driver does NOT update an already-existing
# synced Secret on remount, so a refreshed credential (e.g. one uploaded by
# scripts/upload-subscription-creds.sh) never reaches the cluster — and a rollout
# restart of the tcab-keyvault-sync pod doesn't help. Rotation is the steady-state
# fix: turn it on once per cluster and refreshes then propagate automatically.
#
# Rotation is a property of the AKS MANAGED add-on — Azure control-plane config on the
# cluster resource, not a Kubernetes object — so it can NOT be expressed in the
# kustomize overlay. This script (or cluster IaC, if it ever exists) is its
# declarative home. It is idempotent: safe to re-run; it just re-asserts the setting
# and prints the resulting config.
#
# This uses core `az aks update` (the rotation flags are first-class there), so it
# does not pull in the aks-preview extension that `az aks addon update` requires.
# The update reconciles the whole cluster (a few minutes) and is non-disruptive.
#
# Prerequisites: `az` logged in with rights to update the cluster.
#
# Usage:
#   scripts/enable-secret-rotation.sh
#
# Overridable via env (defaults shown):
#   RG=testcabinet-prod-westus2-rg
#   CLUSTER=testcabinet-prod-westus2-aks
#   POLL_INTERVAL=2m
set -euo pipefail

RG="${RG:-testcabinet-prod-westus2-rg}"
CLUSTER="${CLUSTER:-testcabinet-prod-westus2-aks}"
POLL_INTERVAL="${POLL_INTERVAL:-2m}"

command -v az >/dev/null || { echo "az (Azure CLI) is required but not installed." >&2; exit 1; }

echo "enabling secret auto-rotation on ${CLUSTER} (add-on azure-keyvault-secrets-provider, poll ${POLL_INTERVAL})…"
az aks update -g "$RG" -n "$CLUSTER" \
  --enable-secret-rotation --rotation-poll-interval "$POLL_INTERVAL" \
  -o none

echo "current azureKeyvaultSecretsProvider config:"
az aks show -g "$RG" -n "$CLUSTER" \
  --query 'addonProfiles.azureKeyvaultSecretsProvider.config' -o jsonc

echo "done — changed Key Vault values now reconcile into the synced Secrets within ~${POLL_INTERVAL}."
