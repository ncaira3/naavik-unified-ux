/**
 * Documentation content for the Naavik Unified UX platform.
 *
 * Each `DocPage` is rendered as one scrollable page inside DocsView.
 * Pages contain `sections` which become anchored entries in the
 * "On this page" right rail.
 *
 * Keep the language clean and professional. No emojis. No marketing
 * superlatives. Describe behaviour, inputs, outputs, and edge cases.
 */
import type { ReactNode } from 'react';

export interface DocSection {
  id: string;
  title: string;
  body: ReactNode;
}

export interface DocPage {
  id: string;
  title: string;
  group: string;
  summary: string;
  sections: DocSection[];
}

// ─── Reusable inline primitives ────────────────────────────────────────────

const P = ({ children }: { children: ReactNode }) => (
  <p className="text-[14.5px] leading-7 text-text-secondary dark:text-text-secondary mb-4">{children}</p>
);

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded-md border border-border bg-cream-surface px-1.5 py-0.5 text-[12.5px] font-mono text-text-primary dark:border-pulse-border dark:bg-pulse-surface dark:text-text-primary">
    {children}
  </code>
);

const Pre = ({ children }: { children: ReactNode }) => (
  <pre className="mb-4 overflow-x-auto rounded-lg border border-border bg-cream-surface px-4 py-3 text-[12.5px] leading-6 font-mono text-text-primary dark:border-pulse-border dark:bg-pulse-bg dark:text-text-primary">
    {children}
  </pre>
);

const UL = ({ children }: { children: ReactNode }) => (
  <ul className="mb-4 list-disc space-y-1.5 pl-6 text-[14.5px] leading-7 text-text-secondary dark:text-text-secondary marker:text-text-muted">
    {children}
  </ul>
);

const OL = ({ children }: { children: ReactNode }) => (
  <ol className="mb-4 list-decimal space-y-1.5 pl-6 text-[14.5px] leading-7 text-text-secondary dark:text-text-secondary marker:text-text-muted">
    {children}
  </ol>
);

const SubHeading = ({ children }: { children: ReactNode }) => (
  <h3 className="mt-6 mb-2 text-[15px] font-semibold tracking-tight text-text-primary dark:text-text-primary">
    {children}
  </h3>
);

const Note = ({ title, children }: { title?: string; children: ReactNode }) => (
  <div className="mb-4 rounded-lg border-l-2 border-indigo-500/70 bg-indigo-500/5 px-4 py-3 dark:border-indigo-400/70 dark:bg-indigo-400/5">
    {title ? (
      <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-indigo-600 dark:text-indigo-300">
        {title}
      </p>
    ) : null}
    <div className="text-[13.5px] leading-6 text-text-secondary dark:text-text-secondary">{children}</div>
  </div>
);

const RefTable = ({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | ReactNode)[][];
}) => (
  <div className="mb-5 overflow-x-auto rounded-lg border border-border dark:border-pulse-border">
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="bg-cream-surface dark:bg-pulse-surface">
          {headers.map((h) => (
            <th
              key={h}
              className="border-b border-border px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-[0.06em] text-text-muted dark:border-pulse-border dark:text-text-muted"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={i}
            className="border-b border-border/60 last:border-0 dark:border-pulse-border/60"
          >
            {row.map((cell, j) => (
              <td
                key={j}
                className="px-3 py-2 align-top text-text-secondary dark:text-text-secondary"
              >
                {typeof cell === 'string' ? cell : cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ─── Pages ─────────────────────────────────────────────────────────────────

export const DOC_GROUPS: { id: string; label: string }[] = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'platform', label: 'Platform' },
  { id: 'modules', label: 'Modules' },
  { id: 'chat', label: 'Conversational Agent' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'reference', label: 'Reference' },
];

export const DOC_PAGES: DocPage[] = [
  // ───────────────── Introduction ─────────────────
  {
    id: 'introduction',
    title: 'Introduction',
    group: 'getting-started',
    summary: 'Overview of the Naavik Unified UX platform.',
    sections: [
      {
        id: 'what-is-naavik',
        title: 'What is Naavik',
        body: (
          <>
            <P>
              Naavik is an AI-assisted operations platform for radio access network monitoring,
              root-cause analysis, parameter provisioning, and rApp development. It unifies four
              workspaces — Observe, AppGen, Provision, and a conversational agent — behind a single
              authentication and chat layer.
            </P>
            <P>
              The platform reads from a local PostgreSQL mirror of the customer's network data and
              falls back transparently to the remote MSSQL source for any data not yet mirrored.
              All AI features are grounded in a live schema reference and an Ericsson EIAP DataDict
              of approximately 16,000 parameters.
            </P>
          </>
        ),
      },
      {
        id: 'product-areas',
        title: 'Product areas',
        body: (
          <>
            <UL>
              <li>
                <strong>Naavik Chat</strong> — multi-stream agentic assistant with function-calling
                tool use, structured diagnoses, and inline UI blocks.
              </li>
              <li>
                <strong>Naavik Observe</strong> — interactive site map, KPI dashboards, site detail
                panel with five tabs, AI Site Analyzer, worst-offender ranking, cluster comparison.
              </li>
              <li>
                <strong>Naavik AppGen</strong> — six-stage AI pipeline for rApp generation,
                including planning, code, audit, tests, integration validation, and packaging.
              </li>
              <li>
                <strong>Naavik Provision</strong> — change-request workflow with OSS adapter,
                simulator, and a status board for in-flight, completed, and failed changes.
              </li>
              <li>
                <strong>Knowledge Library</strong> — DataDict-grounded Q&amp;A, fuzzy KPI and
                parameter resolution, parameter-to-KPI cross-reference.
              </li>
            </UL>
          </>
        ),
      },
      {
        id: 'audience',
        title: 'Audience',
        body: (
          <P>
            This documentation is intended for radio access engineers, automation developers, and
            platform administrators. Familiarity with LTE and NR KPIs, Ericsson MO/EIAP naming, and
            basic SQL is assumed.
          </P>
        ),
      },
    ],
  },

  // ───────────────── Quickstart ─────────────────
  {
    id: 'quickstart',
    title: 'Quickstart',
    group: 'getting-started',
    summary: 'First five minutes — log in, pick a market, run an analysis.',
    sections: [
      {
        id: 'log-in',
        title: 'Log in',
        body: (
          <>
            <P>
              Open the application URL and sign in with your username and password. Sessions are
              persisted for four hours via a JWT stored in <Code>localStorage</Code>. Reloads do not
              require re-authentication while the token is valid.
            </P>
            <Note title="Note">
              Admin credentials are sourced from <Code>backend/.env</Code> at startup. If the
              server returns an authentication error on first boot, verify that{' '}
              <Code>ADMIN_USERNAME</Code>, <Code>ADMIN_PASSWORD_HASH</Code>, and{' '}
              <Code>JWT_SECRET</Code> are set.
            </Note>
          </>
        ),
      },
      {
        id: 'pick-a-market',
        title: 'Pick a market',
        body: (
          <P>
            On first login a modal asks you to select a market. Northern California is available
            today; additional markets appear as &ldquo;Coming soon&rdquo; pills. The selection
            persists in <Code>localStorage</Code> under <Code>naavik_market</Code> and can be
            changed later from the user menu.
          </P>
        ),
      },
      {
        id: 'set-default-landing',
        title: 'Set your default landing page',
        body: (
          <P>
            Open <strong>Settings → Appearance</strong> and choose where each login lands you —
            Home, Observe, or AppGen. The preference is stored per browser and used by{' '}
            <Code>getDefaultLandingPage()</Code> on app bootstrap.
          </P>
        ),
      },
      {
        id: 'run-an-analysis',
        title: 'Run your first analysis',
        body: (
          <>
            <OL>
              <li>Navigate to <strong>Observe</strong> from the left rail.</li>
              <li>Click any site marker on the map to open the site detail panel.</li>
              <li>Open the <strong>AI Analyzer</strong> tab to run a deep investigation.</li>
              <li>
                Alternatively, open <strong>Home</strong> and type
                <Code>analyse site 9787</Code> in the chat composer.
              </li>
            </OL>
            <P>
              The agent runs the site analysis tool suite in parallel, returns a diagnosis card,
              and stacks supporting evidence beneath it.
            </P>
          </>
        ),
      },
    ],
  },

  // ───────────────── Authentication ─────────────────
  {
    id: 'authentication',
    title: 'Authentication',
    group: 'getting-started',
    summary: 'Login flow, session lifetime, permissions.',
    sections: [
      {
        id: 'login-flow',
        title: 'Login flow',
        body: (
          <P>
            The login form posts <Code>{'{ username, password }'}</Code> to{' '}
            <Code>/api/auth/login</Code>. The backend validates the password against a bcrypt hash
            stored in <Code>backend/.env</Code>. On success the response includes a JWT signed with{' '}
            <Code>JWT_SECRET</Code> and a 24-hour expiry. The token is stored in localStorage as{' '}
            <Code>naavik_token</Code>.
          </P>
        ),
      },
      {
        id: 'session-lifetime',
        title: 'Session lifetime',
        body: (
          <P>
            On every reload, <Code>AppBootstrap</Code> calls <Code>/api/auth/verify</Code> with the
            existing token. Valid tokens silently re-hydrate the user; invalid or expired tokens
            return the user to the login page. The verify endpoint is the single source of truth
            for client-side session state.
          </P>
        ),
      },
      {
        id: 'permissions',
        title: 'Per-user app permissions',
        body: (
          <P>
            Each app in the platform registry has an optional permission key. The{' '}
            <Code>useAuth()</Code> context exposes a permission map keyed by app id. Hidden apps do
            not appear in the left rail. Admins manage permissions from{' '}
            <strong>Settings → App Permissions</strong>.
          </P>
        ),
      },
      {
        id: 'logout',
        title: 'Logout',
        body: (
          <P>
            Logging out from the profile menu clears the token from localStorage and reloads the
            page. There is no server-side session state to invalidate.
          </P>
        ),
      },
    ],
  },

  // ───────────────── Markets ─────────────────
  {
    id: 'markets',
    title: 'Markets',
    group: 'getting-started',
    summary: 'How market selection filters every view.',
    sections: [
      {
        id: 'overview',
        title: 'Overview',
        body: (
          <P>
            A market is a named collection of raw <Code>MARKET</Code> values from{' '}
            <Code>site_table</Code>. Selecting a market filters the map, dashboards, and site lists
            to sites whose raw market falls inside the configured set. The mapping lives in{' '}
            <Code>frontend/src/config/markets.ts</Code>.
          </P>
        ),
      },
      {
        id: 'available-markets',
        title: 'Available markets',
        body: (
          <RefTable
            headers={['Market', 'Status', 'Raw MARKET values included']}
            rows={[
              ['Northern California', 'Available', 'NORCAL'],
              ['Southern California', 'Coming soon', '—'],
              ['Pacific Northwest', 'Coming soon', '—'],
              ['Texas', 'Coming soon', '—'],
              ['Northeast', 'Coming soon', '—'],
            ]}
          />
        ),
      },
      {
        id: 'switching',
        title: 'Switching markets',
        body: (
          <P>
            Open the profile menu and click <strong>Market</strong>. The modal lets you switch
            without reloading. The new selection is written to localStorage and read by every
            market-aware component on its next render.
          </P>
        ),
      },
    ],
  },

  // ───────────────── Platform overview ─────────────────
  {
    id: 'platform-overview',
    title: 'Platform overview',
    group: 'platform',
    summary: 'Sidebar, app registry, theme, and inter-app navigation.',
    sections: [
      {
        id: 'sidebar',
        title: 'Left sidebar',
        body: (
          <>
            <P>
              The left rail collapses to a 68-pixel icon strip and expands to 248 pixels with full
              labels. It contains the workspace switcher, per-stream session history, and the
              profile menu. Tooltips render through a portal so they are never clipped by overflow
              containers.
            </P>
            <UL>
              <li><strong>Workspaces</strong> — Home, Observe, AppGen, Provision, Documentation.</li>
              <li><strong>Session history</strong> — per-stream prompt list, click to resend.</li>
              <li><strong>Profile menu</strong> — Market, Settings, Feedback, Log out.</li>
            </UL>
          </>
        ),
      },
      {
        id: 'app-registry',
        title: 'App registry',
        body: (
          <P>
            The registry lists every mountable app and its display name, icon, route, default chat
            stream, and required permission. The default registry is defined in{' '}
            <Code>frontend/src/platform/appRegistry.ts</Code>. At runtime,{' '}
            <Code>useAppRegistry()</Code> fetches the live registry from{' '}
            <Code>/platform/registry</Code> and falls back to the default if the fetch fails.
          </P>
        ),
      },
      {
        id: 'platform-bus',
        title: 'Platform bus',
        body: (
          <P>
            A lightweight publish/subscribe bus that lets any component request a navigation
            without prop-drilling. Chat, AppGen, and Provision all publish{' '}
            <Code>NAVIGATE_TO_APP</Code> events; the shell subscribes and routes the user to the
            requested workspace.
          </P>
        ),
      },
      {
        id: 'theme',
        title: 'Theme',
        body: (
          <P>
            The <Code>ThemeProvider</Code> exposes <Code>theme</Code> and <Code>setTheme</Code>{' '}
            with values <Code>light</Code>, <Code>dark</Code>, or <Code>auto</Code>. Auto follows
            the user&apos;s operating system preference. Selection is persisted in localStorage.
          </P>
        ),
      },
    ],
  },

  // ───────────────── Chat & Intent ─────────────────
  {
    id: 'chat',
    title: 'Conversational agent',
    group: 'chat',
    summary: 'Multi-stream chat, agent V3 orchestrator, structured synthesis.',
    sections: [
      {
        id: 'streams',
        title: 'Chat streams',
        body: (
          <>
            <P>
              Each workspace has a default stream that re-frames the agent&apos;s tool list, system
              prompt, and starter suggestions. Streams can be switched manually from the chat
              header.
            </P>
            <RefTable
              headers={['Stream', 'Purpose']}
              rows={[
                ['universal', 'Cross-module assistant. Default for Home.'],
                ['observability', 'Network monitoring and site analysis. Default for Observe.'],
                ['appgen', 'rApp creation and code generation. Default for AppGen.'],
                ['provision', 'Parameter changes and OSS orchestration. Default for Provision.'],
                ['knowledge', 'Telecom domain knowledge and DataDict lookup.'],
              ]}
            />
          </>
        ),
      },
      {
        id: 'agent-v3',
        title: 'Agent V3 orchestrator',
        body: (
          <>
            <P>
              The V3 orchestrator is a true OpenAI function-calling tool-use loop. On every turn it
              advertises the registered tools, lets the model pick which to invoke, executes the
              chosen tool calls in parallel via <Code>Promise.allSettled</Code>, and feeds the
              results back as <Code>tool</Code> messages for the next iteration.
            </P>
            <UL>
              <li>Default model: <Code>gpt-4o-mini</Code>.</li>
              <li>Maximum iterations: <Code>MAX_ITERATIONS = 8</Code>.</li>
              <li>Cancellation: every request flows through an <Code>AbortController</Code>.</li>
            </UL>
          </>
        ),
      },
      {
        id: 'tools',
        title: 'Tool registry',
        body: (
          <>
            <P>
              Twenty-one tools are registered. They split into three families.
            </P>
            <SubHeading>Generic tools</SubHeading>
            <UL>
              <li><Code>find_site</Code>, <Code>navigate_to</Code>, <Code>set_map_layer</Code></li>
              <li><Code>get_worst_offenders</Code>, <Code>get_site_rca</Code>, <Code>get_site_kpis</Code></li>
              <li><Code>show_kpi_dashboard</Code>, <Code>query_data</Code>, <Code>generate_report</Code></li>
              <li><Code>get_telecom_knowledge</Code>, <Code>resolve_kpi_param</Code></li>
            </UL>
            <SubHeading>Deep site-analysis tools</SubHeading>
            <UL>
              <li><Code>get_site_topology</Code>, <Code>get_config_changes</Code></li>
              <li><Code>get_neighbor_relations</Code>, <Code>get_neighbor_outages</Code></li>
              <li><Code>get_ret_changes</Code>, <Code>get_site_outages</Code></li>
              <li><Code>get_hourly_trends</Code>, <Code>get_kpi_impact_breakdown</Code></li>
              <li><Code>get_ticket_history</Code>, <Code>compare_with_cluster</Code></li>
            </UL>
            <P>
              All site-analysis tools accept a <Code>USID</Code> and a date or date range, and read
              from the local mirror first.
            </P>
          </>
        ),
      },
      {
        id: 'structured-synthesis',
        title: 'Structured synthesis',
        body: (
          <>
            <P>
              When the user asks the agent to investigate or analyse a site, the system prompt
              instructs the model to produce a six-section markdown synthesis. The orchestrator
              detects this format and replaces the chat bubble text with the headline, emitting a
              <Code>diagnosis_card</Code> UI block instead so the same content is not shown twice.
            </P>
            <Pre>
{`## Severity
## Headline
## What Changed
## What Degraded
## Likely Root Cause
## Next Actions`}
            </Pre>
          </>
        ),
      },
      {
        id: 'stop-button',
        title: 'Stop button',
        body: (
          <P>
            While a request is in flight the Send button morphs into an animated Stop button.
            Clicking it aborts the in-flight call via the shared <Code>AbortController</Code> and
            posts a system note &ldquo;Request stopped&rdquo;. The input is freed immediately for a
            new query.
          </P>
        ),
      },
      {
        id: 'attachments',
        title: 'Attachments',
        body: (
          <P>
            The composer accepts up to three attachments per message — CSV files up to 750 KB,
            images up to 900 KB, or plain text up to 120 KB. Attachments are sent inline in the
            chat payload.
          </P>
        ),
      },
      {
        id: 'session-history',
        title: 'Session history',
        body: (
          <P>
            Recent user prompts are grouped per stream in the expanded sidebar. Click any prompt to
            re-send it. History is local to the React state and resets on logout.
          </P>
        ),
      },
    ],
  },

  // ───────────────── KPI Validation & Cost Gate ─────────────────
  {
    id: 'agent-guardrails',
    title: 'Agent guardrails',
    group: 'chat',
    summary: 'KPI validation and cost-gating to prevent hallucinations and runaway queries.',
    sections: [
      {
        id: 'kpi-validation',
        title: 'KPI name validation',
        body: (
          <>
            <P>
              Before any data-fetching tool reaches the database, the requested KPI name is
              validated against the live schema reference and the DataDict catalog. The validator
              returns one of three outcomes.
            </P>
            <RefTable
              headers={['Outcome', 'Behaviour']}
              rows={[
                ['ok (exact or high-confidence fuzzy)', 'Proceed with the resolved canonical name.'],
                ['clarify (multiple candidates)', 'Return a chip selector and wait for the user to pick.'],
                ['unknown', 'Return a callout explaining that the KPI does not exist, with example real names.'],
              ]}
            />
            <P>
              This guardrail prevents the agent from fabricating charts for KPIs that do not exist.
              Similarity is computed as a weighted blend of token-overlap and edit distance against
              normalized KPI names.
            </P>
          </>
        ),
      },
      {
        id: 'cost-gate',
        title: 'Query cost gate',
        body: (
          <>
            <P>
              Generated SQL queries are cost-estimated before execution using table cardinalities,
              selectivity factors per filter, and a required-filter policy per table. The estimate
              produces a traffic-light tier.
            </P>
            <RefTable
              headers={['Tier', 'Action']}
              rows={[
                ['green', 'Run normally.'],
                ['yellow', 'Run, but log a slow-query warning with reasons.'],
                ['red', 'Refuse to run. Return a callout with the estimated cost and suggestion chips (pick a site, last 7 days, top 50 offenders, cancel).'],
              ]}
            />
            <P>
              Tables with high cardinality require specific filters. For example,{' '}
              <Code>hourly_intermediate_kpis_table</Code> requires both <Code>USID</Code> and{' '}
              <Code>DATE_ID</Code>. Queries missing required filters are gated to red regardless of
              the row estimate.
            </P>
          </>
        ),
      },
      {
        id: 'intent-classifier',
        title: 'Intent classifier',
        body: (
          <P>
            A three-layer classifier (explicit keyword, semantic embedding, and context-aware) maps
            free-form input to navigation, tools, or chat. It powers the navigation orchestrator —
            phrases like <Code>open observe</Code> or <Code>show me sites with alarms</Code>{' '}
            navigate the user and optionally pre-set filters or layers.
          </P>
        ),
      },
    ],
  },

  // ───────────────── Observe ─────────────────
  {
    id: 'observe',
    title: 'Naavik Observe',
    group: 'modules',
    summary: 'Map, layers, site detail panel, KPI dashboards.',
    sections: [
      {
        id: 'site-map',
        title: 'Site map',
        body: (
          <P>
            A Mapbox-GL map renders the 6,800+ sites in the selected market. Sites are coloured by
            severity — red for top degraded, orange for active outage, blue for nominal. Zoom, pan,
            and click any marker to open the site detail panel.
          </P>
        ),
      },
      {
        id: 'map-layers',
        title: 'Map layers',
        body: (
          <>
            <P>
              Three intelligence layers can be toggled from the map controls or from chat via the{' '}
              <Code>set_map_layer</Code> tool.
            </P>
            <RefTable
              headers={['Layer', 'Source']}
              rows={[
                ['degraded', 'Top offenders ranked by total CQX impact.'],
                ['outage', 'Sites with an active outage flag in site_table.'],
                ['overutilized', 'Sites whose PRB utilization exceeds the configured threshold.'],
              ]}
            />
          </>
        ),
      },
      {
        id: 'site-detail',
        title: 'Site detail panel',
        body: (
          <>
            <P>
              Clicking a site opens a sliding panel with five tabs. The header carries a Summary /
              Diagnostic toggle and a status pill row (e.g.{' '}
              <Code>TOP DEGRADED</Code>, <Code>OUTAGE</Code>).
            </P>
            <RefTable
              headers={['Tab', 'Content']}
              rows={[
                ['Site KPI', 'Multi-KPI dashboard with daily and hourly toggle.'],
                ['RCA', 'Animated root-cause story with evidence and an inline mini-map.'],
                ['Operational Info', 'Alarms, tickets, configuration changes, outages, and EIM orders for the site and its top neighbors over the last 7 days.'],
                ['Site Topology', 'Cells grouped by band with hover-lift tiles.'],
                ['AI Analyzer', 'Deep investigation workflow run on demand.'],
              ]}
            />
          </>
        ),
      },
      {
        id: 'kpi-dashboard',
        title: 'KPI dashboard',
        body: (
          <P>
            The dashboard renders up to eight KPIs simultaneously, each on its own line chart with
            a unit-aware Y-axis, anomaly markers, and a colour drawn from a shared 20-colour
            palette. The daily mode defaults to 30 days; hourly mode defaults to 48 hours. KPIs are
            grouped by category — Throughput, Accessibility, Utilization, Quality, Availability —
            and can be extended with user-defined custom KPIs.
          </P>
        ),
      },
      {
        id: 'worst-offenders',
        title: 'Worst offenders',
        body: (
          <P>
            A daily ranked list of sites by total CQX impact. Each row exposes a one-click link to
            the site detail panel and an inline <strong>Explain RCA</strong> button that triggers
            an in-line explanation in chat.
          </P>
        ),
      },
      {
        id: 'cluster-comparison',
        title: 'Cluster comparison',
        body: (
          <P>
            For any KPI, <Code>compare_with_cluster</Code> ranks the source site among its cluster
            peers and computes its percentile. Sites more than two standard deviations below the
            cluster mean are flagged as outliers. The output is rendered as a bar chart with the
            source site highlighted.
          </P>
        ),
      },
      {
        id: 'neighbor-overlay',
        title: 'Neighbor overlay',
        body: (
          <P>
            When viewing a site, top handover neighbors render as dashed lines on the map with
            handover-share labels. Clicking a neighbor pivots the panel to that site without
            losing context.
          </P>
        ),
      },
      {
        id: 'telemetry-dashboard',
        title: 'Telemetry dashboard',
        body: (
          <P>
            A five-tab telemetry view with semicircular gauges for headline KPIs (CQI, RSRP),
            hourly heatmaps, and KPI trend mini-charts. Designed for at-a-glance health monitoring
            without leaving the site context.
          </P>
        ),
      },
      {
        id: 'compass-dashboard',
        title: 'Compass market dashboard',
        body: (
          <P>
            A market-level KPI tile grid that aggregates across all selected sites. Intended as the
            at-a-glance Network Management home.
          </P>
        ),
      },
      {
        id: 'map-chat-bar',
        title: 'Map chat bar',
        body: (
          <P>
            A persistent chat input docked to the bottom of the map view. Pre-fills with the
            selected site&apos;s USID so users can ask &ldquo;what is wrong here&rdquo; without
            typing the identifier.
          </P>
        ),
      },
    ],
  },

  // ───────────────── AI Site Analyzer ─────────────────
  {
    id: 'site-analyzer',
    title: 'AI Site Analyzer',
    group: 'modules',
    summary: 'Deep investigation workflow inside the site detail panel.',
    sections: [
      {
        id: 'workflow',
        title: 'Investigation workflow',
        body: (
          <>
            <P>
              The Analyzer tab triggers a structured workflow that runs the deep site-analysis tool
              suite in parallel. The investigation steps are guided by the orchestrator&apos;s
              system prompt.
            </P>
            <OL>
              <li><Code>get_site_topology</Code> — understand cell and band structure.</li>
              <li><Code>get_site_outages</Code> — check for active or recent outages.</li>
              <li><Code>get_hourly_trends</Code> — look at the last three days of headline KPIs.</li>
              <li><Code>get_kpi_impact_breakdown</Code> — identify which CQX dimension is most affected.</li>
              <li><Code>get_config_changes</Code> — check parameter changes in the last 7 days.</li>
              <li><Code>get_ret_changes</Code> — check antenna tilt changes in the last 14 days.</li>
              <li><Code>get_neighbor_relations</Code> + <Code>get_neighbor_outages</Code> — assess the surrounding network.</li>
              <li><Code>compare_with_cluster</Code> — confirm whether the issue is site-specific.</li>
            </OL>
          </>
        ),
      },
      {
        id: 'output',
        title: 'Output layout',
        body: (
          <>
            <P>
              The analyzer renders a vertical stack:
            </P>
            <UL>
              <li>Hero severity card with an animated orb and the verdict headline.</li>
              <li>Four verdict-section cards — What Changed, Degraded, Likely Root Cause, Next Actions.</li>
              <li>An investigation trail listing which tools fired and what each returned.</li>
              <li>Grouped supporting evidence — charts, tables, callouts.</li>
            </UL>
          </>
        ),
      },
    ],
  },

  // ───────────────── AppGen ─────────────────
  {
    id: 'appgen',
    title: 'Naavik AppGen',
    group: 'modules',
    summary: 'Six-stage AI pipeline for rApp generation.',
    sections: [
      {
        id: 'pipeline',
        title: 'Six-stage pipeline',
        body: (
          <RefTable
            headers={['Stage', 'Agent', 'Output']}
            rows={[
              ['1. Planning', 'Planning agent', 'Target KPI, trigger condition, action, scope, failure modes.'],
              ['2. Code Generation', 'Code-gen agent', 'rApp code, config YAML, K8s manifests, tests.'],
              ['3. Code Audit', 'Audit agent', 'Security and correctness findings with severity tags.'],
              ['4. Unit Testing', 'Test agent', 'Unit tests for the rApp logic, run in a sandbox.'],
              ['5. Integration Validation', 'Integration agent', 'End-to-end smoke test against a simulated network.'],
              ['6. App Assembly', 'Assembly agent', 'Deployable bundle with manifests and metadata.'],
            ]}
          />
        ),
      },
      {
        id: 'conversational-builder',
        title: 'Conversational builder',
        body: (
          <P>
            The builder accepts a natural-language requirement, asks clarifying questions when the
            requirement is ambiguous, and produces a structured plan before any code is written.
            The plan is shown to the user for approval.
          </P>
        ),
      },
      {
        id: 'scaffold',
        title: 'Scaffold confirmation',
        body: (
          <P>
            Before code generation begins, the agent presents the file scaffold — the list of files
            that will be created and what each contains. The user can approve the scaffold or
            reject it and revise the plan.
          </P>
        ),
      },
      {
        id: 'live-files',
        title: 'Live file generation panel',
        body: (
          <P>
            Files appear in a side panel as they are written. Each file shows progress and a
            syntax-highlighted preview when complete. The Monaco editor lets you inspect and
            hand-edit any file inline.
          </P>
        ),
      },
      {
        id: 'state-machine',
        title: 'State machine and backward navigation',
        body: (
          <P>
            The pipeline is a state machine. Users can rewind to any prior stage, edit the output
            or the input, and re-run forward. State is persisted per project so iteration does not
            require restarting from scratch.
          </P>
        ),
      },
      {
        id: 'rapp-packager',
        title: 'rApp packager',
        body: (
          <P>
            The packager produces a Kubernetes-ready Helm chart with <Code>values.yaml</Code>, a
            deployment manifest, and a service manifest. The chart is downloadable or can be
            published to the internal catalog.
          </P>
        ),
      },
      {
        id: 'catalog',
        title: 'App catalog',
        body: (
          <P>
            A searchable catalog of existing rApps. Search uses embeddings plus a LangChain
            reranker to surface the most relevant prior art for a given goal. Clone any app as the
            starting point for a new project.
          </P>
        ),
      },
      {
        id: 'memory',
        title: 'AppGen memory',
        body: (
          <P>
            Per-project conversation memory is stored in PostgreSQL alongside cross-project
            lessons. The memory is surfaced as suggestions during planning, so prior best practices
            are reused automatically.
          </P>
        ),
      },
    ],
  },

  // ───────────────── Provision ─────────────────
  {
    id: 'provision',
    title: 'Naavik Provision',
    group: 'modules',
    summary: 'Parameter change workflow with OSS adapter framework.',
    sections: [
      {
        id: 'change-request',
        title: 'Change request flow',
        body: (
          <P>
            The change-request UI is a multi-step form that captures the target sites, parameter,
            old and new values, justification, and target window. Submitted requests are tracked
            through the provisioning status board.
          </P>
        ),
      },
      {
        id: 'oss-adapter',
        title: 'OSS adapter framework',
        body: (
          <P>
            A pluggable adapter interface backs both real OSS connectors (Ericsson Network Manager,
            MOSES) and an in-process simulator. The simulator is the default in development. ENM is
            feature-flagged per market.
          </P>
        ),
      },
      {
        id: 'status-board',
        title: 'Status board',
        body: (
          <P>
            Lists in-flight, completed, and failed changes. Each row exposes the OSS audit log and
            a one-click rollback option.
          </P>
        ),
      },
      {
        id: 'control-agent',
        title: 'Control agent automation',
        body: (
          <P>
            Chat phrases like <Code>increase qRxLevMin by 2 dB on USID 9787</Code> trigger the full
            pipeline: validate parameter, draft change, queue, push, monitor. Status streams back
            into the chat as a live <Code>execution_status</Code> block.
          </P>
        ),
      },
      {
        id: 'automation-templates',
        title: 'Automation templates',
        body: (
          <P>
            Pre-built templates such as HOSR-driven traffic balancing automatically pick the
            relevant neighbor relations, compute per-relation offsets, and push the change through
            the OSS layer.
          </P>
        ),
      },
    ],
  },

  // ───────────────── Knowledge ─────────────────
  {
    id: 'knowledge',
    title: 'Knowledge library',
    group: 'modules',
    summary: 'DataDict-grounded Q&A and parameter resolution.',
    sections: [
      {
        id: 'overview',
        title: 'Overview',
        body: (
          <P>
            The knowledge library is grounded in the Ericsson EIAP DataDict — approximately 16,000
            parameter entries indexed for exact, prefix, and fuzzy match. The DataDict is loaded
            into memory at backend startup.
          </P>
        ),
      },
      {
        id: 'qna',
        title: 'Q&amp;A',
        body: (
          <P>
            Ask &ldquo;what is qRxLevMin?&rdquo; or &ldquo;explain DATA_DROP_RATE&rdquo;. The
            system returns the parameter description, valid range, default value, and usage notes.
          </P>
        ),
      },
      {
        id: 'fuzzy-match',
        title: 'Fuzzy match',
        body: (
          <P>
            Misspelled or informal names (<Code>DL_TROUGHPUT</Code>, <Code>drop rate</Code>) are
            auto-corrected via trigram fuzzy match. When multiple candidates score similarly the
            system surfaces a chip selector and waits for the user to pick.
          </P>
        ),
      },
      {
        id: 'param-to-kpi',
        title: 'Parameter ↔ KPI cross-reference',
        body: (
          <P>
            Reverse lookup answers &ldquo;which parameters affect drop rate?&rdquo; by mapping
            every KPI to the parameters known to influence it.
          </P>
        ),
      },
    ],
  },

  // ───────────────── Data Layer ─────────────────
  {
    id: 'data-layer',
    title: 'Data layer and mirror',
    group: 'architecture',
    summary: 'Local Postgres mirror, daily sync, retention, and fall-through to remote.',
    sections: [
      {
        id: 'mirror-overview',
        title: 'Mirror overview',
        body: (
          <P>
            A dedicated <Code>mirror.*</Code> schema in the local Postgres holds faithful copies of
            14 remote tables. Column names, row shape, and data types all match. The mirror is
            built and maintained by the backend on startup.
          </P>
        ),
      },
      {
        id: 'offender-strategy',
        title: 'Offender-only strategy',
        body: (
          <P>
            The mirror only contains rows for offender USIDs — sites where{' '}
            <Code>chain_of_thought IS NOT NULL</Code> on a given day. That is approximately 50 to
            100 USIDs per day times 30 days, which keeps the dataset small while preserving full
            RCA detail.
          </P>
        ),
      },
      {
        id: 'backfill',
        title: 'Initial backfill',
        body: (
          <P>
            On first backend boot, a non-blocking backfill runs for the last 30 days. Days run
            sequentially and tables within a day run in parallel batches of four to keep both the
            remote and local databases responsive.
          </P>
        ),
      },
      {
        id: 'daily-sync',
        title: 'Daily incremental sync',
        body: (
          <P>
            A cron-style scheduler runs <Code>runForDate(yesterday)</Code> every day. The hour is
            configurable via the <Code>MIRROR_DAILY_HOUR_UTC</Code> environment variable; the
            default is 03:00 UTC.
          </P>
        ),
      },
      {
        id: 'retention',
        title: 'Retention sweep',
        body: (
          <P>
            After every daily sync, all mirror tables are pruned of rows older than 30 days. This
            keeps storage bounded and queries fast.
          </P>
        ),
      },
      {
        id: 'chunking',
        title: 'High-cardinality chunking',
        body: (
          <P>
            <Code>hourly_intermediate_kpis_table</Code> contains roughly 36,000 rows per offender
            per day. The sync chunks the offender USID list (five per chunk) and runs three
            concurrent chunks to avoid the ten-minute remote query timeout.
          </P>
        ),
      },
      {
        id: 'sargable',
        title: 'SARGable predicates',
        body: (
          <P>
            All mirror queries use <Code>date_id::date BETWEEN $1::date AND $2::date</Code> instead
            of <Code>CAST(DATE_ID AS DATE) =</Code>, so the planner can still use the{' '}
            <Code>date_id</Code> index.
          </P>
        ),
      },
      {
        id: 'mirror-or-remote',
        title: 'mirrorOrRemote router',
        body: (
          <P>
            A generic helper runs the local query first; on zero rows or an error, it transparently
            falls back to remote. Every site-analysis tool and the KPI dashboard use this router so
            users never see a missing-data gap.
          </P>
        ),
      },
      {
        id: 'shims',
        title: 'Legacy schema shims',
        body: (
          <P>
            <Code>public.filtered_sites</Code>, <Code>public.cqx_offenders_truth_table</Code>,{' '}
            <Code>public.filtered_cell_table</Code>, <Code>public.filtered_sector_table</Code>, and{' '}
            <Code>public.filtered_cell_sector_map_view</Code> are auto-created views over the
            mirror with PascalCase column aliases. Legacy callers continue to work without code
            changes.
          </P>
        ),
      },
      {
        id: 'admin',
        title: 'Admin endpoints',
        body: (
          <P>
            <Code>POST /api/mirror/backfill?days=30</Code> triggers a manual backfill.{' '}
            <Code>GET /api/mirror/status</Code> returns the latest run log. Both endpoints are
            JWT-protected.
          </P>
        ),
      },
    ],
  },

  // ───────────────── Schema Reference ─────────────────
  {
    id: 'schema-reference',
    title: 'Schema reference',
    group: 'architecture',
    summary: 'Remote tables, columns, and required filters.',
    sections: [
      {
        id: 'tables',
        title: 'Tables in scope',
        body: (
          <RefTable
            headers={['Table', 'Purpose', 'Approx rows (30 days)']}
            rows={[
              ['site_table', 'Site metadata, location, outage flag.', '204,000'],
              ['cell_table', 'Cell-level inventory and anomaly state.', '1,200,000'],
              ['sector_table', 'Sector-level metadata.', '300,000'],
              ['intermediate_kpi_table', 'Daily KPI values per cell.', '3,000,000'],
              ['hourly_intermediate_kpis_table', 'Hourly KPI values per cell.', '72,000,000'],
              ['subcomponent_table', 'CQX sub-component contributions.', '3,000,000'],
              ['cqx_offenders_truth_table', 'Daily offender ranking with impact scores.', '3,000'],
              ['configuration_parameters_table', 'Parameter change log (Old → New).', '30,000'],
              ['ret_table', 'Remote electrical tilt snapshots.', '900,000'],
              ['outage_table', 'Per-cell outage events.', '300,000'],
              ['ticket_table', 'Trouble tickets.', '6,000'],
              ['alarm_table', 'Active alarms.', '150,000'],
              ['eim_table', 'EIM work orders.', '15,000'],
              ['neighbors_table_date_id', 'Per-day neighbor relations with HO statistics.', '1,500,000'],
            ]}
          />
        ),
      },
      {
        id: 'required-filters',
        title: 'Required filters',
        body: (
          <>
            <P>
              Some tables are too large to scan unfiltered. The query cost gate enforces that the
              following filters are present before any query is sent to the remote source.
            </P>
            <RefTable
              headers={['Table', 'Required filters']}
              rows={[
                ['intermediate_kpi_table', 'USID'],
                ['hourly_intermediate_kpis_table', 'USID and DATE_ID'],
                ['subcomponent_table', 'USID'],
                ['configuration_parameters_table', 'USID'],
                ['outage_table', 'USID'],
                ['ret_table', 'USID'],
                ['neighbors_table_date_id', 'SOURCE_USID'],
              ]}
            />
            <P>
              Queries missing a required filter are rejected at the cost gate with a callout that
              suggests how to narrow the request — pick a site, choose the last seven days, or
              limit to the top 50 offenders.
            </P>
          </>
        ),
      },
      {
        id: 'schema-ref-cache',
        title: 'Live schema reference cache',
        body: (
          <P>
            The backend caches distinct KPI names, subcomponent names, and the column list of each
            table. The cache refreshes hourly and grounds both the SQL generator and the KPI
            validator.
          </P>
        ),
      },
    ],
  },

  // ───────────────── Generative UI ─────────────────
  {
    id: 'generative-ui',
    title: 'Generative UI blocks',
    group: 'reference',
    summary: 'The 22 visual primitives the agent can compose.',
    sections: [
      {
        id: 'overview',
        title: 'Overview',
        body: (
          <P>
            Every chat response is a stream of typed UI blocks. The renderer maps each block to a
            React component. Adjacent compact tables are automatically paired into a two-column
            grid for denser output.
          </P>
        ),
      },
      {
        id: 'block-types',
        title: 'Block types',
        body: (
          <RefTable
            headers={['Block', 'Purpose']}
            rows={[
              ['data_table', 'Interactive AG-Grid table with filter, sort, and per-row Explain-RCA.'],
              ['compact_table', 'Lightweight dense table; auto-styles numeric and anomaly columns.'],
              ['kpi_dashboard', 'Multi-KPI line chart panel with daily/hourly toggle.'],
              ['insight_chart', 'Single ECharts panel for ad-hoc visualizations.'],
              ['stat_row', 'Horizontal row of label/value stat tiles.'],
              ['callout', 'Tone-coloured info, success, warning, or error box.'],
              ['chips', 'Row of clickable pill prompts.'],
              ['ranked_list', 'Vertical ranked list with severity dots and trend sparkline.'],
              ['rca_story', 'Narrative root-cause card with steps, evidence, and conclusion.'],
              ['rca_summary', 'Condensed RCA card with bucket, confidence, and summary.'],
              ['ticket_escalation', 'Pre-filled escalation card.'],
              ['execution_status', 'Live workflow status with stage list and progress.'],
              ['tabs', 'Tabbed container with nested blocks per tab.'],
              ['grid_layout', 'Responsive multi-column container for nested blocks.'],
              ['map_inset', 'Inline Mapbox preview rendered inside a chat message.'],
              ['code_view', 'Syntax-highlighted code block with copy.'],
              ['diagnosis_card', 'Severity hero strip with four verdict-section cards.'],
              ['severity_meter', 'Horizontal gauge bars for KPI sub-components.'],
              ['topology_grid', 'Cells grouped by band with hover-lift tiles.'],
              ['saved_dashboard_modal', 'Persist a dashboard configuration.'],
              ['saved_dashboards', 'List of saved dashboards with reload, rename, delete.'],
              ['cost_warning', 'Cost-gate callout returned when a query would scan too much data.'],
            ]}
          />
        ),
      },
      {
        id: 'auto-pairing',
        title: 'Auto-pairing',
        body: (
          <P>
            When the agent emits two or more compact tables in a single response, the renderer
            automatically groups them into a two-column grid. This keeps multi-table answers
            scannable without an explicit layout request.
          </P>
        ),
      },
    ],
  },

  // ───────────────── Settings ─────────────────
  {
    id: 'settings',
    title: 'Settings',
    group: 'reference',
    summary: 'Personalization and admin controls.',
    sections: [
      {
        id: 'appearance',
        title: 'Appearance',
        body: (
          <UL>
            <li><strong>Theme</strong> — Light, Dark, or Auto.</li>
            <li><strong>Default landing page</strong> — Home, Observe, or AppGen.</li>
          </UL>
        ),
      },
      {
        id: 'kpi-library',
        title: 'KPI library',
        body: (
          <P>
            Edit the standard KPI groups and add user-saved custom KPIs. Custom KPIs appear in the
            KPI selector everywhere the dashboard is used.
          </P>
        ),
      },
      {
        id: 'app-permissions',
        title: 'App permissions',
        body: (
          <P>
            Admin-only. A matrix of users by registered apps; toggling a cell grants or revokes
            access. Disabled apps are hidden from the user&apos;s left rail.
          </P>
        ),
      },
      {
        id: 'appgen-defaults',
        title: 'AppGen defaults',
        body: (
          <P>
            Per-user defaults for AppGen runs — preferred LLM model, Kubernetes context, default
            OSS adapter, and scaffold preferences.
          </P>
        ),
      },
      {
        id: 'demo-mode',
        title: 'Demo mode (anonymized USIDs)',
        body: (
          <P>
            A single toggle that masks every real USID as <Code>UST######</Code> across the entire
            app. Reverse mapping is automatic in chat: a user can type the masked identifier and
            the system translates it back before sending to the backend.
          </P>
        ),
      },
      {
        id: 'saved-dashboards',
        title: 'Saved dashboards',
        body: (
          <P>
            Any KPI dashboard configuration (site, KPIs, timeframe, days) can be saved with a name.
            Saved dashboards appear in the sidebar with one-click reload, rename, and delete.
          </P>
        ),
      },
    ],
  },

  // ───────────────── Glossary ─────────────────
  {
    id: 'glossary',
    title: 'Glossary',
    group: 'reference',
    summary: 'Acronyms and terms used across the platform.',
    sections: [
      {
        id: 'terms',
        title: 'Terms',
        body: (
          <RefTable
            headers={['Term', 'Definition']}
            rows={[
              ['CQX', 'Composite Quality of Experience — Naavik’s blended quality score with sub-components for throughput, drop, accessibility, voice, and quality.'],
              ['DataDict', 'Ericsson EIAP parameter catalog. Approximately 16,000 entries with description, range, and default value.'],
              ['EIM', 'Engineering Information Management — internal change-management system.'],
              ['ENM', 'Ericsson Network Manager — OSS for parameter changes.'],
              ['HOSR', 'Handover Success Rate.'],
              ['KPI', 'Key Performance Indicator. Names follow the convention DL_DRB_TPUT, DATA_RAN_ACC, HOSR, etc.'],
              ['Offender', 'A site appearing in cqx_offenders_truth_table for a given day with a non-null chain_of_thought.'],
              ['PRB', 'Physical Resource Block — LTE/NR scheduling unit.'],
              ['RAN', 'Radio Access Network.'],
              ['RCA', 'Root Cause Analysis.'],
              ['rApp', 'Radio application packaged for a Kubernetes-based RIC.'],
              ['RET', 'Remote Electrical Tilt — antenna tilt control parameter.'],
              ['SARGable', 'Search-ARGument-able — a predicate the query planner can use with an index.'],
              ['USID', 'Unique Site Identifier — primary key for a site across all tables.'],
            ]}
          />
        ),
      },
    ],
  },

  // ───────────────── Troubleshooting ─────────────────
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    group: 'reference',
    summary: 'Common issues and their resolutions.',
    sections: [
      {
        id: 'login',
        title: 'I cannot log in',
        body: (
          <UL>
            <li>Confirm <Code>backend/.env</Code> defines <Code>ADMIN_USERNAME</Code>, <Code>ADMIN_PASSWORD_HASH</Code>, and <Code>JWT_SECRET</Code>.</li>
            <li>Clear localStorage and reload — a stale or expired token can wedge the bootstrap.</li>
            <li>Check the backend log for <Code>[auth]</Code> entries; bcrypt mismatches are logged explicitly.</li>
          </UL>
        ),
      },
      {
        id: 'no-data',
        title: 'A site shows &ldquo;no data&rdquo;',
        body: (
          <UL>
            <li>The USID may not be in the offender set, so the mirror has nothing. <Code>mirrorOrRemote</Code> should fall through to remote automatically; if it does not, check the run log.</li>
            <li>Hit <Code>GET /api/mirror/status</Code> to confirm a recent sync.</li>
            <li>Force a backfill with <Code>POST /api/mirror/backfill?days=7</Code>.</li>
          </UL>
        ),
      },
      {
        id: 'query-blocked',
        title: 'The agent says my query was blocked by the cost gate',
        body: (
          <P>
            The query was rejected because it would scan too much data. Use one of the suggestion
            chips returned with the callout: pick a site, choose the last seven days, or limit to
            the top 50 offenders.
          </P>
        ),
      },
      {
        id: 'unknown-kpi',
        title: 'The agent says my KPI does not exist',
        body: (
          <P>
            The requested name did not match the live schema or anything close enough in the
            DataDict. Try a canonical name such as <Code>DL_DRB_TPUT</Code>,{' '}
            <Code>DATA_RAN_ACC</Code>, <Code>HOSR</Code>, or <Code>DL_PKTLOSS_RT</Code>. The
            DataDict reference is searchable from the Knowledge stream.
          </P>
        ),
      },
      {
        id: 'agent-stuck',
        title: 'The agent appears stuck',
        body: (
          <P>
            Click the Stop button. The Send button morphs into a stop control while a request is in
            flight; clicking it aborts the in-flight call and frees the composer immediately.
          </P>
        ),
      },
      {
        id: 'mirror-slow',
        title: 'Initial backfill is taking a long time',
        body: (
          <P>
            The 30-day backfill of <Code>hourly_intermediate_kpis_table</Code> can take 10 to 20
            minutes in total on first boot. Subsequent daily syncs cover a single day and finish in
            under a minute. Use <Code>GET /api/mirror/status</Code> to monitor progress; the run
            log lists per-table durations.
          </P>
        ),
      },
    ],
  },
];
