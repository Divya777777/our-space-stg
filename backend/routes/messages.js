const express = require('express');
const router = express.Router();
const {
  sendMessage,
  getRoomMessages,
  deleteMessage,
  getMessageCount,
  searchMessages
} = require('../services/messageService');
const { authenticate, isRoomMember } = require('../middleware/auth');
const {
  validateMessageSend,
  validatePagination
} = require('../middleware/validation');
const { messageLimiter } = require('../middleware/security');
const { logMessageEvent } = require('../utils/auditLogger');

/**
 * POST /api/messages/:roomId
 * Send a message in a room
 */
router.post('/:roomId', authenticate, isRoomMember, messageLimiter, validateMessageSend, async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);
    const { content, messageType } = req.body;

    const message = await sendMessage(roomId, req.user.user_id, {
      content,
      messageType
    });

    await logMessageEvent(
      req.user.user_id,
      message.message_id,
      'send',
      { roomId, messageType }
    );

    res.status(201).json({
      success: true,
      message: {
        messageId: message.message_id.toString(),
        roomId: message.room_id.toString(),
        sender: {
          userId: message.sender.user_id.toString(),
          displayName: message.sender.display_name,
          avatarUrl: message.sender.avatar_url
        },
        content, // Already decrypted on client side
        messageType: message.message_type,
        sentAt: message.sent_at
      }
    });
  } catch (error) {
    console.error('Send message error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to send message',
      message: error.message
    });
  }
});

/**
 * GET /api/messages/:roomId
 * Get messages for a room
 */
router.get('/:roomId', authenticate, isRoomMember, validatePagination, async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const messages = await getRoomMessages(roomId, limit, offset);

    res.json({
      success: true,
      messages,
      count: messages.length
    });
  } catch (error) {
    console.error('Get messages error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to fetch messages',
      message: error.message
    });
  }
});

/**
 * DELETE /api/messages/:messageId
 * Delete a message (soft delete)
 */
router.delete('/:messageId', authenticate, async (req, res) => {
  try {
    const messageId = parseInt(req.params.messageId);

    const result = await deleteMessage(messageId, req.user.user_id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    await logMessageEvent(
      req.user.user_id,
      messageId,
      'delete'
    );

    res.json(result);
  } catch (error) {
    console.error('Delete message error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to delete message',
      message: error.message
    });
  }
});

/**
 * GET /api/messages/:roomId/count
 * Get message count for a room
 */
router.get('/:roomId/count', authenticate, isRoomMember, async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);
    const count = await getMessageCount(roomId);

    res.json({
      success: true,
      count
    });
  } catch (error) {
    console.error('Get message count error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to get message count',
      message: error.message
    });
  }
});

/**
 * GET /api/messages/:roomId/search
 * Search messages in a room
 */
router.get('/:roomId/search', authenticate, isRoomMember, async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);
    const { q: searchTerm } = req.query;

    if (!searchTerm) {
      return res.status(400).json({
        success: false,
        error: 'Search term is required'
      });
    }

    const limit = parseInt(req.query.limit) || 50;
    const results = await searchMessages(roomId, searchTerm, limit);

    res.json({
      success: true,
      results,
      count: results.length
    });
  } catch (error) {
    console.error('Search messages error:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to search messages',
      message: error.message
    });
  }
});

module.exports = router;
