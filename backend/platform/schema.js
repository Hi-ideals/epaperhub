/** Platform (master database) tables. Idempotent: safe to run on every start. */
const { master } = require('../config/db');

const T = 'ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

async function ensurePlatformSchema() {
  await master.query(`CREATE TABLE IF NOT EXISTS platform_admins (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(191) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    token_version INT UNSIGNED NOT NULL DEFAULT 0,
    failed_logins INT UNSIGNED NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ${T}`);

  await master.query(`CREATE TABLE IF NOT EXISTS plans (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'INR',
    duration_months INT UNSIGNED NOT NULL DEFAULT 12,
    storage_mb INT UNSIGNED NOT NULL DEFAULT 5120,
    max_admin_users INT UNSIGNED NOT NULL DEFAULT 5,
    max_editions_per_month INT UNSIGNED NOT NULL DEFAULT 0,
    modules LONGTEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ${T}`);

  await master.query(`CREATE TABLE IF NOT EXISTS tenants (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(80) NOT NULL UNIQUE,
    domain VARCHAR(191) NULL UNIQUE,
    db_name VARCHAR(64) NULL UNIQUE,
    owner_name VARCHAR(120) NULL,
    owner_email VARCHAR(191) NOT NULL,
    owner_phone VARCHAR(30) NULL,
    plan_id INT UNSIGNED NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    starts_at DATE NULL,
    expires_at DATE NULL,
    storage_mb INT UNSIGNED NULL,
    max_admin_users INT UNSIGNED NULL,
    max_editions_per_month INT UNSIGNED NULL,
    modules LONGTEXT NULL,
    notes VARCHAR(1000) NULL,
    storage_used_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    storage_checked_at DATETIME NULL,
    last_reminder VARCHAR(20) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_tenant_status (status),
    CONSTRAINT fk_tenant_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL
  ) ${T}`);

  await master.query(`CREATE TABLE IF NOT EXISTS platform_settings (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(191) NOT NULL UNIQUE,
    setting_value LONGTEXT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ${T}`);

  await require('./credentials').ensure();

  await master.query(`CREATE TABLE IF NOT EXISTS platform_activity (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    admin_id INT UNSIGNED NULL,
    tenant_id INT UNSIGNED NULL,
    action VARCHAR(80) NOT NULL,
    details LONGTEXT NULL,
    ip_address VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_pa_created (created_at),
    KEY idx_pa_tenant (tenant_id)
  ) ${T}`);
}

module.exports = { ensurePlatformSchema };
