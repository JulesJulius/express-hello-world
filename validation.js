"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncSessionsRequestSchema = exports.CreateSessionRequestSchema = exports.InteractionRequestSchema = exports.SessionTypeEnum = exports.InteractionTypeEnum = void 0;
exports.formatZodErrors = formatZodErrors;
const zod_1 = require("zod");
// Interaction types enum - must match Android app's InteractionType enum (lowercased)
exports.InteractionTypeEnum = zod_1.z.enum([
    // App sends these (from InteractionType enum)
    'task_selected',
    'duration_set',
    'timer_started',
    'timer_paused',
    'timer_resumed',
    'timer_interrupted',
    'still_working_yes',
    'still_working_no',
    // Legacy/alternative names
    'timer_start',
    'timer_pause',
    'timer_resume',
    'timer_complete',
    'timer_cancel',
    'task_select',
    'task_create',
    'settings_change',
    'app_open',
    'app_close'
]);
// Session types enum
exports.SessionTypeEnum = zod_1.z.enum(['work', 'interrupted']);
// ISO 8601 datetime regex (supports up to nanosecond precision fractions)
const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/;
// ==================== INTERACTION SCHEMAS ====================
exports.InteractionRequestSchema = zod_1.z.object({
    device_id: zod_1.z
        .string()
        .min(1, 'device_id is required')
        .max(100, 'device_id must be 100 characters or less'),
    task_label: zod_1.z
        .string()
        .max(255, 'task_label must be 255 characters or less')
        .optional()
        .default(''),
    interaction_type: exports.InteractionTypeEnum,
    duration_minutes: zod_1.z
        .number()
        .min(0, 'duration_minutes must be non-negative')
        .max(1440, 'duration_minutes must be 1440 (24 hours) or less')
        .optional()
        .default(0),
    remaining_minutes: zod_1.z
        .number()
        .min(0, 'remaining_minutes must be non-negative')
        .max(1440, 'remaining_minutes must be 1440 (24 hours) or less')
        .optional()
        .default(0),
    continuation_count: zod_1.z
        .number()
        .int()
        .min(0, 'continuation_count must be non-negative')
        .max(100, 'continuation_count must be 100 or less')
        .optional()
        .default(0),
    timestamp: zod_1.z
        .string()
        .regex(iso8601Regex, 'timestamp must be a valid ISO 8601 datetime')
        .optional(),
    device: zod_1.z
        .string()
        .max(100, 'device must be 100 characters or less')
        .optional()
        .default('unknown')
});
// ==================== SESSION SCHEMAS ====================
exports.CreateSessionRequestSchema = zod_1.z.object({
    device_id: zod_1.z
        .string()
        .min(1, 'device_id is required')
        .max(100, 'device_id must be 100 characters or less'),
    task_label: zod_1.z
        .string()
        .min(1, 'task_label is required')
        .max(255, 'task_label must be 255 characters or less'),
    estimated_minutes: zod_1.z
        .number()
        .min(0, 'estimated_minutes must be non-negative')
        .max(1440, 'estimated_minutes must be 1440 (24 hours) or less')
        .optional()
        .default(0),
    actual_minutes: zod_1.z
        .number()
        .min(0, 'actual_minutes must be non-negative')
        .max(1440, 'actual_minutes must be 1440 (24 hours) or less')
        .nullable()
        .optional(),
    continuation_of: zod_1.z
        .string()
        .max(100, 'continuation_of must be 100 characters or less')
        .nullable()
        .optional(),
    session_type: exports.SessionTypeEnum.optional().default('work'),
    completed: zod_1.z.boolean().optional().default(false),
    timestamp_start: zod_1.z
        .string()
        .min(1, 'timestamp_start is required')
        .regex(iso8601Regex, 'timestamp_start must be a valid ISO 8601 datetime'),
    timestamp_end: zod_1.z
        .string()
        .regex(iso8601Regex, 'timestamp_end must be a valid ISO 8601 datetime')
        .nullable()
        .optional(),
    device: zod_1.z
        .string()
        .max(100, 'device must be 100 characters or less')
        .optional()
        .default('unknown'),
    continuation_count: zod_1.z
        .number()
        .int()
        .min(0, 'continuation_count must be non-negative')
        .max(100, 'continuation_count must be 100 or less')
        .optional()
        .default(0)
});
// Bulk sync schema
exports.SyncSessionsRequestSchema = zod_1.z.object({
    sessions: zod_1.z
        .array(exports.CreateSessionRequestSchema)
        .min(1, 'sessions array must contain at least one session')
        .max(100, 'sessions array must contain 100 or fewer sessions')
});
function formatZodErrors(error) {
    return error.errors.map((err) => ({
        field: err.path.join('.') || 'body',
        message: err.message
    }));
}
