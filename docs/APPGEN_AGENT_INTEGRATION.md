# AppGen Agent Integration

Multi-turn conversational agent system integrated from `appgen-agent-experimental` (sw_rewrite branch) into the Unified UX Prototype.

## What Was Integrated

### 1. **Function Library (36 Telecom Functions)**
- **Location**: `backend/src/data/functions.jsonl` (39KB)
- **Functions**: 36 telecom functions including:
  - `calculate_rsrp`, `calculate_sinr`, `estimate_throughput`
  - `handover_decision`, `best_server_selection`
  - Signal processing, mobility, optimization functions
- **Format**: JSONL with function metadata (name, signature, description, parameters, imports)

### 2. **Agent Service** (`appgen-agent.service.ts`)
TypeScript port of the Python LangGraph agent with:

#### Agent Actions
- **`search`** - Search function library for relevant telecom functions
- **`create`** - Generate workflow and Python code
- **`ask_user`** - Ask clarifying questions
- **`done`** - Conversation complete

#### Key Methods
```typescript
// Process user message and advance agent state
processMessage(threadId, userMessage) → AgentState

// Search function library
searchFunctions(query, limit) → FunctionSearchResult[]

// Decision-making
makeDecision(state) → AgentAction

// Execute actions
executeSearch(state)
createWorkflow(state)
askUser(state)
```

#### State Management
```typescript
interface AgentState {
  threadId: string;
  messages: Array<{role, content}>;
  workflow: WorkflowSpec | null;
  generatedCode: string | null;
  nextAction: AgentAction | null;
  pendingQuestion: string | null;
  searchResults: FunctionSearchResult[];
}
```

### 3. **API Endpoints** (app.routes.ts)

#### `POST /api/apps/agent/chat`
Multi-turn conversation with state persistence
```json
Request: { "message": "string", "threadId": "string?" }
Response: {
  "threadId": "thread-uuid",
  "messages": [...],
  "workflow": {...},
  "generatedCode": "...",
  "nextAction": "search|create|ask_user|done",
  "searchResults": [...]
}
```

#### `GET /api/apps/agent/state/:threadId`
Get current agent state for a conversation thread

#### `POST /api/apps/agent/search`
Search function library independently
```json
Request: { "query": "calculate signal strength", "limit": 5 }
Response: { "data": [{ name, description, signature, score }] }
```

### 4. **Frontend Integration** (ConversationalAppBuilder.tsx)

#### Updated Message Flow
1. User sends message → `api.agentChat(message, threadId)`
2. Agent processes → decides action (search/create/ask)
3. Frontend receives:
   - Updated conversation history
   - Workflow (when ready)
   - Generated code (when ready)
   - Function search results (if searched)

#### Key Changes
```typescript
// Agent state tracking
const [threadId, setThreadId] = useState<string | undefined>();
const [agentAction, setAgentAction] = useState<string | null>(null);
const [searchResults, setSearchResults] = useState<Array<...>>([]);

// Agent API calls
handleSendMessage() → api.agentChat()
handleInitialIntent() → api.agentChat()
handleBuildApp() → api.agentChat('Build the app now', threadId)
```

### 5. **Code Generation with Function Library**
Generated Python code includes:
- Imports from searched functions
- DataAdapter boilerplate
- Workflow logic based on conversation
- Report/logging structure

```python
from telecom.basic import calculate_rsrp, calculate_sinr
from adaptors.eiap.eiap_adaptor import EIAPAdaptor as DataAdapter

class AutomationApp:
    def __init__(self):
        self.data_adapter = DataAdapter()
        self.report = defaultdict(dict)
    
    def execute(self):
        # Workflow logic based on conversation
        ...
```

## Architecture Comparison

### Before (Simple Chat)
```
User → OpenAI Chat → Response
User clicks "Build" → Generate Workflow + Code separately
```

### After (Agent-based)
```
User → Agent Decision → [Search Functions | Create Workflow | Ask Clarification]
                    ↓
              Auto-generates workflow + code when ready
                    ↓
              Returns workflow, code, search results in single response
```

## How It Works

### 1. **Conversational App Building**
```
User: "Build an app to optimize PRB utilization"
Agent: [Decision: ask_user] "What threshold should trigger optimization?"

User: "When PRB > 80%"
Agent: [Decision: search] Searches function library for "PRB utilization"
       Returns: estimate_throughput, calculate_sinr

User: "Increase qRxLevMin when condition met"
Agent: [Decision: create] Generates:
       - Workflow with nodes (condition → action)
       - Python code using found functions
```

### 2. **Function Library Search**
Keyword-based matching (upgradeable to semantic/embedding search):
- Scores based on keyword matches in name/description
- Returns top N functions with metadata
- Agent can use these in generated code

### 3. **State Persistence**
- Each conversation has unique `threadId`
- State includes messages, workflow, code, search results
- Stored in-memory (Map) - can be upgraded to Redis

### 4. **Automatic Workflow & Code Generation**
When agent decides user has provided enough info:
- Calls OpenAI to generate workflow JSON (nodes + edges)
- Generates Python code template with:
  - Function imports from search results
  - DataAdapter setup
  - Workflow logic
  - Report structure

## Key Features

✅ **Multi-turn conversation** with state management  
✅ **Function library** (36 telecom functions) with search  
✅ **Intelligent decision-making** (when to search, create, or ask)  
✅ **Automatic workflow generation** from conversation  
✅ **Code generation** using function library  
✅ **TypeScript implementation** (no Python runtime needed)  

## Usage Example

### Frontend
```typescript
// Start conversation
const response = await api.agentChat("Build an app to detect handover failures");

// Continue conversation
const response2 = await api.agentChat("Use RSRP threshold of -110 dBm", response.data.threadId);

// Build when ready
const final = await api.agentChat("Build the app now", threadId);
// → Receives workflow + code
```

### Backend
```typescript
// Agent processes message
const state = await AppGenAgentService.processMessage(threadId, userMessage);

// Returns:
// - messages: conversation history
// - workflow: generated workflow (if ready)
// - generatedCode: Python code (if ready)
// - nextAction: what agent will do next
// - searchResults: functions found (if searched)
```

## Files Modified/Created

### Backend
- ✅ `backend/src/data/functions.jsonl` - Function library (copied from experimental)
- ✅ `backend/src/services/appgen-agent.service.ts` - Agent service (new)
- ✅ `backend/src/routes/app.routes.ts` - Added agent endpoints

### Frontend
- ✅ `frontend/src/services/api.ts` - Added agent API methods
- ✅ `frontend/src/components/AppStore/ConversationalAppBuilder.tsx` - Updated to use agent

## Next Steps (Optional Enhancements)

1. **Semantic Search** - Use OpenAI embeddings for function search (better than keyword)
2. **Streaming Responses** - Stream agent actions as they happen (NDJSON)
3. **Redis State** - Persist agent state beyond memory
4. **Agent Status UI** - Show "Agent is searching...", "Agent is creating workflow..."
5. **Function Preview** - Display found functions in UI with descriptions
6. **Multi-agent** - Add detail agent for parameter validation (like experimental repo)
7. **YANG Schema Integration** - Validate generated parameters against YANG schemas

## Testing

### Test Agent Chat
```bash
curl -X POST http://localhost:3000/api/apps/agent/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"message": "Build an app to optimize cell performance"}'
```

### Test Function Search
```bash
curl -X POST http://localhost:3000/api/apps/agent/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"query": "handover", "limit": 3}'
```

## Credits

Based on `appgen-agent-experimental` (sw_rewrite branch):
- Repository: `https://github.com/aira-technology/appgen-agent-experimental.git`
- Branch: `sw_rewrite`
- Architecture: LangGraph agents, function library, YANG schemas
- Adapted to: TypeScript, Node.js, existing unified_ux structure
