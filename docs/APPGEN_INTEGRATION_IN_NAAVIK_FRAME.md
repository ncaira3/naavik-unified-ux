# AppGen Integration in the Naavik Frame (Unified UX)

Last updated: 2026-04-06

This doc explains **how AppGen is integrated** into the Unified UX “Naavik Frame”, without documenting AppGen internals.

---

## 1) Frame-level concepts

### App registry
- Backend seeds apps in `backend/src/services/platform-registry.service.ts`.
- Frontend mirrors registry defaults in `frontend/src/platform/appRegistry.ts`.
- Each app entry defines:
  - `containerType`: `internal` | `federated` | `iframe`
  - `internalKey` (for internal apps)
  - `chatStream` (controls which chat “stream” is active)

### App hosting
- `frontend/src/platform/AppSlot.tsx` renders the active app:
  - `internal` apps load via `LAZY_COMPONENTS[internalKey]`
  - `federated` apps can be loaded via Module Federation (optional)
  - `iframe` apps embed external URLs

AppGen is configured as an **internal** app:
- `id: "appgen"`
- `internalKey: "appgen"`
- `chatStream: "appgen"`

---

## 2) AppGen API access patterns

There are **two** AppGen-related API surfaces in this repo:

### 2.1 Proxy to an external AppGen service

Use case: the Unified UX hosts AppGen UI, but AppGen backend runs elsewhere.

- Token exchange:
  - `GET /api/appgen/session-token`
  - Implemented in `backend/src/routes/appgen-proxy.routes.ts`
  - Uses `APPGEN_ADMIN_USER` / `APPGEN_ADMIN_PASSWORD` to obtain an AppGen JWT.

- Proxy:
  - `/appgen-api/*` → `${APPGEN_API_URL}/api/*`
  - Implemented by `appgenProxy` in `backend/src/routes/appgen-proxy.routes.ts`
  - Mounted in `backend/src/server.ts` via `app.use('/appgen-api', appgenProxy)`

Frontend usage:
- `frontend/src/components/AppGen/lib/api.ts` targets `/appgen-api` and stores `appgen_token` in localStorage.

### 2.2 Unified AppGen agent endpoints (hosted in this backend)

Use case: AppGen “agent chat” is handled by the Unified UX backend services.

- `backend/src/routes/appgen-agent.routes.ts` exposes:
  - `POST /api/appgen/agent/v1/chat`
  - `GET  /api/appgen/agent/v1/state/:threadId`
  - `POST /api/appgen/agent/v1/generate`
  - `POST /api/appgen/agent/v1/package-rapp`
  - `POST /api/appgen/agent/v1/reset`

Frontend usage:
- `frontend/src/services/api.ts` has `appgenAgentV1*` helpers, used by `frontend/src/components/ChatInterface.tsx`.

---

## 3) Chat + navigation integration

### Chat streams
- Stream state is stored in `frontend/src/context/ChatContext.tsx`.
- `chatStream: "appgen"` routes interactions through AppGen flows in `frontend/src/components/ChatInterface.tsx`.

### Frame navigation from chat
- The platform bus can publish:
  - `NAVIGATE_TO_APP` with `{ appId: 'appgen' }`
- Chat responses often include “choice buttons” that map to app navigation:
  - Example: “Open Naavik AppGen”

---

## 4) Production considerations

For production, the current “admin credential token exchange” should be replaced with one of:
- User-scoped OAuth delegation / SSO token exchange to AppGen
- A trusted backend-to-backend auth mechanism with per-user authorization enforcement

And proxy should:
- Enforce request/response size limits
- Redact sensitive headers from logs
- Use structured logs + request IDs

