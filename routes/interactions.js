"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.interactionsRoutes = void 0;
const crypto_1 = require("crypto");
const express_1 = require("express");
const db_1 = require("../db");
const rate_limit_1 = require("../middleware/rate-limit");
const validation_1 = require("../validation");
exports.interactionsRoutes = (0, express_1.Router)();
// POST on every user input (Damion's requirement)
// Fire-and-forget, no retry needed
// Rate limited: 10 requests per second per device_id
exports.interactionsRoutes.post('/', async (req, res, next) => {
    try {
        const parseResult = validation_1.InteractionRequestSchema.safeParse(req.body);
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
        // Check rate limit: 10 requests per second per device_id
        const allowed = (0, rate_limit_1.checkDeviceRateLimit)(req, res, body.device_id, 10, 1000);
        if (!allowed) {
            return;
        }
        const id = (0, crypto_1.randomUUID)();
        await (0, db_1.query)(`
      INSERT INTO interactions (
        id, device_id, task_label, interaction_type,
        duration_minutes, remaining_minutes, continuation_count,
        timestamp, device
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
            id,
            body.device_id,
            body.task_label ?? '',
            body.interaction_type,
            body.duration_minutes ?? 0,
            body.remaining_minutes ?? 0,
            body.continuation_count ?? 0,
            body.timestamp ?? new Date().toISOString(),
            body.device ?? 'unknown'
        ]);
        res.json({ success: true, id });
    }
    catch (error) {
        next(error);
    }
});
// Get interactions for a device (for debugging/analytics)
exports.interactionsRoutes.get('/', async (req, res, next) => {
    try {
        const deviceId = req.query.device_id;
        const parsedLimit = Number.parseInt(req.query.limit || '100', 10);
        const limit = Number.isNaN(parsedLimit) ? 100 : Math.max(1, parsedLimit);
        if (!deviceId) {
            res.status(400).json({ error: 'device_id is required' });
            return;
        }
        const result = await (0, db_1.query)(`
      SELECT
        id,
        device_id,
        task_label,
        interaction_type,
        duration_minutes,
        remaining_minutes,
        continuation_count,
        timestamp,
        device,
        created_at
      FROM interactions
      WHERE device_id = $1
      ORDER BY timestamp DESC
      LIMIT $2
    `, [deviceId, limit]);
        res.json({ interactions: result.rows });
    }
    catch (error) {
        next(error);
    }
});
// Get interaction summary for analytics
exports.interactionsRoutes.get('/summary', async (req, res, next) => {
    try {
        const deviceId = req.query.device_id;
        if (!deviceId) {
            res.status(400).json({ error: 'device_id is required' });
            return;
        }
        const summary = await (0, db_1.query)(`
      SELECT
        interaction_type,
        COUNT(*)::int AS count
      FROM interactions
      WHERE device_id = $1
      GROUP BY interaction_type
    `, [deviceId]);
        const yesCountResult = await (0, db_1.query)(`
      SELECT COUNT(*)::int AS count
      FROM interactions
      WHERE device_id = $1 AND interaction_type = 'still_working_yes'
    `, [deviceId]);
        const noCountResult = await (0, db_1.query)(`
      SELECT COUNT(*)::int AS count
      FROM interactions
      WHERE device_id = $1 AND interaction_type = 'still_working_no'
    `, [deviceId]);
        const yesCount = yesCountResult.rows[0]?.count ?? 0;
        const noCount = noCountResult.rows[0]?.count ?? 0;
        const totalResponses = yesCount + noCount;
        const accuracyPercent = totalResponses > 0 ? (noCount / totalResponses) * 100 : 0;
        res.json({
            by_type: summary.rows,
            estimation: {
                yes_count: yesCount,
                no_count: noCount,
                accuracy_percent: Math.round(accuracyPercent * 10) / 10
            }
        });
    }
    catch (error) {
        next(error);
    }
});
