# User Flows & Personas: Aira Platform

> **Goal:** Map what each user type does, what apps they use, and how they interact. Then design UX around these real workflows.

---

## Part 1: User Personas

### 1. **NOC Operator** (Network Operations Center)
**Goal:** Keep the network up 24/7. Detect issues fast. Execute quick fixes.

**Day in the life:**
- 6am: Arrives at NOC, opens Aira. "Good morning, what broke overnight?"
- Sees alerts feed + network health score
- 6:15am: Site UST2938 is in CRITICAL (data drop 8%), calls RF engineer
- 6:30am: Provisioning team deploys a new site → NOC tracks progress in Provision view
- Throughout day: Monitors alerts, acknowledges/dismisses them, escalates to engineers

**Primary Apps Used:**
- Overview (entry point)
- Observe (quick drill-down to failing site)
- Aira Chat (contextual questions)
- Provision (track ZTP)

**Decision Trees:**
- Is it an alert? → Observe + RCA → Escalate to engineer OR Run auto-fix
- Is there a change happening? → Provision view for visibility
- Need more context? → Ask Aira

---

### 2. **RF/RAN Engineer**
**Goal:** Diagnose problems. Optimize parameters. Build automation.

**Day in the life:**
- 8am: "Sites in northern cluster are degraded. Give me details." → Opens Analyze
- 8:15am: Compares 3 sites in detail: KPI trends, RCA reasoning, parameter snapshots
- 9am: "I see the problem is high PRB utilization. Build me an app to auto-trigger on this." → Launches Automate
- 9:30am: Tests app in flow editor, deploys it
- 10am: Monitors impact in Observe view on a map

**Primary Apps Used:**
- Analyze (deep RCA work - PRIMARY)
- Observe (map context)
- Automate (build apps)
- Aira Chat (technical questions)

**Decision Trees:**
- Multi-site comparison → Analyze
- Need a quick fix? → Ask Aira to build an app → Automate
- Is it working? → Back to Observe/Analyze to verify

---

### 3. **App Developer** (Internal platform team)
**Goal:** Build reusable rApps for operators. Library management.

**Day in the life:**
- 10am: Opens Automate → App Library
- Sees 47 existing apps, reviews requests from engineers
- 11am: "Build an app that detects VoLTE call failures and retries on secondary band"
- 12pm: Uses Conversational Builder (chat-based AppGen) or Visual Builder (flowchart)
- 1pm: Tests app in Flow Test view with synthetic data
- 2pm: Deploys to catalog, enables for NOC

**Primary Apps Used:**
- Automate (primary - AppGen, Library, Testing)
- Analyze (understand domain problems)
- Aira Chat (code generation help)

**Decision Trees:**
- New app request → Conversational Builder OR Visual Builder
- Need domain context? → Ask Aira + Analyze view
- Ready to deploy? → Version history + test results

---

### 4. **Network Manager** (Team lead / Supervisor)
**Goal:** Oversight. Health reporting. Resource allocation.

**Day in the life:**
- 9am: Opens Overview dashboard
- Sees network health is 87/100, 12 active alerts
- Reviews KPI trends (PDCP, drop rate, VoLTE answer) to understand business impact
- 10am: Checks which sites are problematic, routes to right team
- 11am: Reviews app deployments from his team this week
- 2pm: Prepares for leadership meeting - exports Overview snapshot

**Primary Apps Used:**
- Overview (primary - entry, status, KPIs)
- Observe (selective drill-down)
- Automate (see deployed apps from team)
- Aira Chat (high-level summaries)

**Decision Trees:**
- "What's the network status?" → Overview
- Need to dig into one issue? → Observe
- Curious about apps we've deployed? → Automate/App Library

---

### 5. **Director / VP** (Executive / C-level)
**Goal:** Health scorecard. Business impact. Capacity planning.

**Day in the life:**
- 8am: Opens Overview
- Sees network health metric, top problems
- Asks Aira: "What's the business impact of today's issues?"
- Aira summarizes: "2 sites affecting 5,000 subscribers, PRB congestion in metro clusters"
- 9am: Needs to report to leadership - asks Aira for a summary
- "Generate a network health report for the board"

**Primary Apps Used:**
- Overview (primary - simplified view)
- Aira Chat (conversational summaries)
- (Rarely uses other apps)

**Decision Trees:**
- "What's the state of the network?" → Overview (simplified)
- Need context or business impact? → Ask Aira

---

## Part 2: App Interaction Map

### High-Level App Relationships

```
                    ┌─────────────────────┐
                    │   AIRA CHAT DRAWER  │  ← Floating sidebar on ALL pages
                    └─────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
      Navigation          Context Questions   Action Triggers
      "Take me to         "What's wrong         "Build an app
       site X"             here?"              for this"
           │                  │                  │
           ▼                  ▼                  ▼
      ┌─────────────┐ ┌─────────────┐  ┌──────────────┐
      │  OVERVIEW   │ │  OBSERVE    │  │  ANALYZE     │
      │  Dashboard  │ │  Map + RCA  │  │  Deep RCA    │
      └─────────────┘ └─────────────┘  └──────────────┘
           ▲                  ▲                  ▲
           │                  │                  │
           └──────────────────┼──────────────────┘
                      Alerts & Status
                         Feed Into


      ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
      │  AUTOMATE    │  │ PROVISION    │  │   ADMIN      │
      │  AppGen      │  │ ZTP Tracker  │  │  Settings    │
      │  Library     │  │              │  │              │
      └──────────────┘  └──────────────┘  └──────────────┘
           ▲                  ▲
           │                  │
           └──────────────────┴──────────────────┘
              Part of Main Navigation Sidebar
```

---

## Part 3: User Journey Maps (Detailed Flows)

*[Detailed flows follow - see full document for complete user journeys]*

---

## Part 5: User Flow Summary Table

| Persona | Primary Flow | Time | Apps Used | Aira Role |
|---------|--------------|------|-----------|-----------|
| NOC Operator | Alert → Observe → Act | 5-15m | Overview, Observe, Aira | Navigator + Context |
| RF Engineer | Problem → Analyze → Build App | 30-90m | Analyze, Observe, Automate, Aira | Tech assistant |
| App Dev | Request → Conversational Builder → Deploy | 1-4h | Automate, Analyze, Aira | Code generator |
| Manager | Check health → Review alerts → Report | 10-30m | Overview, Observe, Aira | Summarizer |
| Director | Check score → Ask impact → Export | 5-15m | Overview, Aira | Executive briefer |

---

## Part 6: What This Tells Us About UX Design

### **Design Implications:**

1. **Overview is the Default Homepage**
   - No matter the role, users land here first
   - Must be scannable in <10 seconds
   - Show health score, active alerts, top offenders

2. **Observe is the "Action Center"**
   - 80% of daily work happens here
   - Map + detailed panel = powerful combo
   - Must support deep drill-down (KPI trends, RCA, params, history)

3. **Analyze is for Deep Thinking**
   - RF engineers spend 30-90 min here when troubleshooting
   - Needs multi-site comparison, time controls, reasoning clarity
   - High data density OK here

4. **Automate is for Creation**
   - Two pathways: Conversational (chat) + Visual (flowchart)
   - Code generation is the star - make it visible & streaming
   - Testing & deployment must be frictionless

5. **Aira Drawer is Pervasive, Not Dominant**
   - It's on EVERY page, but not the page itself
   - Acts as: navigator ("go to site X"), contextual helper ("why is this happening?"), action trigger ("build an app")
   - Width: 360px default, can expand to full-screen
   - Should never block the main app UI

6. **Deep Linking is Critical**
   - Users need: `/observe/UST2938` (jump to specific site)
   - Users need: `/analyze/PDCP_THROUGHPUT` (jump to KPI analysis)
   - Aira chats should generate shareable links

---

## Summary: The Story

**The Journey:**
1. **Observe** is how you see the problem (map, alerts, trends)
2. **Analyze** is how you understand it (RCA, comparisons, reasoning)
3. **Automate** is how you fix it (build & deploy apps)
4. **Provision** is how you scale it (ZTP pipeline)
5. **Aira** is your guide through all of it

Each app is self-contained but connected. Users don't jump around randomly - they flow through this journey in response to what the network is telling them.
