# Simple WhatsApp API System Blueprint

## Project Goal

Build a simple but production-ready WhatsApp API platform using **Baileys** with:

- **Superadmin dashboard**
- **Admin accounts**
- **API users**
- **API key authentication**
- **QR/session management**
- **Message sending with attachments**
- **Session health checks**
- **WhatsApp number validation**
- **Socket.IO live updates**
- **PostgreSQL + Prisma**
- **Redis + BullMQ**
- **Dedicated Baileys worker service**
- **Dockerized deployment**

---

# 1. Final Stack

## Frontend
- Next.js
- Tailwind CSS
- Socket.IO Client

## Backend
- NestJS
- Prisma ORM
- PostgreSQL
- Redis
- BullMQ
- Socket.IO
- Swagger / OpenAPI

## WhatsApp Layer
- Dedicated Baileys worker service
- Custom auth-state adapter stored in DB
- Redis-based live session cache and locks

## Deployment
- Docker
- Docker Compose
- Nginx (optional reverse proxy)

---

# 2. Important Production Rule

Do **not** store Baileys sessions using `useMultiFileAuthState` in production.

Baileys’ docs warn that `useMultiFileAuthState` is demo-oriented and not suitable for production. Production should use a custom auth-state store backed by SQL/NoSQL/object storage instead.

For this project:
- session auth state will be stored in **PostgreSQL**
- hot status / locks / QR cache will be stored in **Redis**
- Baileys worker will reconstruct sessions from DB-backed auth state

---

# 3. Roles

## 3.1 Superadmin
Platform-level owner.

### Can do:
- view all admins
- view all API users
- view all WhatsApp sessions
- view platform-wide message usage
- send test messages from dashboard
- monitor queue health
- monitor worker status
- see connection events
- see message counts
- see live connected/disconnected state
- inspect audit logs

---

## 3.2 Admin
Operational account manager.

### Can do:
- create API users
- create and revoke API keys
- create WhatsApp sessions for assigned users
- request QR for user session
- view usage for their own users
- test session health
- test number-on-WhatsApp checks
- trigger send-message APIs for testing

---

## 3.3 API User
Programmatic customer/user.

### Can do:
- authenticate via API key
- request new QR code
- send messages
- send attachments
- test session active status
- check whether a number exists on WhatsApp

---

# 4. Main Product Model

The system should be modeled like this:

## Entity Chain
**Superadmin → Admin → API User → WhatsApp Session → API Key**

### Practical meaning
- superadmin sees everything
- admin manages their own API users
- each API user owns one or more WhatsApp sessions
- API key identifies the API user
- API requests use the API key to determine which user/session is acting

---

# 5. Functional Requirements Mapping

## 5.1 Superadmin dashboard
The superadmin dashboard must show:
- all admins
- all API users
- all WhatsApp sessions
- connected count
- disconnected count
- QR pending count
- sent messages today
- received messages today
- failed jobs
- queue stats
- worker health
- recent connection events

### Live status changes pushed to dashboard
- connected
- qr updated
- disconnected
- message count changed

---

## 5.2 Admin account
Admin account can:
- login to dashboard
- create API users
- generate API keys
- revoke API keys
- create WhatsApp session
- fetch QR for a user session
- view message usage
- test session status
- test number existence

---

## 5.3 User creation with API
Admin should be able to create users through dashboard and API.

### Example
`POST /admin/users`

Creates:
- user record
- optional default API key
- optional default WhatsApp session record

---

## 5.4 API key system
Each API user should have one or more API keys.

### API key rules
- keys stored hashed in DB
- raw key shown only once on creation
- every API request resolves the user from API key
- key can be active/inactive
- optional IP restrictions later
- optional usage quota later

---

## 5.5 Request new QR code
User can request QR code using API key.

### Flow
1. API key is validated
2. system resolves user
3. system resolves user’s session
4. if session not connected, worker generates fresh QR
5. QR is returned or emitted live
6. QR also appears in admin dashboard

---

## 5.6 Session persistence
Session auth must be saved on server side using:
- PostgreSQL for persistent credentials and key material
- Redis for temporary cache/locks/status

### Do not use
- local JSON files
- `useMultiFileAuthState` production storage

---

## 5.7 Send message with file attachment
User sends message via API key.

### Must support
- text
- image
- document
- audio
- video (later if needed)

### Flow
1. API key identifies user
2. request enters API
3. message job queued in BullMQ
4. worker resolves session
5. Baileys sends message
6. usage counters updated
7. dashboard gets realtime update

---

## 5.8 Session active check
API should return whether WhatsApp session is active.

### Result examples
- active
- disconnected
- pending_qr
- reconnecting
- logged_out

---

## 5.9 Check if number exists on WhatsApp
API should validate whether number is registered on WhatsApp.

### Example use
- before sending campaign or transactional message
- before saving customer record

---

## 5.10 Socket.IO realtime updates
Push to dashboard:
- connected
- qr updated
- disconnected
- message count changes
- queue failures
- reconnecting
- job completed

---

# 6. High-Level Architecture

```text
Next.js Dashboard
      |
      v
NestJS API
      |
      |---- PostgreSQL
      |---- Redis
      |---- Socket.IO Gateway
      |
      v
BullMQ Queues
      |
      v
Baileys Worker Service
      |
      v
WhatsApp Sessions
```

---

# 7. Service Breakdown

## 7.1 Frontend (Next.js)
Pages:
- login
- superadmin dashboard
- admin dashboard
- users
- api keys
- sessions
- usage
- queue monitor
- worker health

---

## 7.2 Backend API (NestJS)
Modules:
- auth
- superadmin
- admin
- users
- api-keys
- sessions
- messages
- usage
- websocket
- queues
- health
- audits
- whatsapp

---

## 7.3 Realtime Gateway
Socket.IO gateway pushes:
- session status updates
- QR updates
- usage counters
- queue/job status
- worker events

---

## 7.4 Worker Service
Dedicated service for:
- Baileys sessions
- reconnect logic
- send message jobs
- number validation jobs
- session state updates
- attachment sending

---

# 8. Database Design

## 8.1 users
```sql
id uuid primary key
name varchar(150)
email varchar(150) unique
password_hash text
role varchar(30) not null
parent_admin_id uuid null
is_active boolean default true
created_at timestamp
updated_at timestamp
```

### role values
- SUPERADMIN
- ADMIN
- API_USER

---

## 8.2 api_keys
```sql
id uuid primary key
user_id uuid references users(id)
name varchar(150)
key_hash text
is_active boolean default true
last_used_at timestamp null
created_at timestamp
revoked_at timestamp null
```

---

## 8.3 whatsapp_sessions
```sql
id uuid primary key
user_id uuid references users(id)
label varchar(150)
phone_number varchar(50) null
push_name varchar(150) null
status varchar(30)
last_seen_at timestamp null
qr_expires_at timestamp null
created_at timestamp
updated_at timestamp
```

---

## 8.4 whatsapp_auth_state
```sql
id uuid primary key
session_id uuid references whatsapp_sessions(id)
creds_json text
keys_json text
updated_at timestamp
```

---

## 8.5 message_logs
```sql
id uuid primary key
session_id uuid references whatsapp_sessions(id)
user_id uuid references users(id)
direction varchar(20)
to_number varchar(50) null
message_type varchar(30)
status varchar(30)
error_text text null
created_at timestamp
```

---

## 8.6 usage_daily
```sql
id uuid primary key
session_id uuid references whatsapp_sessions(id)
date date
sent_count integer default 0
received_count integer default 0
failed_count integer default 0
```

---

## 8.7 connection_logs
```sql
id uuid primary key
session_id uuid references whatsapp_sessions(id)
event_type varchar(100)
payload_json jsonb
created_at timestamp
```

---

## 8.8 audit_logs
```sql
id uuid primary key
actor_user_id uuid references users(id)
action varchar(100)
target_type varchar(50)
target_id varchar(100)
payload_json jsonb
created_at timestamp
```

---

# 9. Redis Usage

Redis will be used for:
- BullMQ queues
- session locks
- QR cache
- live connection status
- rate limiting
- temporary session routing metadata

## Example keys
```text
wa:session:{sessionId}:status
wa:session:{sessionId}:qr
wa:session:{sessionId}:lock
wa:user:{userId}:activeSession
wa:apikey:{keyId}:rate
```

---

# 10. Queue Design

## Queues
- `whatsapp-send`
- `whatsapp-reconnect`
- `whatsapp-qr`
- `whatsapp-number-check`
- `whatsapp-maintenance`

## Why queue everything
- avoids slow HTTP requests
- safer retries
- better scaling
- isolates Baileys processing
- keeps API stateless

---

# 11. API Authentication Model

## Dashboard Auth
- email/password login
- JWT bearer token

## API Auth
- `X-API-Key` header

### API Key Resolution
1. hash incoming key
2. match in database
3. resolve API user
4. resolve user’s WhatsApp session
5. process request

---

# 12. Core API Endpoints

## 12.1 Auth
### Dashboard login
`POST /auth/login`

### Current logged in user
`GET /auth/me`

---

## 12.2 Superadmin APIs
### Get all users
`GET /superadmin/users`

### Get all sessions
`GET /superadmin/sessions`

### Get dashboard summary
`GET /superadmin/dashboard/summary`

### Get all usage
`GET /superadmin/usage`

### Get queue status
`GET /superadmin/queues/stats`

### Get worker health
`GET /superadmin/health`

---

## 12.3 Admin APIs
### Create API user
`POST /admin/users`

### List own users
`GET /admin/users`

### Create API key
`POST /admin/users/:id/api-keys`

### Revoke API key
`DELETE /admin/api-keys/:id`

### Create WhatsApp session
`POST /admin/users/:id/sessions`

### Request QR for user session
`POST /admin/sessions/:id/request-qr`

### Get user usage
`GET /admin/users/:id/usage`

---

## 12.4 API User Key-Based APIs

### Request new QR code
`POST /api/session/request-qr`

### Check session status
`GET /api/session/status`

### Check number on WhatsApp
`GET /api/contacts/check-number?phone=60123456789`

### Send text message
`POST /api/messages/send-text`

### Send message with attachment
`POST /api/messages/send-file`

### Get usage
`GET /api/usage/me`

---

# 13. Request / Response Design

## 13.1 Request new QR
### Headers
```http
X-API-Key: your_api_key
```

### Response
```json
{
  "success": true,
  "data": {
    "sessionId": "sess_123",
    "status": "pending_qr",
    "qr": "data-or-token"
  }
}
```

---

## 13.2 Check session active
### Response
```json
{
  "success": true,
  "data": {
    "sessionId": "sess_123",
    "status": "connected",
    "isActive": true,
    "phoneNumber": "60123456789"
  }
}
```

---

## 13.3 Check number in WhatsApp
### Response
```json
{
  "success": true,
  "data": {
    "phone": "60123456789",
    "exists": true,
    "jid": "60123456789@s.whatsapp.net"
  }
}
```

---

## 13.4 Send file message
### Multipart fields
- `to`
- `caption`
- `file`

### Response
```json
{
  "success": true,
  "message": "Message queued",
  "data": {
    "jobId": "job_123",
    "status": "queued"
  }
}
```

---

# 14. Session Lifecycle

## Session states
- created
- pending_qr
- connected
- disconnected
- reconnecting
- logged_out
- failed

## Flow
1. session created
2. QR requested
3. QR scanned
4. session connected
5. messages sent through worker
6. disconnect triggers reconnect job
7. dashboard updates live

---

# 15. Live Dashboard Events

Socket.IO events:
- `session.connected`
- `session.qr.updated`
- `session.disconnected`
- `session.reconnecting`
- `usage.message.count.changed`
- `queue.job.failed`
- `queue.job.completed`

---

# 16. File Attachment Flow

## User request
API user hits:
`POST /api/messages/send-file`

## Process
1. validate API key
2. validate file type/size
3. upload temp file or pass stream
4. create send job
5. worker loads file
6. Baileys sends attachment
7. store send result
8. notify dashboard

---

# 17. Swagger Documentation

Swagger must be enabled in NestJS.

## Docs endpoints
- `/docs`
- `/docs-json`

## Swagger groups
- Auth
- Superadmin
- Admin
- API User
- Sessions
- Messages
- Usage
- Health

## Notes
- Dashboard auth uses bearer token
- API-user routes should document `X-API-Key`
- file upload endpoints must be marked as multipart/form-data

---

# 18. Security Rules

- API keys stored hashed
- JWT for dashboard users
- role guards for superadmin/admin
- ownership checks for admin resources
- rate limiting with Redis
- encrypt Baileys auth state at rest
- audit every QR request, send, revoke, reconnect
- validate attachment types and size limits

---

# 19. Dockerized Project Structure

```text
whatsapp-platform/
├── apps/
│   ├── frontend/
│   ├── backend/
│   └── worker/
├── packages/
│   ├── database/
│   ├── common/
│   └── config/
├── infra/
│   ├── docker/
│   └── nginx/
├── docker-compose.yml
└── .env.example
```

---

# 20. Docker Services

`docker-compose.yml` should include:
- frontend
- backend
- worker
- postgres
- redis
- nginx (optional)

---

# 21. Recommended MVP

## Include
- superadmin login
- admin login
- create API user
- create API key
- request QR
- save session in DB
- send text message
- send file attachment
- check session active
- check number in WhatsApp
- live dashboard events
- Swagger docs
- Docker setup

## Exclude for now
- billing
- campaigns
- chatbot flows
- multi-workspace enterprise RBAC
- webhook marketplace

---

# 22. Final System Flow

```text
Dashboard/API Client
        |
        v
NestJS API
        |
        |---- PostgreSQL
        |---- Redis
        |---- Socket.IO
        |
        v
BullMQ Queue
        |
        v
Baileys Worker
        |
        v
WhatsApp
```

---

# 23. Final Recommendation

For your requirement, the cleanest v1 is:

- **Superadmin** sees everything
- **Admin** creates API users and API keys
- **API user** works only through API key
- **Each API user owns a WhatsApp session**
- **QR generation and sending are handled through queued worker jobs**
- **Session auth is stored in PostgreSQL, not files**
- **Redis handles queue, cache, live status, and locks**
- **Socket.IO powers live dashboard updates**
- **Swagger documents both dashboard and API-key routes**
- **Docker runs the whole stack**

This gives you a simple, scalable, and production-ready API platform without unnecessary complexity.
