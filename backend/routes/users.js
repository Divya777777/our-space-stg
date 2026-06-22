const express = require('express');
const router = express.Router();
const {
  getUserProfile,
  updatePreferences,
  updateProfile,
  getUserSessions,
  revokeSession,
  deleteAccount,
  getUserActivity
} = require('../services/userService');
const { authenticate } = require('../middleware/auth');
const { validatePreferencesUpdate } = require('../middleware/validation');

/**
 * GET /api/users/me
 * Get current user profile
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const profile = await getUserProfile(req.user.user_id);

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user: profile
    });
  } catch (error) {
    console.error('Get user profile error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile',
      message: error.message
    });
  }
});

/**
 * PUT /api/users/me/preferences
 * Update user preferences
 */
router.put('/me/preferences', authenticate, validatePreferencesUpdate, async (req, res) => {
  try {
    const result = await updatePreferences(req.user.user_id, req.body);

    res.json(result);
  } catch (error) {
    console.error('Update preferences error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to update preferences',
      message: error.message
    });
  }
});

/**
 * PUT /api/users/me/profile
 * Update user profile (display name, avatar)
 */
router.put('/me/profile', authenticate, async (req, res) => {
  try {
    const { displayName, avatarUrl } = req.body;

    // Validate
    if (displayName && (displayName.length < 1 || displayName.length > 100)) {
      return res.status(400).json({
        success: false,
        error: 'Display name must be between 1 and 100 characters'
      });
    }

    if (avatarUrl && avatarUrl.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'Avatar URL too long'
      });
    }

    const result = await updateProfile(req.user.user_id, { displayName, avatarUrl });

    res.json(result);
  } catch (error) {
    console.error('Update profile error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
      message: error.message
    });
  }
});

/**
 * GET /api/users/me/sessions
 * Get user's active sessions
 */
router.get('/me/sessions', authenticate, async (req, res) => {
  try {
    const sessions = await getUserSessions(req.user.user_id);

    res.json({
      success: true,
      sessions
    });
  } catch (error) {
    console.error('Get user sessions error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to fetch sessions',
      message: error.message
    });
  }
});

/**
 * DELETE /api/users/me/sessions/:sessionId
 * Revoke a session
 */
router.delete('/me/sessions/:sessionId', authenticate, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await revokeSession(req.user.user_id, sessionId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Revoke session error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to revoke session',
      message: error.message
    });
  }
});

/**
 * GET /api/users/me/activity
 * Get user activity (recent rooms, messages)
 */
router.get('/me/activity', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const activity = await getUserActivity(req.user.user_id, limit);

    res.json({
      success: true,
      activity
    });
  } catch (error) {
    console.error('Get user activity error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to fetch user activity',
      message: error.message
    });
  }
});

/**
 * DELETE /api/users/me
 * Delete user account (soft delete)
 */
router.delete('/me', authenticate, async (req, res) => {
  try {
    const result = await deleteAccount(req.user.user_id);

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Delete account error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to delete account',
      message: error.message
    });
  }
});

module.exports = router;
