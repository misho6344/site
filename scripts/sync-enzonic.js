#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function connectionFromUrl(value, label) {
  if (!value) throw new Error(`Missing ${label} secret.`);
  const url = new URL(value);
  if (url.protocol !== 'mysql:') throw new Error(`${label} must use a mysql:// URL.`);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!url.hostname || !url.username || !database) throw new Error(`${label} is missing host, username, or database.`);
  return {
    host: url.hostname,
    port: url.port || '3306',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database
  };
}

function writeClientConfig(connection, file) {
  const escape = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '');
  const content = [
    '[client]',
    `host="${escape(connection.host)}"`,
    `port=${connection.port}`,
    `user="${escape(connection.user)}"`,
    `password="${escape(connection.password)}"`,
    'ssl-mode=REQUIRED',
    ''
  ].join('\n');
  fs.writeFileSync(file, content, { mode: 0o600 });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function waitForDatabase(config, label) {
  let lastError = 'No connection details were returned by the MySQL client.';
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = spawnSync('mysql', [
      `--defaults-extra-file=${config}`, '--batch', '--skip-column-names',
      '-e', 'SELECT 1'
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status === 0) return;

    lastError = (result.stderr || result.error?.message || `mysql exited with status ${result.status}`).trim();
    if (attempt === 12) {
      throw new Error(`${label} connection failed after 12 attempts. Last MySQL error: ${lastError}`);
    }
    console.log(`${label} connection failed; retry ${attempt}/12 in 10 seconds.`);
    spawnSync('sleep', ['10']);
  }
}

function main() {
  const source = connectionFromUrl(process.env.SOURCE_DATABASE_URL, 'SOURCE_DATABASE_URL');
  const target = connectionFromUrl(process.env.ENZONIC_DATABASE_URL, 'ENZONIC_DATABASE_URL');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'noadframe-db-sync-'));
  const sourceConfig = path.join(temp, 'source.cnf');
  const targetConfig = path.join(temp, 'target.cnf');
  const dumpFile = path.join(temp, 'noadframe.sql');

  try {
    writeClientConfig(source, sourceConfig);
    writeClientConfig(target, targetConfig);

    console.log('Checking primary TiDB connection...');
    waitForDatabase(sourceConfig, 'Primary database');
    console.log('Checking Enzonic secondary connection...');
    waitForDatabase(targetConfig, 'Enzonic secondary');

    console.log('Creating a consistent database snapshot...');
    const dump = spawnSync('mysqldump', [
      `--defaults-extra-file=${sourceConfig}`,
      '--single-transaction', '--quick', '--skip-lock-tables',
      '--routines', '--triggers', '--events', '--hex-blob',
      '--no-tablespaces', '--column-statistics=0', '--set-gtid-purged=OFF',
      source.database
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 128 });
    if (dump.error) throw new Error(`Primary database export could not start: ${dump.error.message}`);
    if (dump.status !== 0) {
      const details = (dump.stderr || '').trim() || `mysqldump exited with status ${dump.status}`;
      throw new Error(`Primary database export failed: ${details}`);
    }
    if (!dump.stdout || dump.stdout.trim().length < 100) throw new Error('Database export was empty or unexpectedly small.');
    fs.writeFileSync(dumpFile, dump.stdout, { mode: 0o600 });

    console.log('Refreshing Enzonic tables from the verified snapshot...');
    run('mysql', [
      `--defaults-extra-file=${targetConfig}`,
      '--database', target.database
    ], { input: fs.readFileSync(dumpFile), stdio: ['pipe', 'inherit', 'inherit'] });

    console.log('Checking the secondary database after synchronization...');
    run('mysql', [
      `--defaults-extra-file=${targetConfig}`, '--database', target.database,
      '--batch', '--skip-column-names', '-e',
      "SELECT CONCAT('TABLES_OK=', COUNT(*)) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
    ]);
    console.log('SYNC_OK: Enzonic secondary database refreshed successfully.');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`SYNC_FAILED: ${error.message}`);
  process.exitCode = 1;
});
