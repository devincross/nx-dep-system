# DEP Platform Deployment Guide

## Overview

This guide covers deploying the DEP Platform to a Linode VPS with:
- Docker containers for applications
- Native MariaDB installation
- Nginx reverse proxy with SSL
- GitHub Actions CI/CD

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │              Linode VPS                  │
                    │                                          │
    Internet ───────┤► Nginx (80/443)                          │
                    │    │                                     │
                    │    ├─► admin.domain.com                  │
                    │    │    ├─► /api/* → admin-api:3000      │
                    │    │    └─► /* → landlord-admin:4200     │
                    │    │                                     │
                    │    └─► *.domain.com                      │
                    │         ├─► /api/* → client-api:3001     │
                    │         └─► /* → client-portal:4201      │
                    │                                          │
                    │    MariaDB (native) ◄─── Docker apps     │
                    └─────────────────────────────────────────┘
```

## Quick Start

### 1. Create Linode VPS

- Create a Linode (recommended: Linode 4GB+)
- Choose Ubuntu 24.04 LTS
- Set root password and SSH keys

### 2. Initial Server Setup

```bash
# SSH into your server
ssh root@your-server-ip

# Download and run setup script
curl -o setup-server.sh https://raw.githubusercontent.com/YOUR_REPO/main/deploy/scripts/setup-server.sh
chmod +x setup-server.sh
./setup-server.sh
```

### 3. Configure MariaDB

```bash
# Secure MariaDB
mysql_secure_installation

# Run database setup script
./deploy/scripts/setup-database.sh
```

### 4. Configure Environment

```bash
cd /opt/dep-platform

# Copy and edit environment file
cp .env.production .env
nano .env  # Update all CHANGE_ME values
```

### 5. Configure Nginx

```bash
# Copy nginx configs
cp deploy/nginx/nginx.conf /etc/nginx/nginx.conf
cp deploy/nginx/conf.d/* /etc/nginx/conf.d/

# Update domain in configs
sed -i 's/${DOMAIN}/yourdomain.com/g' /etc/nginx/conf.d/*.conf

# Test and reload
nginx -t
systemctl reload nginx
```

### 6. Setup SSL

```bash
certbot --nginx -d yourdomain.com -d admin.yourdomain.com -d '*.yourdomain.com'
```

### 7. Configure GitHub Secrets

Add these secrets to your GitHub repository:

| Secret | Description |
|--------|-------------|
| `LINODE_HOST` | Server IP address |
| `LINODE_USER` | SSH username (root or deploy user) |
| `LINODE_SSH_KEY` | Private SSH key for authentication |

### 8. Deploy

Push to `main` branch to trigger automatic deployment, or manually:

```bash
cd /opt/dep-platform
./deploy/scripts/deploy.sh
```

## Manual Deployment

```bash
# Pull latest images
docker compose -f docker-compose.prod.yml pull

# Deploy with zero downtime
docker compose -f docker-compose.prod.yml up -d --remove-orphans

# Check status
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f
```

## Troubleshooting

### Check container logs
```bash
docker compose -f docker-compose.prod.yml logs admin-api
docker compose -f docker-compose.prod.yml logs client-api
```

### Check database connection
```bash
docker exec -it dep-admin-api sh
# Inside container:
wget -qO- http://localhost:3000/health
```

### Restart services
```bash
docker compose -f docker-compose.prod.yml restart
```

