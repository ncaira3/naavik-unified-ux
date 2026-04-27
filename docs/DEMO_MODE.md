# Demo Mode - Guided Conversations

The AppGen conversational builder includes **Demo Mode** - guided conversations where you type through a scripted flow to build telecom automation apps.

## Features

- **5 Pre-scripted Scenarios** covering common telecom use cases
- **Type or Click** - Type your messages or click suggested replies
- **Real Conversation Flow** - You drive the conversation, AI responds from the script
- **Live Code Generation** - Python code appears on the right when the conversation completes

## Available Scenarios

### 1. PRB Utilization Optimizer 📊
**Problem**: Cells getting overloaded with high PRB utilization  
**Solution**: Automatically adjust qRxLevMin to shrink cell coverage when PRB > 90%  
**Technology**: 4G (EUtranCell)

### 2. Handover Failure Reducer 📶
**Problem**: Users experiencing dropped calls during handovers  
**Solution**: Decrease a3Offset to trigger handovers earlier when failure rate > 5%  
**Technology**: 4G (EUtranCell)

### 3. RRC Connection Success Improver 🔗
**Problem**: High RRC connection failures preventing users from connecting  
**Solution**: Increase maxHARQTx retransmissions when failure rate > 3%  
**Technology**: Both 4G and 5G

### 4. Data Drop Rate Mitigator 📉
**Problem**: High packet drop rates hurting user experience  
**Solution**: Optimize scheduling when drops > 2% AND buffer > 80%  
**Technology**: 4G (EUtranCell)

### 5. 5G Capacity Booster 🚀
**Problem**: Underutilized 5G cells not maximizing throughput  
**Solution**: Enable carrier aggregation (maxNumScells=4) when PRB < 60%  
**Technology**: 5G (NRCellDU)

## How to Use

1. **Open AppGen** in the Unified UX Prototype
2. **Click the demo icon** (✨) in the chat header
3. **Select a scenario** from the dropdown
4. **Type or click** each suggested message to advance the conversation
5. **See the code generate** on the right when the conversation completes

## Demo Flow

```
Pick scenario → See first suggestion ("Try saying: ...")
→ Type your message or click suggestion (or click Send to use suggestion)
→ Assistant responds from script
→ Next suggestion appears
→ Repeat until conversation complete
→ Code and workflow appear on right panel
```

## Technical Implementation

### Backend

**`demo-conversations.ts`** - Defines scenarios with:
- Conversation array (role, content, delay)
- finalWorkflow object (nodes, edges, metadata)
- Use case metadata (name, description, icon)

**API Endpoints**:
- `GET /api/apps/demo/scenarios` - List all scenarios
- `GET /api/apps/demo/:scenarioId` - Get specific scenario details

### Frontend

**`ConversationalAppBuilder.tsx`** enhancements:
- `playDemoScenario()` - Orchestrates playback with delays
- `generateCodeFromDemoWorkflow()` - Converts workflow to Python code
- Scenario picker dropdown UI
- Message timing and loading states

### Code Generation

Each scenario's `finalWorkflow` is converted to Python code with:
- Data adapter initialization
- CM Handle ID fetching
- KPI monitoring logic
- Conditional parameter updates
- Report generation and logging

## Interaction

- **Type** - Enter your own message or type the suggested text
- **Click suggestion** - Fills the input; edit if desired, then send
- **Click Send on suggestion** - Sends the suggested message immediately
- **Assistant response** - Brief 400ms delay for natural feel

## Example Workflow Structure

```json
{
  "name": "PRBUtilizationOptimizer",
  "description": "Reduces congestion by adjusting cell coverage when PRB > 90%",
  "nodes": [
    { "id": "start", "type": "start", "label": "Start" },
    { "id": "n1", "type": "action", "label": "Get all 4G cells" },
    { "id": "n2", "type": "condition", "label": "PRB > 90%?" },
    { "id": "n3", "type": "action", "label": "Increase qRxLevMin by 2 dB" },
    { "id": "end", "type": "end", "label": "End" }
  ],
  "edges": [
    { "from": "start", "to": "n1" },
    { "from": "n1", "to": "n2" },
    { "from": "n2", "to": "n3", "label": "yes" },
    { "from": "n3", "to": "end" }
  ]
}
```

## Adding New Scenarios

To add a new demo scenario:

1. Edit `backend/src/services/demo-conversations.ts`
2. Add a new object to `DEMO_SCENARIOS` array:

```typescript
{
  id: 'my-scenario',
  name: 'Scenario Name',
  description: 'What it does',
  icon: '🎯',
  conversation: [
    { role: 'user', content: 'User message' },
    { role: 'assistant', content: 'AI response', delay: 900 }
  ],
  finalWorkflow: {
    name: 'AppName',
    description: 'What the app does',
    nodes: [...],
    edges: [...]
  }
}
```

3. Restart backend
4. Scenario appears in dropdown automatically

## Benefits for Demos

✅ **No OpenAI Dependency** - Works offline, no API calls  
✅ **You Drive the Flow** - Type through the conversation yourself  
✅ **Guided** - Suggested messages keep you on track  
✅ **Professional** - Showcases complete use cases with real code  
✅ **Flexible** - Type your own words or click to send suggestions  

## Notes

- Demo mode does **not** use the agent service or OpenAI
- You **type** (or click) through the scripted flow; assistant responses are pre-written
- Generated code is **functional** and follows telecom patterns
- Workflows are **ready to deploy** in AppGen executor

---

**Perfect for**: Trade shows, customer demos, internal presentations, testing without OpenAI costs
