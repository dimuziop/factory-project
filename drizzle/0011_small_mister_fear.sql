-- The `refunds` table was really the Refund Request (the ask), not the Refund
-- (the money). Rename it, and rename the decision columns: a Refund Request is
-- "decided", not "resolved". The undecided state is "open", not "requested".
CREATE TABLE `refund_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reason` text NOT NULL,
	`amount` integer NOT NULL,
	`requested_at` text NOT NULL,
	`decided_at` text,
	`decided_by_user_id` integer,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refund_requests_purchase_idx` ON `refund_requests` (`purchase_id`);--> statement-breakpoint
INSERT INTO `refund_requests` (`id`, `purchase_id`, `status`, `reason`, `amount`, `requested_at`, `decided_at`, `decided_by_user_id`)
SELECT `id`, `purchase_id`, CASE `status` WHEN 'requested' THEN 'open' ELSE `status` END, `reason`, `amount`, `requested_at`, `resolved_at`, `resolved_by_user_id`
FROM `refunds`;--> statement-breakpoint
DROP TABLE `refunds`;