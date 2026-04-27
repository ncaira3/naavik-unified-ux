# UX Principles: Aira Platform Redesign

> **5 Core Principles Guiding the Design Strategy**

---

## PRINCIPLE #1: ONE QUESTION PER SCREEN

What users ask:

| Screen | Question it Answers |
|--------|-------------------|
| Overview | "What's the health of my network right now?" |
| Observe | "What's wrong with this specific site?" |
| Analyze | "Why is this happening? How do I fix it?" |
| Automate | "How do I build an app to automate this fix?" |
| Provision | "How is the ZTP deployment progressing?" |

💡 **Each screen is focused, not bloated. Users know exactly where to go.**

---

## PRINCIPLE #2: FLOWS GUIDE LAYOUT

User workflows are journeys, not random clicks.

**The Alert Response Flow:**

```
Alert arrives
    ↓
OVERVIEW  (see what broke?)
    ↓
OBSERVE   (where & what's the impact?)
    ↓
ANALYZE   (why is this happening?)
    ↓
AUTOMATE  (build app to fix it)
    ↓
Back to OBSERVE (monitor improvement)
```

💡 **Each screen naturally leads to the next. No dead ends, no confusion.**

---

## PRINCIPLE #3: AIRA IS ALWAYS ACCESSIBLE

Chat is NOT the main UI. It's a persistent assistant on every page.

**Layout:**
```
┌─────────────────────────────┬──────────────────┐
│                             │  AIRA DRAWER     │
│  Main Content Area          │  ┌────────────┐  │
│  (Overview / Observe /      │  │ Chat hist. │  │
│   Analyze / etc)            │  │ Messages   │  │
│                             │  │ Input box  │  │
│  User can ask questions     │  └────────────┘  │
│  while viewing any screen   │                  │
│                             │  360px width     │
└─────────────────────────────┴──────────────────┘
```

**Aira can:**
- Answer contextual questions
- Navigate user to another screen
- Suggest next steps
- Execute actions (build app, run provision)

💡 **AI is woven into the product, not separate.**

---

## PRINCIPLE #4: ROLE-BASED DEFAULTS

Different users have different needs. Meet them where they are.

| User Role | Default Screen | Time Spent |
|-----------|---|---|
| NOC Operator | Overview | 5-15 min/alert |
| RF Engineer | Analyze | 30-90 min |
| App Developer | Automate | 1-4 hours |
| Manager | Overview | 10-30 min |
| Director/VP | Overview | 5-15 min |

**Login as NOC Operator:**
→ OVERVIEW (alerts)

**Login as RF Engineer:**
→ ANALYZE (deep work)

💡 **No one-size-fits-all. Tailored experiences.**

---

## PRINCIPLE #5: DEPTH MATCHES TASK

Information density varies by user & screen.

**DIRECTOR (5 min):**
```
Network Health: 87/100
Active Alerts: 12
Critical Sites: 4
```
LOW DENSITY

**MANAGER (15 min):**
```
Network Health + 6 KPI Cards
Alerts Feed + Top Offenders
```
MEDIUM DENSITY

**RF ENGINEER (90 min):**
```
Multi-site charts, RCA panel,
Parameter comparisons,
Anomaly timeline, evidence
```
HIGH DENSITY

💡 **More time on screen = more data to explore.**

---

## How These Principles Work Together

**User: NOC Operator | Alert Response Workflow**

🚀 **Principle #4 (Role-Based Default)**
→ Opens to OVERVIEW (not Analyze)

🎯 **Principle #1 (One Question)**
→ Overview shows: "What's broken?" in 10 sec

🧭 **Principle #2 (Flows Guide Layout)**
→ Click alert → OBSERVE → Map + RCA panel
→ Natural progression, no confusion

📊 **Principle #5 (Depth Matches Task)**
→ OBSERVE shows medium detail (not overwhelming)

💬 **Principle #3 (Aira Always Accessible)**
→ Sidebar drawer: "Aira, build app to fix this"
→ Aira navigates to AUTOMATE

✅ **Result: Alert to resolution in 5-15 minutes**

---

## Enabling the Principles: Design System

To execute these principles, we need:

✅ **Component Library (shadcn/ui + Tremor)**
- Consistent buttons, inputs, cards
- Data visualization components
- Predictable behavior

✅ **Design Tokens (Colors, Type, Spacing)**
- Status colors (red=critical, green=normal)
- Typography scale (12px to 32px)
- 4px spacing grid

✅ **Layout System**
- Sidebar (64px or 240px)
- Aira drawer (360px or full-screen)
- Responsive grid

✅ **Navigation Architecture**
- React Router (proper URLs, deep links)
- Sidebar nav (5 main sections)
- Role-based route guards

💡 **System enables consistency & scalability.**

---

## Transformation: Demo → Production

| CURRENT (Demo) | → | TARGET (Production) |
|---|---|---|
| Chat = Main UI | → | Chat = Assistant |
| State switching | → | Real routing (URLs) |
| One-off components | → | Component library |
| No design system | → | Design tokens + system |
| All screens same | → | Role-based defaults |
| Everything visible | → | Contextual info density |
| Hard to navigate | → | Clear workflows |
| No deep links | → | Shareable URLs |
| 10-min demo | → | Daily production tool |

**Result:**
- Operators use Aira 8 hours/day
- Engineers trust it for critical decisions
- Managers get 5-min executive briefings

---

## Key Takeaways

✓ **UI is guided by real user workflows, not arbitrary layouts**

✓ **Chat (Aira) is a feature, not the product**
It lives on every screen as an assistant

✓ **Every screen answers ONE question**
Users always know where to go next

✓ **Different users get different defaults**
NOC sees alerts, Engineers see diagnostics

✓ **Design system enables consistency & scale**
Components + tokens = maintainable code

**Result: From "I'm confused" → "It's obvious"**
