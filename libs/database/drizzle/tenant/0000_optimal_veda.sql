CREATE TABLE `accounts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`external_account_id` varchar(255),
	`dep_account_id` varchar(255),
	`name` varchar(255),
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`type` enum('dep','zoho','netsuite','database','ssl') NOT NULL,
	`status` enum('current','disabled') NOT NULL DEFAULT 'current',
	`connection_data` text NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	`deleted_at` timestamp,
	CONSTRAINT `credentials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dep_transactions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned,
	`transaction_id` varchar(255) NOT NULL,
	`device_enrollment_transaction_id` varchar(512),
	`order_type` enum('OR','RE','VD','OV') NOT NULL,
	`status` enum('pending','in_progress','complete','error','posted_with_errors') NOT NULL DEFAULT 'pending',
	`request_payload` text,
	`response_payload` text,
	`error_code` varchar(100),
	`error_message` text,
	`completed_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `dep_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_changes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`change_type` enum('created','updated','deleted') NOT NULL,
	`changed_fields` text,
	`snapshot` text,
	`synced_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `order_changes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_item_changes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`order_item_id` bigint unsigned,
	`serial_number` varchar(255) NOT NULL,
	`change_type` enum('added','updated','removed') NOT NULL,
	`changed_fields` text,
	`snapshot` text,
	`synced_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `order_item_changes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`is_dep` boolean NOT NULL DEFAULT false,
	`serial_number` varchar(255) NOT NULL,
	`dep_status` enum('pending','submitted','complete','error','changes') NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	`deleted_at` timestamp,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`order_id` char(36) NOT NULL,
	`account_id` bigint unsigned NOT NULL,
	`external_order_id` varchar(255),
	`external_account_id` varchar(255),
	`external_order_status` varchar(255),
	`status` enum('waiting','pending','submitted','complete','error','changes') NOT NULL,
	`po` varchar(255),
	`changes` text,
	`dep_order_id` char(36),
	`dep_ordered_at` timestamp,
	`dep_shipped_at` timestamp,
	`created_at` timestamp,
	`updated_at` timestamp,
	`source` varchar(255),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_external_order_id_unique` UNIQUE(`external_order_id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`permissions` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `sync_status` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`sync_type` enum('accounts','orders','full') NOT NULL,
	`status` enum('success','error','running','pending') NOT NULL,
	`last_sync_at` timestamp,
	`last_success_at` timestamp,
	`records_processed` int DEFAULT 0,
	`records_created` int DEFAULT 0,
	`records_updated` int DEFAULT 0,
	`records_errored` int DEFAULT 0,
	`error_message` text,
	`error_details` text,
	`started_at` timestamp,
	`completed_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `sync_status_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`role_id` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`first_name` varchar(255),
	`last_name` varchar(255),
	`password_hash` varchar(255),
	`is_active` boolean NOT NULL DEFAULT true,
	`last_login_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `dep_transactions` ADD CONSTRAINT `dep_transactions_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_changes` ADD CONSTRAINT `order_changes_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_item_changes` ADD CONSTRAINT `order_item_changes_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_item_changes` ADD CONSTRAINT `order_item_changes_order_item_id_order_items_id_fk` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `dep_txn_order_id_idx` ON `dep_transactions` (`order_id`);--> statement-breakpoint
CREATE INDEX `dep_txn_transaction_id_idx` ON `dep_transactions` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `dep_txn_enrollment_id_idx` ON `dep_transactions` (`device_enrollment_transaction_id`);--> statement-breakpoint
CREATE INDEX `dep_txn_status_idx` ON `dep_transactions` (`status`);--> statement-breakpoint
CREATE INDEX `order_changes_order_id_idx` ON `order_changes` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_changes_synced_at_idx` ON `order_changes` (`synced_at`);--> statement-breakpoint
CREATE INDEX `order_item_changes_order_id_idx` ON `order_item_changes` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_item_changes_order_item_id_idx` ON `order_item_changes` (`order_item_id`);--> statement-breakpoint
CREATE INDEX `order_item_changes_synced_at_idx` ON `order_item_changes` (`synced_at`);--> statement-breakpoint
CREATE INDEX `products_order_id_foreign` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `products_serial_number_index` ON `order_items` (`serial_number`);--> statement-breakpoint
CREATE INDEX `orders_account_id_foreign` ON `orders` (`account_id`);