-- ============================================================
-- Maa Baglamukhi Resort — v4 Normalized Schema
-- Auto-bootstrapping: CREATE TABLE IF NOT EXISTS everywhere
-- ============================================================

-- 1. USERS & AUTH
-- ============================================================

CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) UNIQUE,
  `phone` VARCHAR(30),
  `password_hash` VARCHAR(255) NOT NULL,
  `role_id` INT UNSIGNED NOT NULL DEFAULT 4,
  `avatar_url` VARCHAR(500),
  `status` ENUM('active','inactive','suspended') DEFAULT 'active',
  `last_login_at` DATETIME NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_email` (`email`),
  KEY `idx_phone` (`phone`),
  KEY `idx_role` (`role_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Roles
CREATE TABLE IF NOT EXISTS `roles` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL UNIQUE,
  `display_name` VARCHAR(100) NOT NULL,
  `description` TEXT,
  `is_system` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- System roles used by every role-gated route (roleMiddleware alias map).
-- The login JWT carries roles.name via LEFT JOIN; an empty roles table makes
-- every user fall back to 'staff', so all admin-gated routes answer 403.
-- INSERT IGNORE against the UNIQUE key on roles.name: additive only — a
-- running install keeps its existing rows, a fresh install gets the seven.
-- ids are fixed so users.role_id (1..7, see ensureDefaultStaffLogins)
-- resolves to the right role.
INSERT IGNORE INTO `roles` (`id`, `name`, `display_name`, `is_system`) VALUES
  (1, 'admin', 'Administrator', 0),
  (2, 'manager', 'Manager', 0),
  (3, 'reception', 'Reception', 0),
  (4, 'accounts', 'Accounts', 0),
  (5, 'housekeeping', 'Housekeeping', 0),
  (6, 'waiter', 'Waiter', 0),
  (7, 'kitchen', 'Kitchen', 0);

-- Permissions
CREATE TABLE IF NOT EXISTS `permissions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `module` VARCHAR(50) NOT NULL,
  `action` VARCHAR(50) NOT NULL,
  `description` VARCHAR(255),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_module_action` (`module`, `action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Role-Permission mapping
CREATE TABLE IF NOT EXISTS `role_permissions` (
  `role_id` INT UNSIGNED NOT NULL,
  `permission_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`role_id`, `permission_id`),
  FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- User sessions (JWT tracking)
CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `token_jti` VARCHAR(64) NOT NULL,
  `ip_address` VARCHAR(64),
  `user_agent` VARCHAR(255),
  `expires_at` DATETIME NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_jti` (`token_jti`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. RESORT & ROOMS
-- ============================================================

CREATE TABLE IF NOT EXISTS `resort_profiles` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `tagline` VARCHAR(255),
  `description` TEXT,
  `address_line1` VARCHAR(255),
  `address_line2` VARCHAR(255),
  `city` VARCHAR(100),
  `state` VARCHAR(100),
  `country` VARCHAR(100) DEFAULT 'India',
  `pincode` VARCHAR(20),
  `phone` VARCHAR(30),
  `email` VARCHAR(191),
  `website` VARCHAR(255),
  `gstin` VARCHAR(50),
  `check_in_time` TIME DEFAULT '14:00:00',
  `check_out_time` TIME DEFAULT '11:00:00',
  `logo_url` VARCHAR(500),
  `cover_image_url` VARCHAR(500),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Room types / categories
CREATE TABLE IF NOT EXISTS `room_categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `slug` VARCHAR(120) NOT NULL UNIQUE,
  `description` TEXT,
  `max_adults` INT DEFAULT 2,
  `max_children` INT DEFAULT 1,
  `default_price` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `size_sqft` INT,
  `bed_type` VARCHAR(50),
  `view_type` VARCHAR(50),
  `unit_label` VARCHAR(40) DEFAULT 'Room',
  `is_active` TINYINT(1) DEFAULT 1,
  `sort_order` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_slug` (`slug`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Individual rooms
CREATE TABLE IF NOT EXISTS `rooms` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `room_number` VARCHAR(50) NOT NULL,
  `category_id` INT UNSIGNED NOT NULL,
  `floor` VARCHAR(20),
  `building` VARCHAR(100),
  `status` ENUM('available','occupied','cleaning','out_of_service','reserved') DEFAULT 'available',
  `current_booking_id` INT UNSIGNED NULL,
  `notes` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_room_number` (`room_number`),
  KEY `idx_category` (`category_id`),
  KEY `idx_status` (`status`),
  FOREIGN KEY (`category_id`) REFERENCES `room_categories`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Amenity catalog
CREATE TABLE IF NOT EXISTS `amenities` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL UNIQUE,
  `icon` VARCHAR(100),
  `category` VARCHAR(50),
  `description` TEXT,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Category ↔ Amenity mapping
CREATE TABLE IF NOT EXISTS `room_category_amenities` (
  `category_id` INT UNSIGNED NOT NULL,
  `amenity_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`category_id`, `amenity_id`),
  FOREIGN KEY (`category_id`) REFERENCES `room_categories`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`amenity_id`) REFERENCES `amenities`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Room/category image gallery
CREATE TABLE IF NOT EXISTS `room_images` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id` INT UNSIGNED NOT NULL,
  `url` VARCHAR(500) NOT NULL,
  `alt_text` VARCHAR(255),
  `sort_order` INT DEFAULT 0,
  `is_primary` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category_id`),
  FOREIGN KEY (`category_id`) REFERENCES `room_categories`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rate plans (BAR, AP, CP, MAP, EP)
CREATE TABLE IF NOT EXISTS `rate_plans` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(20) NOT NULL UNIQUE,
  `name` VARCHAR(100) NOT NULL,
  `description` TEXT,
  `includes_breakfast` TINYINT(1) DEFAULT 0,
  `includes_lunch` TINYINT(1) DEFAULT 0,
  `includes_dinner` TINYINT(1) DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Base rates per category per rate plan
CREATE TABLE IF NOT EXISTS `room_rates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id` INT UNSIGNED NOT NULL,
  `rate_plan_id` INT UNSIGNED NOT NULL,
  `price` DECIMAL(10,2) NOT NULL,
  `currency` VARCHAR(10) DEFAULT 'INR',
  `is_active` TINYINT(1) DEFAULT 1,
  `effective_from` DATE,
  `effective_to` DATE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_category_plan` (`category_id`, `rate_plan_id`),
  KEY `idx_category` (`category_id`),
  FOREIGN KEY (`category_id`) REFERENCES `room_categories`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`rate_plan_id`) REFERENCES `rate_plans`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Date-specific rate overrides
CREATE TABLE IF NOT EXISTS `room_rate_calendar` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id` INT UNSIGNED NOT NULL,
  `rate_plan_id` INT UNSIGNED NOT NULL,
  `date` DATE NOT NULL,
  `price` DECIMAL(10,2) NOT NULL,
  `min_nights` INT DEFAULT 1,
  `max_nights` INT DEFAULT 30,
  `stop_sell` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_date_category_plan` (`date`, `category_id`, `rate_plan_id`),
  KEY `idx_category_date` (`category_id`, `date`),
  FOREIGN KEY (`category_id`) REFERENCES `room_categories`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`rate_plan_id`) REFERENCES `rate_plans`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. BOOKINGS & GUESTS
-- ============================================================

CREATE TABLE IF NOT EXISTS `bookings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_code` VARCHAR(40) NOT NULL UNIQUE,
  `source_id` INT UNSIGNED,
  `status` ENUM('inquiry','confirmed','reserved','checked_in','checked_out','cancelled','no_show') DEFAULT 'confirmed',
  `check_in` DATE NOT NULL,
  `check_out` DATE NOT NULL,
  `adults` INT DEFAULT 1,
  `children` INT DEFAULT 0,
  `infants` INT DEFAULT 0,
  `total_rooms` INT DEFAULT 1,
  `total_guests` INT DEFAULT 1,
  `subtotal` DECIMAL(12,2) DEFAULT 0,
  `discount_amount` DECIMAL(12,2) DEFAULT 0,
  `tax_amount` DECIMAL(12,2) DEFAULT 0,
  `total_amount` DECIMAL(12,2) DEFAULT 0,
  `advance_amount` DECIMAL(12,2) DEFAULT 0,
  `balance_amount` DECIMAL(12,2) DEFAULT 0,
  `currency` VARCHAR(10) DEFAULT 'INR',
  `cancellation_reason` TEXT,
  `special_requests` TEXT,
  `created_by` BIGINT UNSIGNED,
  `cancelled_by` BIGINT UNSIGNED,
  `cancelled_at` DATETIME NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_booking_code` (`booking_code`),
  KEY `idx_status` (`status`),
  KEY `idx_dates` (`check_in`, `check_out`),
  KEY `idx_source` (`source_id`),
  KEY `idx_created_by` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Booking sources / channels
CREATE TABLE IF NOT EXISTS `booking_sources` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL UNIQUE,
  `type` ENUM('direct','walk_in','ota','corporate','travel_agent','gds','social','other') DEFAULT 'direct',
  `is_active` TINYINT(1) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Status history (full lifecycle tracking)
CREATE TABLE IF NOT EXISTS `booking_status_history` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `from_status` VARCHAR(50),
  `to_status` VARCHAR(50) NOT NULL,
  `changed_by` BIGINT UNSIGNED,
  `remarks` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_created` (`created_at`),
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Room allocation per booking (supports multi-room)
CREATE TABLE IF NOT EXISTS `booking_rooms` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `room_id` INT UNSIGNED NOT NULL,
  `category_id` INT UNSIGNED NOT NULL,
  `rate_plan_id` INT UNSIGNED,
  `rate_per_night` DECIMAL(10,2) NOT NULL,
  `nights` INT NOT NULL DEFAULT 1,
  `room_charge` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `extra_charges` DECIMAL(12,2) DEFAULT 0,
  `discount` DECIMAL(12,2) DEFAULT 0,
  `total` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `guest_name` VARCHAR(255),
  `adults` INT DEFAULT 1,
  `children` INT DEFAULT 0,
  `notes` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_room` (`room_id`),
  KEY `idx_category` (`category_id`),
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`category_id`) REFERENCES `room_categories`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`rate_plan_id`) REFERENCES `rate_plans`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Guest profiles
CREATE TABLE IF NOT EXISTS `guest_profiles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `first_name` VARCHAR(120) NOT NULL,
  `last_name` VARCHAR(120),
  `email` VARCHAR(191),
  `phone` VARCHAR(30) NOT NULL,
  `alternate_phone` VARCHAR(30),
  `date_of_birth` DATE,
  `gender` ENUM('male','female','other','prefer_not_to_say'),
  `nationality` VARCHAR(100) DEFAULT 'Indian',
  `id_type` ENUM('aadhaar','passport','driving_license','voter_id','other'),
  `id_number` VARCHAR(100),
  `address_line1` VARCHAR(255),
  `address_line2` VARCHAR(255),
  `city` VARCHAR(100),
  `state` VARCHAR(100),
  `country` VARCHAR(100),
  `pincode` VARCHAR(20),
  `preferences` JSON,
  `is_vip` TINYINT(1) DEFAULT 0,
  `total_stays` INT DEFAULT 0,
  `total_spend` DECIMAL(14,2) DEFAULT 0,
  `last_stay_date` DATE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_phone` (`phone`),
  KEY `idx_email` (`email`),
  KEY `idx_vip` (`is_vip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Link bookings to guest profiles
CREATE TABLE IF NOT EXISTS `booking_guests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `guest_profile_id` BIGINT UNSIGNED,
  `is_primary` TINYINT(1) DEFAULT 0,
  `first_name` VARCHAR(120) NOT NULL,
  `last_name` VARCHAR(120),
  `age` INT,
  `relationship` VARCHAR(50),
  PRIMARY KEY (`id`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_guest` (`guest_profile_id`),
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`guest_profile_id`) REFERENCES `guest_profiles`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Guest identification documents
CREATE TABLE IF NOT EXISTS `guest_identifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED,
  `guest_profile_id` BIGINT UNSIGNED,
  `id_type` ENUM('aadhaar','passport','driving_license','voter_id','other') NOT NULL,
  `id_number` VARCHAR(100) NOT NULL,
  `file_url` VARCHAR(500),
  `verified` TINYINT(1) DEFAULT 0,
  `verified_by` BIGINT UNSIGNED,
  `verified_at` DATETIME,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_guest` (`guest_profile_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Guest reviews & ratings (Booking.com-style)
CREATE TABLE IF NOT EXISTS `guest_reviews` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED,
  `guest_profile_id` BIGINT UNSIGNED,
  `overall_rating` DECIMAL(2,1) NOT NULL,
  `cleanliness_rating` DECIMAL(2,1),
  `service_rating` DECIMAL(2,1),
  `location_rating` DECIMAL(2,1),
  `value_rating` DECIMAL(2,1),
  `review_title` VARCHAR(255),
  `review_text` TEXT,
  `is_published` TINYINT(1) DEFAULT 0,
  `published_at` DATETIME,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_guest` (`guest_profile_id`),
  KEY `idx_published` (`is_published`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Review media
CREATE TABLE IF NOT EXISTS `review_media` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `review_id` BIGINT UNSIGNED NOT NULL,
  `media_type` ENUM('image','video') DEFAULT 'image',
  `url` VARCHAR(500) NOT NULL,
  `caption` VARCHAR(255),
  `sort_order` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_review` (`review_id`),
  FOREIGN KEY (`review_id`) REFERENCES `guest_reviews`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Special requests per booking
CREATE TABLE IF NOT EXISTS `special_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `request_type` ENUM('early_checkin','late_checkout','anniversary','birthday','honeymoon','dietary','accessibility','other') DEFAULT 'other',
  `description` TEXT,
  `status` ENUM('pending','acknowledged','fulfilled','unavailable') DEFAULT 'pending',
  `handled_by` BIGINT UNSIGNED,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_booking` (`booking_id`),
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Promotions & offers
CREATE TABLE IF NOT EXISTS `promotions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `code` VARCHAR(50) UNIQUE,
  `description` TEXT,
  `type` ENUM('percentage','fixed_amount','free_night','upgrade','other') DEFAULT 'percentage',
  `value` DECIMAL(10,2) NOT NULL,
  `max_discount` DECIMAL(10,2),
  `applicable_categories` JSON,
  `min_nights` INT DEFAULT 1,
  `max_nights` INT,
  `min_advance_days` INT,
  `valid_from` DATE NOT NULL,
  `valid_to` DATE NOT NULL,
  `max_redemptions` INT,
  `used_count` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_code` (`code`),
  KEY `idx_dates` (`valid_from`, `valid_to`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Track promo usage per booking
CREATE TABLE IF NOT EXISTS `promo_usages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `promotion_id` BIGINT UNSIGNED NOT NULL,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `discount_amount` DECIMAL(12,2) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_promo` (`promotion_id`),
  FOREIGN KEY (`promotion_id`) REFERENCES `promotions`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- Phase 2: Restaurant, Kitchen, Banquet, Payments
-- ============================================================

-- 4. RESTAURANT
-- ============================================================

CREATE TABLE IF NOT EXISTS `restaurant_tables` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `number` VARCHAR(50) NOT NULL UNIQUE,
  `floor_name` VARCHAR(80),
  `section_name` VARCHAR(80),
  `seat_count` INT DEFAULT 4,
  `status` ENUM('available','occupied','reserved','cleaning','out_of_service') DEFAULT 'available',
  `status_color` VARCHAR(30),
  `is_active` TINYINT(1) DEFAULT 1,
  `sort_order` INT DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `menu_categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT,
  `sort_order` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `menu_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT,
  `price` DECIMAL(10,2) NOT NULL,
  `tax_percent` DECIMAL(5,2) DEFAULT 5.00,
  `food_type` ENUM('Veg','Non-Veg','Egg',' Jain') DEFAULT 'Veg',
  `status` ENUM('available','unavailable','seasonal') DEFAULT 'available',
  `image_url` VARCHAR(500),
  `is_featured` TINYINT(1) DEFAULT 0,
  `prep_time_minutes` INT DEFAULT 15,
  `sort_order` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category_id`),
  KEY `idx_status` (`status`),
  FOREIGN KEY (`category_id`) REFERENCES `menu_categories`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `table_id` INT UNSIGNED,
  `table_number` VARCHAR(50) NOT NULL,
  `token_id` BIGINT UNSIGNED,
  `waiter_id` BIGINT UNSIGNED,
  `waiter_name` VARCHAR(191),
  `entity_type` ENUM('Table','Room','Token','Takeaway') DEFAULT 'Table',
  `entity_ref_id` BIGINT UNSIGNED,
  `status` ENUM('pending','confirmed','preparing','ready','served','completed','cancelled') DEFAULT 'pending',
  `subtotal` DECIMAL(12,2) DEFAULT 0,
  `tax_amount` DECIMAL(12,2) DEFAULT 0,
  `discount_amount` DECIMAL(12,2) DEFAULT 0,
  `total_amount` DECIMAL(12,2) DEFAULT 0,
  `notes` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_table` (`table_number`),
  KEY `idx_token` (`token_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  FOREIGN KEY (`waiter_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`table_id`) REFERENCES `restaurant_tables`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `menu_item_id` INT UNSIGNED,
  `name` VARCHAR(191) NOT NULL,
  `quantity` INT NOT NULL DEFAULT 1,
  `unit_price` DECIMAL(10,2) NOT NULL,
  `tax_percent` DECIMAL(5,2) DEFAULT 0,
  `tax_amount` DECIMAL(10,2) DEFAULT 0,
  `total` DECIMAL(12,2) NOT NULL,
  `notes` VARCHAR(255),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order` (`order_id`),
  KEY `idx_menu_item` (`menu_item_id`),
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Consolidated bills
CREATE TABLE IF NOT EXISTS `bills` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT UNSIGNED,
  `table_number` VARCHAR(50) NOT NULL,
  `token_id` BIGINT UNSIGNED,
  `entity_type` ENUM('Table','Room','Token','Takeaway','Banquet') DEFAULT 'Table',
  `entity_ref_id` BIGINT UNSIGNED,
  `waiter_name` VARCHAR(191),
  `customer_name` VARCHAR(191),
  `phone` VARCHAR(30),
  `subtotal` DECIMAL(12,2) DEFAULT 0,
  `service_charge` DECIMAL(12,2) DEFAULT 0,
  `tax_amount` DECIMAL(12,2) DEFAULT 0,
  `discount_amount` DECIMAL(12,2) DEFAULT 0,
  `round_off` DECIMAL(10,2) DEFAULT 0,
  `total` DECIMAL(12,2) DEFAULT 0,
  `payment_method` ENUM('cash','card','upi','wallet','net_banking','credit','other') DEFAULT 'cash',
  `payment_status` ENUM('unpaid','partial','paid','refunded','cancelled') DEFAULT 'unpaid',
  `paid_amount` DECIMAL(12,2) DEFAULT 0,
  `paid_at` DATETIME,
  `split_count` INT DEFAULT 1,
  `split_no` INT DEFAULT 1,
  `room_booking_id` BIGINT UNSIGNED,
  `room_booking_code` VARCHAR(80),
  `folio_entry_id` BIGINT UNSIGNED,
  `source_module` VARCHAR(50),
  `created_by` BIGINT UNSIGNED,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order` (`order_id`),
  KEY `idx_table` (`table_number`),
  KEY `idx_status` (`payment_status`),
  KEY `idx_created` (`created_at`),
  KEY `idx_booking` (`room_booking_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Split bill lines
CREATE TABLE IF NOT EXISTS `bill_splits` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bill_id` BIGINT UNSIGNED NOT NULL,
  `split_no` INT NOT NULL,
  `split_label` VARCHAR(100),
  `amount` DECIMAL(12,2) NOT NULL,
  `payment_method` VARCHAR(50),
  `paid_at` DATETIME,
  PRIMARY KEY (`id`),
  KEY `idx_bill` (`bill_id`),
  FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- QR Tokens for ordering
CREATE TABLE IF NOT EXISTS `tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token_code` VARCHAR(40) NOT NULL UNIQUE,
  `table_id` INT UNSIGNED,
  `table_number` VARCHAR(50),
  `waiter_id` BIGINT UNSIGNED,
  `waiter_name` VARCHAR(191),
  `status` ENUM('active','completed','cancelled','expired') DEFAULT 'active',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_code` (`token_code`),
  KEY `idx_status` (`status`),
  KEY `idx_table` (`table_number`),
  FOREIGN KEY (`table_id`) REFERENCES `restaurant_tables`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kitchen Order Tickets
CREATE TABLE IF NOT EXISTS `kot_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `table_number` VARCHAR(50) NOT NULL,
  `waiter_name` VARCHAR(191),
  `entity_type` ENUM('Table','Room','Token','Takeaway') DEFAULT 'Table',
  `items` JSON NOT NULL,
  `status` ENUM('pending','preparing','ready','completed','cancelled') DEFAULT 'pending',
  `prep_time_minutes` INT DEFAULT 20,
  `expected_ready_at` DATETIME,
  `ready_at` DATETIME,
  `ready_message` VARCHAR(255),
  `kot_no` VARCHAR(100),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order` (`order_id`),
  KEY `idx_table` (`table_number`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. BANQUET & EVENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS `banquet_halls` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT,
  `capacity_min` INT DEFAULT 10,
  `capacity_max` INT DEFAULT 200,
  `area_sqft` INT,
  `rate_per_hour` DECIMAL(10,2) DEFAULT 0,
  `rate_per_day` DECIMAL(10,2) DEFAULT 0,
  `is_ac` TINYINT(1) DEFAULT 0,
  `has_projector` TINYINT(1) DEFAULT 0,
  `has_sound_system` TINYINT(1) DEFAULT 0,
  `has_stage` TINYINT(1) DEFAULT 0,
  `has_dance_floor` TINYINT(1) DEFAULT 0,
  `image_url` VARCHAR(500),
  `status` ENUM('available','booked','maintenance') DEFAULT 'available',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `banquet_pricing_plans` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `hall_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `min_guests` INT,
  `max_guests` INT,
  `hall_charge` DECIMAL(12,2) DEFAULT 0,
  `per_plate_rate` DECIMAL(10,2) DEFAULT 0,
  `min_hours` INT DEFAULT 4,
  `extra_hour_rate` DECIMAL(10,2) DEFAULT 0,
  `is_default` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_hall` (`hall_id`),
  FOREIGN KEY (`hall_id`) REFERENCES `banquet_halls`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `banquet_bookings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED,
  `hall_id` INT UNSIGNED NOT NULL,
  `customer_name` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(50) NOT NULL,
  `email` VARCHAR(191),
  `event_title` VARCHAR(191) NOT NULL,
  `event_type` VARCHAR(100),
  `guest_count` INT,
  `menu_package` VARCHAR(100),
  `meal_section` VARCHAR(100),
  `custom_menu_items` TEXT,
  `lighting_system` VARCHAR(100),
  `decoration_fee` DECIMAL(12,2) DEFAULT 0,
  `event_support_fee` DECIMAL(12,2) DEFAULT 0,
  `lighting_charge` DECIMAL(12,2) DEFAULT 0,
  `custom_menu_charge` DECIMAL(12,2) DEFAULT 0,
  `hall_charge` DECIMAL(12,2) DEFAULT 0,
  `meal_charge` DECIMAL(12,2) DEFAULT 0,
  `subtotal` DECIMAL(12,2) DEFAULT 0,
  `discount` DECIMAL(12,2) DEFAULT 0,
  `gst_percent` DECIMAL(5,2) DEFAULT 5.00,
  `gst_amount` DECIMAL(12,2) DEFAULT 0,
  `total` DECIMAL(12,2) DEFAULT 0,
  `advance` DECIMAL(12,2) DEFAULT 0,
  `balance` DECIMAL(12,2) DEFAULT 0,
  `event_date` DATE NOT NULL,
  `start_time` TIME NOT NULL,
  `end_time` TIME NOT NULL,
  `status` ENUM('inquiry','confirmed','in_progress','completed','cancelled') DEFAULT 'confirmed',
  `invoice_no` VARCHAR(100),
  `created_by` BIGINT UNSIGNED,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_hall_date` (`hall_id`, `event_date`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  FOREIGN KEY (`hall_id`) REFERENCES `banquet_halls`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Banquet booking addons (lighting, decoration, etc.)
CREATE TABLE IF NOT EXISTS `banquet_booking_addons` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `addon_type` ENUM('lighting','decoration','event_support','custom_menu','other') NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT,
  `amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_booking` (`booking_id`),
  FOREIGN KEY (`booking_id`) REFERENCES `banquet_bookings`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. PAYMENTS & FINANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS `payment_methods` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL UNIQUE,
  `code` VARCHAR(30) NOT NULL UNIQUE,
  `is_active` TINYINT(1) DEFAULT 1,
  `icon` VARCHAR(100),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Unified payments table
CREATE TABLE IF NOT EXISTS `payments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED,
  `bill_id` BIGINT UNSIGNED,
  `invoice_id` BIGINT UNSIGNED,
  `banquet_booking_id` BIGINT UNSIGNED,
  `amount` DECIMAL(12,2) NOT NULL,
  `payment_method_id` INT UNSIGNED NOT NULL,
  `payment_type` ENUM('advance','payment','refund','balance','deposit') DEFAULT 'payment',
  `reference_no` VARCHAR(100),
  `transaction_details` TEXT,
  `receipt_url` VARCHAR(500),
  `status` ENUM('pending','completed','failed','refunded','cancelled') DEFAULT 'completed',
  `received_by` BIGINT UNSIGNED,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_bill` (`bill_id`),
  KEY `idx_invoice` (`invoice_id`),
  KEY `idx_method` (`payment_method_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Invoices
CREATE TABLE IF NOT EXISTS `invoices` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED,
  `banquet_booking_id` BIGINT UNSIGNED,
  `invoice_no` VARCHAR(80) NOT NULL UNIQUE,
  `invoice_type` ENUM('room','restaurant','banquet','combined','folio') DEFAULT 'room',
  `invoice_date` DATE NOT NULL,
  `due_date` DATE,
  `subtotal` DECIMAL(12,2) DEFAULT 0,
  `service_charge` DECIMAL(12,2) DEFAULT 0,
  `tax_amount` DECIMAL(12,2) DEFAULT 0,
  `discount_amount` DECIMAL(12,2) DEFAULT 0,
  `round_off` DECIMAL(10,2) DEFAULT 0,
  `total` DECIMAL(12,2) DEFAULT 0,
  `paid_amount` DECIMAL(12,2) DEFAULT 0,
  `balance` DECIMAL(12,2) DEFAULT 0,
  `payment_status` ENUM('unpaid','partial','paid','overdue','refunded') DEFAULT 'unpaid',
  `payment_mode` VARCHAR(50),
  `terms_accepted` TINYINT(1) DEFAULT 0,
  `terms_accepted_at` DATETIME,
  `sent_at` DATETIME,
  `created_by` BIGINT UNSIGNED,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_invoice_no` (`invoice_no`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_status` (`payment_status`),
  KEY `idx_dates` (`invoice_date`, `due_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Invoice line items
CREATE TABLE IF NOT EXISTS `invoice_lines` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invoice_id` BIGINT UNSIGNED NOT NULL,
  `line_type` ENUM('room_charge','extra_charge','food','beverage','service','tax','discount','payment','adjustment','other') DEFAULT 'other',
  `description` VARCHAR(255) NOT NULL,
  `reference_id` BIGINT UNSIGNED,
  `reference_type` VARCHAR(50),
  `quantity` DECIMAL(10,3) DEFAULT 1,
  `unit_price` DECIMAL(10,2) DEFAULT 0,
  `amount` DECIMAL(12,2) NOT NULL,
  `tax_percent` DECIMAL(5,2) DEFAULT 0,
  `tax_amount` DECIMAL(10,2) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_invoice` (`invoice_id`),
  KEY `idx_type` (`line_type`),
  FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Folio entries (guest folio / night audit)
CREATE TABLE IF NOT EXISTS `folio_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id` BIGINT UNSIGNED NOT NULL,
  `booking_room_id` BIGINT UNSIGNED,
  `entry_date` DATE NOT NULL,
  `entry_type` ENUM('room_charge','extra_charge','discount','payment','refund','adjustment','food','beverage','service') DEFAULT 'adjustment',
  `category` VARCHAR(100) DEFAULT 'Miscellaneous',
  `description` VARCHAR(255) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `reference_id` BIGINT UNSIGNED,
  `reference_type` VARCHAR(50),
  `created_by` VARCHAR(100) DEFAULT 'Front Desk',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_room` (`booking_room_id`),
  KEY `idx_date` (`entry_date`),
  KEY `idx_type` (`entry_type`),
  FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. HOUSEKEEPING
-- ============================================================

CREATE TABLE IF NOT EXISTS `housekeeping_statuses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL UNIQUE,
  `display_name` VARCHAR(100) NOT NULL,
  `color` VARCHAR(30),
  `sort_order` INT DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `housekeeping_assignments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `room_id` INT UNSIGNED NOT NULL,
  `room_number` VARCHAR(50) NOT NULL,
  `assigned_to` BIGINT UNSIGNED,
  `assigned_to_name` VARCHAR(191),
  `task_type` ENUM('cleaning','deep_clean','inspection','setup','maintenance','other') DEFAULT 'cleaning',
  `priority` ENUM('urgent','high','normal','low') DEFAULT 'normal',
  `status` ENUM('pending','in_progress','completed','verified','cancelled') DEFAULT 'pending',
  `notes` TEXT,
  `started_at` DATETIME,
  `completed_at` DATETIME,
  `verified_by` BIGINT UNSIGNED,
  `verified_at` DATETIME,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_room` (`room_number`),
  KEY `idx_assignee` (`assigned_to`),
  KEY `idx_status` (`status`),
  FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Completed cleaning log
CREATE TABLE IF NOT EXISTS `housekeeping_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `room_id` VARCHAR(100),
  `room_number` VARCHAR(50) NOT NULL,
  `assignment_id` BIGINT UNSIGNED,
  `assigned_to` VARCHAR(255),
  `guest_status` VARCHAR(255),
  `final_status` VARCHAR(100),
  `verified_by_user_id` BIGINT UNSIGNED,
  `verified_by_name` VARCHAR(120),
  `completed_at` DATETIME,
  `verified_at` DATETIME,
  PRIMARY KEY (`id`),
  KEY `idx_room` (`room_number`),
  KEY `idx_completed` (`completed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Maintenance requests
CREATE TABLE IF NOT EXISTS `maintenance_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `room_id` INT UNSIGNED,
  `room_number` VARCHAR(50),
  `request_type` VARCHAR(100) NOT NULL,
  `description` TEXT,
  `priority` ENUM('urgent','high','normal','low') DEFAULT 'normal',
  `status` ENUM('open','in_progress','resolved','cancelled') DEFAULT 'open',
  `assigned_to` BIGINT UNSIGNED,
  `reported_by` BIGINT UNSIGNED,
  `resolved_at` DATETIME,
  `cost` DECIMAL(10,2) DEFAULT 0,
  `notes` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_room` (`room_number`),
  KEY `idx_status` (`status`),
  KEY `idx_priority` (`priority`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. INVENTORY & PROCUREMENT
-- ============================================================

CREATE TABLE IF NOT EXISTS `inventory_categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `parent_id` INT UNSIGNED,
  `description` TEXT,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_parent` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `category_id` INT UNSIGNED,
  `sku` VARCHAR(100) UNIQUE,
  `unit_id` INT UNSIGNED,
  `vendor_id` INT UNSIGNED,
  `unit_cost` DECIMAL(10,2) DEFAULT 0,
  `selling_price` DECIMAL(10,2) DEFAULT 0,
  `reorder_level` DECIMAL(10,3) DEFAULT 0,
  `reorder_quantity` DECIMAL(10,3) DEFAULT 0,
  `hsn_code` VARCHAR(20),
  `tax_percent` DECIMAL(5,2) DEFAULT 0,
  `is_perishable` TINYINT(1) DEFAULT 0,
  `shelf_life_days` INT,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category_id`),
  KEY `idx_sku` (`sku`),
  KEY `idx_vendor` (`vendor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_stock` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `inventory_item_id` BIGINT UNSIGNED NOT NULL,
  `location_id` INT UNSIGNED,
  `batch_no` VARCHAR(100),
  `expiry_date` DATE,
  `quantity` DECIMAL(10,3) DEFAULT 0,
  `unit_cost` DECIMAL(10,2) DEFAULT 0,
  `last_restocked` DATETIME,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_item` (`inventory_item_id`),
  KEY `idx_location` (`location_id`),
  KEY `idx_batch` (`batch_no`),
  FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_vendors` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `contact_person` VARCHAR(191),
  `phone` VARCHAR(30),
  `email` VARCHAR(191),
  `address` TEXT,
  `gstin` VARCHAR(50),
  `category` VARCHAR(100),
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_name` (`name`),
  KEY `idx_gstin` (`gstin`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_units` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL UNIQUE,
  `abbreviation` VARCHAR(20) NOT NULL,
  `base_unit_id` INT UNSIGNED,
  `conversion_factor` DECIMAL(10,4) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_locations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `type` ENUM('store','cold_storage','dry_store','bar','kitchen','other') DEFAULT 'store',
  `building` VARCHAR(100),
  `floor` VARCHAR(20),
  `is_active` TINYINT(1) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_purchases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `vendor_id` INT UNSIGNED,
  `purchase_no` VARCHAR(80) NOT NULL UNIQUE,
  `purchase_date` DATE NOT NULL,
  `total_amount` DECIMAL(12,2) DEFAULT 0,
  `paid_amount` DECIMAL(12,2) DEFAULT 0,
  `status` ENUM('draft','ordered','received','completed','cancelled') DEFAULT 'draft',
  `notes` TEXT,
  `received_by` BIGINT UNSIGNED,
  `created_by` BIGINT UNSIGNED,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_vendor` (`vendor_id`),
  KEY `idx_date` (`purchase_date`),
  KEY `idx_status` (`status`),
  FOREIGN KEY (`vendor_id`) REFERENCES `inventory_vendors`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_purchase_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `purchase_id` BIGINT UNSIGNED NOT NULL,
  `inventory_item_id` BIGINT UNSIGNED NOT NULL,
  `quantity` DECIMAL(10,3) NOT NULL,
  `unit_cost` DECIMAL(10,2) NOT NULL,
  `tax_percent` DECIMAL(5,2) DEFAULT 0,
  `tax_amount` DECIMAL(10,2) DEFAULT 0,
  `total` DECIMAL(12,2) NOT NULL,
  `batch_no` VARCHAR(100),
  `expiry_date` DATE,
  PRIMARY KEY (`id`),
  KEY `idx_purchase` (`purchase_id`),
  KEY `idx_item` (`inventory_item_id`),
  FOREIGN KEY (`purchase_id`) REFERENCES `inventory_purchases`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_consumption` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `inventory_item_id` BIGINT UNSIGNED NOT NULL,
  `quantity` DECIMAL(10,3) NOT NULL,
  `unit` VARCHAR(60),
  `reference_type` ENUM('order','manual','adjustment','recipe','other') DEFAULT 'manual',
  `reference_id` VARCHAR(120),
  `remarks` TEXT,
  `consumed_by` VARCHAR(120),
  `consumed_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_item` (`inventory_item_id`),
  KEY `idx_consumed` (`consumed_at`),
  FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inventory_adjustments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `inventory_item_id` BIGINT UNSIGNED NOT NULL,
  `adjustment_type` ENUM('add','remove','correction','damage','expiry') DEFAULT 'correction',
  `quantity` DECIMAL(10,3) NOT NULL,
  `reason` TEXT,
  `adjusted_by` BIGINT UNSIGNED,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_item` (`inventory_item_id`),
  KEY `idx_created` (`created_at`),
  FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `menu_item_ingredients` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `menu_item_id` INT UNSIGNED NOT NULL,
  `inventory_item_id` BIGINT UNSIGNED NOT NULL,
  `quantity` DECIMAL(10,3) NOT NULL,
  `unit` VARCHAR(60),
  `wastage_percent` DECIMAL(5,2) DEFAULT 0,
  `is_optional` TINYINT(1) DEFAULT 0,
  `notes` TEXT,
  `sort_order` INT DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_menu_item` (`menu_item_id`),
  KEY `idx_inventory` (`inventory_item_id`),
  FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. ACCOUNTING (Double-entry)
-- ============================================================

CREATE TABLE IF NOT EXISTS `chart_of_accounts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(20) NOT NULL UNIQUE,
  `name` VARCHAR(191) NOT NULL,
  `type` ENUM('asset','liability','equity','revenue','expense') NOT NULL,
  `parent_id` INT UNSIGNED,
  `is_active` TINYINT(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_code` (`code`),
  KEY `idx_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `transactions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `transaction_no` VARCHAR(80) NOT NULL UNIQUE,
  `transaction_date` DATE NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `reference_type` VARCHAR(50),
  `reference_id` BIGINT UNSIGNED,
  `created_by` BIGINT UNSIGNED,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_date` (`transaction_date`),
  KEY `idx_reference` (`reference_type`, `reference_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `transaction_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `transaction_id` BIGINT UNSIGNED NOT NULL,
  `account_id` INT UNSIGNED NOT NULL,
  `entry_type` ENUM('debit','credit') NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `description` VARCHAR(255),
  PRIMARY KEY (`id`),
  KEY `idx_transaction` (`transaction_id`),
  KEY `idx_account` (`account_id`),
  FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`account_id`) REFERENCES `chart_of_accounts`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. HR & ATTENDANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS `departments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL UNIQUE,
  `description` TEXT,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `designations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `department_id` INT UNSIGNED,
  `description` TEXT,
  PRIMARY KEY (`id`),
  KEY `idx_department` (`department_id`),
  FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `employees` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED UNIQUE,
  `employee_code` VARCHAR(50) UNIQUE,
  `first_name` VARCHAR(120) NOT NULL,
  `last_name` VARCHAR(120),
  `department_id` INT UNSIGNED,
  `designation_id` INT UNSIGNED,
  `date_of_joining` DATE,
  `date_of_leaving` DATE,
  `phone` VARCHAR(30),
  `emergency_contact` VARCHAR(30),
  `address` TEXT,
  `aadhaar_no` VARCHAR(20),
  `pan_no` VARCHAR(20),
  `bank_account` VARCHAR(50),
  `bank_ifsc` VARCHAR(20),
  `base_salary` DECIMAL(12,2) DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_employee_code` (`employee_code`),
  KEY `idx_department` (`department_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`designation_id`) REFERENCES `designations`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `attendance_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `employee_id` BIGINT UNSIGNED NOT NULL,
  `date` DATE NOT NULL,
  `check_in` TIME,
  `check_out` TIME,
  `status` ENUM('present','absent','late','half_day','on_leave','holiday','week_off') DEFAULT 'present',
  `leave_type` ENUM('casual','sick','earned','maternity','paternity','unpaid','other'),
  `notes` TEXT,
  `approved_by` BIGINT UNSIGNED,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_employee_date` (`employee_id`, `date`),
  KEY `idx_date` (`date`),
  KEY `idx_status` (`status`),
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `salary_payments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `employee_id` BIGINT UNSIGNED NOT NULL,
  `month` DATE NOT NULL,
  `basic_salary` DECIMAL(12,2) NOT NULL,
  `allowances` DECIMAL(12,2) DEFAULT 0,
  `deductions` DECIMAL(12,2) DEFAULT 0,
  `net_salary` DECIMAL(12,2) NOT NULL,
  `paid_amount` DECIMAL(12,2) DEFAULT 0,
  `payment_date` DATE,
  `payment_method` VARCHAR(50),
  `status` ENUM('draft','approved','paid','cancelled') DEFAULT 'draft',
  `approved_by` BIGINT UNSIGNED,
  `paid_by` BIGINT UNSIGNED,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_employee_month` (`employee_id`, `month`),
  KEY `idx_month` (`month`),
  KEY `idx_status` (`status`),
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. SYSTEM
-- ============================================================

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED,
  `user_name` VARCHAR(191),
  `user_role` VARCHAR(50),
  `action` VARCHAR(100) NOT NULL,
  `module` VARCHAR(50) NOT NULL,
  `endpoint` VARCHAR(255),
  `http_method` VARCHAR(10),
  `request_data` JSON,
  `response_status` INT,
  `old_value` JSON,
  `new_value` JSON,
  `ip_address` VARCHAR(64),
  `user_agent` VARCHAR(255),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_module` (`module`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED,
  `user_role` VARCHAR(50),
  `type` VARCHAR(100) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` TEXT,
  `data` JSON,
  `is_read` TINYINT(1) DEFAULT 0,
  `read_at` DATETIME,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_role` (`user_role`),
  KEY `idx_read` (`is_read`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `app_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(100) NOT NULL UNIQUE,
  `value` JSON,
  `description` TEXT,
  `updated_by` BIGINT UNSIGNED,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `print_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `print_type` VARCHAR(50) NOT NULL,
  `reference_id` BIGINT UNSIGNED,
  `reference_type` VARCHAR(50),
  `status` ENUM('pending','printing','completed','failed','cancelled') DEFAULT 'pending',
  `printer_name` VARCHAR(100),
  `error_message` TEXT,
  `printed_by` BIGINT UNSIGNED,
  `printed_at` DATETIME,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_reference` (`reference_type`, `reference_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Communication logs
CREATE TABLE IF NOT EXISTS `communication_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `channel` ENUM('sms','whatsapp','email','call') NOT NULL,
  `recipient_phone` VARCHAR(30),
  `recipient_email` VARCHAR(191),
  `subject` VARCHAR(255),
  `message_body` TEXT,
  `template_id` VARCHAR(100),
  `status` ENUM('pending','sent','delivered','read','failed','bounced') DEFAULT 'pending',
  `provider_response` JSON,
  `sent_by` BIGINT UNSIGNED,
  `sent_at` DATETIME,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_channel` (`channel`),
  KEY `idx_recipient` (`recipient_phone`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Accounts side ledgers (added 2026-10-18, HAG-46)
--
-- The DDL for these nine tables is defined in
-- src/models/AccountsExpansionModel.js, but nothing requires that model
-- and nothing calls its ensureSchema(): app.js:34 imports a symbol named
-- ensureAccountsExpansionSchema from ./models/TransactionsModel, which is a
-- different model that creates only transactions. So on a clean install
-- nothing else creates these tables, and schema-v4.sql has to.
--
-- They are also in migrations/20261018_accounts_schema_drift.sql, which
-- holds the per-table rationale. Every statement is IF NOT EXISTS
-- guarded, so re-running either file is a no-op.
--
-- "accounts" is deliberately NOT created. The v4 ledger is
-- transactions + transaction_entries + chart_of_accounts, and
-- transaction_entries.account_id FOREIGN KEYs to chart_of_accounts.id.
-- See the migration header for the mapping.
-- ============================================================

CREATE TABLE IF NOT EXISTS `purchase_orders` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `po_number` VARCHAR(100) NOT NULL,
  `vendor_name` VARCHAR(255) NOT NULL,
  `order_date` DATE NOT NULL,
  `expected_date` DATE DEFAULT NULL,
  `total_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `status` VARCHAR(50) NOT NULL DEFAULT 'Draft',
  `notes` TEXT NULL,
  `source_module` VARCHAR(80) NULL,
  `source_id` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_purchase_order_number` (`po_number`),
  KEY `idx_purchase_order_date` (`order_date`),
  KEY `idx_purchase_order_source` (`source_module`, `source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vendor_payment_records` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `vendor_name` VARCHAR(255) NOT NULL,
  `invoice_ref` VARCHAR(120) NULL,
  `payment_date` DATE NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `payment_mode` VARCHAR(50) NOT NULL DEFAULT 'Bank Transfer',
  `status` VARCHAR(50) NOT NULL DEFAULT 'Scheduled',
  `notes` TEXT NULL,
  `source_module` VARCHAR(80) NULL,
  `source_id` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_vendor_payment_date` (`payment_date`),
  KEY `idx_vendor_payment_source` (`source_module`, `source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `petty_cash_entries` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `entry_date` DATE NOT NULL,
  `entry_type` VARCHAR(20) NOT NULL,
  `category` VARCHAR(120) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `approved_by` VARCHAR(255) NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_petty_cash_date` (`entry_date`),
  KEY `idx_petty_cash_type` (`entry_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gst_return_records` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `filing_period` VARCHAR(20) NOT NULL,
  `return_type` VARCHAR(50) NOT NULL,
  `taxable_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `gst_collected` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `gst_paid` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `net_payable` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `status` VARCHAR(50) NOT NULL DEFAULT 'Draft',
  `filed_on` DATE NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_gst_period` (`filing_period`),
  KEY `idx_gst_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payroll_records` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `staff_name` VARCHAR(255) NOT NULL,
  `payroll_month` VARCHAR(20) NOT NULL,
  `attendance_days` INT NOT NULL DEFAULT 0,
  `base_salary` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `allowance` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `deduction` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `net_salary` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `status` VARCHAR(50) NOT NULL DEFAULT 'Draft',
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payroll_month` (`payroll_month`),
  KEY `idx_payroll_staff` (`staff_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `profit_center_entries` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `center_name` VARCHAR(100) NOT NULL,
  `entry_date` DATE NOT NULL,
  `income_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `expense_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_profit_center_name` (`center_name`),
  KEY `idx_profit_center_date` (`entry_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payment_gateway_settings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `payment_mode` VARCHAR(50) NOT NULL,
  `department` VARCHAR(50) NOT NULL DEFAULT 'Hotel',
  `provider_name` VARCHAR(100) NULL,
  `upi_id` VARCHAR(150) NULL,
  `account_holder_name` VARCHAR(150) NULL,
  `bank_name` VARCHAR(150) NULL,
  `qr_image_url` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payment_gateway_mode` (`payment_mode`),
  KEY `idx_payment_gateway_department` (`department`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `account_bank_ledgers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `entry_date` DATE NOT NULL,
  `bank_name` VARCHAR(255) NOT NULL,
  `bank_account` VARCHAR(255) NULL,
  `source_type` VARCHAR(50) NULL,
  `source_id` INT NULL,
  `payment_mode` VARCHAR(50) NULL,
  `amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `direction` VARCHAR(10) NOT NULL DEFAULT 'in',
  `reference_no` VARCHAR(120) NULL,
  `description` VARCHAR(255) NOT NULL,
  `debit` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `credit` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `reconciliation_status` VARCHAR(50) NOT NULL DEFAULT 'Pending',
  `match_status` VARCHAR(30) NOT NULL DEFAULT 'unmatched',
  `matched_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `statement_ref` VARCHAR(120) NULL,
  `statement_date` DATE NULL,
  `reconciled_at` DATETIME NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bank_ledger_date` (`entry_date`),
  KEY `idx_bank_ledger_bank` (`bank_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bank_reconciliation_matches` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `bank_ledger_id` INT NOT NULL,
  `source_type` VARCHAR(50) NOT NULL,
  `source_id` INT NOT NULL,
  `source_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `matched_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `match_status` VARCHAR(30) NOT NULL DEFAULT 'matched',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_reco_match_source` (`source_type`, `source_id`),
  KEY `idx_reco_match_bank` (`bank_ledger_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
