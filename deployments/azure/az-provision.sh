#!/usr/bin/env bash
#
# Annotated `az` CLI walkthrough for one environment (staging OR prod). This is a
# reference you step through, not a turnkey script — read deployment/azure.md
# alongside it and fill in every value in the variables block.
#
# Prerequisites: `az login`, an Azure Container Registry, and a Tailscale auth
# key (or the Azure-native networking alternative in the docs).

set -euo pipefail

# ── Fill these in ────────────────────────────────────────────────────────────
ENV="staging"                       # staging | prod
RG="rg-tcab-${ENV}"
LOCATION="<azure-region>"           # e.g. eastus
REGISTRY="<registry>"               # ACR name (without .azurecr.io)
IMAGE_TAG="$(git rev-parse --short HEAD)"
VM_SIZE="<vm-size>"                 # e.g. Standard_D4s_v5
CONTAINERAPPS_ENV="cae-tcab-${ENV}"
# Secrets — source these from your secret store, do not hard-code:
#   R2_ACCOUNT_ID R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
#   SITE_DEPLOY_HOOK_URL TAILSCALE_AUTH_KEY

# ── Resource group ───────────────────────────────────────────────────────────
az group create -n "$RG" -l "$LOCATION"

# ── Backend: build image, then deploy to Container Apps ──────────────────────
# 1. Build and push the backend image (includes Chromium for reference rendering).
az acr build -r "$REGISTRY" -t "tcab-backend:${IMAGE_TAG}" \
  -f deployments/azure/backend.Dockerfile .

# 2. Container Apps environment + an Azure Files share for the backend's state
#    (DB, definition store, ingest checkout). Prefer NFS for the SQLite file.
#    (Storage + share creation omitted — see the Azure Files + Container Apps docs;
#    register it on the environment as the storageName referenced in containerapp.yaml.)
az containerapp env create -g "$RG" -n "$CONTAINERAPPS_ENV" -l "$LOCATION"

# 3. Create the app from the example definition. Edit deployments/azure/containerapp.yaml
#    first: image tag, the registered Azure Files storageName, and TCAB_ENV.
az containerapp create -g "$RG" -n "tcab-backend" \
  --environment "$CONTAINERAPPS_ENV" \
  --yaml deployments/azure/containerapp.yaml

# 4. Set the backend's secrets (referenced by name in containerapp.yaml).
az containerapp secret set -g "$RG" -n "tcab-backend" --secrets \
  "r2-account-id=${R2_ACCOUNT_ID:?}" \
  "r2-bucket=${R2_BUCKET:?}" \
  "r2-access-key-id=${R2_ACCESS_KEY_ID:?}" \
  "r2-secret-access-key=${R2_SECRET_ACCESS_KEY:?}" \
  "site-deploy-hook-url=${SITE_DEPLOY_HOOK_URL:?}"

# ── Workers: one VM per node (repeat, or use a VM Scale Set) ──────────────────
# worker-cloud-init.yaml installs Docker, the worker binary + systemd unit, the
# harness images, and joins the tailnet. Template the auth key into it at create
# time; do not commit it.
az vm create -g "$RG" -n "tcab-worker-1" \
  --image Ubuntu2404 --size "$VM_SIZE" \
  --custom-data deployments/azure/worker-cloud-init.yaml

echo "Provisioned ${ENV}. Register each worker's private URL in the web console."
