# Agent Debug Guide

## Quick Health Check

```bash
# Test if agent service is working (no auth required)
curl http://localhost:3000/api/apps/agent/health

# Should return:
# - functionLibraryLoaded: true
# - functionsFound: 2
# - sampleFunctions: ["calculate_rsrp", "calculate_sinr"]
# - openaiConfigured: true
```

## Common Issues & Fixes

### 1. "doesn't look like it's working"

**Check browser console (F12 → Console):**
- Any red errors?
- Network tab → filter "agent" → see request/response

**Expected behavior:**
1. Type message in AppGen chat
2. See loading indicator
3. Get agent response
4. If you say "build", workflow appears on right

### 2. No response from agent

**Backend logs:**
```bash
cd backend && npm run dev
# Look for:
# - "processMessage called"
# - "Agent decision: <action>"
# - "createWorkflow: Starting"
```

**Frontend console:**
```javascript
// Should see:
// - "Sending agent message..."
// - Response with threadId, messages, workflow
```

### 3. Workflow not appearing

**Check:**
- Did agent decide to "create"?
- Look for `workflow` and `generatedCode` in API response
- Frontend should call `updateContext` with workflow

### 4. OpenAI errors

**If you see "401" or "API key" errors:**
```bash
# Check backend/.env has:
OPENAI_API_KEY=sk-proj-...   # Not "dummy-key"

# Restart backend after changing:
cd backend && npm run dev
```

## Test Flow

### 1. Test Agent Chat (with auth token)

Get auth token first:
```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Save the token, then:
TOKEN="your-token-here"

# Test agent chat
curl -X POST http://localhost:3000/api/apps/agent/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"Build an app to optimize PRB"}'
```

### 2. Check Response Structure

```json
{
  "success": true,
  "data": {
    "threadId": "thread-uuid",
    "messages": [
      { "role": "user", "content": "..." },
      { "role": "assistant", "content": "..." }
    ],
    "workflow": null,          // null until agent creates it
    "generatedCode": null,     // null until agent creates it
    "nextAction": "ask_user",  // or "search", "create", "done"
    "searchResults": []
  }
}
```

### 3. Frontend Debugging

**Add to ConversationalAppBuilder:**
```typescript
// In handleSendMessage, after api.agentChat():
console.log('Agent response:', response);
console.log('ThreadId:', response.data?.threadId);
console.log('Next action:', response.data?.nextAction);
console.log('Has workflow:', !!response.data?.workflow);
console.log('Has code:', !!response.data?.generatedCode);
```

## Expected Conversation Flow

```
User: "Build an app to optimize PRB"
Agent (action: ask_user): "What threshold should trigger optimization?"

User: "When PRB > 80%"
Agent (action: search): [Searches for "PRB"]
Agent: "Found estimate_throughput. What action to take?"

User: "Increase qRxLevMin"
Agent (action: create): [Generates workflow + code]
Agent: "Created workflow with 3 steps. Code generated!"
→ Workflow appears on right
→ Code appears in Code tab
```

## Logs to Watch

### Backend (`backend/` terminal)
```
processMessage called { threadId: '...', messageLength: 25 }
Agent makeDecision { messageCount: 2, lastUserMessage: '...' }
Agent decision: ask_user { threadId: '...' }
```

### Frontend (Browser Console)
```
Sending agent message...
Agent response: { success: true, data: {...} }
Updated context with workflow
```

## Still Not Working?

1. **Check backend is running:** `curl http://localhost:3000/api/apps/agent/health`
2. **Check frontend is running:** Open http://localhost:5173 (or your port)
3. **Check you're logged in:** Token in localStorage
4. **Check browser console:** Any errors?
5. **Check backend logs:** Any exceptions?

## Quick Test in Browser Console

```javascript
// Paste in browser console (when on app):
api.agentChat("Test message")
  .then(r => console.log('SUCCESS:', r))
  .catch(e => console.error('ERROR:', e));
```
