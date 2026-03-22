#!/bin/bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REPO_NAME="weather-agent-orchestrator"
IMAGE_TAG=$(date +%Y%m%d-%H%M%S)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}"

echo "=== orchestrator デプロイ ==="
echo "  Region: ${REGION} | Image: ${ECR_URI}:${IMAGE_TAG}"

echo "Step 1: ECR リポジトリ確認..."
aws ecr describe-repositories --repository-names "${REPO_NAME}" --region "${REGION}" 2>/dev/null || \
  aws ecr create-repository --repository-name "${REPO_NAME}" --region "${REGION}" --image-scanning-configuration scanOnPush=true

echo "Step 2: Docker ビルド..."
docker buildx build --platform linux/arm64 -f Dockerfile -t "${ECR_URI}:${IMAGE_TAG}" --load ..

echo "Step 3: ECR プッシュ..."
aws ecr get-login-password --region "${REGION}" | \
  docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker push "${ECR_URI}:${IMAGE_TAG}"

echo "Step 4: Runtime デプロイ..."
cd .. && uv run python orchestrator/deploy_runtime.py \
  --region "${REGION}" \
  --container-uri "${ECR_URI}:${IMAGE_TAG}" \
  --role-arn "arn:aws:iam::${ACCOUNT_ID}:role/weather-agent-runtime-role" \
  --agent-name "orchestrator_container"

echo "=== 完了 ==="
