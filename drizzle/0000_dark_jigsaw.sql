CREATE TABLE `schedule_cells` (
	`row_key` text NOT NULL,
	`hour_index` integer NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`row_key`, `hour_index`)
);
--> statement-breakpoint
CREATE TABLE `shutdown_notes` (
	`row_key` text PRIMARY KEY NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shutdown_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
