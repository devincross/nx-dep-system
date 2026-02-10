-- Initialize databases for the multi-tenant application
-- This script runs automatically when the MariaDB container starts for the first time

-- Create the landlord (master) database
CREATE DATABASE IF NOT EXISTS landlord_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

-- Create a template tenant database for running migrations
CREATE DATABASE IF NOT EXISTS tenant_template_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

-- Create application user with appropriate privileges
CREATE USER IF NOT EXISTS 'dep_user'@'%' IDENTIFIED BY 'dep_password';

-- Grant privileges on landlord database
GRANT ALL PRIVILEGES ON landlord_db.* TO 'dep_user'@'%';

-- Grant privileges on tenant template database
GRANT ALL PRIVILEGES ON tenant_template_db.* TO 'dep_user'@'%';

-- Grant ability to create new databases (needed for creating tenant databases)
GRANT CREATE ON *.* TO 'dep_user'@'%';

-- Grant privileges on any tenant database (tenant_*)
-- Note: This grants access to all databases starting with 'tenant_'
GRANT ALL PRIVILEGES ON `tenant_%`.* TO 'dep_user'@'%';

-- Apply the privilege changes
FLUSH PRIVILEGES;

-- Log completion
SELECT 'Database initialization complete!' AS message;

