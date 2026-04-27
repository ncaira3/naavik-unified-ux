# AppGen Memory System - Quick Start Guide

## ✅ What Was Fixed

1. **Database Schema Issue** - Added missing `user_id`, `conversation_phase`, `conversation_summary` columns
2. **Short-Term Memory** - Conversation context now persists across messages
3. **Entity Extraction** - Automatically detects KPIs, parameters, thresholds, actions, scope
4. **Progressive Building** - App builds incrementally with clear progress indicators
5. **Smart Suggestions** - Context-aware next steps and refinement options

## 🚀 Testing the System

### 1. Start a Chat
```bash
curl -X POST http://localhost:3001/api/appgen/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I want to improve coverage by adjusting qRxLevMin when PRB exceeds 80 percent",
    "channel": "appgen_chat"
  }'
```

Save the `threadId` from the response.

### 2. Check Memory & Context
```bash
curl http://localhost:3001/api/appgen/v1/context/{threadId}
```

This shows:
- Extracted entities (KPIs, parameters, thresholds, etc.)
- Current conversation phase
- Workflow draft
- Confidence score

### 3. Get Real-Time Progress
```bash
curl http://localhost:3001/api/appgen/v1/app-state/{threadId}
```

Returns:
- Progress percentage (0-100%)
- Completed steps
- Next recommended step
- Smart suggestions
- Preview of final workflow

### 4. Get Suggestions
```bash
curl http://localhost:3001/api/appgen/v1/suggestions/{threadId}
```

Returns prioritized suggestions (high → medium → low):
- **High**: Required clarifications (KPI, threshold, parameters)
- **Medium**: Refinements (scope, logic conditions)
- **Low**: Optional enhancements

### 5. Continue Conversation
```bash
curl -X POST http://localhost:3001/api/appgen/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "{threadId}",
    "message": "Apply to all sites in the network",
    "channel": "appgen_chat"
  }'
```

After each message:
- Memory is automatically updated
- Progress bar advances
- Suggestions adapt to new information

### 6. Build When Ready
```bash
# Validate workflow
curl http://localhost:3001/api/appgen/v1/validate/{threadId}

# Generate if valid
curl -X POST http://localhost:3001/api/appgen/v1/generate \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "{threadId}",
    "authorizationToken": "{token from chat response}"
  }'
```

## 📊 What the System Extracts

### Automatically Recognized Entities

**KPIs:**
- PRB, Data Drop Rate, Throughput, Data Accessibility, NS ESO Avail, PDCP MB, Poor Quality Rate, Voice Call Drop, VoLTE, vRAN

**Parameters:**
- qRxLevMin, servCellConfig, RS_EPRE, CSFB, RAU

**Operators:**
- ">" (GT), "<" (LT), ">=" (GTE), "<=" (LTE), "=" (EQ)

**Scope Types:**
- Site, Sector, Cell, Network

**Technologies:**
- 5G, 4G, LTE, NR, NSA, SA

## 📈 Conversation Flow

```
Message 1: "I want to improve coverage by adjusting qRxLevMin when PRB exceeds 80"
  ↓
  Phase: INTAKE → CLARIFICATION
  Extracted: KPI (PRB), Parameter (qRxLevMin), Threshold (80)
  Progress: 50%
  Suggestion: ✓ KPI found, ✓ Parameter found, ✗ Need scope

Message 2: "Apply to all sites"
  ↓
  Phase: CLARIFICATION → REFINEMENT
  Extracted: + Scope (network-wide)
  Progress: 75%
  Suggestion: ✓ Ready for review

Message 3: "Authorize build"
  ↓
  Phase: READY_TO_BUILD
  Progress: 100%
  Action: Generate workflow
  ↓
  Success: Workflow created and ready for execution
```

## 💡 Example Conversation

```
User: "Create an app that improves our network coverage"
Bot: [Context: Problem identified]
     Progress: 25%
     Suggestion: Which KPI indicates poor coverage? (PRB, Data Drop Rate, etc.)

User: "PRB is constantly above 80 percent"
Bot: [Context: KPI extracted]
     Progress: 50%
     Suggestion: Should we adjust qRxLevMin to improve coverage?

User: "Yes, decrease it to -135"
Bot: [Context: Parameter + value extracted]
     Progress: 75%
     Suggestion: Apply to all sites or specific ones?

User: "All sites please"
Bot: [Context: Scope extracted]
     Progress: 100%
     Ready to build!
     Workflow preview:
       Condition: PRB > 80%
       Action: Set qRxLevMin = -135
       Scope: All sites
     [Authorize Build button appears]

User: Clicks "Authorize Build"
Bot: Workflow generated successfully!
```

## 🔧 New API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/appgen/v1/context/:threadId` | GET | Get conversation context & extracted entities |
| `/api/appgen/v1/app-state/:threadId` | GET | Get real-time app build progress |
| `/api/appgen/v1/suggestions/:threadId` | GET | Get context-aware suggestions |
| `/api/appgen/v1/suggestions/:threadId?slotType=kpi` | GET | Get suggestions for specific field |
| `/api/appgen/v1/help/:slotType` | GET | Get help text for field |
| `/api/appgen/v1/validate/:threadId` | GET | Validate workflow completeness |

## 📱 Frontend Integration

### Update AppGen Chat Component
```typescript
// After each message, fetch and display app state
const response = await fetch(`/api/appgen/v1/chat`, {
  method: 'POST',
  body: JSON.stringify({ message, channel: 'appgen_chat', threadId })
});

const { data } = await response.json();
const { threadId } = data;

// Get latest state
const appState = await fetch(`/api/appgen/v1/app-state/${threadId}`).then(r => r.json());

// Display:
// - Progress bar: {appState.progress}%
// - Completed steps: {appState.completedSteps}
// - Next step: {appState.nextStep}
// - Suggestions: {appState.suggestions}
// - Ready to build?: {appState.readyToBuild}
```

## 🐛 Troubleshooting

**Issue: Entity not extracted?**
- The system uses keyword matching. Try using standard terminology (PRB instead of "packet buffer", qRxLevMin instead of "Q-value")

**Issue: Progress not advancing?**
- Ensure you're using threadId in subsequent messages
- Progress increases as more entities are extracted

**Issue: "Ready to build" not appearing?**
- Check `/api/appgen/v1/validate/{threadId}` for missing required fields
- Workflow needs at least: KPI condition + at least one action

**Issue: Database error?**
- Migration was applied. Verify with: `\d conversation_sessions` in psql
- Columns should include: `user_id`, `conversation_phase`, `conversation_summary`

## 📝 Configuration

To adjust entity recognition or phase transitions:
1. Edit `backend/src/services/conversation-memory.service.ts`
2. Modify extraction patterns in `extractKPIs()`, `extractParameters()`, etc.
3. Adjust confidence thresholds
4. Rebuild: `npm run build`

## ✨ Key Features

✅ **Automatic Entity Recognition** - Learns what you want to build
✅ **Real-Time Progress** - Know exactly where you are in the build process
✅ **Smart Suggestions** - Get contextual next steps
✅ **Confidence Scoring** - System tells you how confident it is
✅ **Workflow Preview** - See what will be built before authorizing
✅ **Message Archiving** - Old messages archived for better performance
✅ **Phase Tracking** - Conversation automatically advances through phases
✅ **Validation** - Know if workflow is ready before building

---

**Next Steps:**
1. Test with a few different conversation scenarios
2. Adjust entity recognition patterns if needed
3. Update frontend to show progress, suggestions, and preview
4. Monitor conversation_sessions table for phase/summary data
