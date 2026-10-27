#!/usr/bin/env node
/**
 * One-shot cleanup of synthetic test people.
 *
 * Deletes:
 *  - `employees` rows with user_id NULL (all test probes: HAG34 x11,
 *    HAG46 Staff, Contract-Check-Worker, Test). Their attendance_records
 *    and salary_payments rows cascade.
 *  - `users` rows that have no employee profile AND do not end in
 *    @resort.com (keeps Chef Kumar / kitchen@ and Admin / admin@resort.com).
 *
 * Default is --dry-run (prints the exact rows, changes nothing).
 * Pass --execute to actually delete.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const EXECUTE = process.argv.includes('--execute');

async function main() {
  const db = await mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 1,
  });

  // --- employees: unlinked test profiles -------------------------------------
  const [unlinkedEmps] = await db.query(
    'SELECT id, employee_code, first_name, last_name FROM employees WHERE user_id IS NULL ORDER BY id'
  );
  console.log(`\n[${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}] unlinked employees to delete: ${unlinkedEmps.length}`);
  for (const e of unlinkedEmps) console.log(`  emp ${e.id} ${e.employee_code} ${e.first_name} ${e.last_name}`);

  if (unlinkedEmps.length) {
    const [att] = await db.query(
      `SELECT employee_id, COUNT(*) n FROM attendance_records WHERE employee_id IN (${unlinkedEmps.map(() => '?').join(',')}) GROUP BY employee_id`,
      unlinkedEmps.map((e) => e.id)
    );
    const [sal] = await db.query(
      `SELECT employee_id, COUNT(*) n FROM salary_payments WHERE employee_id IN (${unlinkedEmps.map(() => '?').join(',')}) GROUP BY employee_id`,
      unlinkedEmps.map((e) => e.id)
    );
    console.log('  cascading attendance_records rows:', att.length ? JSON.stringify(att) : 'none');
    console.log('  cascading salary_payments rows:', sal.length ? JSON.stringify(sal) : 'none');
  }

  // --- users: unlinked AND not @resort.com ----------------------------------
  const [unlinkedUsers] = await db.query(
    `SELECT u.id, u.name, u.email FROM users u
     LEFT JOIN employees e ON e.user_id = u.id
     WHERE e.id IS NULL AND LOWER(COALESCE(u.email,'')) NOT LIKE '%@resort.com'
     ORDER BY u.id`
  );
  console.log(`\n[${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}] unlinked test users to delete: ${unlinkedUsers.length}`);
  for (const u of unlinkedUsers) console.log(`  user ${u.id} ${u.name} ${u.email}`);

  if (!EXECUTE) {
    console.log('\nDry run complete. Re-run with --execute to apply.');
    await db.end();
    return;
  }

  if (unlinkedEmps.length) {
    await db.query(
      `DELETE FROM employees WHERE id IN (${unlinkedEmps.map(() => '?').join(',')})`,
      unlinkedEmps.map((e) => e.id)
    );
    console.log(`deleted ${unlinkedEmps.length} unlinked employees (attendance/salary rows cascaded)`);
  }
  if (unlinkedUsers.length) {
    await db.query(
      `DELETE FROM users WHERE id IN (${unlinkedUsers.map(() => '?').join(',')})`,
      unlinkedUsers.map((u) => u.id)
    );
    console.log(`deleted ${unlinkedUsers.length} unlinked test users (employees.user_id / orders.waiter_id etc. set NULL)`);
  }

  const [[{ n: empCount }]] = await db.query('SELECT COUNT(*) n FROM employees');
  const [[{ n: userCount }]] = await db.query('SELECT COUNT(*) n FROM users');
  console.log(`\nAfter: employees=${empCount}, users=${userCount}`);
  await db.end();
}

main().catch((e) => { console.error('CLEANUP FAILED:', e.message); process.exit(1); });
