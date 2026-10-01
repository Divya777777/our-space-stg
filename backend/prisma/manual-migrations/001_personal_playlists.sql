-- Apply only to a LOCAL/STAGING copy after reviewing the existing schema.
-- This project previously used db push and has no Prisma migration baseline.
-- Keep existing playlist and song IDs; detach only personal playlists from rooms.
BEGIN;
ALTER TABLE "playlists" ALTER COLUMN "room_id" DROP NOT NULL;
UPDATE "playlists" SET "room_id" = NULL WHERE "playlist_type" = 'personal';
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_scope_check" CHECK (
  ("playlist_type" = 'personal' AND "room_id" IS NULL)
  OR ("playlist_type" = 'room' AND "room_id" IS NOT NULL)
);
COMMIT;

-- The existing cascading room FK is retained. Only room playlists now reference
-- rooms, so deleting a room cannot delete a personal playlist.
-- This script is deliberately one-time: a second application errors and rolls
-- back. Unexpected legacy playlist types also fail instead of being discarded.
