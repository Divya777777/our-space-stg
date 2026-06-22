const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Encrypt data using AES-256-GCM
 * @param {string} plaintext - Data to encrypt
 * @param {Buffer} key - 32-byte encryption key
 * @returns {Object} - { encrypted, iv, authTag }
 */
function encrypt(plaintext, key) {
  try {
    // Generate random IV
    const iv = crypto.randomBytes(IV_LENGTH);

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // Encrypt
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt data using AES-256-GCM
 * @param {string} encrypted - Encrypted data (hex)
 * @param {string} ivHex - IV (hex)
 * @param {string} authTagHex - Authentication tag (hex)
 * @param {Buffer} key - 32-byte encryption key
 * @returns {string} - Decrypted plaintext
 */
function decrypt(encrypted, ivHex, authTagHex, key) {
  try {
    // Convert hex to buffer
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Decryption failed - data may be corrupted or tampered with');
  }
}

/**
 * Generate encryption key from environment variable
 * @returns {Buffer} - 32-byte key
 */
function getEncryptionKey() {
  const keyHex = process.env.ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error('ENCRYPTION_KEY not set in environment variables');
  }

  const key = Buffer.from(keyHex, 'hex');

  if (key.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex characters)`);
  }

  return key;
}

/**
 * Hash a file for checksum verification
 * @param {Buffer} fileBuffer - File data
 * @returns {string} - SHA-256 hash (hex)
 */
function hashFile(fileBuffer) {
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * Generate random token for various purposes
 * @param {number} length - Token length in bytes
 * @returns {string} - Random token (hex)
 */
function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Derive a key from a password using PBKDF2
 * @param {string} password - Password
 * @param {string} salt - Salt (hex)
 * @param {number} iterations - Number of iterations (default: 100000)
 * @returns {Buffer} - Derived key
 */
function deriveKey(password, salt, iterations = 100000) {
  const saltBuffer = Buffer.from(salt, 'hex');
  return crypto.pbkdf2Sync(password, saltBuffer, iterations, KEY_LENGTH, 'sha256');
}

/**
 * Generate salt for key derivation
 * @returns {string} - Salt (hex)
 */
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  encrypt,
  decrypt,
  getEncryptionKey,
  hashFile,
  generateToken,
  deriveKey,
  generateSalt,
  ALGORITHM
};
