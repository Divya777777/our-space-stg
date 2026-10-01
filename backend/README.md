# Our Space shared website and mobile backend

Extends the existing website backend with authenticated mobile routes and account-owned personal playlists. The service remains in `backend/` so existing deployment root directories continue to work. See `DEPLOYMENT.md` for the required database rollout.

## Changes

- Personal playlists have `room_id = NULL`, belong to their creator, and survive room deletion. Creating or listing a personal playlist requires no room membership.
- `GET /api/playlists/personal` returns only the authenticated user's personal library.
- `GET /api/playlists/room/:roomId` preserves the website's combined response (room plus the caller's personal playlists). Use `?scope=room` for room-only results. The native API independently scopes personal and room data.
- Add/remove/reorder operations require personal ownership or active membership in an active room. Private playlist ownership is enforced even when another user is in the same room.
- Reordering requires every current playlist song exactly once, with distinct positions from zero to length minus one. Foreign playlist item IDs are rejected before updates. Writes run in serializable transactions with bounded conflict retries.
- Personal playlist names/IDs are not exposed in a room's playback response when a person shares a video from their private library. A room playlist from another room cannot be selected.
- Playback replacement is transactional, avoiding a committed empty state between delete/create.
- Logout now authenticates and revokes the current session. Failed Google login auditing and validation errors no longer echo the submitted credential.
- Room route IDs are validated and converted before Prisma queries. Relevant numeric and boolean request fields are normalized.
- Track duration can be omitted when metadata is not yet available (stored as zero, consistent with the existing schema).

## Local setup

Use Node **22.12 or later**; the existing dependency range now resolves packages that require it. A lockfile is included. Dependency installation and Prisma generation do not require a database connection.

```sh
cd backend
npm ci
npm run prisma:generate
cp .env.example .env
```

Set `.env` to a **separate local or staging PostgreSQL database**, and supply fresh local secrets. Do not copy the live Neon connection string. Environment files are ignored. The default example port is 3003, separate from the mobile test server's 3002.

For a brand-new, empty local database only:

```sh
npx prisma db push
npx prisma db execute --file prisma/manual-migrations/001_personal_playlists.sql --schema prisma/schema.prisma
npm start
```

For an existing local/staging copy of the old database, apply **only** the SQL migration above, then regenerate Prisma. Do not use `db push` to substitute for the data migration: the SQL detaches old personal playlists while preserving playlist IDs, song entries, and owners. It also enforces the scope constraint, which Prisma's schema language does not represent.

The SQL is transactional and one-time. Invalid legacy playlist types cause a rollback for inspection; no rows are silently dropped. It deliberately does not live in a Prisma migration chain because the original project has no migration baseline. Establish a baseline against the actual deployed schema before adopting `prisma migrate deploy` later. Do not reattach personal playlists or restore NOT NULL as a casual rollback: newer personal playlists have no original room.

Production schema changes are explicit: deployment start commands do not run `prisma db push`. Apply the reviewed SQL migration separately after verifying the correct database and deployed backend.

## API examples

All requests require the existing bearer access token. The authenticated user, not a submitted owner ID, determines personal ownership.

Create personal:

```json
{"playlistName":"After hours","playlistType":"personal"}
```

Create room:

```json
{"playlistName":"Our late nights","playlistType":"room","roomId":7}
```

Personal creation returns `roomId: null`. A legacy `roomId` supplied for a personal playlist is ignored by the service and stored as null. Mobile clients should omit it.

Save a song with `POST /api/playlists/:playlistId/songs`:

```json
{"videoId":"abcdefghijk","title":"Fetched video title"}
```

The caller still supplies media metadata; this phase does not add server-side YouTube title lookup. Existing website callers sending duration/artist/thumbnail continue to work.

Reorder with `PUT /api/playlists/:playlistId/reorder`:

```json
{"songOrder":[{"playlistSongId":31,"newPosition":0},{"playlistSongId":30,"newPosition":1}]}
```

Permission failures return 403, invalid order 400, duplicate saved songs 409. Existing successful response shapes are preserved apart from nullable personal room IDs and the separate personal library endpoint.

## Validation

```sh
npm test
npm run prisma:validate
```

Tests cover owner isolation, membership, room-independent creation, room-only reads, invalid/foreign reorder items, conflict retries, logout middleware, ID normalization, and route serialization. Embedded PostgreSQL tests run the migration against isolated fixtures, test cascading room deletion, and verify rollback for invalid legacy records. They do not connect to Neon. Service tests use an injected Prisma client; full live login, real Prisma/database integration, and multi-device calls remain for the integration phase.

## Mobile integration and responsiveness

See `DEPLOYMENT.md` for deployment and OAuth configuration. `/api/mobile` exposes the app's room, playlist, playback, and call contracts using authenticated PostgreSQL-backed users. Native tokens use SecureStore and refresh automatically. PeerJS remains for the website; native-to-native calls use the existing WebRTC media implementation with a room-scoped signaling queue and TURN credentials.

Room and call requests support `wait=1&cursor=...`. Matching cursors keep the request open until a change or heartbeat. Updates wake waiting clients immediately, replacing fixed 900/1200 ms client timers. Call heartbeats are 15 seconds; room heartbeats are 10 seconds. Clients cancel waits when leaving, back off on errors, and avoid rendering identical snapshots. Legacy website writes are observed on the room heartbeat rather than the mobile notification path; native/website call signaling is not interoperable yet.

Signaling and change notifications are ephemeral and require a **single backend instance**. Persistent accounts, messages, memberships, playlists and playback remain in PostgreSQL. Server restart may require retrying a call. A shared event broker is needed before scaling to multiple replicas. This change does not claim the entire inherited backend is production-audited.
