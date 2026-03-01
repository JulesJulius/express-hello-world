"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.problemErrors = void 0;
exports.problemResponse = problemResponse;
exports.problemErrorHandler = problemErrorHandler;
exports.problemNotFound = problemNotFound;
/**
 * Create a Problem Details response
 */
function problemResponse(req, res, status, title, detail, extensions) {
    const problem = {
        type: `https://focus-timer-api.auramediastudios.workers.dev/problems/${status}`,
        title,
        status,
        instance: req.originalUrl || req.url,
        ...(detail && { detail }),
        ...(extensions || {})
    };
    res.status(status).type('application/problem+json').json(problem);
}
/**
 * Common error responses
 */
exports.problemErrors = {
    badRequest: (req, res, detail, extensions) => problemResponse(req, res, 400, 'Bad Request', detail || 'The request was malformed or missing required fields', extensions),
    unauthorized: (req, res, detail) => problemResponse(req, res, 401, 'Unauthorized', detail || 'Authentication required'),
    forbidden: (req, res, detail) => problemResponse(req, res, 403, 'Forbidden', detail || 'You do not have permission to access this resource'),
    notFound: (req, res, detail) => problemResponse(req, res, 404, 'Not Found', detail || 'The requested resource was not found'),
    methodNotAllowed: (req, res, allowed) => problemResponse(req, res, 405, 'Method Not Allowed', `Allowed methods: ${allowed.join(', ')}`, { allowed }),
    conflict: (req, res, detail) => problemResponse(req, res, 409, 'Conflict', detail || 'The request conflicts with the current state'),
    unprocessableEntity: (req, res, detail, errors) => problemResponse(req, res, 422, 'Unprocessable Entity', detail || 'Validation failed', errors ? { errors } : undefined),
    tooManyRequests: (req, res, retryAfter) => problemResponse(req, res, 429, 'Too Many Requests', 'Rate limit exceeded', retryAfter ? { retryAfter } : undefined),
    internalError: (req, res, detail) => problemResponse(req, res, 500, 'Internal Server Error', detail || 'An unexpected error occurred'),
    serviceUnavailable: (req, res, detail) => problemResponse(req, res, 503, 'Service Unavailable', detail || 'The service is temporarily unavailable')
};
/**
 * Error handler middleware using RFC 9457
 */
function problemErrorHandler(err, req, res, next) {
    if (res.headersSent) {
        next(err);
        return;
    }
    console.error('Error:', err);
    // Check for known error types
    if (err.message.includes('not found')) {
        exports.problemErrors.notFound(req, res, err.message);
        return;
    }
    if (err.message.includes('unauthorized') || err.message.includes('authentication')) {
        exports.problemErrors.unauthorized(req, res, err.message);
        return;
    }
    if (err.message.includes('validation') || err.message.includes('invalid')) {
        exports.problemErrors.unprocessableEntity(req, res, err.message);
        return;
    }
    // Default to internal error
    exports.problemErrors.internalError(req, res, process.env.NODE_ENV === 'development' ? err.message : undefined);
}
/**
 * 404 handler using RFC 9457
 */
function problemNotFound(req, res) {
    exports.problemErrors.notFound(req, res, `The endpoint ${req.path} does not exist`);
}
