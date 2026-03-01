"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDeviceRateLimit = checkDeviceRateLimit;
const problem_details_1 = require("./problem-details");
/**
 * In-memory rate limit store
 * Uses Map with automatic cleanup on access
 */
class RateLimitStore {
    constructor() {
        this.store = new Map();
        this.lastCleanup = Date.now();
        this.cleanupInterval = 60000; // Clean up every 60 seconds
    }
    /**
     * Check and update rate limit for a key
     * Returns { allowed, remaining, resetTime }
     */
    check(key, maxRequests, windowMs) {
        const now = Date.now();
        // Periodic cleanup of expired entries
        if (now - this.lastCleanup > this.cleanupInterval) {
            this.cleanup(windowMs);
            this.lastCleanup = now;
        }
        const entry = this.store.get(key);
        const windowStart = entry?.windowStart || now;
        const windowEnd = windowStart + windowMs;
        // Check if we're in a new window
        if (now >= windowEnd) {
            this.store.set(key, { count: 1, windowStart: now });
            return {
                allowed: true,
                remaining: maxRequests - 1,
                resetTime: now + windowMs,
                current: 1
            };
        }
        // Same window - increment count
        const newCount = (entry?.count || 0) + 1;
        const allowed = newCount <= maxRequests;
        if (allowed) {
            this.store.set(key, { count: newCount, windowStart });
        }
        return {
            allowed,
            remaining: Math.max(0, maxRequests - newCount),
            resetTime: windowEnd,
            current: newCount
        };
    }
    /**
     * Clean up expired entries
     */
    cleanup(windowMs) {
        const now = Date.now();
        for (const [key, entry] of this.store.entries()) {
            if (now - entry.windowStart > windowMs) {
                this.store.delete(key);
            }
        }
    }
}
const rateLimitStore = new RateLimitStore();
/**
 * Check rate limit for a specific device_id (for use in route handlers)
 * Returns true if request should continue, false if blocked
 */
function checkDeviceRateLimit(req, res, deviceId, maxRequests = 10, windowMs = 1000) {
    const key = `device:${deviceId}`;
    const result = rateLimitStore.check(key, maxRequests, windowMs);
    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000).toString());
    if (!result.allowed) {
        const retryAfterMs = result.resetTime - Date.now();
        const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
        res.setHeader('Retry-After', retryAfterSeconds.toString());
        problem_details_1.problemErrors.tooManyRequests(req, res, retryAfterSeconds);
        return false;
    }
    return true;
}
