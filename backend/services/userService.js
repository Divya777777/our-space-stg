const { PrismaClient } = require('@prisma/client');
const { OAuth2Client } = require('google-auth-library');
const { generateAccessToken, generateRefreshToken } = require('../middleware/auth');

const prisma = new PrismaClient();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * Authenticate user with Google OAuth
 */
async function authenticateWithGoogle(credential, ipAddress, userAgent) {
  try {
    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Find or create user
    let user = await prisma.users.findUnique({
      where: { google_id: googleId }
    });

    if (!user) {
      // Create new user
      user = await prisma.users.create({
        data: {
          google_id: googleId,
          email,
          display_name: name,
          avatar_url: picture
        }
      });

      // Create default preferences
      await prisma.user_preferences.create({
        data: {
          user_id: user.user_id,
          theme: 'light',
          notifications_enabled: true,
          auto_join_rooms: false,
          default_video_quality: 'auto'
        }
      });
    } else {
      // Update last login
      await prisma.users.update({
        where: { user_id: user.user_id },
        data: {
          last_login_at: new Date(),
          last_login_ip: ipAddress,
          failed_login_attempts: 0
        }
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken({
      userId: user.user_id,
      email: user.email
    });

    const refreshToken = generateRefreshToken({
      userId: user.user_id,
      email: user.email
    });

    // Create session
    const accessExpiresAt = new Date();
    accessExpiresAt.setHours(accessExpiresAt.getHours() + 24);

    const refreshExpiresAt = new Date();
    refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 7);

    const session = await prisma.user_sessions.create({
      data: {
        user_id: user.user_id,
        access_token: accessToken,
        refresh_token: refreshToken,
        access_expires_at: accessExpiresAt,
        refresh_expires_at: refreshExpiresAt,
        ip_address: ipAddress,
        user_agent: userAgent,
        is_active: true
      }
    });

    return {
      user: {
        userId: user.user_id.toString(),
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url
      },
      accessToken,
      refreshToken,
      expiresAt: accessExpiresAt
    };
  } catch (error) {
    console.error('Google auth error:', error);
    throw new Error('Authentication failed');
  }
}

/**
 * Logout user (invalidate session)
 */
async function logout(sessionId) {
  try {
    await prisma.user_sessions.update({
      where: { session_id: sessionId },
      data: { is_active: false }
    });

    return { success: true };
  } catch (error) {
    console.error('Logout error:', error);
    throw new Error('Failed to logout');
  }
}

/**
 * Get user profile
 */
async function getUserProfile(userId) {
  try {
    const user = await prisma.users.findUnique({
      where: { user_id: userId },
      include: {
        preferences: true
      }
    });

    if (!user) {
      return null;
    }

    // Get user statistics
    const roomsHosted = await prisma.rooms.count({
      where: { host_user_id: user.user_id }
    });

    const roomsJoined = await prisma.room_members.count({
      where: { user_id: user.user_id }
    });

    const messagesSent = await prisma.messages.count({
      where: {
        sender_user_id: user.user_id,
        deleted_at: null
      }
    });

    return {
      userId: user.user_id.toString(),
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      preferences: user.preferences ? {
        theme: user.preferences.theme,
        notificationsEnabled: user.preferences.notifications_enabled,
        autoJoinRooms: user.preferences.auto_join_rooms,
        defaultVideoQuality: user.preferences.default_video_quality
      } : null,
      statistics: {
        roomsHosted,
        roomsJoined,
        messagesSent
      }
    };
  } catch (error) {
    console.error('Get user profile error:', error);
    throw new Error('Failed to fetch user profile');
  }
}

/**
 * Update user preferences
 */
async function updatePreferences(userId, preferencesData) {
  try {
    const {
      theme,
      notificationsEnabled,
      autoJoinRooms,
      defaultVideoQuality
    } = preferencesData;

    const updateData = {};

    if (theme !== undefined) updateData.theme = theme;
    if (notificationsEnabled !== undefined) updateData.notifications_enabled = notificationsEnabled;
    if (autoJoinRooms !== undefined) updateData.auto_join_rooms = autoJoinRooms;
    if (defaultVideoQuality !== undefined) updateData.default_video_quality = defaultVideoQuality;

    const preferences = await prisma.user_preferences.upsert({
      where: { user_id: userId },
      update: updateData,
      create: {
        user_id: userId,
        ...updateData
      }
    });

    return {
      success: true,
      preferences: {
        theme: preferences.theme,
        notificationsEnabled: preferences.notifications_enabled,
        autoJoinRooms: preferences.auto_join_rooms,
        defaultVideoQuality: preferences.default_video_quality
      }
    };
  } catch (error) {
    console.error('Update preferences error:', error);
    throw new Error('Failed to update preferences');
  }
}

/**
 * Update user profile (display name, avatar)
 */
async function updateProfile(userId, profileData) {
  try {
    const { displayName, avatarUrl } = profileData;

    const updateData = {};

    if (displayName !== undefined) updateData.display_name = displayName;
    if (avatarUrl !== undefined) updateData.avatar_url = avatarUrl;

    const user = await prisma.users.update({
      where: { user_id: userId },
      data: updateData
    });

    return {
      success: true,
      user: {
        userId: user.user_id.toString(),
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url
      }
    };
  } catch (error) {
    console.error('Update profile error:', error);
    throw new Error('Failed to update profile');
  }
}

/**
 * Get user's active sessions
 */
async function getUserSessions(userId) {
  try {
    const sessions = await prisma.user_sessions.findMany({
      where: {
        user_id: userId,
        is_active: true,
        access_expires_at: {
          gt: new Date()
        }
      },
      select: {
        session_id: true,
        ip_address: true,
        user_agent: true,
        created_at: true,
        last_accessed_at: true
      },
      orderBy: {
        last_accessed_at: 'desc'
      }
    });

    return sessions.map(s => ({
      sessionId: s.session_id.toString(),
      ipAddress: s.ip_address,
      userAgent: s.user_agent,
      createdAt: s.created_at,
      lastAccessedAt: s.last_accessed_at
    }));
  } catch (error) {
    console.error('Get user sessions error:', error);
    throw new Error('Failed to fetch sessions');
  }
}

/**
 * Revoke a session
 */
async function revokeSession(userId, sessionId) {
  try {
    const session = await prisma.user_sessions.findUnique({
      where: { session_id: sessionId }
    });

    if (!session || session.user_id !== userId) {
      return { success: false, error: 'Session not found or unauthorized' };
    }

    await prisma.user_sessions.update({
      where: { session_id: sessionId },
      data: { is_active: false }
    });

    return { success: true };
  } catch (error) {
    console.error('Revoke session error:', error);
    throw new Error('Failed to revoke session');
  }
}

/**
 * Delete user account (soft delete)
 */
async function deleteAccount(userId) {
  try {
    // Soft delete user
    await prisma.users.update({
      where: { user_id: userId },
      data: { deleted_at: new Date() }
    });

    // Invalidate all sessions
    await prisma.user_sessions.updateMany({
      where: { user_id: userId },
      data: { is_active: false }
    });

    return { success: true };
  } catch (error) {
    console.error('Delete account error:', error);
    throw new Error('Failed to delete account');
  }
}

/**
 * Get user activity summary
 */
async function getUserActivity(userId, limit = 10) {
  try {
    // Get recent rooms
    const recentRooms = await prisma.recent_rooms.findMany({
      where: { user_id: userId },
      include: {
        room: {
          select: {
            room_id: true,
            room_name: true,
            room_code: true,
            is_active: true
          }
        }
      },
      orderBy: {
        last_visited_at: 'desc'
      },
      take: limit
    });

    // Get recent messages
    const recentMessages = await prisma.messages.findMany({
      where: {
        sender_user_id: userId,
        deleted_at: null
      },
      include: {
        room: {
          select: {
            room_id: true,
            room_name: true,
            room_code: true
          }
        }
      },
      orderBy: {
        sent_at: 'desc'
      },
      take: limit
    });

    return {
      recentRooms: recentRooms.map(r => ({
        visitId: r.visit_id.toString(),
        room: r.room,
        lastVisited: r.last_visited_at,
        visitCount: r.visit_count,
        isFavorite: r.is_favorite
      })),
      recentMessages: recentMessages.map(m => ({
        messageId: m.message_id.toString(),
        roomId: m.room_id.toString(),
        roomName: m.room.room_name,
        sentAt: m.sent_at
      }))
    };
  } catch (error) {
    console.error('Get user activity error:', error);
    throw new Error('Failed to fetch user activity');
  }
}

module.exports = {
  authenticateWithGoogle,
  logout,
  getUserProfile,
  updatePreferences,
  updateProfile,
  getUserSessions,
  revokeSession,
  deleteAccount,
  getUserActivity
};
