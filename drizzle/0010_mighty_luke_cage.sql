-- `amount_refunded` (nullable, never written) becomes `amount` (NOT NULL): the
-- refund amount is what the learner paid, captured when they asked. SQLite
-- cannot add a NOT NULL column without a default, so rebuild the table and
-- backfill existing rows from the purchase.
CREATE TABLE `__new_refunds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`reason` text NOT NULL,
	`amount` integer NOT NULL,
	`requested_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by_user_id` integer,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_refunds` (`id`, `purchase_id`, `status`, `reason`, `amount`, `requested_at`, `resolved_at`, `resolved_by_user_id`)
SELECT `r`.`id`, `r`.`purchase_id`, `r`.`status`, `r`.`reason`, `p`.`amount_paid`, `r`.`requested_at`, `r`.`resolved_at`, `r`.`resolved_by_user_id`
FROM `refunds` `r`
INNER JOIN `purchases` `p` ON `p`.`id` = `r`.`purchase_id`;
--> statement-breakpoint
DROP TABLE `refunds`;
--> statement-breakpoint
ALTER TABLE `__new_refunds` RENAME TO `refunds`;
--> statement-breakpoint
CREATE INDEX `refunds_purchase_idx` ON `refunds` (`purchase_id`);
