ALTER TABLE `orders` ADD `erp_synced_at` timestamp;--> statement-breakpoint
ALTER TABLE `orders` ADD `erp_sync_error` text;