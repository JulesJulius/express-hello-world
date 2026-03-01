"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.endpointAuditMiddleware = endpointAuditMiddleware;
const db_1 = require("../db");
function normalizePath(path) {
    if (path.length > 1 && path.endsWith('/')) {
        return path.slice(0, -1);
    }
    return path;
}
function mapEndpoint(method, path) {
    const normalizedPath = normalizePath(path);
    const upperMethod = method.toUpperCase();
    if (normalizedPath === '/' && upperMethod === 'GET') {
        return {
            interactionKey: 'system.root',
            targetTable: 'system',
            operation: 'read'
        };
    }
    if (normalizedPath === '/health' && upperMethod === 'GET') {
        return {
            interactionKey: 'system.health',
            targetTable: 'system',
            operation: 'read'
        };
    }
    if (normalizedPath === '/api/sessions' && upperMethod === 'POST') {
        return {
            interactionKey: 'sessions.create',
            targetTable: 'sessions',
            operation: 'create'
        };
    }
    if (normalizedPath === '/api/sessions' && upperMethod === 'GET') {
        return {
            interactionKey: 'sessions.list',
            targetTable: 'sessions',
            operation: 'read'
        };
    }
    if (normalizedPath === '/api/sessions/by-task' && upperMethod === 'GET') {
        return {
            interactionKey: 'sessions.by_task',
            targetTable: 'sessions',
            operation: 'read'
        };
    }
    if (/^\/api\/sessions\/[^/]+$/.test(normalizedPath) && upperMethod === 'DELETE') {
        return {
            interactionKey: 'sessions.delete',
            targetTable: 'sessions',
            operation: 'delete'
        };
    }
    if (normalizedPath === '/api/sessions/sync' && upperMethod === 'POST') {
        return {
            interactionKey: 'sessions.sync',
            targetTable: 'sessions',
            operation: 'bulk_write'
        };
    }
    if (normalizedPath === '/api/interactions' && upperMethod === 'POST') {
        return {
            interactionKey: 'interactions.create',
            targetTable: 'interactions',
            operation: 'create'
        };
    }
    if (normalizedPath === '/api/interactions' && upperMethod === 'GET') {
        return {
            interactionKey: 'interactions.list',
            targetTable: 'interactions',
            operation: 'read'
        };
    }
    if (normalizedPath === '/api/interactions/summary' && upperMethod === 'GET') {
        return {
            interactionKey: 'interactions.summary',
            targetTable: 'interactions',
            operation: 'read'
        };
    }
    if (normalizedPath === '/api/stats' && upperMethod === 'GET') {
        return {
            interactionKey: 'stats.summary',
            targetTable: 'stats',
            operation: 'read'
        };
    }
    if (normalizedPath === '/api/stats/by-task' && upperMethod === 'GET') {
        return {
            interactionKey: 'stats.by_task',
            targetTable: 'stats',
            operation: 'read'
        };
    }
    if (normalizedPath === '/api/stats/daily' && upperMethod === 'GET') {
        return {
            interactionKey: 'stats.daily',
            targetTable: 'stats',
            operation: 'read'
        };
    }
    return {
        interactionKey: 'unmapped.endpoint',
        targetTable: 'unmapped',
        operation: 'unknown'
    };
}
function extractDeviceId(req) {
    const queryDeviceId = req.query.device_id;
    if (typeof queryDeviceId === 'string' && queryDeviceId.length > 0) {
        return queryDeviceId;
    }
    const body = req.body;
    if (body && typeof body === 'object') {
        const bodyRecord = body;
        const bodyDeviceId = bodyRecord.device_id;
        if (typeof bodyDeviceId === 'string' && bodyDeviceId.length > 0) {
            return bodyDeviceId;
        }
        const sessions = bodyRecord.sessions;
        if (Array.isArray(sessions)) {
            const firstSession = sessions.find((session) => session &&
                typeof session === 'object' &&
                typeof session.device_id === 'string');
            if (firstSession && typeof firstSession.device_id === 'string') {
                return firstSession.device_id;
            }
        }
    }
    return null;
}
function extractTargetRecordId(req, responseBody) {
    if (responseBody && typeof responseBody === 'object') {
        const responseRecord = responseBody;
        if (typeof responseRecord.id === 'string' && responseRecord.id.length > 0) {
            return responseRecord.id;
        }
    }
    if (typeof req.params.id === 'string' && req.params.id.length > 0) {
        return req.params.id;
    }
    return null;
}
function endpointAuditMiddleware(req, res, next) {
    const startedAt = Date.now();
    const requestPath = req.originalUrl || req.url;
    const requestPathname = requestPath.split('?')[0] || '/';
    let responseBody;
    const originalJson = res.json.bind(res);
    res.json = ((body) => {
        responseBody = body;
        return originalJson(body);
    });
    const originalSend = res.send.bind(res);
    res.send = ((body) => {
        if (responseBody === undefined) {
            responseBody = body;
        }
        return originalSend(body);
    });
    res.on('finish', () => {
        const durationMs = Date.now() - startedAt;
        const mapping = mapEndpoint(req.method, requestPathname);
        const deviceId = extractDeviceId(req);
        const targetRecordId = extractTargetRecordId(req, responseBody);
        void (0, db_1.insertEndpointAuditRecord)({
            method: req.method,
            path: requestPathname,
            interaction_key: mapping.interactionKey,
            target_table: mapping.targetTable,
            operation: mapping.operation,
            target_record_id: targetRecordId,
            device_id: deviceId,
            status_code: res.statusCode,
            duration_ms: durationMs,
            request_query: req.query,
            request_params: req.params,
            request_body: req.body,
            response_body: responseBody
        }).catch((error) => {
            console.error('[endpoint-audit] failed to persist request audit record', error);
        });
    });
    next();
}
