# Visual Block Diagrams - Aira Platform User Flows

> Copy these Mermaid diagrams into Figma (Mermaid plugin) or into a markdown viewer (GitHub, Notion, etc.)

---

## 1. The 5 User Personas & Their Primary Workflows

```mermaid
graph TD
    A["👤 NOC Operator<br/>(24/7 Monitor)"] -->|Primary: Alert Response| B["Overview → Observe → Act<br/>5-15 min"]

    C["👨‍💻 RF/RAN Engineer<br/>(Troubleshooting)"] -->|Primary: Deep Diagnosis| D["Analyze → Observe → Automate<br/>30-90 min"]

    E["🛠️ App Developer<br/>(Platform Team)"] -->|Primary: Build Automation| F["Automate (Builder) → Test → Deploy<br/>1-4 hours"]

    G["📊 Manager<br/>(Team Lead)"] -->|Primary: Oversight| H["Overview → Observe → Automate<br/>10-30 min"]

    I["👔 Director/VP<br/>(Executive)"] -->|Primary: Health Briefing| J["Overview → Aira (Summary)<br/>5-15 min"]

    style A fill:#e8f4f8
    style C fill:#e8f4f8
    style E fill:#e8f4f8
    style G fill:#e8f4f8
    style I fill:#e8f4f8
    style B fill:#fff4e6
    style D fill:#fff4e6
    style F fill:#fff4e6
    style H fill:#fff4e6
    style J fill:#fff4e6
```

---

## 2. Alert Response Flow (NOC Operator)

```mermaid
graph TD
    Start["🚨 ALERT ARRIVES<br/>Email/SMS/Dashboard"] --> Open["Open Aira App"]
    Open --> Overview["📊 OVERVIEW DASHBOARD<br/>(Entry Point)"]
    Overview --> Alert["See Alert in Feed<br/>CRITICAL: Site UST2938"]
    Alert --> Click["Click Alert or Ask Aira:<br/>'What wrong with UST2938?'"]
    Click --> Observe["🗺️ OBSERVE VIEW<br/>(Map + Site Panel)"]
    Observe --> Panel["Site Panel Opens<br/>├─ Overview Tab<br/>├─ KPI Trends<br/>├─ RCA Details<br/>└─ Parameters"]
    Panel --> Decision{"What's the<br/>root cause?"}

    Decision -->|Known Issue| Ask1["Ask Aira:<br/>'Run app: HighPRB_Auto'"]
    Decision -->|New Issue| Ask2["Ask Aira:<br/>'Build an app for this'"]

    Ask1 --> Deploy1["✅ App Executes<br/>(May trigger Provision)"]
    Ask2 --> Build["🤖 AUTOMATE<br/>(AppGen)"]
    Build --> Deploy2["✅ App Deploys"]

    Deploy1 --> Back["Return to OBSERVE<br/>Monitor improvement"]
    Deploy2 --> Back
    Back --> Done["✅ RESOLVED<br/>5-15 min elapsed"]

    style Start fill:#fee
    style Overview fill:#e8f4f8
    style Observe fill:#e8f4f8
    style Build fill:#f0e8f8
    style Deploy1 fill:#e8fee8
    style Deploy2 fill:#e8fee8
    style Done fill:#e8fee8
```

---

## 3. Apps & How They Connect

```mermaid
graph TB
    Aira["💬 AIRA CHAT DRAWER<br/>(Persistent on ALL pages)<br/>─────────<br/>• Navigate to sites<br/>• Answer questions<br/>• Trigger actions<br/>• Suggest next steps"]

    Overview["📊 OVERVIEW<br/>────────<br/>Network Health 87/100<br/>Active Alerts: 12<br/>Critical Sites: 4<br/>─────────<br/>Users: All (default)<br/>Time: 2-5 min"]

    Observe["🗺️ OBSERVE<br/>────────<br/>Mapbox Map<br/>Site Drill-down<br/>KPI Trends<br/>RCA Details<br/>─────────<br/>Users: NOC, Engineer, Manager<br/>Time: 5-30 min"]

    Analyze["📈 ANALYZE<br/>────────<br/>Deep RCA Workspace<br/>Multi-site Compare<br/>Anomaly Timeline<br/>─────────<br/>Users: RF Engineer (primary)<br/>Time: 30-90 min"]

    Automate["🤖 AUTOMATE<br/>────────<br/>AppGen (2 builders)<br/>App Library<br/>Flow Test<br/>Deployment<br/>─────────<br/>Users: Developer, Engineer<br/>Time: 1-4 hours"]

    Provision["📦 PROVISION<br/>────────<br/>ZTP Pipeline<br/>Step Tracker<br/>Multi-site Batch<br/>─────────<br/>Users: NOC, Manager<br/>Time: 2-24 hours"]

    Aira -->|Navigate| Overview
    Aira -->|Context| Observe
    Aira -->|Deep dive| Analyze
    Aira -->|Build app| Automate
    Aira -->|Track ZTP| Provision

    Overview -->|Drill down| Observe
    Observe -->|Need RCA| Analyze
    Analyze -->|Build fix| Automate
    Automate -->|Deploy app| Observe
    Automate -->|Trigger ZTP| Provision
    Provision -->|Check status| Observe

    style Aira fill:#f0e8f8,stroke:#4a7ccc,stroke-width:3px
    style Overview fill:#e8f4f8
    style Observe fill:#e8f4f8
    style Analyze fill:#fff4e6
    style Automate fill:#f0e8f8
    style Provision fill:#ffe8e8
```

---

## 4. Decision Tree: What App Should User Go To?

```mermaid
graph TD
    Start["User opens app<br/>OR has a question"] --> Q1{"What do you<br/>need to do?"}

    Q1 -->|"Check network status"| Q2{"How deep?"}
    Q2 -->|"Just the score"| Overview["📊 OVERVIEW"]
    Q2 -->|"Drill down to a site"| Observe["🗺️ OBSERVE"]

    Q1 -->|"Troubleshoot a problem"| Q3{"Need to<br/>understand or<br/>fix?"}
    Q3 -->|"Understand (RCA)"| Analyze["📈 ANALYZE"]
    Q3 -->|"Fix it (build app)"| Automate["🤖 AUTOMATE"]

    Q1 -->|"Deploy new sites"| Provision["📦 PROVISION"]

    Q1 -->|"Need help"| Aira["💬 Ask Aira<br/>(on ANY page)"]
    Aira -->|"Navigate to..."| Overview
    Aira -->|"Navigate to..."| Observe
    Aira -->|"Navigate to..."| Analyze
    Aira -->|"Navigate to..."| Automate

    Q1 -->|"Check ZTP progress"| Provision

    style Start fill:#fee
    style Overview fill:#e8f4f8
    style Observe fill:#e8f4f8
    style Analyze fill:#fff4e6
    style Automate fill:#f0e8f8
    style Provision fill:#ffe8e8
    style Aira fill:#f0e8f8,stroke:#4a7ccc,stroke-width:2px
```

---

## Color Legend (Used in Diagrams)

- 🔴 **Red (`#fee`)** = Entry point / Start
- 🔵 **Blue (`#e8f4f8`)** = Observation views (what users see)
- 🟡 **Yellow (`#fff4e6`)** = Analysis & deep work
- 🟣 **Purple (`#f0e8f8`)** = Aira / AI features
- 🟢 **Green (`#e8fee8`)** = Resolution / Success
- 🟠 **Orange (`#ffe8e8`)** = Provisioning / Infrastructure
