/**
 * Naavik Companion Agent — minimal A2A server for demoing the A2A integration.
 *
 * Runs as a standalone Node process on port 9555. Naavik's A2A client connects
 * to it and discovers three skills:
 *
 *   summarize-incident   take a free-text incident description, return a structured report
 *   lookup-runbook       given an RCA bucket name, return the matching runbook content
 *   draft-escalation     given site + severity + summary, return a formatted escalation draft
 *
 * Why a separate process? It proves the A2A boundary — engineers see a real
 * second agent on a real second port, discovered via /.well-known/agent.json.
 *
 * No external deps: uses `node:http` only.  Logic is deterministic + template-
 * based on purpose so the demo never hits "OpenAI quota exceeded" mid-keynote.
 *
 * Start:
 *   cd backend && npm run demo:a2a
 * Then in Naavik UI:
 *   Settings → Integrations → A2A → Add agent
 *   URL: http://localhost:9555
 *   Auth: none
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';

const PORT = Number(process.env.A2A_COMPANION_PORT) || 9555;
const HOST = process.env.A2A_COMPANION_HOST || '0.0.0.0';

// ─── Agent Card (the manifest Naavik fetches) ─────────────────────────────

const AGENT_CARD = {
  name: 'Naavik Companion Agent',
  description:
    'A demo A2A peer agent that complements Naavik with ops-process skills — ' +
    'incident summarisation, runbook lookup, and escalation drafting.',
  url: `http://localhost:${PORT}`,
  version: '1.0.0',
  provider: { organization: 'Aira Technologies', url: 'https://aira.tech' },
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  authentication: { schemes: ['none'] },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    {
      id: 'summarize-incident',
      name: 'Summarise incident',
      description:
        'Take a free-text incident description and return a structured incident report — ' +
        'severity, affected scope, root-cause hypothesis, recommended next step.',
      examples: [
        'Summarise the incident: site 9787 lost coverage in sector A starting 18:00, root cause appears to be a tilt change on neighbor 9821.',
      ],
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Free-text incident narrative.' },
        },
        required: ['description'],
      },
    },
    {
      id: 'lookup-runbook',
      name: 'Look up runbook',
      description:
        'Return the on-call runbook for a specific RCA category (e.g. coverage_degradation, congestion).',
      examples: ['What runbook applies to coverage_degradation?'],
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'RCA bucket name (e.g. "coverage_degradation", "congestion", "outage").',
          },
        },
        required: ['category'],
      },
    },
    {
      id: 'draft-escalation',
      name: 'Draft escalation',
      description:
        'Produce a ready-to-send escalation note (email or ticket body) for a degraded site.',
      examples: ['Draft a high-severity escalation for site 9787.'],
      inputSchema: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          summary: { type: 'string', description: 'One-line incident summary.' },
        },
        required: ['siteId', 'severity'],
      },
    },
  ],
};

// ─── Static runbook content (small, deterministic, demo-safe) ─────────────

const RUNBOOKS: Record<string, { title: string; steps: string[]; primaryOwner: string }> = {
  coverage_degradation: {
    title: 'Coverage Degradation — Tilt / Power',
    primaryOwner: 'RF Optimization (on-call)',
    steps: [
      'Confirm the neighbour RET change date in `configuration_parameters_table`.',
      'Verify the offender site\'s sector boundary against the new neighbour footprint.',
      'If the tilt delta is ≥ 3°, schedule a reversion via Provision.',
      'Re-measure HOSR + RSRP over one busy hour to confirm recovery.',
    ],
  },
  congestion: {
    title: 'Congestion — Traffic Steering / Layer Balance',
    primaryOwner: 'Capacity Planning (on-call)',
    steps: [
      'Run the traffic-balancer recommendation and apply CIO shifts toward neighbours with PRB headroom.',
      'If congestion persists in busy hour, push reselection priority to a higher-band layer (LPE).',
      'After 24 h, validate via DL_DRB_TPUT recovery and PRB drop.',
      'If both fail, file a capacity-add request.',
    ],
  },
  outage: {
    title: 'Outage — Site or Sector',
    primaryOwner: 'Network Operations (24x7)',
    steps: [
      'Open a hardware/transport ticket for the affected eNB / gNB.',
      'Use outage_tilt_optimizer to identify neighbours that can extend coverage during the recovery window.',
      'Set a 30-minute revert reminder on any tilt changes.',
      'Close the incident only after the original cell is back up AND tilts are restored.',
    ],
  },
  interference: {
    title: 'Uplink Interference',
    primaryOwner: 'RF Optimization (on-call)',
    steps: [
      'Inspect uplink RSSI floor over 24h — confirm persistent elevation vs. transient spikes.',
      'Re-tune p0NominalPusch and alpha if power control is at fault.',
      'If RSSI is high without UE traffic, request a site visit for external-emitter scan.',
    ],
  },
};

// ─── Skill implementations ─────────────────────────────────────────────────

function summarizeIncident(input: { description?: string }): { text: string; data: Record<string, any> } {
  const desc = String(input.description ?? '').trim();
  if (!desc) {
    return { text: 'Need a `description` field in the input.', data: { ok: false } };
  }
  const usidMatch = desc.match(/\b(?:usid|site)\s*#?(\d{3,6})\b/i);
  const usid = usidMatch ? usidMatch[1] : null;
  const sectorMatch = desc.match(/sector\s+([a-z])\b/i);
  const timeMatch = desc.match(/(\d{1,2}:\d{2})/);
  const severity = /critical|down|outage/i.test(desc)
    ? 'critical'
    : /degraded|low throughput|coverage/i.test(desc)
      ? 'high'
      : 'medium';
  const rootCause = /tilt|ret/i.test(desc)
    ? 'Antenna tilt change on adjacent cell'
    : /power|tx/i.test(desc)
      ? 'Tx power adjustment'
      : /congestion|prb|traffic/i.test(desc)
        ? 'Organic traffic growth / congestion'
        : 'To be confirmed';
  const text = [
    `**Incident Summary**`,
    `- Site: ${usid ? `USID ${usid}` : '(not specified)'}`,
    `- Sector: ${sectorMatch ? sectorMatch[1].toUpperCase() : '(not specified)'}`,
    `- Start time: ${timeMatch ? timeMatch[1] : '(not specified)'}`,
    `- Severity: ${severity.toUpperCase()}`,
    `- Likely root cause: ${rootCause}`,
    `- Recommended next step: Run RCA via Naavik and validate via runbook lookup.`,
  ].join('\n');
  return {
    text,
    data: { usid, sector: sectorMatch?.[1] ?? null, severity, rootCauseHint: rootCause, raw: desc },
  };
}

function lookupRunbook(input: { category?: string }): { text: string; data: Record<string, any> } {
  const cat = String(input.category ?? '').trim().toLowerCase().replace(/[^a-z_]/g, '_');
  const candidates = Object.keys(RUNBOOKS);
  const hit = RUNBOOKS[cat] ?? RUNBOOKS[candidates.find((k) => cat.includes(k) || k.includes(cat)) ?? ''];
  if (!hit) {
    return {
      text: `No runbook for category "${input.category}". Known categories: ${candidates.join(', ')}.`,
      data: { found: false, categories: candidates },
    };
  }
  const text = [
    `**${hit.title}**`,
    `Primary owner: ${hit.primaryOwner}`,
    '',
    'Steps:',
    ...hit.steps.map((s, i) => `${i + 1}. ${s}`),
  ].join('\n');
  return { text, data: { found: true, ...hit } };
}

function draftEscalation(input: { siteId?: string; severity?: string; summary?: string }): {
  text: string;
  data: Record<string, any>;
} {
  const siteId = String(input.siteId ?? '').trim();
  const sev = String(input.severity ?? 'medium').toLowerCase();
  const summary = String(input.summary ?? 'Network degradation detected.').trim();
  const text = [
    `Subject: [${sev.toUpperCase()}] Site ${siteId || 'N/A'} — ${summary.slice(0, 80)}`,
    '',
    `Team,`,
    '',
    `We are observing a ${sev}-severity event on site ${siteId || '(unspecified)'}.`,
    '',
    `**Summary**`,
    summary,
    '',
    `**What we know**`,
    `- RCA category and root-cause hypothesis have been generated in Naavik.`,
    `- A recommended action plan is attached to this thread.`,
    `- Recovery time depends on the action class (revert vs. provision vs. hardware).`,
    '',
    `**Ask**`,
    `Please ack receipt and confirm on-call ownership. Acknowledge within 15 min for ${sev} severity.`,
    '',
    `— Naavik Operations Agent`,
  ].join('\n');
  return {
    text,
    data: { siteId, severity: sev, summary, generatedAt: new Date().toISOString() },
  };
}

// ─── JSON-RPC handler ─────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

function rpcResult(id: string | number, result: any): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}
function rpcError(id: string | number | null, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

function handleTaskSend(req: JsonRpcRequest): string {
  const params = req.params ?? {};
  const skillId = params?.metadata?.skillId ?? '';
  const messageParts = params?.message?.parts ?? [];

  // Pull both a text part and a data part from the incoming message — callers
  // can pass either form (text-only via free-form input or structured data).
  let textInput = '';
  let dataInput: Record<string, any> = {};
  for (const p of messageParts) {
    if (p?.type === 'text' && typeof p.text === 'string') textInput += (textInput ? '\n' : '') + p.text;
    if (p?.type === 'data' && p.data && typeof p.data === 'object') {
      dataInput = { ...dataInput, ...p.data };
    }
  }

  let output: { text: string; data: Record<string, any> };
  try {
    switch (skillId) {
      case 'summarize-incident':
        output = summarizeIncident({ description: dataInput.description ?? textInput });
        break;
      case 'lookup-runbook':
        output = lookupRunbook({ category: dataInput.category ?? textInput });
        break;
      case 'draft-escalation':
        output = draftEscalation({
          siteId: dataInput.siteId ?? (textInput.match(/\b\d{3,6}\b/)?.[0]),
          severity: dataInput.severity ?? 'medium',
          summary: dataInput.summary ?? textInput,
        });
        break;
      default:
        return rpcError(req.id, -32601, `Unknown skill "${skillId}"`);
    }
  } catch (err) {
    return rpcError(req.id, -32603, `Skill threw: ${(err as Error).message}`);
  }

  const task = {
    id: params.id || `task_${Date.now()}`,
    status: { state: 'completed' as const },
    artifacts: [
      {
        name: skillId,
        parts: [
          { type: 'text', text: output.text },
          { type: 'data', data: output.data },
        ],
      },
    ],
    message: { parts: [{ type: 'text', text: output.text }] },
  };
  return rpcResult(req.id, task);
}

// ─── HTTP server ──────────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body: string, contentType = 'application/json'): void {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => { buf += chunk; });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.end();
  }
  const url = req.url || '/';

  // Discovery
  if (req.method === 'GET' && (url === '/.well-known/agent.json' || url === '/agent.json')) {
    return send(res, 200, JSON.stringify(AGENT_CARD, null, 2));
  }

  // Health
  if (req.method === 'GET' && (url === '/' || url === '/health')) {
    return send(res, 200, JSON.stringify({ ok: true, agent: AGENT_CARD.name }));
  }

  // JSON-RPC
  if (req.method === 'POST') {
    try {
      const body = await readBody(req);
      const rpc = JSON.parse(body) as JsonRpcRequest;
      if (rpc?.jsonrpc !== '2.0' || !rpc.method) {
        return send(res, 400, rpcError(rpc?.id ?? null, -32600, 'Invalid JSON-RPC request'));
      }
      if (rpc.method === 'tasks/send') {
        return send(res, 200, handleTaskSend(rpc));
      }
      return send(res, 200, rpcError(rpc.id, -32601, `Method not implemented: ${rpc.method}`));
    } catch (err) {
      return send(res, 400, rpcError(null, -32700, `Parse error: ${(err as Error).message}`));
    }
  }

  return send(res, 404, JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[a2a-companion] listening on http://${HOST}:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[a2a-companion] Agent Card: http://${HOST}:${PORT}/.well-known/agent.json`);
  // eslint-disable-next-line no-console
  console.log(`[a2a-companion] Skills: ${AGENT_CARD.skills.map((s) => s.id).join(', ')}`);
});
