#!/bin/bash
# ===========================================
# Database Setup Script
# ===========================================
# Run this script to create the required databases
# Usage: ./setup-database.sh

set -e

echo "=== DEP Platform Database Setup ==="

# Prompt for MySQL root password
read -sp "Enter MySQL root password: " MYSQL_ROOT_PASSWORD
echo ""

# Prompt for application user password
read -sp "Enter password for dep_user: " DEP_USER_PASSWORD
echo ""

# Create databases and user
mysql -u root -p"$MYSQL_ROOT_PASSWORD" <<EOF
-- Create application user
CREATE USER IF NOT EXISTS 'dep_user'@'localhost' IDENTIFIED BY '$DEP_USER_PASSWORD';
CREATE USER IF NOT EXISTS 'dep_user'@'172.17.0.%' IDENTIFIED BY '$DEP_USER_PASSWORD';

-- Create landlord database (master database)
CREATE DATABASE IF NOT EXISTS landlord_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON landlord_db.* TO 'dep_user'@'localhost';
GRANT ALL PRIVILEGES ON landlord_db.* TO 'dep_user'@'172.17.0.%';

-- Create tenant template database
CREATE DATABASE IF NOT EXISTS tenant_template_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON tenant_template_db.* TO 'dep_user'@'localhost';
GRANT ALL PRIVILEGES ON tenant_template_db.* TO 'dep_user'@'172.17.0.%';

-- Grant ability to create tenant databases dynamically
GRANT CREATE ON *.* TO 'dep_user'@'localhost';
GRANT CREATE ON *.* TO 'dep_user'@'172.17.0.%';

FLUSH PRIVILEGES;
EOF

echo ""
echo "=== Database Setup Complete ==="
echo ""
echo "Created:"
echo "  - User: dep_user"
echo "  - Database: landlord_db"
echo "  - Database: tenant_template_db"
echo ""
echo "Note: Update LANDLORD_DB_PASSWORD in .env with: $DEP_USER_PASSWORD"

