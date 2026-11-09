#!/usr/bin/env bash
# Runs on the GITHUB RUNNER: asks the server (via AWS Systems Manager) to deploy a version.
# No SSH, no port 22, no keys. Needs AWS credentials (OIDC) + EC2_INSTANCE_ID.
set -euo pipefail

TAG="${1:?Usage: bash scripts/ssm-deploy.sh <image-tag>}"
INSTANCE_ID="${EC2_INSTANCE_ID:?EC2_INSTANCE_ID is not set (GitHub variable)}"

# Security: the tag goes into a shell command, so allow only safe characters
[[ "$TAG" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "❌ Invalid image tag: $TAG"; exit 1; }

# Command for the server, run as user 'ubuntu' (SSM itself runs as root)
REMOTE="cd ~/streamlined-deployment && git fetch --quiet origin main && git reset --quiet --hard origin/main && bash scripts/deploy.sh ${TAG}"
PARAMS=$(jq -n --arg c "runuser -l ubuntu -c '${REMOTE}'" '{commands: [$c], executionTimeout: ["600"]}')

echo "==> Sending deploy command for ${TAG} to ${INSTANCE_ID}"
CMD_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --comment "Deploy ${TAG} (GitHub run ${GITHUB_RUN_ID:-manual})" \
  --parameters "$PARAMS" \
  --query "Command.CommandId" --output text)
echo "    SSM command ID: ${CMD_ID}"

echo "==> Waiting for the server to finish (max 10 minutes)"
STATUS="Pending"
for _ in $(seq 1 120); do
  sleep 5
  STATUS=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
    --query "Status" --output text 2>/dev/null || echo "Pending")
  case "$STATUS" in
    Pending|InProgress|Delayed) continue ;;
    *) break ;;
  esac
done

echo "----------------------- server output -----------------------"
aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query "StandardOutputContent" --output text
echo "----------------------- server errors -----------------------"
aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query "StandardErrorContent" --output text
echo "-------------------------------------------------------------"

if [ "$STATUS" != "Success" ]; then
  echo "❌ Deployment failed (SSM status: ${STATUS})"
  exit 1
fi
echo "✅ Deployment of ${TAG} finished"
