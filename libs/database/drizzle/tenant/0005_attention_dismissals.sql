CREATE TABLE `attention_dismissals` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`order_id` bigint unsigned NOT NULL,
	`type` varchar(64) NOT NULL,
	`note` text,
	`dismissed_by` varchar(255),
	`dismissed_at` timestamp DEFAULT (now()),
	CONSTRAINT `attention_dismissals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `attention_dismissals` ADD CONSTRAINT `attention_dismissals_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attention_dismissals_order_id_idx` ON `attention_dismissals` (`order_id`);