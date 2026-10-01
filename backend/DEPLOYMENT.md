# Shared backend rollout

Deploy the existing `backend/` directory. Preserve the existing DATABASE_URL, Google web client ID, JWT secrets, encryption key and TURN credentials. Use Node 22.13 or later, build `npm ci --include=dev && npx prisma generate`, start `npm start`, and one instance. No mobile source or frontend changes are part of this release.

## Database coordination

The existing database must use `prisma/manual-migrations/001_personal_playlists.sql`. This one-time transaction makes room_id nullable, detaches existing personal playlists, and adds a scope constraint. It preserves IDs, owners and song entries. The migration passed against a separate Neon copy of the existing database (8 personal playlists, 20 room playlists, 8 song entries).

Before applying to production, verify the service DATABASE_URL identifies the intended database and create a fresh recovery branch. Coordinate cutover: old code cannot safely read null room IDs, while personal playlist creation in the new code requires the migration. Use a maintenance window and verify every service sharing that database has the new code before allowing personal playlist writes. Do not roll old code back onto the migrated database. Pushing this commit does not by itself apply the data migration.

## Verification

Check `/health` and `/api/mobile/capabilities`. Verify website Google login and playlist responses, then mobile login with two accounts, personal isolation, room membership and call signaling. Native-to-native calls use the mobile signaling routes; native-to-website calls still need common signaling. Calls and notifications require one process until a shared broker is added.
