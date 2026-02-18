#!/bin/bash
# ===========================================
# Linode Server Setup Script
# ===========================================
# Run this script once to set up a fresh Linode VPS
# Usage: ./setup-server.sh

set -e

echo "=== DEP Platform Server Setup ==="

# Update system
echo "Updating system packages..."
apt-get update && apt-get upgrade -y

# Install Docker
echo "Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Install Docker Compose plugin
echo "Installing Docker Compose..."
apt-get install -y docker-compose-plugin

# Install Nginx
echo "Installing Nginx..."
apt-get install -y nginx

# Install Certbot for Let's Encrypt
echo "Installing Certbot..."
apt-get install -y certbot python3-certbot-nginx

# Install MariaDB
echo "Installing MariaDB..."
apt-get install -y mariadb-server
systemctl enable mariadb
systemctl start mariadb

# Secure MariaDB installation
echo "Running MariaDB secure installation..."
echo "Please run 'mysql_secure_installation' manually to set root password"

# Create application directory
echo "Creating application directory..."
mkdir -p /opt/dep-platform
cd /opt/dep-platform

# Set up firewall
echo "Configuring firewall..."
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
ufw --force enable

# Add current user to docker group
usermod -aG docker $USER

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Run 'mysql_secure_installation' to secure MariaDB"
echo "2. Create databases: landlord_db and tenant_template_db"
echo "3. Copy .env.production to /opt/dep-platform/.env"
echo "4. Copy docker-compose.prod.yml to /opt/dep-platform/"
echo "5. Copy nginx configs to /etc/nginx/"
echo "6. Set up SSL with: certbot --nginx -d yourdomain.com -d admin.yourdomain.com"
echo "7. Configure GitHub secrets for deployment"
echo ""

