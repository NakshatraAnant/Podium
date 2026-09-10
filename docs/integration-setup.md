# Integration Setup — Gmail, Google Calendar, Google Meet

Status: **not built** (blueprint Phase 9). This document exists so a future
session — or AMM Brands' own IT contact — knows exactly what to provide and
what will be built against it, per the original brief's instruction to
document activation requirements even when the integration itself is stubbed.
Nothing in this repo currently calls any Google API.

## What we'll need from AMM Brands

1. **A Google Cloud project** (new or existing) with billing enabled (Google
   APIs used here are free at AMM's expected volume, but a project needs
   billing enabled to raise API quotas beyond the sandbox default).
2. **OAuth consent screen** configured as **Internal** if AMM Brands uses
   Google Workspace (recommended — restricts the app to `@ammbrands.in`
   accounts, no Google verification review needed) or **External** with the
   app in "Testing" mode for a pilot with a handful of named test users.
3. **OAuth 2.0 Client ID** (Web application type), with:
   - Authorized redirect URI: `https://<your-domain>/auth/google/callback`
     (or `http://localhost:3001/auth/google/callback` for local dev).
4. **APIs enabled** on that project: Gmail API, Google Calendar API. (Google
   Meet links are created as a side effect of a Calendar API event insert
   with `conferenceData` requested — there is no separate "Meet API" to
   enable for that use case.)
5. The resulting **Client ID** and **Client Secret** go into `.env` as
   `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (already present
   as placeholders in `.env.example`) — never commit real values.

## Scopes — deliberately minimal (blueprint §16/§24)

```
openid
email
profile
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/calendar.events
```

**Never request `gmail.modify`, `gmail.metadata`-only-then-widen, or full
mailbox scope.** `gmail.readonly` + `gmail.send` covers everything the
prototype's Mail screen does (read, reply, no delete/label-management via
API). `calendar.events` (not full `calendar`) is enough to create/read
events this app creates — it cannot read or modify the user's entire
calendar.

## What gets built against these, when this phase is picked up

### Gmail sync (`emails` table)
- OAuth2 code exchange → store refresh token encrypted, associated with the
  `User` who connected it (per-user connection, not a shared mailbox).
- Initial sync: `users.messages.list` for the last N days, or a fixed count,
  to seed the inbox view — **not** a full mailbox mirror (data minimization).
- Incremental sync: Gmail `history.list` keyed off a stored `historyId`,
  ideally driven by a `users.watch()` Pub/Sub push subscription rather than
  polling (polling is the fallback if Pub/Sub setup is deferred).
- Store only: `gmail_message_id`, `thread_id`, from-address, subject, a body
  snippet, received timestamp, read/starred flags. Full body fetched on
  demand when a user opens a message, not stored redundantly.
- Linking: match sender domain/email against `clients`, `vendors`, `leads`
  (via their contact email fields once `client_contacts`/`vendor_contacts`
  are populated with real email addresses) — unmatched mail routes to a
  "needs linking" view, mirroring the prototype's `link: null` case.
- Disconnect/token-expiry handling: surface as a visible banner in Settings
  (per the original prompt's §14 "integration health surfaced in the app
  itself"), never a silent failure.

### Calendar / Meet (`meetings` table)
- Creating a `meetings` row (from the app) → `events.insert` on the
  connected user's calendar with `conferenceDataVersion: 1` and a
  `createRequest` to get a real Meet link back — store that link in
  `meetings.meet_link`.
- Post-meeting notes/action items: Google Meet doesn't expose transcripts or
  notes via a general API without Workspace add-on entitlements AMM may not
  have; treat "notes → tasks" (automation `au9`) as a manually-entered notes
  field for V1, promotable to tasks by a human, not an automated transcript
  pull, unless AMM confirms they have Gemini/Meet transcription entitlements
  worth building against.

## Until this is built

The Mail and Meetings/Calendar screens in `docs/screens.md` are marked ⬜
(stub) for exactly this reason. Do not fabricate a "sandbox mode" UI that
pretends to sync — better to leave those nav items absent from the frontend
than to ship a convincing-looking fake, per this build's general principle of
not claiming more than what's verified.
