-- Dedupe accounts before adding the unique index: the broken syncAll upsert
-- inserted duplicate rows per external_account_id. Keep the lowest id,
-- merge dep_account_id into it, repoint orders, then delete the rest.
UPDATE `accounts` a
JOIN (
	SELECT `external_account_id`, MIN(`id`) AS keep_id, MAX(`dep_account_id`) AS dep_id
	FROM `accounts`
	WHERE `external_account_id` IS NOT NULL
	GROUP BY `external_account_id`
	HAVING COUNT(*) > 1
) d ON a.`id` = d.keep_id
SET a.`dep_account_id` = COALESCE(a.`dep_account_id`, d.dep_id);--> statement-breakpoint
UPDATE `orders` o
JOIN `accounts` a ON o.`account_id` = a.`id`
JOIN (
	SELECT `external_account_id`, MIN(`id`) AS keep_id
	FROM `accounts`
	WHERE `external_account_id` IS NOT NULL
	GROUP BY `external_account_id`
) k ON a.`external_account_id` = k.`external_account_id`
SET o.`account_id` = k.keep_id
WHERE o.`account_id` <> k.keep_id;--> statement-breakpoint
DELETE a FROM `accounts` a
JOIN (
	SELECT `external_account_id`, MIN(`id`) AS keep_id
	FROM `accounts`
	WHERE `external_account_id` IS NOT NULL
	GROUP BY `external_account_id`
) k ON a.`external_account_id` = k.`external_account_id`
WHERE a.`id` <> k.keep_id;--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_external_account_id_unique` UNIQUE(`external_account_id`);
