"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertEndpointAuditRecord = insertEndpointAuditRecord;
exports.getPool = getPool;
exports.query = query;
exports.withClient = withClient;
exports.initDatabase = initDatabase;
exports.closeDatabase = closeDatabase;
const crypto_1 = require("crypto");
const pg_1 = require("pg");
let pool = null;
let queryCounter = 0;
const MAX_AUDIT_PAYLOAD_CHARS = 16000;
function resolveConnectionString() {
    const connectionString = process.env.POSTGRESS_DATABASE_CONNECTION_URL ??
        process.env.POSTGRES_DATABASE_CONNECTION_URL;
    if (!connectionString) {
        throw new Error('POSTGRESS_DATABASE_CONNECTION_URL environment variable is required');
    }
    return connectionString;
}
function describeConnection(connectionString) {
    try {
        const url = new URL(connectionString);
        const database = url.pathname.replace(/^\/+/, '') || '(default)';
        const port = url.port ? `:${url.port}` : '';
        return `${url.protocol}//${url.hostname}${port}/${database}`;
    }
    catch {
        return '[unparsable connection string]';
    }
}
function parseBoolean(value) {
    if (!value) {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return undefined;
}
function shouldLogDatabaseInteractions() {
    return parseBoolean(process.env.DB_LOG_QUERIES) ?? true;
}
function nextQueryId() {
    queryCounter += 1;
    return queryCounter;
}
function normalizeSql(sql) {
    return sql.replace(/\s+/g, ' ').trim();
}
function stringifyParams(params) {
    try {
        return JSON.stringify(params);
    }
    catch {
        return '[unserializable parameters]';
    }
}
function extractQueryDetails(args) {
    const first = args[0];
    if (typeof first === 'string') {
        const second = args[1];
        return {
            sql: first,
            params: Array.isArray(second) ? second : []
        };
    }
    if (first &&
        typeof first === 'object' &&
        'text' in first &&
        typeof first.text === 'string') {
        const config = first;
        return {
            sql: config.text,
            params: Array.isArray(config.values) ? config.values : []
        };
    }
    return {
        sql: '[unknown query format]',
        params: []
    };
}
function serializeAuditPayload(payload) {
    if (payload === undefined) {
        return null;
    }
    try {
        const serialized = JSON.stringify(payload);
        if (!serialized) {
            return null;
        }
        if (serialized.length <= MAX_AUDIT_PAYLOAD_CHARS) {
            return serialized;
        }
        return `${serialized.slice(0, MAX_AUDIT_PAYLOAD_CHARS)}... [truncated ${serialized.length - MAX_AUDIT_PAYLOAD_CHARS} chars]`;
    }
    catch {
        return '[unserializable payload]';
    }
}
async function insertEndpointAuditRecord(input) {
    await query(`
    INSERT INTO endpoint_audit (
      id,
      method,
      path,
      interaction_key,
      target_table,
      operation,
      target_record_id,
      device_id,
      status_code,
      duration_ms,
      request_query,
      request_params,
      request_body,
      response_body
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14
    )
  `, [
        (0, crypto_1.randomUUID)(),
        input.method,
        input.path,
        input.interaction_key,
        input.target_table,
        input.operation,
        input.target_record_id ?? null,
        input.device_id ?? null,
        input.status_code,
        input.duration_ms,
        serializeAuditPayload(input.request_query),
        serializeAuditPayload(input.request_params),
        serializeAuditPayload(input.request_body),
        serializeAuditPayload(input.response_body)
    ]);
}
function resolveSslConfig(connectionString) {
    const explicitSsl = parseBoolean(process.env.POSTGRES_SSL);
    if (explicitSsl === true) {
        const rejectUnauthorized = parseBoolean(process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED);
        return { rejectUnauthorized: rejectUnauthorized ?? false };
    }
    if (explicitSsl === false) {
        return false;
    }
    try {
        const url = new URL(connectionString);
        const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
        if (sslMode === 'disable') {
            return false;
        }
        if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
            const rejectUnauthorized = parseBoolean(process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED);
            return { rejectUnauthorized: rejectUnauthorized ?? false };
        }
        const isLocalHost = url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1' ||
            url.hostname === '::1';
        if (isLocalHost) {
            return false;
        }
    }
    catch {
        // Fall back to secure default for non-URL connection string formats.
    }
    const rejectUnauthorized = parseBoolean(process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED);
    return { rejectUnauthorized: rejectUnauthorized ?? false };
}
function getPool() {
    if (!pool) {
        const connectionString = resolveConnectionString();
        const ssl = resolveSslConfig(connectionString);
        pool = new pg_1.Pool({
            connectionString,
            ssl
        });
        pool.on('error', (error) => {
            console.error('[db] pool error', error);
        });
        if (shouldLogDatabaseInteractions()) {
            console.log(`[db] pool initialized target=${describeConnection(connectionString)} ssl=${ssl ? 'enabled' : 'disabled'}`);
        }
    }
    return pool;
}
async function query(text, params = []) {
    const logEnabled = shouldLogDatabaseInteractions();
    const queryId = nextQueryId();
    const normalizedSql = normalizeSql(text);
    if (logEnabled) {
        console.log(`[db:${queryId}] query start sql="${normalizedSql}" params=${stringifyParams(params)}`);
    }
    const startedAt = Date.now();
    try {
        const result = await getPool().query(text, params);
        if (logEnabled) {
            console.log(`[db:${queryId}] query success rows=${result.rowCount ?? 0} duration_ms=${Date.now() - startedAt}`);
        }
        return result;
    }
    catch (error) {
        if (logEnabled) {
            console.error(`[db:${queryId}] query error duration_ms=${Date.now() - startedAt}`, error);
        }
        throw error;
    }
}
async function withClient(callback) {
    const logEnabled = shouldLogDatabaseInteractions();
    const client = await getPool().connect();
    const originalQuery = client.query.bind(client);
    if (logEnabled) {
        console.log('[db] client acquired');
        client.query = async (...args) => {
            const { sql, params } = extractQueryDetails(args);
            const queryId = nextQueryId();
            const normalizedSql = normalizeSql(sql);
            const startedAt = Date.now();
            console.log(`[db:${queryId}] tx query start sql="${normalizedSql}" params=${stringifyParams(params)}`);
            try {
                const result = await originalQuery(...args);
                console.log(`[db:${queryId}] tx query success rows=${result.rowCount ?? 0} duration_ms=${Date.now() - startedAt}`);
                return result;
            }
            catch (error) {
                console.error(`[db:${queryId}] tx query error duration_ms=${Date.now() - startedAt}`, error);
                throw error;
            }
        };
    }
    try {
        return await callback(client);
    }
    finally {
        if (logEnabled) {
            ;
            client.query = originalQuery;
            console.log('[db] client released');
        }
        client.release();
    }
}
async function initDatabase() {
    await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      task_label TEXT NOT NULL,
      estimated_minutes DOUBLE PRECISION NOT NULL DEFAULT 0,
      actual_minutes DOUBLE PRECISION,
      session_type TEXT NOT NULL DEFAULT 'work' CHECK (session_type IN ('work', 'interrupted')),
      completed BOOLEAN DEFAULT FALSE,
      timestamp_start TIMESTAMPTZ NOT NULL,
      timestamp_end TIMESTAMPTZ,
      device TEXT DEFAULT 'unknown',
      continuation_of TEXT,
      continuation_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
    await query('CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_label)');
    await query('CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(timestamp_start)');
    await query(`
    CREATE TABLE IF NOT EXISTS stats (
      device_id TEXT PRIMARY KEY,
      total_minutes DOUBLE PRECISION DEFAULT 0,
      total_sessions INTEGER DEFAULT 0,
      unique_tasks INTEGER DEFAULT 0,
      completed_first_timer INTEGER DEFAULT 0,
      needed_continuation INTEGER DEFAULT 0,
      last_session_date DATE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
    await query(`
    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      task_label TEXT DEFAULT '',
      interaction_type TEXT NOT NULL,
      duration_minutes DOUBLE PRECISION DEFAULT 0,
      remaining_minutes DOUBLE PRECISION DEFAULT 0,
      continuation_count INTEGER DEFAULT 0,
      timestamp TIMESTAMPTZ NOT NULL,
      device TEXT DEFAULT 'unknown',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
    await query('CREATE INDEX IF NOT EXISTS idx_interactions_device ON interactions(device_id)');
    await query('CREATE INDEX IF NOT EXISTS idx_interactions_type ON interactions(interaction_type)');
    await query('CREATE INDEX IF NOT EXISTS idx_interactions_timestamp ON interactions(timestamp)');
    await query(`
    CREATE TABLE IF NOT EXISTS endpoint_audit (
      id TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      interaction_key TEXT NOT NULL,
      target_table TEXT NOT NULL,
      operation TEXT NOT NULL,
      target_record_id TEXT,
      device_id TEXT,
      status_code INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      request_query TEXT,
      request_params TEXT,
      request_body TEXT,
      response_body TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
    await query('CREATE INDEX IF NOT EXISTS idx_endpoint_audit_created_at ON endpoint_audit(created_at DESC)');
    await query('CREATE INDEX IF NOT EXISTS idx_endpoint_audit_interaction_key ON endpoint_audit(interaction_key)');
    await query('CREATE INDEX IF NOT EXISTS idx_endpoint_audit_device_id ON endpoint_audit(device_id)');
}
async function closeDatabase() {
    if (!pool) {
        return;
    }
    await pool.end();
    pool = null;
}
