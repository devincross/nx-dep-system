CREATE TABLE `reconciliation_findings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`run_id` char(36) NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`order_number` varchar(255),
	`external_order_id` varchar(255),
	`our_devices` text,
	`zoho_devices` text,
	`apple_devices` text,
	`zoho_match` boolean,
	`apple_match` boolean,
	`zoho_added` text,
	`zoho_removed` text,
	`zoho_correction_applied` boolean NOT NULL DEFAULT false,
	`missing_from_apple` text,
	`extra_in_apple` text,
	`recommended_action` enum('none','ov_restore','investigate','not_in_apple','not_in_zoho') NOT NULL DEFAULT 'none',
	`severity` enum('ok','warn','critical') NOT NULL DEFAULT 'ok',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `reconciliation_findings_id` PRIMARY KEY(`id`),
	CONSTRAINT `reconciliation_findings_run_order_unique` UNIQUE(`run_id`,`order_id`)
);
--> statement-breakpoint
CREATE TABLE `reconciliation_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`run_id` char(36) NOT NULL,
	`status` enum('pending','running','paused','complete','error','canceled') NOT NULL DEFAULT 'pending',
	`scope` text,
	`cursor_order_id` bigint unsigned NOT NULL DEFAULT 0,
	`total_orders` int,
	`processed_orders` int NOT NULL DEFAULT 0,
	`zoho_corrected_count` int NOT NULL DEFAULT 0,
	`zoho_mismatch_count` int NOT NULL DEFAULT 0,
	`apple_match_count` int NOT NULL DEFAULT 0,
	`missing_from_apple_count` int NOT NULL DEFAULT 0,
	`extra_in_apple_count` int NOT NULL DEFAULT 0,
	`critical_count` int NOT NULL DEFAULT 0,
	`error_order_count` int NOT NULL DEFAULT 0,
	`zoho_indexed_at` timestamp,
	`error` text,
	`started_at` timestamp,
	`completed_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `reconciliation_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `reconciliation_runs_run_id_unique` UNIQUE(`run_id`)
);
--> statement-breakpoint
CREATE INDEX `reconciliation_findings_run_idx` ON `reconciliation_findings` (`run_id`);--> statement-breakpoint
CREATE INDEX `reconciliation_findings_severity_idx` ON `reconciliation_findings` (`run_id`,`severity`);--> statement-breakpoint
CREATE INDEX `reconciliation_runs_status_idx` ON `reconciliation_runs` (`status`);