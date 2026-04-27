# Ideas from Appspace Codebase

Reference: `appspace/` — Aira-style AI Studio for building telecom apps. Below are patterns and ideas that can inform the Unified UX Prototype (intent screen, AppGen, workflow, app registry).

---

## 1. App structure & navigation

- **HOME**: Hero headline, short subtitle, single prominent input that routes to AppGen (e.g. “Describe your app idea…” with “Build” and model badge).
- **Floating nav (top-left)**: Logo + hamburger; vertical menu: HOME, APPGEN, APPSPACE, SETTINGS.
- **User menu (top-right)**: Avatar, name, dropdown (Settings, Profile, Logout).
- **Feature cards** on HOME: e.g. “Generate Apps”, “Deploy & Monitor”, “Configure” — each navigates to the corresponding view.

---

## 2. AppGen / intent-to-app UX

**Input & actions**

- One main textarea (“Describe your idea” / “Describe your automation in natural language”).
- **Resource type selector**: App vs Applet (Full Application vs Function Only) — could map to “full workflow” vs “single condition/action”.
- Primary CTA: “Build” / “Generate” with optional model badge (e.g. GPT-4o).

**Context & files**

- “+” menu: Add files, Add context, Company knowledge (could feed into intent or workflow).
- Drag-and-drop file upload; show attached files as chips with remove.

**Build feedback (instead of silent loading)**

- **Terminal-style build logs** while generating, e.g.:
  - “Connecting to AI synthesis engine…”
  - “Analyzing requirements…”
  - “Generating app structure…”
  - “Validating standards compliance…”
  - “Building logic…”
  - “Complete!”
- Or shorter: “[INIT] Connection…”, “[PLAN] Analyzing intent…”, “[BUILD] Intent parsed…”, “[SPEC] Validating…”, “[GEN] Python scaffold created.”

**Result view**

- Single result card: **name**, **description**, **Data Model** (tags/chips), then actions: **Discard** / **Save to AppSpace** (or “Save App”).
- Optional: “Preview Code” before save.

**Suggestions**

- **Greeting rotation**: e.g. “Build your ideas with Aira”, “What would you like to create?”, “Describe it. We’ll build it.”
- **Suggestion cards**: 3–4 cards (e.g. Network Traffic Analyzer, Handover Optimizer, QoS Monitor) with icon, title, short description; **click fills the prompt** (e.g. “Build a network traffic analyzer”).
- Carousel if many suggestions.

---

## 3. Spec / schema output

- **SpecStudio-style**: After generate, show **Build logs** (left) and **Spec preview** (right): name, version, data model (field: type), pages (title/route), and actions: Preview Code, Publish Package.
- **Forge-style**: Two-column — left: type selector + textarea + Generate; right: “Build Process” logs + “Generated Spec” card (name, version, description, data model, “Save to Gallery”).
- **Domain badges**: e.g. “O-RAN”, “3GPP Rel-18” to signal telecom compliance.

---

## 4. OpenAI / generation contract

- **Structured JSON output**: One schema for “app spec”, e.g. `name`, `description`, `version`, `dataModel`, `pages`, `pythonCode`.
- **System prompt**: Role (e.g. “5G RAN engineer”), domain (carrier-grade, 3GPP, O-RAN), and “always respond with valid JSON”.
- **Resource type in user message**: “Manifest a carrier-grade app (rApp)” vs “standalone neural function” to vary scope.

**For our demo**: We already have intent → workflow → code. We could add a “spec” layer (name, description, data model) from the same NL input and show it in the result card before or alongside the code.

---

## 5. AppSpace (registry & deploy)

**Registry list**

- **Filter tabs**: All Apps, Aira Native, Company, Your Apps, Favorites, Analytics, Automation, Optimization.
- **Two lists**: “Aira Native Apps” (predefined) and “Your Apps” (user-created from AppGen).
- **Card layout**: Icon (with color), name, description (line-clamp), tags, favorite heart; status for user apps (e.g. ACTIVE).

**Applet Vault**

- Prominent card: “Applet Vault”, count of applets, “Create new applet” → navigates to AppGen.
- Modal: grid of applets (icon, name, description, last modified, Open); “Sync with GitHub”, “New Applet”, close.

**Empty / CTA**

- When no user apps: “Create your first app” card with short copy and “Go to AppGen” button.

---

## 6. App detail (single app view)

**Header**

- Back, app icon, name, status badge (e.g. Active), description, tags; actions: “Improve with AI” (→ AppGen), overflow menu.

**Tabs**

- **Overview**: Quick stats (version, deployments, test coverage, uptime); Deployment Status grid (Aira, EIAP, ENM, Nokia, Huawei); Recent Activity list.
- **App Logic**: Version history (version, date, changes, status); Core Logic code preview + “View Full” / “Edit”.
- **Deployments**: Cards per target (icon, status, version, instances, Update/Monitor/Configure); Version Deployment Matrix table.
- **Testing**: Test suites (Unit, Integration, E2E, Performance) with pass/fail and coverage; “Deployment Target Tests”; “AI Evaluation Results” (accuracy, latency, etc.).
- **Monitoring**: Live metrics (instances, requests/min, response time); performance chart placeholder; Recent Alerts; “Improve with AI” CTA.

**Ideas for our demo**

- Reuse “Overview” + “App Logic” (workflow/code) + optional “Deployments” for saved apps.
- “Improve with AI” could re-open the same app in AppGen with pre-filled intent or workflow.

---

## 7. Types & data model

- **ResourceType**: APP | FUNCTION.
- **DeploymentTarget**: AIRA_NATIVE, ERICSSON_ENM, NOKIA_EDEN (aligns with our EIAP/ENM).
- **AppStatus**: VOID, SYNTHESIZING, SYNCHRONIZING, ACTIVE, STABLE, ORBITING, DORMANT, ERROR.
- **AppSpec**: id, name, type, description, version, dataModel, pages?, pythonCode, generatedAt, target?.
- **AppPackage**: spec + status + optional metrics.
- **AuditLog**: id, timestamp, action, appId, user, status (SUCCESS | WARNING | ERROR).

We already have app save; we could align saved app shape with AppPackage and add status/audit for consistency.

---

## 8. Shared / Settings

- **RegistryTable**: Table of App Registry (ID, name, version, published at, status) + Audit Log table (timestamp, action, resource, user, status).
- Settings view can show registry + audit log for admins.

---

## Quick wins for Unified UX Prototype

1. **Build logs during “Create Workflow” / “Generate App”**: Show 3–5 short log lines (e.g. “Parsing intent…”, “Building workflow…”, “Generating code…”) so the flow feels responsive and transparent.
2. **Suggestion cards on Intent/AppGen**: Reuse “suggested queries” as clickable cards (icon + title + short description) that fill the NL input.
3. **App type selector**: Optional “Full workflow” vs “Single action” (or App vs Applet) in AppGen to scope what we generate.
4. **Result card before code**: Show app name + description + “Data model” (e.g. KPIs/params used) in a card, then “View code” / “Copy” / “Save”.
5. **App detail for saved apps**: List saved apps; click opens Overview + App Logic (workflow + code) and “Improve with AI” back to AppGen.

These can be adopted incrementally without changing the current intent → workflow → code pipeline.
