"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionsRoutes = void 0;
const crypto_1 = require("crypto");
const express_1 = require("express");
const db_1 = require("../db");
const validation_1 = require("../validation");
exports.sessionsRoutes = (0, express_1.Router)();
// Create a new session (Damion's task tracking format)
exports.sessionsRoutes.post('/', async (req, res, next) => {
    try {
        const parseResult = validation_1.CreateSessionRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(400).json({
                type: 'https://api.focustimer.app/errors/validation-error',
                title: 'Validation Error',
                status: 400,
                detail: 'Request body failed validation',
                errors: (0, validation_1.formatZodErrors)(parseResult.error)
            });
            return;
        }
        const body = parseResult.data;
        const id = (0, crypto_1.randomUUID)();
        await (0, db_1.query)(`
      INSERT INTO sessions (
        id, device_id, task_label, estimated_minutes, actual_minutes,
        session_type, completed, timestamp_start, timestamp_end,
        device, continuation_count, continuation_of
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
            id,
            body.device_id,
            body.task_label,
            body.estimated_minutes ?? 0,
            body.actual_minutes ?? null,
            body.session_type ?? 'work',
            body.completed ?? false,
            body.timestamp_start,
            body.timestamp_end ?? null,
            body.device ?? 'unknown',
            body.continuation_count ?? 0,
            body.continuation_of ?? null
        ]);
        await updateStats(body.device_id, body);
        res.json({ success: true, id });
    }
    catch (error) {
        next(error);
    }
});
// Get sessions for a device
exports.sessionsRoutes.get('/', async (req, res, next) => {
    try {
        const deviceId = req.query.device_id;
        const parsedLimit = Number.parseInt(req.query.limit || '50', 10);
        const limit = Number.isNaN(parsedLimit) ? 50 : Math.max(1, parsedLimit);
        if (!deviceId) {
            res.status(400).json({ error: 'device_id is required' });
            return;
        }
        const result = await (0, db_1.query)(`
      SELECT
        id,
        device_id,
        task_label,
        estimated_minutes,
        actual_minutes,
        session_type,
        completed,
        timestamp_start,
        timestamp_end,
        device,
        continuation_of,
        continuation_count,
        created_at
      FROM sessions
      WHERE device_id = $1
      ORDER BY timestamp_start DESC
      LIMIT $2
    `, [deviceId, limit]);
        res.json({ sessions: result.rows });
    }
    catch (error) {
        next(error);
    }
});
// Get sessions by task label
exports.sessionsRoutes.get('/by-task', async (req, res, next) => {
    try {
        const deviceId = req.query.device_id;
        const taskLabel = req.query.task_label;
        if (!deviceId || !taskLabel) {
            res.status(400).json({ error: 'device_id and task_label are required' });
            return;
        }
        const result = await (0, db_1.query)(`
      SELECT
        id,
        device_id,
        task_label,
        estimated_minutes,
        actual_minutes,
        session_type,
        completed,
        timestamp_start,
        timestamp_end,
        device,
        continuation_of,
        continuation_count,
        created_at
      FROM sessions
      WHERE device_id = $1 AND task_label = $2
      ORDER BY timestamp_start DESC
    `, [deviceId, taskLabel]);
        res.json({ sessions: result.rows });
    }
    catch (error) {
        next(error);
    }
});
// Delete a session
exports.sessionsRoutes.delete('/:id', async (req, res, next) => {
    try {
        const id = req.params.id;
        const deviceId = req.query.device_id;
        if (!deviceId) {
            res.status(400).json({ error: 'device_id is required' });
            return;
        }
        await (0, db_1.query)('DELETE FROM sessions WHERE id = $1 AND device_id = $2', [
            id,
            deviceId
        ]);
        res.json({ success: true });
    }
    catch (error) {
        next(error);
    }
});
// Bulk sync sessions
exports.sessionsRoutes.post('/sync', async (req, res, next) => {
    try {
        const parseResult = validation_1.SyncSessionsRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
            res.status(400).json({
                type: 'https://api.focustimer.app/errors/validation-error',
                title: 'Validation Error',
                status: 400,
                detail: 'Request body failed validation',
                errors: (0, validation_1.formatZodErrors)(parseResult.error)
            });
            return;
        }
        const body = parseResult.data;
        const synced = [];
        for (const session of body.sessions) {
            const id = (0, crypto_1.randomUUID)();
            await (0, db_1.query)(`
        INSERT INTO sessions (
          id, device_id, task_label, estimated_minutes, actual_minutes,
          session_type, completed, timestamp_start, timestamp_end,
          device, continuation_count, continuation_of
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO NOTHING
      `, [
                id,
                session.device_id,
                session.task_label,
                session.estimated_minutes ?? 0,
                session.actual_minutes ?? null,
                session.session_type ?? 'work',
                session.completed ?? false,
                session.timestamp_start,
                session.timestamp_end ?? null,
                session.device ?? 'unknown',
                session.continuation_count ?? 0,
                session.continuation_of ?? null
            ]);
            synced.push(id);
            await updateStats(session.device_id, session);
        }
        res.json({ success: true, synced_count: synced.length });
    }
    catch (error) {
        next(error);
    }
});
async function updateStats(deviceId, session) {
    const today = new Date().toISOString().split('T')[0];
    const continuationCount = session.continuation_count ?? 0;
    const wasCompleted = session.completed && session.session_type !== 'interrupted';
    await (0, db_1.withClient)(async (client) => {
        await client.query('BEGIN');
        try {
            const existingResult = await client.query(`
        SELECT
          total_minutes,
          total_sessions,
          completed_first_timer,
          needed_continuation
        FROM stats
        WHERE device_id = $1
        FOR UPDATE
      `, [deviceId]);
            const existing = existingResult.rows[0];
            if (existing) {
                const newTotalMinutes = Number(existing.total_minutes) +
                    (session.actual_minutes ?? session.estimated_minutes ?? 0);
                const newTotalSessions = Number(existing.total_sessions) + 1;
                let newCompletedFirstTimer = Number(existing.completed_first_timer);
                let newNeededContinuation = Number(existing.needed_continuation);
                if (wasCompleted) {
                    if (continuationCount === 0) {
                        newCompletedFirstTimer += 1;
                    }
                    else {
                        newNeededContinuation += 1;
                    }
                }
                await client.query(`
          UPDATE stats SET
            total_minutes = $1,
            total_sessions = $2,
            completed_first_timer = $3,
            needed_continuation = $4,
            last_session_date = $5,
            updated_at = NOW()
          WHERE device_id = $6
        `, [
                    newTotalMinutes,
                    newTotalSessions,
                    newCompletedFirstTimer,
                    newNeededContinuation,
                    today,
                    deviceId
                ]);
            }
            else {
                const initialCompletedFirstTimer = wasCompleted && continuationCount === 0 ? 1 : 0;
                const initialNeededContinuation = wasCompleted && continuationCount > 0 ? 1 : 0;
                await client.query(`
          INSERT INTO stats (
            device_id, total_minutes, total_sessions, unique_tasks,
            completed_first_timer, needed_continuation, last_session_date
          )
          VALUES ($1, $2, 1, 1, $3, $4, $5)
        `, [
                    deviceId,
                    session.actual_minutes ?? session.estimated_minutes ?? 0,
                    initialCompletedFirstTimer,
                    initialNeededContinuation,
                    today
                ]);
            }
            const uniqueTasksResult = await client.query(`
        SELECT COUNT(DISTINCT task_label)::int AS count
        FROM sessions
        WHERE device_id = $1
      `, [deviceId]);
            const uniqueTaskCount = uniqueTasksResult.rows[0]?.count ?? 0;
            await client.query('UPDATE stats SET unique_tasks = $1, updated_at = NOW() WHERE device_id = $2', [uniqueTaskCount, deviceId]);
            await client.query('COMMIT');
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    });
}
