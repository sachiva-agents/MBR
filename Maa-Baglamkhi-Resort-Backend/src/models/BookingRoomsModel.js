const { pool, getConnection } = require('../utils/poolPromise')

class BookingRooms {
  constructor() {
    this.pool = pool
  }

  async ensureSchema() {
    const conn = await getConnection()
    try {
      await conn.beginTransaction()

      await conn.query(`CREATE TABLE IF NOT EXISTS \`booking_rooms\` (
            \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`booking_id\` BIGINT UNSIGNED NOT NULL,
  \`room_id\` INT UNSIGNED NOT NULL,
  \`category_id\` INT UNSIGNED NOT NULL,
  \`rate_plan_id\` INT UNSIGNED,
  \`rate_per_night\` DECIMAL(10,2) NOT NULL,
  \`nights\` INT NOT NULL DEFAULT 1,
  \`room_charge\` DECIMAL(12,2) NOT NULL DEFAULT 0,
  \`extra_charges\` DECIMAL(12,2) DEFAULT 0,
  \`discount\` DECIMAL(12,2) DEFAULT 0,
  \`gst_percent\` DECIMAL(5,2) NOT NULL DEFAULT 0,
  \`total\` DECIMAL(12,2) NOT NULL DEFAULT 0,
  \`guest_name\` VARCHAR(255),
  \`adults\` INT DEFAULT 1,
  \`children\` INT DEFAULT 0,
  \`notes\` TEXT,
  \`created_at\` TIMESTAMP,
  \`updated_at\` TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_booking\` (\`booking_id\`),
  KEY \`idx_room\` (\`room_id\`),
  KEY \`idx_category\` (\`category_id\`),
  FOREIGN KEY (\`booking_id\`) REFERENCES \`bookings\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (\`category_id\`) REFERENCES \`room_categories\`(\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)

      // Live installs predate the column; SHOW COLUMNS degrades to
      // "table absent -> skip" is not a risk here (we just created it).
      const [colRows] = await conn.query(
        `SHOW COLUMNS FROM \`booking_rooms\` LIKE 'gst_percent'`
      )
      if (!colRows.length) {
        await conn.query(
          `ALTER TABLE \`booking_rooms\` ADD COLUMN \`gst_percent\` DECIMAL(5,2) NOT NULL DEFAULT 0`
        )
      }

      await conn.commit()
    } catch (err) {
      await conn.rollback()
      console.error('Schema error for booking_rooms:', err.message)
    } finally {
      conn.release()
    }
  }

  async findByBookingId(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`booking_rooms\` WHERE \`booking_id\` = ?", args)
    return rows
  }

  async findById(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`booking_rooms\` WHERE \`id\` = ?", args)
    return rows
  }

  async findAll(...args) {
    const [rows] = await this.pool.execute("SELECT * FROM \`booking_rooms\` ORDER BY \`created_at\` DESC", args)
    return rows
  }
}

module.exports = new (BookingRooms)()
