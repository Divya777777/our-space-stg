const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Severity levels for audit logs
 */
const Severity = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
};

/**
 * Log an audit event
 * @param {Object} params - Audit log parameters
 * @param {number|null} params.userId - User ID (null for anonymous)
 * @param {string} params.action - Action performed
 * @param {string|null} params.resourceType - Type of resource affected
 * @param {number|null} params.resourceId - ID of resource affected
 * @param {string|null} params.ipAddress - IP address
 * @param {string|null} params.userAgent - User agent
 * @param {Object|string|null} params.details - Additional details
 * @param {string} params.severity - Severity level
 */
async function logAuditEvent({
  userId = null,
  action,
  resourceType = null,
  resourceId = null,
  ipAddress = null,
  userAgent = null,
  details = null,
  severity = Severity.INFO
}) {
  try {
    // Convert details to JSON string if it's an object
    const detailsStr = details
      ? typeof details === 'string'
        ? details
        : JSON.stringify(details)
      : null;

    await prisma.audit_logs.create({
      data: {
        user_id: userId ? parseInt(userId) : null,
        action,
        resource_type: resourceType,
        resource_id: resourceId ? parseInt(resourceId) : null,
        ip_address: ipAddress,
        user_agent: userAgent,
        details: detailsStr,
        severity
      }
    });
  } catch (error) {
    // Don't throw errors for audit logging failures
    // Just log to console
    console.error('Failed to log audit event:', error);
  }
}

/**
 * Log authentication events
 */
async function logAuth(userId, action, success, ipAddress, userAgent, details = null) {
  await logAuditEvent({
    userId,
    action: `auth.${action}`,
    resourceType: 'user',
    resourceId: userId,
    ipAddress,
    userAgent,
    details: {
      success,
      ...details
    },
    severity: success ? Severity.INFO : Severity.WARNING
  });
}

/**
 * Log room events
 */
async function logRoomEvent(userId, roomId, action, details = null) {
  await logAuditEvent({
    userId,
    action: `room.${action}`,
    resourceType: 'room',
    resourceId: roomId,
    details,
    severity: Severity.INFO
  });
}

/**
 * Log message events
 */
async function logMessageEvent(userId, messageId, action, details = null) {
  await logAuditEvent({
    userId,
    action: `message.${action}`,
    resourceType: 'message',
    resourceId: messageId,
    details,
    severity: Severity.INFO
  });
}

/**
 * Log security events
 */
async function logSecurityEvent(userId, action, ipAddress, userAgent, details = null, severity = Severity.WARNING) {
  await logAuditEvent({
    userId,
    action: `security.${action}`,
    ipAddress,
    userAgent,
    details,
    severity
  });
}

/**
 * Log failed login attempt
 */
async function logFailedLogin(email, ipAddress, userAgent, reason) {
  await logAuditEvent({
    userId: null,
    action: 'auth.login_failed',
    resourceType: 'user',
    ipAddress,
    userAgent,
    details: {
      email,
      reason
    },
    severity: Severity.WARNING
  });
}

/**
 * Log account lockout
 */
async function logAccountLockout(userId, ipAddress, userAgent) {
  await logAuditEvent({
    userId,
    action: 'security.account_locked',
    resourceType: 'user',
    resourceId: userId,
    ipAddress,
    userAgent,
    severity: Severity.CRITICAL
  });
}

/**
 * Query audit logs
 * @param {Object} filters - Filter parameters
 * @returns {Promise<Array>} - Audit logs
 */
async function getAuditLogs(filters = {}) {
  const {
    userId,
    action,
    resourceType,
    severity,
    startDate,
    endDate,
    limit = 100,
    offset = 0
  } = filters;

  const where = {};

  if (userId) where.user_id = userId;
  if (action) where.action = { contains: action };
  if (resourceType) where.resource_type = resourceType;
  if (severity) where.severity = severity;
  if (startDate || endDate) {
    where.created_at = {};
    if (startDate) where.created_at.gte = new Date(startDate);
    if (endDate) where.created_at.lte = new Date(endDate);
  }

  const logs = await prisma.audit_logs.findMany({
    where,
    include: {
      user: {
        select: {
          user_id: true,
          email: true,
          display_name: true
        }
      }
    },
    orderBy: {
      created_at: 'desc'
    },
    take: limit,
    skip: offset
  });

  return logs;
}

module.exports = {
  logAuditEvent,
  logAuth,
  logRoomEvent,
  logMessageEvent,
  logSecurityEvent,
  logFailedLogin,
  logAccountLockout,
  getAuditLogs,
  Severity
};
