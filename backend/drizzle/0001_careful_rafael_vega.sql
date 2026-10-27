CREATE TABLE `post_images` (
	`post_id` text PRIMARY KEY NOT NULL,
	`bytes` blob NOT NULL,
	`mime` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
