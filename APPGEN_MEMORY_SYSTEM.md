# AppGen Memory System - Implementation Guide

## Overview

The new **AppGen Memory System** enables reliable conversations with the chatbot to build network automation apps incrementally. It provides:

1. **Short-Term Memory**: Retains conversation context across multiple exchanges
2. **Context Derivation**: Automatically extracts key entities (KPIs, parameters, thresholds, actions)
3. **Progressive App Building**: Helps users build apps on-the-go with clear progress indicators

## Architecture

### Services

#### 1. `ConversationMemoryService`
Manages short-term memory and context derivation.

**Key Features:**
- Extracts entities from conversation text:
  - KPIs (PRB, Data Drop Rate, Throughput, etc.)
  - Parameters (qRxLevMin, servCellConfig, etc.)
  - Thresholds and operators (> 80, < 5%, etc.)
  - Actions (parameter change, ticket escalation, etc.)
  - Conditions (AND/OR logic)
  - Scope (site, sector, cell, network)
  - Technology context (5G, 4G, LTE, etc.)

- Builds workflow drafts from extracted entities
- Tracks conversation phases (intake → clarification → refinement → ready_to_build)
- Calculates confidence scores

**API Endpoint:**
```
GET /api/appgen/v1/context/:threadId
```

**Response Example:**
```json
{
  "threadId": "uuid",
  "phase": "clarification",
  "messageCount": 5,
  "extractedEntities": {
    "kpis": [
      { "name": "PRB", "operator": "GT", "threshold": 80, "confidence": 0.9 }
    ],
    "parameters": [
      { "name": "qRxLevMin", "confidence": 0.85 }
    ],
    "thresholds": [...],
    "actions": [...],
    "scope": { "type": "site", "confidence": 0.75 },
    "technology": "5G"
  },
  "workflowDraft": {
    "condition": {...},
    "actions": [...],
    "completeness": 60,
    "gaps": ["Target parameter value"]
  },
  "confidenceScore": 0.72,
  "summary": "**Problem**: Improve network coverage\n**KPIs**: PRB\n**Parameters**: qRxLevMin\n**Needs**: Target parameter value"
}
```

#### 2. `ProgressiveAppGenService`
Provides progressive app building with suggestions and guidance.

**Key Features:**
- Gets real-time app build state with progress (0-100%)
- Generates contextual suggestions (clarify, suggest, refine, next_step)
- Builds workflow preview
- Provides help text for each slot
- Validates workflow completeness

**API Endpoints:**

```
GET /api/appgen/v1/app-state/:threadId
```
Returns current app build progress, completed steps, next steps, and preview.

```
GET /api/appgen/v1/suggestions/:threadId?slotType=kpi
```
Returns context-aware suggestions. Optionally filter by slot type.

```
GET /api/appgen/v1/help/:slotType
```
Returns help text for a specific field (kpi, parameter, threshold, etc.).

```
GET /api/appgen/v1/validate/:threadId
```
Validates workflow and returns errors/warnings.

## Usage Flow

### 1. Start a Conversation
```bash
POST /api/appgen/v1/chat
{
  "message": "I want to improve coverage by adjusting qRxLevMin when PRB exceeds 80%",
  "channel": "appgen_chat"
}
```

### 2. Check Memory & Context
```bash
GET /api/appgen/v1/context/{threadId}
```
This returns extracted entities, conversation phase, and workflow draft.

### 3. Get Real-Time App State
```bash
GET /api/appgen/v1/app-state/{threadId}
```
Returns:
- Progress percentage
- Completed steps
- Next recommended step
- Smart suggestions
- Workflow preview

### 4. Get Context-Aware Suggestions
```bash
GET /api/appgen/v1/suggestions/{threadId}
```
Returns prioritized suggestions (high → medium → low) to move toward app build.

### 5. Get Help Text
```bash
GET /api/appgen/v1/help/kpi
```
Provides contextual help for any field.

### 6. Validate & Build
```bash
GET /api/appgen/v1/validate/{threadId}
```
Check if workflow is ready to build. If valid, call:

```bash
POST /api/appgen/v1/generate
{
  "threadId": "...",
  "authorizationToken": "..."
}
```

## Conversation Phases

The system automatically tracks conversation progress:

### 1. **Intake** (0-2 messages)
- User describes problem
- System extracts initial entities
- **Suggestion**: "Define the KPI to Monitor"

### 2. **Clarification** (3-4 messages)
- System asks clarifying questions
- User provides KPIs, parameters, thresholds
- **Suggestion**: "Set the Threshold Value"

### 3. **Refinement** (5+ messages)
- User refines logic (AND/OR conditions)
- Defines scope (sites, cells, etc.)
- **Suggestion**: "Refine Logic" or "Define Scope"

### 4. **Ready to Build**
- All required fields filled
- Confidence score > 0.7
- **Suggestion**: "Review and authorize build"

### 5. **Completed**
- Workflow generated and packaged
- New workflows can be built

## Entity Extraction Examples

The system automatically recognizes:

### KPIs
- "PRB" / "packet request buffer" → PRB
- "data drop rate" / "DDR" → DATA_DROP_RATE
- "throughput" / "THPT" → THPT
- "data accessibility" / "DAR" → DATA_ACC_RATE
- "availability" / "avail" → NS_ESO_AVAIL
- "voice call drop" / "VCDR" → VCDR
- "VoLTE" / "call" → VOLTE_ANS_TCALLS

### Parameters
- "qRxLevMin" → qRxLevMin
- "serving cell" / "servCellConfig" → servCellConfig
- "reference signal" → RS_EPRE
- "circuit switch" → CSFB

### Thresholds
- "exceeds 80" / "PRB > 80" → {type: 'kpi', value: 80, operator: 'GT'}
- "below 5%" / "drop rate < 5" → {type: 'kpi', value: 5, operator: 'LT'}

### Actions
- "increase qRxLevMin" → {type: 'parameter_change', target: 'qRxLevMin'}
- "escalate" / "create ticket" → {type: 'ticket_escalation'}
- "notify" / "alert" → {type: 'notification'}

### Scope
- "all sites" / "network" → {type: 'network'}
- "specific cells" / "sectors" → {type: 'sector'}
- "this site" / "location" → {type: 'site'}

## Workflow Draft Structure

As conversation progresses, the workflow draft auto-populates:

```json
{
  "version": 1,
  "condition": {
    "join": "AND",
    "kpis": [
      { "name": "PRB", "operator": "GT", "threshold": 80 }
    ]
  },
  "actions": [
    {
      "type": "parameter_change",
      "target": "qRxLevMin",
      "value": "-135",
      "scope": { "type": "site" }
    }
  ],
  "completeness": 85,
  "gaps": ["Confirm scope filter"]
}
```

## Frontend Integration Example

### React Component Example
```typescript
import { useEffect, useState } from 'react';

export function AppGenBuilder({ threadId }: { threadId: string }) {
  const [appState, setAppState] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [context, setContext] = useState(null);

  useEffect(() => {
    // Get real-time app state
    fetch(`/api/appgen/v1/app-state/${threadId}`)
      .then(r => r.json())
      .then(data => setAppState(data.data));

    // Get suggestions
    fetch(`/api/appgen/v1/suggestions/${threadId}`)
      .then(r => r.json())
      .then(data => setSuggestions(data.data));

    // Get context
    fetch(`/api/appgen/v1/context/${threadId}`)
      .then(r => r.json())
      .then(data => setContext(data.data));
  }, [threadId]);

  return (
    <div>
      {/* Progress Bar */}
      <div>Progress: {appState?.progress}%</div>

      {/* Completed Steps */}
      <div>
        <h3>Completed Steps</h3>
        {appState?.completedSteps.map(step => <span key={step}>{step}</span>)}
      </div>

      {/* Next Step */}
      <div>
        <h3>Next Step</h3>
        <p>{appState?.nextStep}</p>
      </div>

      {/* Smart Suggestions */}
      <div>
        <h3>Suggestions</h3>
        {suggestions.map(suggestion => (
          <div key={suggestion.id} className={`priority-${suggestion.priority}`}>
            <h4>{suggestion.title}</h4>
            <p>{suggestion.description}</p>
            {suggestion.suggestedValue && (
              <p>Suggested: {suggestion.suggestedValue}</p>
            )}
          </div>
        ))}
      </div>

      {/* Workflow Preview */}
      {appState?.previewWorkflow && (
        <div>
          <h3>Workflow Preview</h3>
          <pre>{JSON.stringify(appState.previewWorkflow, null, 2)}</pre>
        </div>
      )}

      {/* Build Button */}
      {appState?.readyToBuild && (
        <button onClick={() => authorizeAndBuild()}>
          Authorize Build
        </button>
      )}
    </div>
  );
}
```

## Database Schema

New columns added to `conversation_sessions`:
- `user_id` (VARCHAR): Track user who created the session
- `conversation_phase` (VARCHAR): Current phase (intake, clarification, etc.)
- `conversation_summary` (TEXT): AI-generated summary of conversation

New column added to `conversation_messages`:
- `is_archived` (BOOLEAN): Archive old messages to keep context fresh

## Error Handling

The system gracefully handles:
- Missing or incomplete entities
- Ambiguous KPI/parameter names
- Network errors during extraction
- Conversation interruptions

All errors are logged with context for debugging.

## Configuration

### Entity Recognition Confidence Thresholds
- KPI extraction: 0.9 confidence
- Parameter extraction: 0.85 confidence
- Threshold extraction: 0.75 confidence
- Scope extraction: 0.75 confidence

Adjust these in `ConversationMemoryService.extractEntitiesFromMessages()` if needed.

### Phase Transition Conditions
- Intake → Clarification: KPI or parameters mentioned
- Clarification → Refinement: Thresholds defined + 4+ messages
- Refinement → Ready: All gaps filled
- Ready → Completed: Workflow generated

Customize in `determinePhase()` method.

## Performance Considerations

1. **Memory Building**: ~100-200ms per context build
2. **Suggestion Generation**: ~50-100ms
3. **Entity Extraction**: ~30-50ms
4. **Caching**: Context is cached per request, rebuilt only when needed

For conversations > 50 messages, consider archiving old messages using `ConversationSessionModel.archiveMessagesUpTo()`.

## Future Enhancements

1. **Multi-turn refinement**: Allow users to refine specific aspects
2. **Similar apps**: Suggest existing apps based on context
3. **Confidence feedback**: Let users rate confidence of extracted entities
4. **Undo/Redo**: Track conversation branches
5. **Templates**: Pre-filled workflows based on similar past apps
