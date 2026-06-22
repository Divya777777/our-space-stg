const { PrismaClient } = require('@prisma/client');
const { encrypt, decrypt, getEncryptionKey, hashFile } = require('../utils/encryption');

const prisma = new PrismaClient();

/**
 * Send a message in a room
 */
async function sendMessage(roomId, senderId, messageData) {
  try {
    const { content, messageType = 'text', isSystemMessage = false } = messageData;

    // Get encryption key
    const encryptionKey = getEncryptionKey();

    // Encrypt message content
    const encrypted = encrypt(content, encryptionKey);

    // Create message
    const message = await prisma.messages.create({
      data: {
        room_id: roomId,
        sender_user_id: senderId,
        content_encrypted: encrypted.encrypted,
        encryption_iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        encryption_algorithm: 'AES-256-GCM',
        message_type: messageType,
        is_system_message: isSystemMessage
      },
      include: {
        sender: {
          select: {
            user_id: true,
            display_name: true,
            avatar_url: true
          }
        }
      }
    });

    return message;
  } catch (error) {
    console.error('Send message error:', error);
    throw new Error('Failed to send message');
  }
}

/**
 * Get messages for a room (with decryption)
 */
async function getRoomMessages(roomId, limit = 100, offset = 0) {
  try {
    const messages = await prisma.messages.findMany({
      where: {
        room_id: roomId,
        deleted_at: null
      },
      include: {
        sender: {
          select: {
            user_id: true,
            display_name: true,
            avatar_url: true
          }
        },
        files: true
      },
      orderBy: {
        sent_at: 'desc'
      },
      take: limit,
      skip: offset
    });

    // Decrypt messages
    const encryptionKey = getEncryptionKey();

    const decryptedMessages = messages.map(msg => {
      try {
        const decryptedContent = decrypt(
          msg.content_encrypted,
          msg.encryption_iv,
          msg.auth_tag,
          encryptionKey
        );

        return {
          messageId: msg.message_id.toString(),
          roomId: msg.room_id.toString(),
          sender: {
            userId: msg.sender.user_id.toString(),
            displayName: msg.sender.display_name,
            avatarUrl: msg.sender.avatar_url
          },
          content: decryptedContent,
          messageType: msg.message_type,
          isSystemMessage: msg.is_system_message,
          sentAt: msg.sent_at,
          files: msg.files
        };
      } catch (decryptError) {
        console.error('Message decryption failed:', decryptError);
        return {
          ...msg,
          content: '[Encrypted message - decryption failed]',
          decryptionError: true
        };
      }
    });

    return decryptedMessages.reverse(); // Oldest first
  } catch (error) {
    console.error('Get messages error:', error);
    throw new Error('Failed to fetch messages');
  }
}

/**
 * Delete a message (soft delete)
 */
async function deleteMessage(messageId, userId) {
  try {
    const message = await prisma.messages.findUnique({
      where: { message_id: messageId }
    });

    if (!message) {
      return { success: false, error: 'Message not found' };
    }

    // Check if user is the sender
    if (message.sender_user_id !== userId) {
      return { success: false, error: 'You can only delete your own messages' };
    }

    // Soft delete
    await prisma.messages.update({
      where: { message_id: messageId },
      data: { deleted_at: new Date() }
    });

    return { success: true };
  } catch (error) {
    console.error('Delete message error:', error);
    throw new Error('Failed to delete message');
  }
}

/**
 * Upload and attach file to message
 */
async function attachFile(messageId, fileData) {
  try {
    const {
      originalFilename,
      storedFilename,
      fileSize,
      fileType,
      fileBuffer
    } = fileData;

    // Get encryption key
    const encryptionKey = getEncryptionKey();

    // Encrypt file content
    const encrypted = encrypt(fileBuffer.toString('base64'), encryptionKey);

    // Calculate checksum
    const checksum = hashFile(fileBuffer);

    // Store file metadata
    const file = await prisma.message_files.create({
      data: {
        message_id: messageId,
        original_filename: originalFilename,
        stored_filename: storedFilename,
        file_size: fileSize,
        file_type: fileType,
        encryption_iv: encrypted.iv,
        checksum
      }
    });

    // Note: In production, you would save the encrypted content to a file storage service
    // For now, we're just storing metadata

    return file;
  } catch (error) {
    console.error('Attach file error:', error);
    throw new Error('Failed to attach file');
  }
}

/**
 * Get file for download
 */
async function getFile(fileId, userId) {
  try {
    const file = await prisma.message_files.findUnique({
      where: { file_id: fileId },
      include: {
        message: {
          include: {
            room: {
              include: {
                members: {
                  where: {
                    user_id: userId,
                    left_at: null
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!file) {
      return { success: false, error: 'File not found' };
    }

    // Check if user is a member of the room
    if (file.message.room.members.length === 0) {
      return { success: false, error: 'Unauthorized' };
    }

    return {
      success: true,
      file: {
        fileId: file.file_id.toString(),
        originalFilename: file.original_filename,
        fileSize: file.file_size,
        fileType: file.file_type,
        uploadedAt: file.uploaded_at
        // In production, include download URL or encrypted content
      }
    };
  } catch (error) {
    console.error('Get file error:', error);
    throw new Error('Failed to fetch file');
  }
}

/**
 * Send system message
 */
async function sendSystemMessage(roomId, content) {
  try {
    const encryptionKey = getEncryptionKey();
    const encrypted = encrypt(content, encryptionKey);

    // Use first room member as sender (system user would be better)
    const firstMember = await prisma.room_members.findFirst({
      where: { room_id: roomId, left_at: null },
      orderBy: { joined_at: 'asc' }
    });

    if (!firstMember) {
      throw new Error('No members in room');
    }

    const message = await prisma.messages.create({
      data: {
        room_id: roomId,
        sender_user_id: firstMember.user_id,
        content_encrypted: encrypted.encrypted,
        encryption_iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        encryption_algorithm: 'AES-256-GCM',
        message_type: 'system',
        is_system_message: true
      }
    });

    return message;
  } catch (error) {
    console.error('Send system message error:', error);
    throw new Error('Failed to send system message');
  }
}

/**
 * Get message count for a room
 */
async function getMessageCount(roomId) {
  try {
    const count = await prisma.messages.count({
      where: {
        room_id: roomId,
        deleted_at: null
      }
    });

    return count;
  } catch (error) {
    console.error('Get message count error:', error);
    return 0;
  }
}

/**
 * Search messages in a room (searches encrypted content - limited functionality)
 */
async function searchMessages(roomId, searchTerm, limit = 50) {
  try {
    // Note: Searching encrypted content is not possible without decrypting all messages
    // This is a performance/security tradeoff
    // For production, consider using searchable encryption or client-side search

    const allMessages = await getRoomMessages(roomId, 1000, 0);

    const results = allMessages.filter(msg =>
      msg.content.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return results.slice(0, limit);
  } catch (error) {
    console.error('Search messages error:', error);
    throw new Error('Failed to search messages');
  }
}

module.exports = {
  sendMessage,
  getRoomMessages,
  deleteMessage,
  attachFile,
  getFile,
  sendSystemMessage,
  getMessageCount,
  searchMessages
};
