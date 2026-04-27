# From User Flows to Screen Design

> **How to translate user flows into actual Figma screens**

---

## Screen Inventory (What You Need to Design in Figma)

### **Tier 1: Critical Screens (Week 1-2)**

```
1. OVERVIEW DASHBOARD
   ├─ Main: Network health card + KPI grid (6-up)
   ├─ Right sidebar: Alerts feed (live)
   ├─ Bottom: Top offenders table
   └─ Supports: All 5 user personas (entry point)

2. OBSERVE VIEW (Map)
   ├─ Left: Full Mapbox map
   ├─ Right panel (tabs): Overview | KPI Trends | RCA | Parameters | History
   ├─ Site selection: Click marker or search
   └─ Supports: NOC operators, RF engineers (drill-down)

3. OBSERVE SITE PANEL (Detailed)
   ├─ Header: Site name + severity badge
   ├─ Overview tab: Site info, current KPI values, neighbor list
   ├─ KPI Trends tab: Time-series chart (multi-KPI)
   ├─ RCA tab: Reasoning card (confidence, root cause, evidence)
   ├─ Parameters tab: Current values + recent changes
   └─ Actions: "Build app", "Provision", "Compare sites"

4. AIRA DRAWER (Chat Panel)
   ├─ Chat history (scrollable)
   ├─ Message types: User text, AI text, Action cards
   ├─ Bottom: Input field + attachments
   ├─ Expand button: Full-screen mode
   └─ Floating on all pages

5. SIDEBAR NAVIGATION
   ├─ Logo + org switcher (top)
   ├─ Nav items (5): Overview, Observe, Analyze, Automate, Provision
   ├─ Secondary items (2): Admin, Settings
   ├─ Aira icon (bottom)
   └─ User avatar (bottom)
```

---

## Screen Design Rules (Flow-Driven)

### **Rule 1: Every Screen Answers a Question**

| Screen | Question it Answers |
|--------|-------------------|
| Overview | "What's the health of my network right now?" |
| Observe | "What's wrong with this specific site?" |
| Analyze | "Why is this happening? How do I fix it?" |
| Automate | "How do I build an app to automate this fix?" |
| Provision | "How is the ZTP deployment progressing?" |

### **Rule 2: Every Screen Has ONE Primary Action**

| Screen | Primary Action |
|--------|----------------|
| Overview | Click alert → Go to Observe |
| Observe | See RCA → Ask Aira to build app |
| Analyze | Spot pattern → Build app |
| Automate Builder | Write code → Test → Deploy |
| Provision | Monitor steps → Approve next step |

### **Rule 3: Aira is Always 1 Click Away**

- Every page has Aira drawer on the right (360px)
- Drawer persists across navigation
- Chat can navigate ("Go to site X") or help ("What does this mean?")

### **Rule 4: Each User Role Sees Different Defaults**

```
NOC Operator logs in:
  Default route: /overview
  Sidebar shows: Overview, Observe, Provision, Aira
  Context: Alert-focused, quick action

RF Engineer logs in:
  Default route: /analyze
  Sidebar shows: All items
  Context: Deep technical work

Manager logs in:
  Default route: /overview
  Sidebar shows: Overview, Observe, Automate
  Context: Health + team productivity

Director logs in:
  Default route: /overview (simplified)
  Sidebar shows: Overview only
  Context: 10,000 ft view
```

---

## Data Density by User & Screen

```
Director:
  Overview dashboard = LOW density
  (Score card + 3 KPI cards + alerts feed)

Manager:
  Overview dashboard = MEDIUM density
  (Score + 6 KPI cards + alerts + offenders table)

NOC Operator:
  Observe site panel = MEDIUM density
  (Tabs keep info organized but accessible)

RF Engineer:
  Analyze workspace = HIGH density
  (4-pane layout, multi-KPI overlays, RCA details)

App Developer:
  Automate builder = MEDIUM-HIGH density
  (Code + flowchart + test results all visible)
```

---

## Summary: Flow → Design Checklist

- [ ] **Overview:** All roles can see network health in <10 seconds
- [ ] **Observe:** Drill-down is 1-click from alert
- [ ] **Analyze:** Multi-site comparison requires <3 clicks
- [ ] **Automate:** Building an app is smooth: chat/visual → code → test → deploy
- [ ] **Aira:** Accessible from every page, can navigate users to specific screens
- [ ] **Provision:** Progress is visible, ZTP is trackable
- [ ] **Sidebar:** Role-based nav reduces cognitive load
- [ ] **Consistency:** All screens use same button, card, table components

**Next step:** Open Figma and start designing these screens in order of priority (Overview → Observe → Analyze → Automate → Provision).
