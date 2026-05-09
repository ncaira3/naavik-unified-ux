# Naavik Network DB — Schema Dictionary

Comprehensive column-level reference for every table the Naavik Unified UX queries (remote MSSQL + local Postgres mirror).

**Source:** `backend/src/services/db-schema-reference.service.ts` (FULL_SCHEMA constant)
**Tables:** 21 · **Total columns:** 339

Canonical join keys highlighted across the schema:
- **USID** — site identifier (string, primary join key in nearly every table)
- **DATE_ID** — point-in-time partitioning column
- **HOUR_ID** — hour 0–23 (only on hourly_intermediate_kpis_table)
- **site_id, cell_id, kpi_id** — internal UUIDs for joining within site/cell/KPI scopes

---

## Table Index

- **[site_table](#site-table)** (55 cols) — PRIMARY site / RCA / topology table — one row per (USID, date) with full RCA pipeline output
- **[cell_table](#cell-table)** (21 cols) — Cell-level inventory — one row per (cell, date) with cell metadata + per-cell anomaly flags
- **[intermediate_kpi_table](#intermediate-kpi-table)** (12 cols) — Daily cell-level KPI values — one row per (USID, cell, KPI, date)
- **[hourly_intermediate_kpis_table](#hourly-intermediate-kpis-table)** (13 cols) — Hourly cell-level KPI values — one row per (USID, cell, KPI, date, hour)
- **[kpi_table](#kpi-table)** (16 cols) — Aggregated KPI table — daily KPI values with numerator/denominator detail
- **[subcomponent_table](#subcomponent-table)** (17 cols) — CQX super-KPI subcomponent breakdown — one row per (USID, subcomponent, date)
- **[cqx_offenders_truth_table](#cqx-offenders-truth-table)** (15 cols) — Customer-experience super-KPI offender impacts — one row per (USID, date)
- **[alarm_table](#alarm-table)** (22 cols) — Network alarms — one row per alarm event
- **[ticket_table](#ticket-table)** (23 cols) — Trouble tickets — one row per ticket per date
- **[eim_table](#eim-table)** (12 cols) — Engineering Information Manager work orders — one row per advisory
- **[outage_table](#outage-table)** (8 cols) — Cell-level outage events — one row per (USID, cell, metric, date)
- **[configuration_parameters_table](#configuration-parameters-table)** (9 cols) — Parameter change log — one row per (USID, parameter, change date)
- **[ret_table](#ret-table)** (17 cols) — Remote Electrical Tilt sensor data — one row per (USID, sector, date)
- **[sector_table](#sector-table)** (8 cols) — Sector-level inventory — one row per (USID, sector, date)
- **[neighbors_table](#neighbors-table)** (14 cols) — Neighbor handover relations — point-in-time snapshot per neighbor pair
- **[neighbors_table_date_id](#neighbors-table-date-id)** (15 cols) — Dated neighbor relations — same shape as neighbors_table plus DATE_ID
- **[lte_parameters_table](#lte-parameters-table)** (16 cols) — LTE-specific cell parameters — one row per (cell, date)
- **[lte_sector_carrier_table](#lte-sector-carrier-table)** (12 cols) — LTE sector carrier configuration — one row per (sector carrier, date)
- **[nr_parameters_table](#nr-parameters-table)** (13 cols) — 5G NR cell parameters — one row per (NR cell, date)
- **[nr_sector_carrier_table](#nr-sector-carrier-table)** (17 cols) — 5G NR sector carrier configuration — one row per (NR sector carrier, date)
- **[correlation_table](#correlation-table)** (4 cols) — Correlation clusters identified by the agent — one row per cluster

---

## site_table

_PRIMARY site / RCA / topology table — one row per (USID, date) with full RCA pipeline output_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **site_id** | `uniqueidentifier` | Internal site UUID (used for joins on site-scoped tables). |
| 2 | `site_name` | `varchar` | Human-readable site name (e.g. CVMN090025F). |
| 3 | `cell_num` | `int` | Total number of cells configured at this site. |
| 4 | **USID** | `varchar(64)` | Public site identifier — the primary join key across all telecom tables. |
| 5 | `LATITUDE` | `float` | Site latitude in decimal degrees. |
| 6 | `LONGITUDE` | `float` | Site longitude in decimal degrees. |
| 7 | `DISTRICT` | `int` | AT&T district code (operational region). |
| 8 | `ZONE_ID` | `varchar` | Operational zone identifier within the district. |
| 9 | `ZONE_ENGINEER` | `varchar` | Name of the engineer assigned to this zone. |
| 10 | `ENGINEER_UID` | `varchar` | User ID of the assigned engineer. |
| 11 | `MANAGER_UID` | `varchar` | User ID of the engineering manager. |
| 12 | `COUNTY` | `varchar` | County in which the site is located. |
| 13 | `CITY` | `varchar` | City in which the site is located. |
| 14 | `STATE` | `varchar(2)` | Two-letter US state code. |
| 15 | `STREET_ADDRESS` | `varchar` | Street address of the cell tower. |
| 16 | `ZIP` | `int` | ZIP code of the site address. |
| 17 | `FA_LOCATION` | `varchar` | Frequency assignment location identifier. |
| 18 | `SITE_TYPE` | `varchar` | Site classification (e.g. MACRO-CONVENTIONAL, SMALL-CELL, IBS). |
| 19 | `STRUCTURE_TOWER_TYPE` | `varchar` | Physical structure type (MONOPOLE, GUYED, ROOFTOP, LATTICE, etc.). |
| 20 | `ATT_SITE_ID` | `varchar` | AT&T's internal site identifier (legacy, may differ from USID). |
| 21 | `CLUSTERID` | `varchar` | Cluster identifier for grouped network analysis. |
| 22 | `CLUSTERNAME` | `varchar` | Human-readable cluster name. |
| 23 | `MARKET` | `varchar(64)` | Market code (e.g. CASA = California Sacramento, CASF = California San Francisco). |
| 24 | `DISTRICT_MANAGER` | `varchar` | Name of the district manager. |
| 25 | `strongest_factors` | `text(json)` | JSON array of top causal factors identified by the RCA agent. |
| 26 | `rca_fingerprint_reference_id` | `varchar` | Reference id linking to the RCA pattern fingerprint catalog. |
| 27 | `solution_recommendation` | `text` | Recommended remediation action(s) from the RCA agent. |
| 28 | `outage` | `bool` | True if the site is currently in outage state. |
| 29 | `outage_timestamp` | `datetime` | Timestamp when the outage was first detected. |
| 30 | `degraded_category` | `varchar` | Coarse degradation category — populated whenever any KPI degrades, even if RCA hasn't run yet. |
| 31 | `rca_traversal` | `text(json)` | JSON tree of the RCA decision path the agent walked. |
| 32 | `rca_bucket` | `varchar` | Final RCA bucket/category (e.g. 'Outage Neighbor', 'Capacity Congestion'). |
| 33 | `kpi_summary` | `text` | Human-readable narrative summary of KPI behavior on this date. |
| 34 | `ticket_summary` | `text` | Summary of related trouble tickets for the period. |
| 35 | `alarm_summary` | `text` | Summary of related alarms for the period. |
| 36 | `rca_summary` | `text` | Top-line RCA summary written by the agent. |
| 37 | `short_summary` | `text(json)` | JSON object with brief headline statements about the site. |
| 38 | `long_summary` | `text` | Full RCA narrative — multi-paragraph explanation. |
| 39 | `solution_summary` | `text` | Detailed remediation plan written by the agent. |
| 40 | `parameter_summary` | `text` | Summary of parameter changes that occurred. |
| 41 | `user_feedback` | `text` | Feedback captured from operators reviewing the RCA. |
| 42 | `neighbor_summary` | `text` | Summary of neighbor-relation issues impacting this site. |
| 43 | `confidence_score_int` | `int` | Integer 0–100 confidence score for the RCA conclusion. |
| 44 | **DATE_ID** | `datetime` | Date for which this analysis applies (one row per site per day). |
| 45 | `update_time` | `datetime` | When this row was last updated by the pipeline. |
| 46 | `version` | `int` | Schema/pipeline version number. |
| 47 | `outage_summary` | `text` | Outage-specific narrative summary. |
| 48 | `intuitions` | `text(json)` | JSON of agent intuition checks: each intuition has a status (APPLIES / DOES NOT APPLY). |
| 49 | `chain_of_thought` | `text(json)` | JSON array of the agent's step-by-step reasoning. Presence = AI analysis completed. |
| 50 | `confidence_score` | `text(json)` | JSON object with detailed confidence breakdown ({score, evidence, ...}). |
| 51 | `token_and_cost_usage` | `text(json)` | JSON tracking LLM token usage and cost for this analysis. |
| 52 | `details` | `text(json)` | Catch-all JSON for additional pipeline metadata. |
| 53 | `run_time_seconds` | `float` | Wall-clock seconds the RCA pipeline took for this row. |
| 54 | `anomaly_flag` | `bool` | True if site-level anomaly was detected. |
| 55 | `anomaly_score` | `float` | Numeric anomaly score (higher = more anomalous). |

## cell_table

_Cell-level inventory — one row per (cell, date) with cell metadata + per-cell anomaly flags_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **cell_id** | `uniqueidentifier` | Internal cell UUID. |
| 2 | **site_id** | `uniqueidentifier` | Foreign key to site_table.site_id. |
| 3 | `cell_name` | `varchar` | Logical cell name (e.g. CVL02383_7C_1). |
| 4 | `num_kpis` | `int` | Count of KPIs monitored for this cell. |
| 5 | `AZIMUTH` | `float` | Antenna azimuth in degrees (0=North, 90=East). |
| 6 | `HEIGHT` | `float` | Antenna height in meters above ground. |
| 7 | `LATITUDE` | `float` | Cell antenna latitude (may differ from site center). |
| 8 | `LONGITUDE` | `float` | Cell antenna longitude. |
| 9 | `TECH` | `varchar` | Radio technology (4G, 5G). |
| 10 | **USID** | `varchar` | Site USID this cell belongs to. |
| 11 | `USEID` | `varchar` | User Equipment Site ID — unique cell identifier in AT&T's catalog. |
| 12 | `CARRIER` | `varchar` | Carrier/band identifier (e.g. 700_1, AWS_5, n77). |
| 13 | `neighbor_relations` | `text(json)` | JSON list of neighbor cells configured for handover. |
| 14 | `update_time` | `datetime` | Last update timestamp. |
| 15 | `version` | `int` | Schema version. |
| 16 | **DATE_ID** | `datetime` | Date for which this cell snapshot applies. |
| 17 | `strongest_factors` | `text(json)` | Top causal factors at the cell level. |
| 18 | `kpi_anomaly_flag_list` | `text(json)` | JSON list of which KPIs flagged anomaly for this cell. |
| 19 | `kpi_anomaly_score_list` | `text(json)` | JSON list of anomaly scores (parallel to flag list). |
| 20 | `anomaly_flag` | `bool` | True if cell has any anomaly. |
| 21 | `anomaly_score` | `float` | Numeric anomaly score for the cell. |

## intermediate_kpi_table

_Daily cell-level KPI values — one row per (USID, cell, KPI, date)_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **kpi_id** | `uniqueidentifier` | Internal KPI row UUID. |
| 2 | **cell_id** | `uniqueidentifier` | FK to cell_table. |
| 3 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 4 | **USID** | `varchar` | Site USID. |
| 5 | `cell_name` | `varchar` | Cell name (e.g. CVL02383_7A_1). |
| 6 | `kpi_name` | `varchar` | KPI identifier (e.g. DL_DRB_TPUT, HOSR, DATA_RAN_ACC). |
| 7 | `kpi_value` | `float` | Numeric KPI value for the day. |
| 8 | `TECH` | `varchar` | Radio technology (4G, 5G). |
| 9 | `anomaly_flag` | `bool` | True if this KPI value is anomalous. |
| 10 | `anomaly_score` | `float` | Anomaly score for this KPI value. |
| 11 | **DATE_ID** | `datetime` | The date this KPI applies to. |
| 12 | `version` | `int` | Schema version. |

## hourly_intermediate_kpis_table

_Hourly cell-level KPI values — one row per (USID, cell, KPI, date, hour)_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **kpi_id** | `uniqueidentifier` | Internal KPI row UUID. |
| 2 | **cell_id** | `uniqueidentifier` | FK to cell_table. |
| 3 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 4 | **USID** | `varchar` | Site USID. |
| 5 | `cell_name` | `varchar` | Cell name. |
| 6 | `kpi_name` | `varchar` | KPI identifier (same vocabulary as intermediate_kpi_table). |
| 7 | `kpi_value` | `float` | Numeric KPI value for this hour. |
| 8 | `TECH` | `varchar` | Radio technology. |
| 9 | `anomaly_flag` | `bool` | True if this hour is anomalous. |
| 10 | `anomaly_score` | `float` | Anomaly score. |
| 11 | **DATE_ID** | `datetime` | Date this row applies to. |
| 12 | **HOUR_ID** | `int` | Hour of day (0–23). |
| 13 | `version` | `int` | Schema version. |

## kpi_table

_Aggregated KPI table — daily KPI values with numerator/denominator detail_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **kpi_id** | `uniqueidentifier` | KPI row UUID. |
| 2 | **cell_id** | `uniqueidentifier` | FK to cell_table. |
| 3 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 4 | **USID** | `varchar` | Site USID. |
| 5 | `cell_name` | `varchar` | Cell name. |
| 6 | `kpi_name` | `varchar` | KPI identifier. |
| 7 | `kpi_value` | `float` | Computed KPI value (numerator/denominator). |
| 8 | `anomaly_flag` | `bool` | True if anomalous. |
| 9 | `numerator` | `float` | Numerator of the KPI computation. |
| 10 | `denominator` | `float` | Denominator of the KPI computation. |
| 11 | `anomaly_score_numerator` | `float` | Anomaly score on the numerator side. |
| 12 | `anomaly_score_denominator` | `float` | Anomaly score on the denominator side. |
| 13 | `anomaly_score_ratio` | `float` | Ratio-based anomaly score for the KPI. |
| 14 | `alarms` | `text(json)` | Related alarm IDs that may explain the KPI value. |
| 15 | **DATE_ID** | `datetime` | Date this row applies to. |
| 16 | `version` | `int` | Schema version. |

## subcomponent_table

_CQX super-KPI subcomponent breakdown — one row per (USID, subcomponent, date)_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | `subcomponent_id` | `uniqueidentifier` | Subcomponent row UUID. |
| 2 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 3 | **kpi_id** | `uniqueidentifier` | FK to the parent KPI. |
| 4 | **USID** | `varchar` | Site USID. |
| 5 | `subcomponent_name` | `varchar` | Subcomponent identifier (e.g. DL_TPUT_IMP, DATA_DROP_IMP, VOICE_DROP_IMP). |
| 6 | `subcomponent_value` | `float` | Subcomponent contribution to total impact. |
| 7 | `operator_numerator` | `float` | Operator-supplied numerator for this subcomponent. |
| 8 | `operator_denominator` | `float` | Operator-supplied denominator. |
| 9 | `operator_ratio` | `float` | Ratio numerator/denominator. |
| 10 | `anomaly_score_ratio` | `float` | Ratio-form anomaly score. |
| 11 | `anomaly_flag` | `bool` | True if anomalous. |
| 12 | `estimated_subcomponent_num` | `float` | Model-estimated numerator. |
| 13 | `estimated_subcomponent_den` | `float` | Model-estimated denominator. |
| 14 | `normalized_subcomponent` | `float` | Normalized subcomponent value (0–1 typical). |
| 15 | `normalized_estimated_subcomponent` | `float` | Normalized estimated subcomponent. |
| 16 | **DATE_ID** | `datetime` | Date this row applies to. |
| 17 | `version` | `int` | Schema version. |

## cqx_offenders_truth_table

_Customer-experience super-KPI offender impacts — one row per (USID, date)_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **DATE_ID** | `datetime` | Date this row applies to. |
| 2 | **USID** | `varchar` | Site USID. |
| 3 | `TOTAL_IMPACT_LATEST` | `float` | Total CQX impact score for this site on this date. |
| 4 | `DL_TPUT_IMP` | `float` | Downlink throughput component of the impact. |
| 5 | `UL_TPUT_IMP` | `float` | Uplink throughput component of the impact. |
| 6 | `DATA_DROP_IMP` | `float` | Data drop rate component of the impact. |
| 7 | `DATA_ACC_IMP` | `float` | Data accessibility component of the impact. |
| 8 | `VRAN_ACC_IMP` | `float` | Voice RAN accessibility component. |
| 9 | `VCDR_ACC_IMP` | `float` | Voice Call Drop Rate accessibility component. |
| 10 | `VOICE_DROP_IMP` | `float` | Voice drop rate component. |
| 11 | `NS_ESO_IMP` | `float` | Network Service / End-to-end ESO component. |
| 12 | `QUALITY_IMP` | `float` | Quality (CQI etc.) component. |
| 13 | `TOTAL_IMPACT_WOW` | `float` | Week-over-week change in total impact. |
| 14 | `IMPACT_DELTA` | `float` | Day-over-day change in impact. |
| 15 | `version` | `int` | Schema version. |

## alarm_table

_Network alarms — one row per alarm event_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 2 | **USID** | `varchar` | Site USID. |
| 3 | `IDENTIFIER` | `varchar` | Unique alarm identifier. |
| 4 | `AGENT` | `varchar` | Agent that raised the alarm (e.g. ENM, NetCool). |
| 5 | `SUMMARY` | `varchar` | Short alarm description. |
| 6 | `LASTOCCURRENCE` | `datetime` | Most recent occurrence timestamp of this alarm. |
| 7 | `site_name` | `varchar` | Site name. |
| 8 | `LOCATION` | `varchar` | Physical location (often equipment-room level). |
| 9 | `EQUIPMENTTYPE` | `varchar` | Type of equipment (e.g. RBS, Router, eNB). |
| 10 | `ADDITIONALINFO` | `text` | Free-form additional details. |
| 11 | `DELETEDAT` | `datetime` | When the alarm was acknowledged/cleared. |
| 12 | `CLASS_NAME` | `varchar` | Alarm class (e.g. Communications, Equipment). |
| 13 | `NETWORK_NAME` | `varchar` | Network domain (e.g. LTE, NR, Transport). |
| 14 | `INITIALSEVERITY_NAME` | `varchar` | Severity at first occurrence (Critical, Major, etc.). |
| 15 | `MSGSEVERITY_NAME` | `varchar` | Current severity name. |
| 16 | `ALARM_DURATION` | `int` | Duration in seconds the alarm was active. |
| 17 | `EQUIPMENTPRIORITY` | `varchar` | Priority tag for the equipment. |
| 18 | `CLEAREDBY` | `varchar` | Agent or user that cleared the alarm. |
| 19 | `LOCMARKET` | `varchar` | Market code where the alarm occurred. |
| 20 | `RAWDETAIL` | `text` | Raw alarm payload from the source system. |
| 21 | **DATE_ID** | `datetime` | Date this row applies to. |
| 22 | `version` | `int` | Schema version. |

## ticket_table

_Trouble tickets — one row per ticket per date_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 2 | **USID** | `varchar` | Site USID. |
| 3 | `TICKET_NUMBER` | `varchar` | Ticket reference (system unique). |
| 4 | `CREATE_TIME` | `datetime` | When the ticket was opened. |
| 5 | `TICKET_STATUS` | `varchar` | Current status (OPEN, CLOSED, IN_PROGRESS, etc.). |
| 6 | `ASSIGNED_DEPARTMENT` | `varchar` | Department the ticket is assigned to. |
| 7 | `SHORT_DESCRIPTION` | `varchar` | Brief description of the issue. |
| 8 | `MODIFIED_TIME` | `datetime` | Last modified timestamp. |
| 9 | `ASSIGNED_TO` | `varchar` | Person currently assigned. |
| 10 | `WF_ASSIGNED_TO_CUID` | `varchar` | Workflow-assigned user CUID. |
| 11 | `CLOSED_TIME` | `datetime` | When the ticket was closed (null if still open). |
| 12 | `COMMON_ID` | `varchar` | Cross-system common ID linking to other artifacts. |
| 13 | `PROBLEM_DETAIL` | `text` | Detailed problem description. |
| 14 | `PROBLEM_CATEGORY` | `varchar` | Top-level problem category. |
| 15 | `PROBLEM_SUBCATEGORY` | `varchar` | Subcategory under the main problem category. |
| 16 | `EQUIPMENT_ID` | `varchar` | Affected equipment identifier. |
| 17 | `SUBMITTED_BY` | `varchar` | Username of the submitter. |
| 18 | `SUBMITTER_DEPARTMENT` | `varchar` | Submitter's department. |
| 19 | `SUBMITTER_FULL_NAME` | `varchar` | Submitter's full name. |
| 20 | `LOCATION_ID` | `varchar` | Location reference for the ticket. |
| 21 | `RANKING` | `int` | Priority/severity ranking. |
| 22 | **DATE_ID** | `datetime` | Date this row applies to. |
| 23 | `version` | `int` | Schema version. |

## eim_table

_Engineering Information Manager work orders — one row per advisory_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 2 | **USID** | `varchar` | Site USID. |
| 3 | `ADVISORY_ID` | `varchar` | Advisory unique identifier. |
| 4 | `DESCRIPTION_OF_WORK` | `text` | Free-form description of the work to perform. |
| 5 | `COMMON_ID` | `varchar` | Cross-system common ID. |
| 6 | `LOCATION_ID` | `varchar` | Location identifier. |
| 7 | `EQUIPMENT_ID` | `varchar` | Equipment identifier. |
| 8 | `EQUIPMENT_NAME` | `varchar` | Human-readable equipment name. |
| 9 | `LOCATION_NAME` | `varchar` | Human-readable location name. |
| 10 | `ACTUAL_START_DTS` | `datetime` | Actual start datetime of the work. |
| 11 | **DATE_ID** | `datetime` | Date this row applies to. |
| 12 | `version` | `int` | Schema version. |

## outage_table

_Cell-level outage events — one row per (USID, cell, metric, date)_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 2 | **USID** | `varchar` | Site USID. |
| 3 | `site_name` | `varchar` | Site name. |
| 4 | `cell_name` | `varchar` | Cell experiencing the outage. |
| 5 | `METRIC` | `varchar` | Outage metric type (e.g. 4G_CELL_DOWN, 5G_CELL_DOWN). |
| 6 | `SNAPSHOT_HOUR` | `int` | Hour of day (0–23) when the snapshot detected the outage. |
| 7 | **DATE_ID** | `datetime` | Date this row applies to. |
| 8 | `version` | `int` | Schema version. |

## configuration_parameters_table

_Parameter change log — one row per (USID, parameter, change date)_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 2 | **DATE_ID** | `datetime` | Date the parameter change was observed. |
| 3 | `NODE` | `varchar` | Network node (eNodeB / gNodeB) where the parameter lives. |
| 4 | **USID** | `varchar` | Site USID. |
| 5 | `SUBELMT` | `varchar` | Sub-element / cell name (e.g. CVL02383_7A_1). |
| 6 | `Parameter` | `varchar` | Configuration parameter name (e.g. MAXIMUMTRANSMISSIONPOWER). |
| 7 | `Old_Value` | `int|float|varchar` | Value before the change. |
| 8 | `New_Value` | `int|float|varchar` | Value after the change. |
| 9 | `version` | `int` | Schema version. |

## ret_table

_Remote Electrical Tilt sensor data — one row per (USID, sector, date)_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 2 | **DATE_ID** | `datetime` | Date this row applies to. |
| 3 | `NODE` | `varchar` | Network node (eNodeB). |
| 4 | `ANTENNAUNITGROUP_ID_` | `int` | Antenna unit group identifier. |
| 5 | `ANTENNANEARUNIT_ID_` | `int` | Near-unit antenna identifier. |
| 6 | `ELECTRICALANTENNATILT` | `int` | Current electrical tilt in tenths of a degree. |
| 7 | `MINTILT` | `int` | Minimum allowed tilt. |
| 8 | `MAXTILT` | `int` | Maximum allowed tilt. |
| 9 | `USERLABEL` | `varchar` | Human-readable sector label (e.g. ALPHA, BETA, GAMMA). |
| 10 | `IUANTANTENNAMODELNUMBER` | `varchar` | Antenna model number. |
| 11 | `RETSUBUNIT_ID_` | `int` | RET sub-unit identifier. |
| 12 | `IUANTANTENNASERIALNUMBER` | `varchar` | Antenna serial number. |
| 13 | `IUANTBASESTATIONID` | `varchar` | Base station ID. |
| 14 | `IUANTSECTORID` | `varchar` | Sector identifier (typically ALPHA/BETA/GAMMA). |
| 15 | `CALIBRATIONSTATUS` | `int` | Calibration status code (0=ok, others=fault). |
| 16 | **USID** | `varchar` | Site USID. |
| 17 | `version` | `int` | Schema version. |

## sector_table

_Sector-level inventory — one row per (USID, sector, date)_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **USID** | `varchar` | Site USID. |
| 2 | `AZIMUTH` | `int` | Sector azimuth in degrees. |
| 3 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 4 | `strongest_factors` | `text(json)` | Top causal factors at sector level. |
| 5 | `anomaly_flag` | `bool` | True if sector is anomalous. |
| 6 | `anomaly_score` | `float` | Sector anomaly score. |
| 7 | **DATE_ID** | `datetime` | Date this row applies to. |
| 8 | `version` | `int` | Schema version. |

## neighbors_table

_Neighbor handover relations — point-in-time snapshot per neighbor pair_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **site_id** | `uniqueidentifier` | FK to site_table for the source side. |
| 2 | `neighbor_site_id` | `uniqueidentifier` | FK to site_table for the neighbor side. |
| 3 | `SOURCE_USID` | `varchar` | USID of the source site. |
| 4 | `SOURCE_USID_FACE` | `varchar` | Sector/face of the source site (ALPHA/BETA/GAMMA). |
| 5 | `NEIGH_USID` | `varchar` | USID of the neighbor site. |
| 6 | `NEIGH_USID_FACE` | `varchar` | Sector/face of the neighbor. |
| 7 | `HANDOVER_COUNT` | `int` | Number of handovers source→neighbor in the period. |
| 8 | `HO_RANK` | `int` | Rank of this neighbor by HO volume (1 = top). |
| 9 | `TOTAL_HANDOVER` | `float` | Total handover count for the source site (denominator for percentage). |
| 10 | `CUMMULATIVE_SUM` | `float` | Cumulative percent of HOs covered by neighbors up to this rank. |
| 11 | `PERC_HANDOVER` | `float` | Percent of source HOs going to this neighbor. |
| 12 | `SOURCE_NEIGH_DISTANCE_METERS` | `float` | Physical distance source→neighbor in meters. |
| 13 | `update_time` | `datetime` | Last update timestamp. |
| 14 | `version` | `int` | Schema version. |

## neighbors_table_date_id

_Dated neighbor relations — same shape as neighbors_table plus DATE_ID_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **site_id** | `uniqueidentifier` | Source site UUID. |
| 2 | `neighbor_site_id` | `uniqueidentifier` | Neighbor site UUID. |
| 3 | `SOURCE_USID` | `varchar` | Source USID. |
| 4 | `SOURCE_USID_FACE` | `varchar` | Source sector/face. |
| 5 | `NEIGH_USID` | `varchar` | Neighbor USID. |
| 6 | `NEIGH_USID_FACE` | `varchar` | Neighbor sector/face. |
| 7 | `HANDOVER_COUNT` | `int` | HO count on this date. |
| 8 | `HO_RANK` | `int` | Rank on this date. |
| 9 | `TOTAL_HANDOVER` | `float` | Total HOs from source on this date. |
| 10 | `CUMMULATIVE_SUM` | `float` | Cumulative %. |
| 11 | `PERC_HANDOVER` | `float` | Percent of HOs to this neighbor. |
| 12 | `SOURCE_NEIGH_DISTANCE_METERS` | `float` | Distance in meters. |
| 13 | `update_time` | `datetime` | Last update. |
| 14 | **DATE_ID** | `datetime` | Date this row applies to. |
| 15 | `version` | `int` | Schema version. |

## lte_parameters_table

_LTE-specific cell parameters — one row per (cell, date)_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 2 | **cell_id** | `uniqueidentifier` | FK to cell_table. |
| 3 | **DATE_ID** | `datetime` | Date this row applies to. |
| 4 | `NODE` | `varchar` | eNodeB node identifier. |
| 5 | `cell_name` | `varchar` | Cell name. |
| 6 | `ADMINISTRATIVESTATE` | `int` | Cell administrative state code (0=Locked, 1=Unlocked, 2=Shutting Down). |
| 7 | `PRIMARYPLMNRESERVED` | `bool` | True if cell is reserved for the primary PLMN. |
| 8 | `CELLBARRED` | `int` | Cell barred indicator (0=NOT_BARRED, 1=BARRED). |
| 9 | `EARFCNDL` | `int` | Downlink E-UTRA absolute radio frequency channel number. |
| 10 | `PHYSICALLAYERCELLID` | `int` | PCI (0–503). |
| 11 | `PHYSICALLAYERSUBCELLID` | `int` | PCI sub-id. |
| 12 | `PHYSICALLAYERCELLIDGROUP` | `int` | PCI group (0–167). |
| 13 | `CCEDYNUEADMCTRLRETDIFFTHR` | `int` | Control channel dynamic UE admission control retain differential threshold. |
| 14 | `ULDYNUEADMCTRLRETDIFFTHR` | `int` | Uplink dynamic UE admission control retain differential threshold. |
| 15 | **USID** | `varchar` | Site USID. |
| 16 | `version` | `int` | Schema version. |

## lte_sector_carrier_table

_LTE sector carrier configuration — one row per (sector carrier, date)_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 2 | **DATE_ID** | `datetime` | Date this row applies to. |
| 3 | `NODE` | `varchar` | eNodeB node. |
| 4 | `SECTORCARRIER_ID_` | `varchar` | Unique sector-carrier identifier. |
| 5 | `OPERATIONALSTATE` | `int` | Operational state code (0=Disabled, 1=Enabled). |
| 6 | `AVAILABILITYSTATUS` | `varchar` | Availability status text. |
| 7 | `MAXIMUMTRANSMISSIONPOWER` | `int` | Configured max TX power in 0.1 dBm units. |
| 8 | `CONFIGUREDMAXTXPOWER` | `int` | Currently configured max TX power. |
| 9 | `NOOFRXANTENNAS` | `int` | Number of receive antennas. |
| 10 | `NOOFTXANTENNAS` | `int` | Number of transmit antennas. |
| 11 | **USID** | `varchar` | Site USID. |
| 12 | `version` | `int` | Schema version. |

## nr_parameters_table

_5G NR cell parameters — one row per (NR cell, date)_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 2 | **cell_id** | `uniqueidentifier` | FK to cell_table. |
| 3 | **DATE_ID** | `datetime` | Date this row applies to. |
| 4 | `NODE` | `varchar` | gNodeB node. |
| 5 | `cell_name` | `varchar` | NR cell name. |
| 6 | `CELLSTATE` | `int` | Cell state code (e.g. 0=Inactive, 1=Active). |
| 7 | `CELLBARRED` | `int` | Cell barred indicator for NR (0=NOT_BARRED, 1=BARRED). |
| 8 | `ADMINISTRATIVESTATE` | `int` | Administrative state code. |
| 9 | `AVAILABILITYSTATUS` | `varchar` | Availability status text. |
| 10 | `NRPCI` | `int` | NR Physical Cell Identity (0–1007). |
| 11 | `POINTAARFCNTDD` | `varchar` | TDD ARFCN reference point. |
| 12 | **USID** | `varchar` | Site USID. |
| 13 | `version` | `int` | Schema version. |

## nr_sector_carrier_table

_5G NR sector carrier configuration — one row per (NR sector carrier, date)_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | **site_id** | `uniqueidentifier` | FK to site_table. |
| 2 | **DATE_ID** | `datetime` | Date this row applies to. |
| 3 | `NODE` | `varchar` | gNodeB node. |
| 4 | `NRSECTORCARRIERID` | `varchar` | Unique NR sector-carrier id. |
| 5 | `ARFCNDL` | `int` | NR downlink ARFCN. |
| 6 | `ARFCNUL` | `int` | NR uplink ARFCN. |
| 7 | `BSCHANNELBWDL` | `int` | Downlink channel bandwidth (MHz). |
| 8 | `OPERATIONALSTATE` | `int` | Operational state code. |
| 9 | `CONFIGUREDMAXTXPOWER` | `int` | Configured max TX power. |
| 10 | `MAXTRANSMISSIONPOWER` | `int` | Hardware max TX power. |
| 11 | `NOOFTXANTENNAS` | `int` | Total TX antennas. |
| 12 | `NOOFUSEDTXANTENNAS` | `int` | TX antennas currently in use. |
| 13 | `NOOFUSEDRXANTENNAS` | `int` | RX antennas currently in use. |
| 14 | `NOOFRXANTENNAS` | `int` | Total RX antennas. |
| 15 | `DLCALIBRATIONENABLED` | `bool` | True if downlink calibration is enabled. |
| 16 | **USID** | `varchar` | Site USID. |
| 17 | `version` | `int` | Schema version. |

## correlation_table

_Correlation clusters identified by the agent — one row per cluster_

| # | Column | Type | Description |
|---|---|---|---|
| 1 | `correlation_cluster` | `varchar` | Cluster identifier from the correlation engine. |
| 2 | `mind_map` | `text(json)` | JSON mind-map of correlated entities (sites, cells, KPIs). |
| 3 | **DATE_ID** | `datetime` | Date this row applies to. |
| 4 | `version` | `int` | Schema version. |

---

## Notes on Types

Types listed are the **logical** types the agent uses when generating SQL. The actual MSSQL column types may differ (e.g. `varchar` columns are typically `VARCHAR(64)` or larger; `int` may be `BIGINT`; `bool` is stored as `BIT`). The local Postgres mirror lowercases all column names and maps types as follows:

| Logical | MSSQL | Postgres (mirror) |
|---|---|---|
| varchar | VARCHAR / NVARCHAR | TEXT |
| int | INT / SMALLINT / BIGINT | BIGINT |
| float | FLOAT / REAL | DOUBLE PRECISION |
| bool | BIT | BOOLEAN |
| datetime | DATETIME / DATETIME2 | TIMESTAMP |
| uniqueidentifier | UNIQUEIDENTIFIER | TEXT |
| text(json) | NVARCHAR(MAX) holding JSON | TEXT |

## Common Query Patterns

**Daily KPI for one site:**
```sql
SELECT cell_name, kpi_value FROM intermediate_kpi_table WITH (NOLOCK)
WHERE USID = '9787' AND kpi_name = 'DL_DRB_TPUT'
  AND CAST(DATE_ID AS DATE) = CAST('2026-04-25' AS DATE)
```

**Top offenders for a date:**
```sql
SELECT TOP 10 USID, TOTAL_IMPACT_LATEST FROM cqx_offenders_truth_table WITH (NOLOCK)
WHERE CAST(DATE_ID AS DATE) = CAST('2026-04-25' AS DATE)
ORDER BY TOTAL_IMPACT_LATEST DESC
```

**Site + RCA + impact roll-up:**
```sql
SELECT s.USID, s.rca_bucket, sc.subcomponent_value AS impact
FROM site_table s WITH (NOLOCK)
JOIN subcomponent_table sc WITH (NOLOCK)
  ON s.USID = sc.USID AND s.DATE_ID = sc.DATE_ID
WHERE s.chain_of_thought IS NOT NULL
  AND sc.subcomponent_name = 'Total_Impact_Mkt_CQX_Delta'
```

## Join Conventions

- **All telecom tables join on `USID + DATE_ID`** (and `HOUR_ID` for hourly).
- **Cell-level joins** also use `cell_name`.
- **Cross-site relationships** use `neighbors_table` / `neighbors_table_date_id` (`SOURCE_USID` ↔ `NEIGH_USID`).
- **`site_id`, `cell_id`, `kpi_id`** are internal UUIDs — only useful when joining within the AT&T platform (not exposed to end users).
