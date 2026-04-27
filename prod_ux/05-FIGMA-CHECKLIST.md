# Design Kickoff Checklist: From Flows to Figma

> **Your complete roadmap to go from user flows to production UI design**

---

## Phase 0: Before You Open Figma (This Conversation)

### ✅ Completed:
- [x] Identified 5 user personas & their primary workflows
- [x] Created detailed flow diagrams (Alert Response → Resolution)
- [x] Mapped app interactions (Overview → Observe → Analyze → Automate → Provision)
- [x] Documented Aira as persistent assistant (not main page)
- [x] Planned information architecture (5 main sections + admin)
- [x] Chose design system (shadcn/ui + Tremor)

### Key Insights to Remember:
1. **Chat is a drawer, not a page** - This is the biggest mindset shift from demo
2. **Aira is on every screen** - 360px right sidebar, always accessible
3. **Every screen answers one question** - Don't make screens do too much
4. **Users flow through apps** - Alert → Observe → Analyze → Build → Monitor
5. **Role-based defaults** - NOC sees Overview first, engineer sees Analyze first

---

## Phase 1: Figma Setup (Day 1)

### **Step 1a: Create Figma File Structure**

```
Naavik Design System (Main File)
├── 📄 Page 1: TOKENS
│   ├─ Colors (variables)
│   ├─ Typography (styles)
│   ├─ Spacing (grid)
│   └─ Shadows & radius
│
├── 📄 Page 2: COMPONENTS
│   ├─ Button (primary/secondary/ghost, 3 sizes)
│   ├─ Input, Select, Textarea
│   ├─ Card, Badge, Pill
│   ├─ Table (headers, rows, pagination)
│   ├─ Modal / Dialog
│   ├─ Sheet / Drawer
│   ├─ Tabs
│   ├─ KPI Card (metric + sparkline)
│   ├─ Alert Row
│   ├─ Site Status Pill
│   ├─ Chat Message (user + AI)
│   └─ Network Health Bar
│
├── 📄 Page 3: SCREENS
│   ├─ Overview Dashboard
│   ├─ Observe Map + Panel
│   ├─ Analyze Workspace
│   ├─ Automate Builder
│   ├─ Provision Tracker
│   ├─ Aira Drawer (3 states)
│   └─ Sidebar Navigation
│
└── 📄 Page 4: FLOWS (Reference)
    ├─ Alert Response Flow
    ├─ Deep Diagnosis Flow
    ├─ App Building Flow
    └─ Executive Review Flow
```

### **Step 1b: Create Figma Variables**

Go to **Assets > Variables** and create:

```
Colors:
  ├─ brand/primary → #ED1C24
  ├─ brand/secondary → #4a7ccc
  ├─ bg/base → #faf8f5 (light) / #0d1117 (dark)
  ├─ bg/surface → #f3f1ee (light) / #161b22 (dark)
  ├─ text/primary → #1a1a1a (light) / #e6e6e6 (dark)
  ├─ status/critical → #dc2626
  ├─ status/warning → #f59e0b
  ├─ status/normal → #10b981
  └─ status/info → #3b82f6

Typography:
  ├─ display/32 → Inter 32/40 semibold
  ├─ heading/20 → Inter 20/28 semibold
  ├─ subhead/16 → Inter 16/24 medium
  ├─ body/14 → Inter 14/20 regular
  ├─ caption/12 → Inter 12/16 regular
  └─ mono/13 → JetBrains Mono 13 regular

Spacing:
  ├─ xs → 4px
  ├─ sm → 8px
  ├─ md → 12px
  ├─ lg → 16px
  ├─ xl → 24px
  ├─ xxl → 32px
  └─ xxxl → 48px
```

---

## Phase 2: Component Library (Days 1-2)

### **Tier 1: Foundation Components (Build First)**

Priority order:

#### 1. **Button**
```
States: default, hover, active, disabled
Variants: primary, secondary, ghost, destructive
Sizes: sm (28px), md (36px), lg (44px)
Include: Icon button variant
```

#### 2. **Input & Form**
```
Text Input:
  - label, placeholder, helper text
  - States: default, focused, error, disabled
  - Icon slots (left + right)

Select:
  - Label, placeholder, options list
  - Searchable variant
```

#### 3. **Card**
```
Anatomy: Header | Body | Footer
Variants: Default, Elevated, Outlined
```

#### 4. **Badge**
```
Variants: primary, secondary, danger, warning, info, success
Sizes: sm, md, lg
```

#### 5. **Table**
```
Anatomy: Header row, Data rows, Footer (pagination)
Features: Hover, Sortable headers, Selectable rows, Pagination
```

---

## Phase 3: Design Key Screens (Days 2-4)

### **Screen Priority Order**

```
Day 2-3: OVERVIEW DASHBOARD (Highest ROI - all users see it)
  ↓
Day 3: OBSERVE MAP + SITE PANEL (Most-used screen by NOC + engineers)
  ↓
Day 3-4: AIRA DRAWER (Used on every page)
  ↓
Day 4: SIDEBAR NAVIGATION (Used on every page)
  ↓
Day 4: ANALYZE WORKSPACE (Used by RF engineers 30+ min at a time)
  ↓
(Week 2) Remaining screens: Automate, Provision, etc.
```

---

## Phase 4: Hand-Off to Development (Week 2+)

### **Developer Handoff Checklist**

```
Documentation:
  ✓ Design spec doc (figma file with annotations)
  ✓ Component API (props, states, sizes)
  ✓ Color tokens (export as CSS variables)
  ✓ Typography scale (font families, sizes, weights)
  ✓ Spacing & layout grid (baseline grid info)
  ✓ User flows (reference user-flows-and-personas.md)
  ✓ Screen routes (map Figma screens to React routes)

Code Setup:
  ✓ Install shadcn/ui + Tremor
  ✓ Configure Tailwind config with design tokens
  ✓ Set up React Router with all routes
  ✓ Create component stubs for each Figma component
  ✓ Set up dark mode variables
```

---

## Timeline (Realistic Estimate)

```
Week 1:
  Mon-Tue: Tokens + Component Library (Tier 1 + 2)
  Wed-Thu: Overview Dashboard screen
  Fri: Observe screen + Aira drawer

Week 2:
  Mon-Tue: Sidebar navigation + role-based variants
  Wed: Analyze workspace
  Thu-Fri: Automate + Provision screens

Week 3+:
  Code implementation (developers build what you designed)
  Iteration & refinement (design + code collaborate)
```

---

## Your Next Action

**Open Figma now and:**

1. Create new file: `Naavik Design System`
2. Create 4 pages: TOKENS | COMPONENTS | SCREENS | FLOWS
3. Start on TOKENS page (colors, typography, spacing)
4. Then move to COMPONENTS page (build Button, Input, Card, Table)
5. Then design Overview Dashboard on SCREENS page

You've got this! 🚀
