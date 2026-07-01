const { body, param, query, validationResult } = require('express-validator');

/**
 * Handle validation errors
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    console.log('[VALIDATION ERROR] Request body:', req.body);
    console.log('[VALIDATION ERROR] Errors:', errors.array());
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }

  next();
}

/**
 * Validation rules for authentication
 */
const validateGoogleAuth = [
  body('credential')
    .notEmpty()
    .withMessage('Google credential is required')
    .isString()
    .withMessage('Credential must be a string'),
  handleValidationErrors
];

/**
 * Validation rules for room creation
 */
const validateRoomCreation = [
  body('roomName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Room name must be between 1 and 200 characters'),
  body('maxMembers')
    .optional()
    .isInt({ min: 2, max: 50 })
    .withMessage('Max members must be between 2 and 50'),
  body('isPublic')
    .optional()
    .isBoolean()
    .withMessage('isPublic must be a boolean'),
  body('requiresApproval')
    .optional()
    .isBoolean()
    .withMessage('requiresApproval must be a boolean'),
  handleValidationErrors
];

/**
 * Validation rules for joining room
 */
const validateRoomJoin = [
  body('roomCode')
    .notEmpty()
    .withMessage('Room code is required')
    .isString()
    .isLength({ min: 6, max: 10 })
    .withMessage('Invalid room code format')
    .matches(/^[A-Z0-9]+$/)
    .withMessage('Room code must contain only uppercase letters and numbers'),
  handleValidationErrors
];

/**
 * Validation rules for sending message
 */
const validateMessageSend = [
  param('roomId')
    .notEmpty()
    .isInt()
    .withMessage('Valid room ID is required'),
  body('content')
    .notEmpty()
    .withMessage('Message content is required')
    .isString()
    .trim()
    .isLength({ min: 1, max: 5000 })
    .withMessage('Message must be between 1 and 5000 characters'),
  body('messageType')
    .optional()
    .isIn(['text', 'file', 'system'])
    .withMessage('Invalid message type'),
  handleValidationErrors
];

/**
 * Validation rules for file upload
 */
const validateFileUpload = [
  param('roomId')
    .notEmpty()
    .isInt()
    .withMessage('Valid room ID is required'),
  body('filename')
    .notEmpty()
    .withMessage('Filename is required')
    .isString()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Filename must be between 1 and 255 characters'),
  body('fileType')
    .notEmpty()
    .withMessage('File type is required')
    .isString(),
  body('fileSize')
    .notEmpty()
    .isInt({ min: 1, max: 2097152 }) // 2MB max
    .withMessage('File size must be between 1 byte and 2MB'),
  handleValidationErrors
];

/**
 * Validation rules for creating playlist
 */
const validatePlaylistCreation = [
  body('roomId')
    .notEmpty()
    .isInt()
    .withMessage('Valid room ID is required'),
  body('playlistName')
    .notEmpty()
    .withMessage('Playlist name is required')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Playlist name must be between 1 and 200 characters'),
  body('playlistType')
    .optional()
    .isIn(['room', 'personal'])
    .withMessage('Invalid playlist type'),
  handleValidationErrors
];

/**
 * Validation rules for adding song to playlist
 */
const validateAddSong = [
  param('playlistId')
    .notEmpty()
    .isInt()
    .withMessage('Valid playlist ID is required'),
  body('videoId')
    .notEmpty()
    .withMessage('Video ID is required')
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Video ID must be between 1 and 100 characters'),
  body('title')
    .notEmpty()
    .withMessage('Song title is required')
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Title must be between 1 and 500 characters'),
  body('artist')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Artist name must be less than 200 characters'),
  body('durationSeconds')
    .notEmpty()
    .isInt({ min: 0 })
    .withMessage('Duration must be a non-negative integer'),
  body('thumbnailUrl')
    .optional()
    .isURL()
    .withMessage('Invalid thumbnail URL'),
  handleValidationErrors
];

/**
 * Validation rules for updating now playing
 */
const validateNowPlaying = [
  param('roomId')
    .notEmpty()
    .isInt()
    .withMessage('Valid room ID is required'),
  body('videoId')
    .notEmpty()
    .withMessage('Video ID is required')
    .isString()
    .trim(),
  body('playlistId')
    .optional()
    .isInt()
    .withMessage('Playlist ID must be an integer'),
  body('currentTimeSeconds')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Current time must be a positive number'),
  body('isPlaying')
    .optional()
    .isBoolean()
    .withMessage('isPlaying must be a boolean'),
  handleValidationErrors
];

/**
 * Validation rules for join request approval
 */
const validateJoinApproval = [
  param('requestId')
    .notEmpty()
    .isInt()
    .withMessage('Valid request ID is required'),
  body('approved')
    .notEmpty()
    .isBoolean()
    .withMessage('Approval status must be a boolean'),
  handleValidationErrors
];

/**
 * Validation rules for user preferences update
 */
const validatePreferencesUpdate = [
  body('theme')
    .optional()
    .isIn(['light', 'dark'])
    .withMessage('Theme must be either light or dark'),
  body('notificationsEnabled')
    .optional()
    .isBoolean()
    .withMessage('notificationsEnabled must be a boolean'),
  body('autoJoinRooms')
    .optional()
    .isBoolean()
    .withMessage('autoJoinRooms must be a boolean'),
  body('defaultVideoQuality')
    .optional()
    .isIn(['auto', 'high', 'medium', 'low'])
    .withMessage('Invalid video quality'),
  handleValidationErrors
];

/**
 * Validation rules for room visit tracking
 */
const validateRoomVisit = [
  param('roomId')
    .notEmpty()
    .isInt()
    .withMessage('Valid room ID is required'),
  body('timeSpentSeconds')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Time spent must be a positive integer'),
  handleValidationErrors
];

/**
 * Validation rules for favorite room toggle
 */
const validateFavoriteToggle = [
  param('roomId')
    .notEmpty()
    .isInt()
    .withMessage('Valid room ID is required'),
  body('isFavorite')
    .notEmpty()
    .isBoolean()
    .withMessage('isFavorite must be a boolean'),
  handleValidationErrors
];

/**
 * Validation rules for pagination
 */
const validatePagination = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be a non-negative integer'),
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  validateGoogleAuth,
  validateRoomCreation,
  validateRoomJoin,
  validateMessageSend,
  validateFileUpload,
  validatePlaylistCreation,
  validateAddSong,
  validateNowPlaying,
  validateJoinApproval,
  validatePreferencesUpdate,
  validateRoomVisit,
  validateFavoriteToggle,
  validatePagination
};
