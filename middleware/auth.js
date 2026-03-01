"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
/**
 * Bearer token authentication middleware
 * Validates Authorization: Bearer <token> header
 */
function authMiddleware(req, res, next) {
    const authHeader = req.header('Authorization');
    const validToken = process.env.API_AUTH_TOKEN;
    if (!authHeader) {
        if (!validToken) {
            next();
            return;
        }
        res.status(401).json({ error: 'Missing Authorization header' });
        return;
    }
    if (!authHeader.startsWith('Bearer ')) {
        res
            .status(401)
            .json({ error: 'Invalid Authorization format. Use: Bearer <token>' });
        return;
    }
    if (!validToken) {
        console.warn('API_AUTH_TOKEN not configured - auth disabled');
        next();
        return;
    }
    const token = authHeader.substring(7);
    if (token !== validToken) {
        res.status(403).json({ error: 'Invalid token' });
        return;
    }
    next();
}
