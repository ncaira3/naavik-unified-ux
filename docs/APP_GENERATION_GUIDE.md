# How to Generate Telecom-Hardened Apps

## Overview

You can generate **Ericsson EIAP-compliant Python code** from natural language logic. The generated code follows the structure you provided:

- `EIAPAdaptor` as DataAdapter
- `CellFlowManager` class
- Multi-entity intersection (EUtranCell ∩ NRCellCU ∩ NRCellDU)
- CSV report with `write_csv_headers` and `log_report_row`
- KPI checks and parameter updates via `data_adapter.get()` / `data_adapter.update()`

## Ways to Generate an App

### 1. **AppStore Intent Box (Recommended)**

1. Go to **AppStore**
2. Enter your logic in the intent box, for example:
   - `Change qRxLevMin to -122 when PRB utilization exceeds 90%`
   - `Increase qRxLevMin when PRB utilization goes > 90%`
   - `When drop rate exceeds 5%, increase qRxLevMin`
3. Click **"Start Building"**
4. The split-screen builder opens with:
   - **Left**: Chat for questions or refinements
   - **Right**: Generated Python EIAP code

### 2. **Conversational Builder (LLM-driven)**

1. Go to **Naavik AppGen** → **Create with AI**
2. Chat with the assistant (OpenAI) to describe your automation, ask about parameters (qRxLevMin, PRB, etc.), or refine your logic
3. When done chatting, click **Build the app**
4. You get **Code** (default tab) and **Flowchart** tabs, plus **Package as rApp** and **Save as Applet** options

**OpenAI API**: Set `OPENAI_API_KEY` in backend `.env` for full agentic, LLM-powered conversation. Without it, a context-aware fallback acknowledges user logic and guides next steps, but for best results use the API key.

### 3. **Direct API**

```bash
curl -X POST http://localhost:3000/api/automation/generate-eiap \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"naturalLanguageInput": "Increase qRxLevMin when PRB utilization exceeds 90%"}'
```

## Generated Code Structure

The output matches your sample:

```python
from adaptors.eiap.eiap_adaptor import EIAPAdaptor as DataAdapter
import json
import pandas as pd
import os
from datetime import datetime, timedelta, timezone      
from collections import defaultdict
from static.tunable_params import *

# ... write_csv_headers, log_report_row ...

class CellFlowManager:
    def __init__(self):
        self.all_cmhandle_ids = None
        self.curr_id = None
        self.data_adapter = DataAdapter()
        self.report = defaultdict(lambda: {})
        self.app_name = '<uuid>'

    def start(self):
        self.loop_over_cells()

    def loop_over_cells(self):
        # Intersection of EUtranCell, NRCellCU, NRCellDU
        ids_eutran = self.data_adapter.get_cm_handle_ids(...)
        ids_nrcellcu = self.data_adapter.get_cm_handle_ids(...)
        ids_nrcelldu = self.data_adapter.get_cm_handle_ids(...)
        self.all_cmhandle_ids = list(set(ids_eutran) & set(ids_nrcellcu) & set(ids_nrcelldu))
        # ...

    def check_dl_prb_utilization(self):
        avg_dl_prb_util = self.data_adapter.get(cmhandle_id, "kpi", "avg_dl_prb_util")
        if avg_dl_prb_util > 80:
            self.increase_qrxlevmin()
        # ...

    def increase_qrxlevmin(self):
        mo_class = "EUtranFreqRelation"
        parameter = "qRxLevMin"
        current_value = self.data_adapter.get(...)
        new_value = (current_value + step) if True else -115
        self.data_adapter.update(cmhandle_id, mo_class, parameter, new_value)
        self.loop_over_cells()
```

## Supported Logic Patterns

| Pattern | Example | Generated |
|--------|---------|-----------|
| PRB + qRxLevMin | "PRB util > 90%, increase qRxLevMin" | `check_dl_prb_utilization`, `increase_qrxlevmin` |
| Drop rate + qRxLevMin | "Drop rate > 5%, set qRxLevMin to -115" | `check_drop_rate`, `set_qrxlevmin` |
| CRS gain | "Increase CRS gain when congested" | `check_dl_prb_utilization`, `adjust_crsgain` |
| Antenna tilt | "Adjust downtilt when PRB > 80%" | `check_dl_prb_utilization`, `set_antennadowntilt` |

## Parameter-to-MO-Class Mapping

| Parameter | MO Class |
|-----------|----------|
| qRxLevMin | EUtranFreqRelation |
| crsGain | EUtranCellFDD |
| antennaDowntilt | EUtranCellFDD |
| transmitPower | EUtranCellFDD |

## KPI Field Names

| KPI | data_adapter.get(..., "kpi", ...) |
|-----|-----------------------------------|
| DL PRB utilization | `avg_dl_prb_util` |
| Drop rate | `drop_rate` |

## Tips

1. **Be specific**: Include the parameter, KPI, and threshold.
2. **Use telecom terms**: qRxLevMin, PRB utilization, drop rate, etc.
3. **Set or increase**: "Increase qRxLevMin" uses `current_value + step`; "Set to -122" uses the fixed value.
4. **OpenAI optional**: If no API key is set, a fallback generator produces the same structure.
