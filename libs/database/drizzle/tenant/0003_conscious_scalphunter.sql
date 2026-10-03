-- Add with DEFAULT 'admin' so every existing user is backfilled as admin,
-- then reset the default to 'user' for accounts created afterwards.
ALTER TABLE `users` ADD `role` enum('admin','user') DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ALTER `role` SET DEFAULT 'user';
