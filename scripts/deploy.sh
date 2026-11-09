#!/usr/bin/env bash
# Runs ON THE SERVER: deploy one image version, check it, auto-rollback if unhealthy.
# Usage: bash scripts/deploy.sh <image-tag>   (tag = 7-character commit ID)
set -euo pipefail                       # stop on errors and undefined variables

NEW_TAG="${1:?Usage: bash scripts/deploy.sh <image-tag>}"
cd "$(dirname "$0")/.."                 # work from the project folder
STATE_FILE=".deployed_tag"              # last version that was healthy
PREV_TAG=$(cat "$STATE_FILE" 2>/dev/null || true)

echo "==> Loading settings from .env"
set -a; source .env; set +a             # export every setting

echo "==> Logging in to Amazon ECR (via the server's IAM role, no stored keys)"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY" > /dev/null

echo "==> Choosing the Nginx config"
if sudo test -f "certbot/conf/live/${DOMAIN}/fullchain.pem"; then
  sed "s/__DOMAIN__/${DOMAIN}/g" nginx/templates/https.conf.template > nginx/conf.d/app.conf
  echo "    Certificate found → HTTPS"
else
  echo "    No certificate yet → HTTP only"
fi

# Pull and start one version of the app
deploy_tag() {
  export APP_IMAGE="${ECR_REGISTRY}/${ECR_REPOSITORY}:$1"
  echo "==> Deploying ${APP_IMAGE}"
  docker compose pull --quiet
  docker compose up -d --no-build --remove-orphans || true   # our own check decides below
  docker compose exec -T nginx nginx -s reload > /dev/null 2>&1 || true
}

# Ask /ready (app + database) through Nginx up to 30 times, 2 seconds apart (~1 minute).
healthy() {
  for i in $(seq 1 30); do
    if curl -ksfL http://localhost/ready > /dev/null; then
      echo "    ✅ Healthy after $i attempt(s)"
      return 0
    fi
    sleep 2
  done
  return 1
}

deploy_tag "$NEW_TAG"
if healthy; then
  echo "$NEW_TAG" > "$STATE_FILE"       # remember this good version
  docker image prune -f > /dev/null     # free disk space
  echo "🚀 Deployment of ${NEW_TAG} succeeded (previous: ${PREV_TAG:-none})"
  exit 0
fi

echo "❌ ${NEW_TAG} is NOT healthy. Recent app logs:"
docker compose logs --tail=40 app || true

# Automatic rollback to the last healthy version
if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$NEW_TAG" ]; then
  echo "↩️  Automatic rollback to ${PREV_TAG}"
  deploy_tag "$PREV_TAG"
  if healthy; then
    echo "✅ Rolled back to ${PREV_TAG}. The site is up; the failed version is ${NEW_TAG}."
  else
    echo "🚨 Rollback ALSO unhealthy. Investigate manually."
  fi
fi
exit 1                                  # report failure to the pipeline
