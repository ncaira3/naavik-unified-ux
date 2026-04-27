# Production UX Design Documentation

> Complete design strategy for Aira Platform production-grade UI redesign

---

## 📚 Files in This Folder

### **01-STRATEGIC-PLAN.md**
Comprehensive strategic plan covering:
- Information architecture (5 main sections + admin)
- Design system choice (shadcn/ui + Tremor)
- Figma workflow steps
- React Router navigation architecture
- Role-based view configuration
- Code architecture changes

**Start here if:** You want the full strategic overview

---

### **02-USER-FLOWS-PERSONAS.md**
Detailed user personas and workflows:
- 5 user personas with day-in-the-life scenarios
- Primary apps used per persona
- Decision trees for each user
- App interaction maps
- User journey summaries
- Design implications

**Start here if:** You want to understand who uses what and why

---

### **03-FLOW-DIAGRAMS.md**
Visual block diagrams (Mermaid format):
- 5 personas & their workflows
- Alert response flow (NOC operator)
- Apps & connections diagram
- Decision tree (what app to use)
- Color legend

**Start here if:** You want quick visual references
**Use in:** Figma (install Mermaid plugin), Notion, GitHub, or Markdown viewer

---

### **04-FLOWS-TO-SCREENS.md**
Translation from flows to screen design:
- Complete screen inventory (15 screens)
- Screen design rules (4 core rules)
- Data density guidelines by user
- Role-based view configuration
- Checklist for validation

**Start here if:** You're designing screens and need guidance on what each should show

---

### **05-FIGMA-CHECKLIST.md**
Step-by-step Figma setup guide:
- Phase 1: Figma file structure
- Phase 2: Component library build order
- Phase 3: Screen design priority
- Phase 4: Developer handoff checklist
- Timeline & realistic estimates

**Start here if:** You're opening Figma and need a concrete roadmap

---

### **06-UX-PRINCIPLES.md**
The 5 core UX principles:
1. One Question Per Screen
2. Flows Guide Layout
3. Aira Always Accessible
4. Role-Based Defaults
5. Depth Matches Task

**Use for:** Presentations, design decisions, stakeholder alignment
**Format:** Ready-to-present slides or reference material

---

## 🎯 How to Use These Files

### **If You're a Product Manager:**
1. Read `02-USER-FLOWS-PERSONAS.md` → Understand user needs
2. Skim `06-UX-PRINCIPLES.md` → Understand design philosophy
3. Reference `03-FLOW-DIAGRAMS.md` → Show stakeholders visually
4. Check `05-FIGMA-CHECKLIST.md` → Understand timeline

### **If You're a Designer:**
1. Start with `06-UX-PRINCIPLES.md` → Know what you're building toward
2. Read `02-USER-FLOWS-PERSONAS.md` → Understand user context
3. Use `03-FLOW-DIAGRAMS.md` as reference while designing
4. Follow `05-FIGMA-CHECKLIST.md` step-by-step
5. Refer to `04-FLOWS-TO-SCREENS.md` for screen specs

### **If You're an Engineer:**
1. Read `01-STRATEGIC-PLAN.md` → Understand architecture
2. Skim `02-USER-FLOWS-PERSONAS.md` → Context on user needs
3. Check `04-FLOWS-TO-SCREENS.md` → What data each screen needs
4. Use `06-UX-PRINCIPLES.md` → Why screens are designed certain ways

### **If You're Presenting to Stakeholders:**
1. Use `06-UX-PRINCIPLES.md` as your slide deck (ready-to-present format)
2. Reference `03-FLOW-DIAGRAMS.md` for visuals
3. Show timeline from `05-FIGMA-CHECKLIST.md`
4. Explain user needs from `02-USER-FLOWS-PERSONAS.md`

---

## 🚀 Quick Start (Next 3 Days)

### **Day 1: Alignment**
- [ ] Read `06-UX-PRINCIPLES.md` (understand philosophy)
- [ ] Review `03-FLOW-DIAGRAMS.md` with team (visual alignment)
- [ ] Discuss `02-USER-FLOWS-PERSONAS.md` (confirm user understanding)

### **Day 2: Planning**
- [ ] Read `01-STRATEGIC-PLAN.md` (full strategy)
- [ ] Review `05-FIGMA-CHECKLIST.md` (timeline & approach)
- [ ] Map dependencies and get buy-in

### **Day 3: Execution**
- [ ] Open Figma
- [ ] Follow `05-FIGMA-CHECKLIST.md` Phase 1 (setup)
- [ ] Start building components (Phase 2)

---

## 🎨 Key Design Decisions

### **5 Main Apps:**
1. **Overview** - Entry point for all users (health + alerts)
2. **Observe** - Network map + site drill-down (NOC primary)
3. **Analyze** - Deep RCA workspace (Engineer primary)
4. **Automate** - AppGen + app library (Developer primary)
5. **Provision** - ZTP pipeline tracker (NOC + Manager)

### **Persistent Aira Drawer:**
- 360px wide sidebar on every page
- NOT the main interface (biggest shift from demo)
- Can navigate, answer questions, trigger actions

### **Design System:**
- shadcn/ui (components) + Tremor (data viz)
- Keep existing Tailwind tokens (cream, pulse, naavik-primary)
- Figma Variables for light/dark mode

### **Navigation:**
- React Router (proper URLs, deep links)
- Role-based defaults (NOC→Overview, Engineer→Analyze)
- Sidebar nav with 5 sections

---

## 📊 User Personas (TL;DR)

| Role | Primary App | Time | Key Action |
|------|---|---|---|
| NOC Operator | Overview | 5-15 min | Alert → Observe → Act |
| RF Engineer | Analyze | 30-90 min | Problem → Deep RCA → Build App |
| App Developer | Automate | 1-4 hours | Request → Build → Test → Deploy |
| Manager | Overview | 10-30 min | Health check → Drill down → Report |
| Director | Overview | 5-15 min | Score check → Ask Aira → Export |

---

## 🛠️ Tech Stack

- **Frontend:** React 18 + TypeScript + Vite
- **UI Components:** shadcn/ui + Tremor
- **Styling:** Tailwind CSS 3
- **Routing:** React Router v6
- **Icons:** Lucide React
- **Design:** Figma

---

## 📋 Document Versions

- Created: March 2025
- Last Updated: March 9, 2025
- Version: 1.0 (Production Ready)
- Location: `/naavik_unified_ux/prod_ux/`

---

## 🤔 Questions?

Each file has specific guidance. If you're stuck:
1. What are you working on? (Design, code, planning, presenting)
2. Which file matches your task?
3. Read that file's relevant section

If you need to brainstorm or go deeper on any topic, reference the file and we can dive in.

Good luck! 🚀
