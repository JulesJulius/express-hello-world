"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const db_1 = require("./db");
const auth_1 = require("./middleware/auth");
const endpoint_audit_1 = require("./middleware/endpoint-audit");
const problem_details_1 = require("./middleware/problem-details");
const interactions_1 = require("./routes/interactions");
const sessions_1 = require("./routes/sessions");
const stats_1 = require("./routes/stats");
const MAX_LOG_PAYLOAD_CHARS = 4000;
function truncate(value, maxLength) {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
}
function safeJson(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return '[unserializable payload]';
    }
}
const app = (0, express_1.default)();
const port = Number.parseInt(process.env.PORT || '8787', 10);
// CORS for mobile app
app.use((0, cors_1.default)());
// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    const requestPath = req.originalUrl || req.url;
    res.on('finish', () => {
        const request = req;
        const durationMs = Date.now() - start;
        const payload = {
            params: req.params,
            query: req.query,
            body: req.body ?? request.rawBody ?? null
        };
        const payloadText = truncate(safeJson(payload), MAX_LOG_PAYLOAD_CHARS);
        console.log(`${new Date().toISOString()} ${req.method} ${requestPath} ${res.statusCode} ${durationMs}ms ${req.ip} payload=${payloadText}`);
    });
    next();
});
// JSON parser
app.use(express_1.default.json({
    verify: (req, _res, buf) => {
        ;
        req.rawBody = buf.toString('utf8');
    }
}));
// Persist one audit record for every REST request
app.use(endpoint_audit_1.endpointAuditMiddleware);
// Handle malformed JSON with the same contract used by route-level validation
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && 'body' in err) {
        res.status(400).json({
            type: 'https://api.focustimer.app/errors/invalid-json',
            title: 'Invalid JSON',
            status: 400,
            detail: 'Request body must be valid JSON'
        });
        return;
    }
    next(err);
});
// Bearer token auth (optional - if API_AUTH_TOKEN is set)
app.use('/api', auth_1.authMiddleware);
// Root - API info
app.get('/', (_req, res) => {
    res.json({
        name: 'Focus Timer API',
        version: '2.0.0',
        description: "Task tracking timer with estimation accuracy (Damion's methodology)",
        endpoints: {
            health: 'GET /health',
            sessions: 'GET|POST /api/sessions',
            sessions_sync: 'POST /api/sessions/sync',
            sessions_by_task: 'GET /api/sessions/by-task?device_id=X&task_label=Y',
            interactions: 'POST /api/interactions',
            interactions_summary: 'GET /api/interactions/summary?device_id=X',
            stats: 'GET /api/stats?device_id=X',
            stats_by_task: 'GET /api/stats/by-task?device_id=X',
            stats_daily: 'GET /api/stats/daily?device_id=X&days=7'
        }
    });
});
// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Mount routes
app.use('/api/sessions', sessions_1.sessionsRoutes);
app.use('/api/stats', stats_1.statsRoutes);
app.use('/api/interactions', interactions_1.interactionsRoutes);
// 404 handler (RFC 9457)
app.use(problem_details_1.problemNotFound);
// Error handler (RFC 9457)
app.use(problem_details_1.problemErrorHandler);
async function bootstrap() {
    await (0, db_1.initDatabase)();
    app.listen(port, () => {
        console.log(`Focus Timer API listening on port ${port}`);
    });
}
function installShutdownHooks() {
    const shutdown = async (signal) => {
        try {
            await (0, db_1.closeDatabase)();
        }
        catch (error) {
            console.error(`Error while closing database during ${signal}:`, error);
        }
        finally {
            process.exit(0);
        }
    };
    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
}
installShutdownHooks();
void bootstrap().catch((error) => {
    console.error('Failed to start Focus Timer API:', error);
    process.exit(1);
});
exports.default = app;
