"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statsRoutes = void 0;
const express_1 = require("express");
const db_1 = require("../db");
exports.statsRoutes = (0, express_1.Router)();
// Get stats for a device (estimation accuracy tracking)
exports.statsRoutes.get('/', async (req, res, next) => {
    try {
        const deviceId = req.query.device_id;
        if (!deviceId) {
            res.status(400).json({ error: 'device_id is required' });
            return;
        }
        const result = await (0, db_1.query)('SELECT * FROM stats WHERE device_id = $1', [
            deviceId
        ]);
        const stats = result.rows[0];
        if (!stats) {
            const emptyResponse = {
                total_minutes: 0,
                total_sessions: 0,
                unique_tasks: 0,
                completed_first_timer: 0,
                needed_continuation: 0,
                accuracy_percent: 0
            };
            res.json(emptyResponse);
            return;
        }
        const total = stats.completed_first_timer + stats.needed_continuation;
        const accuracyPercent = total > 0 ? (stats.completed_first_timer / total) * 100 : 0;
        const response = {
            total_minutes: Math.floor(stats.total_minutes),
            total_sessions: stats.total_sessions,
            unique_tasks: stats.unique_tasks,
            completed_first_timer: stats.completed_first_timer,
            needed_continuation: stats.needed_continuation,
            accuracy_percent: Math.round(accuracyPercent * 10) / 10
        };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
// Get detailed estimation breakdown by task
exports.statsRoutes.get('/by-task', async (req, res, next) => {
    try {
        const deviceId = req.query.device_id;
        if (!deviceId) {
            res.status(400).json({ error: 'device_id is required' });
            return;
        }
        const taskStats = await (0, db_1.query)(`
      SELECT
        task_label,
        COUNT(*)::int AS session_count,
        COALESCE(SUM(estimated_minutes), 0)::double precision AS total_estimated,
        COALESCE(SUM(actual_minutes), 0)::double precision AS total_actual,
        SUM(CASE WHEN continuation_count = 0 AND completed = TRUE THEN 1 ELSE 0 END)::int AS first_timer_completions,
        SUM(CASE WHEN continuation_count > 0 THEN 1 ELSE 0 END)::int AS continuations,
        COALESCE(AVG(continuation_count), 0)::double precision AS avg_continuations
      FROM sessions
      WHERE device_id = $1
      GROUP BY task_label
      ORDER BY session_count DESC
      LIMIT 20
    `, [deviceId]);
        res.json({ tasks: taskStats.rows });
    }
    catch (error) {
        next(error);
    }
});
// Get daily summary
exports.statsRoutes.get('/daily', async (req, res, next) => {
    try {
        const deviceId = req.query.device_id;
        const parsedDays = Number.parseInt(req.query.days || '7', 10);
        const days = Number.isNaN(parsedDays) ? 7 : Math.max(1, parsedDays);
        if (!deviceId) {
            res.status(400).json({ error: 'device_id is required' });
            return;
        }
        const dailyStats = await (0, db_1.query)(`
      SELECT
        DATE(timestamp_start) AS date,
        COUNT(*)::int AS session_count,
        COALESCE(SUM(actual_minutes), 0)::double precision AS total_minutes,
        COUNT(DISTINCT task_label)::int AS unique_tasks
      FROM sessions
      WHERE device_id = $1
        AND timestamp_start >= NOW() - ($2::text || ' days')::interval
      GROUP BY DATE(timestamp_start)
      ORDER BY date DESC
    `, [deviceId, days]);
        res.json({ daily: dailyStats.rows });
    }
    catch (error) {
        next(error);
    }
});
