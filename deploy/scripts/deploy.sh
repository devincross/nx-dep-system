#!/bin/bash
# ===========================================
# Manual Deployment Script
# ===========================================
# Run this script to manually deploy the latest version
# Usage: ./deploy.sh [tag]
#
# Environment variables:
#   BUILD_LOCAL=true  - Build images locally instead of pulling from registry

set -e

TAG=${1:-latest}
DEPLOY_DIR="/opt/dep-platform"

echo "=== Deploying DEP Platform (tag: $TAG) ==="

cd $DEPLOY_DIR

# Set image tag
export IMAGE_TAG=$TAG

# Build or pull images based on environment
if [ "$BUILD_LOCAL" = "true" ]; then
  echo "Building images locally..."
  docker compose -f docker-compose.prod.yml build
else
  echo "Pulling latest images..."
  docker compose -f docker-compose.prod.yml pull
fi

# Stop existing containers
echo "Stopping existing containers..."
docker compose -f docker-compose.prod.yml down

# Start new containers
echo "Starting new containers..."
docker compose -f docker-compose.prod.yml up -d

# Wait for health checks
echo "Waiting for services to be healthy..."
sleep 10

# Show status
echo ""
echo "=== Deployment Status ==="
docker compose -f docker-compose.prod.yml ps

# Clean up old images
echo ""
echo "Cleaning up old images..."
docker image prune -f

echo ""
echo "=== Deployment Complete ==="

