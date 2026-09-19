#!/usr/bin/env node
/**
 * Emulacion end-to-end de DesAIgnSync (equivalente al flujo real del Side Panel).
 *
 * Arranca, todo local y sin Chrome:
 *   1. un proveedor LLM OpenAI-compatible falso (en memoria),
 *   2. el Local MCP Host real,
 *   3. los fixtures MCP reales de Chrome DevTools y Design System,
 *   4. empareja por HTTP y ejecuta POST /inspection/review.
 *
 * Uso:  npm run build --workspace @desaignsync/local-host   (una vez)
 *       node scripts/emulate-review.mjs
 */
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST_ENTRY = join(REPO, 'apps/local-host/dist/index.js');
const CHROME_FIXTURE = join(REPO, 'tests/fixtures/chrome-devtools-mcp-fixture.mjs');
const DS_FIXTURE = join(REPO, 'tests/fixtures/design-system-mcp-fixture.mjs');

let startLocalHost;
try {
  ({ startLocalHost } = await import(HOST_ENTRY));
} catch {
  console.error(`No encuentro el host compilado en ${HOST_ENTRY}\nEjecuta: npm run build --workspace @desaignsync/local-host`);
  process.exit(1);
}

// ---------- 1. Proveedor LLM OpenAI-compatible falso ----------
const llmServer = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fixture-model-a' }] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const wantsJson = body?.response_format?.type === 'json_object';
      const content = wantsJson
        ? JSON.stringify({
            summary: 'El elemento usa Button / Primary del Design System; no veo desviaciones objetivas.',
            findings: [],
            recommendation: 'No hay cambios necesarios; revisar el estado de foco si aplica.',
            uncertainty: 'El estado de foco no se pudo observar con la evidencia disponible.'
          })
        : 'pong';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 900, completion_tokens: 60 }
        })
      );
      return;
    }
    res.writeHead(404).end();
  });
});
await new Promise((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
const llmPort = llmServer.address().port;

// ---------- 2. Local Host real ----------
const home = mkdtempSync(join(tmpdir(), 'desaignsync-emulate-'));
const host = await startLocalHost({
  env: { DESAIGNSYNC_HOME: home, DESAIGNSYNC_LOG_LEVEL: 'warn', DESAIGNSYNC_SECRET_BACKEND: 'file' },
  overrides: { port: 0 },
  connectAutoStart: false,
  servers: [
    {
      id: 'chrome-fixture',
      name: 'Chrome DevTools',
      transport: 'stdio',
      command: process.execPath,
      args: [CHROME_FIXTURE],
      role: 'inspection',
      enabled: true,
      autoStart: false,
      timeoutMs: 8000
    },
    {
      id: 'ds-fixture',
      name: 'Design System',
      transport: 'stdio',
      command: process.execPath,
      args: [DS_FIXTURE],
      role: 'design-system-reference',
      enabled: true,
      autoStart: false,
      timeoutMs: 8000
    }
  ]
});

const post = async (path, body, token) => {
  const response = await fetch(`${host.server.url}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
};

try {
  console.log('\n=== 1) HOST ===');
  console.log('api           ', host.server.url);
  console.log('pairing code  ', host.sessions.pairingCode);

  console.log('\n=== 2) MCP servers ===');
  await host.mcp.connect('chrome-fixture');
  await host.mcp.connect('ds-fixture');
  for (const status of host.mcp.listStatuses()) {
    if (status.serverId.endsWith('fixture')) {
      console.log(`${status.state.padEnd(7)} ${status.name} (${status.role}) · ${status.tools?.length ?? 0} tools`);
    }
  }

  console.log('\n=== 3) LLM provider ===');
  const saved = await host.providers.save({
    id: 'llm-fixture',
    name: 'LLM emulado (OpenAI-compatible)',
    baseUrl: `http://127.0.0.1:${llmPort}/v1`,
    apiKey: 'sk-fixture-secret',
    modelIds: ['fixture-model-a'],
    selectedModel: 'fixture-model-a',
    visionMode: 'no'
  });
  const probe = await host.providers.adapter('llm-fixture').testConnection();
  console.log(`provider ${saved.id} · testConnection ok=${probe.ok} · ${probe.value?.model}`);

  console.log('\n=== 4) Pairing (como el Side Panel) ===');
  const pair = await post('/session/pair', {
    pairingCode: host.sessions.pairingCode,
    clientName: 'emulacion'
  });
  const token = pair.body.token;
  console.log('pairing status', pair.status, '· token', `${String(token).slice(0, 12)}...`);

  console.log('\n=== 5) REVIEW de un elemento ===');
  const review = await post(
    '/inspection/review',
    {
      target: {
        schemaVersion: 1,
        selector: '#save',
        tagName: 'button',
        rect: { x: 0, y: 0, width: 120, height: 40 },
        capturedAt: new Date().toISOString(),
        tabId: 1,
        url: 'https://example.test/'
      },
      profileId: 'design-qa',
      llmProviderId: 'llm-fixture',
      inspectionMcpId: 'chrome-fixture',
      designSystemMcpId: 'ds-fixture'
    },
    token
  );

  if (review.status !== 200) {
    console.error('ERROR', review.status, JSON.stringify(review.body).slice(0, 400));
    process.exitCode = 1;
  } else {
    const result = review.body;
    const selected = result.match.selected;
    console.log('\n--- INFORME ---');
    console.log(`Observado : <${result.evidence.tagName}> role=${result.evidence.role ?? '-'} nombre="${result.evidence.accessibleName ?? '-'}"`);
    console.log(
      `Match     : ${selected ? `${selected.componentName}${selected.variantName ? ` / ${selected.variantName}` : ''}` : 'No reliable match'} · ${Math.round((result.match.confidence ?? 0) * 100)}% (${result.match.outcome})`
    );
    console.log(`Cobertura : ${Math.round(result.evidenceCoverage * 100)}% de la evidencia esperada`);
    console.log('\nCandidatos:');
    for (const candidate of result.match.candidates) {
      console.log(
        `  ${String(Math.round(candidate.confidence * 100)).padStart(3)}%  ${candidate.componentName}${candidate.variantName ? ` / ${candidate.variantName}` : ''}`
      );
    }
    console.log('\nChecklist (checks con evidencia):');
    for (const finding of result.findings.filter((entry) => entry.status !== 'NOT_EVALUATED')) {
      const observed = finding.observed !== undefined ? ` obs=${JSON.stringify(finding.observed)}` : '';
      const expected = finding.expected !== undefined ? ` exp=${JSON.stringify(finding.expected)}` : '';
      console.log(`  ${finding.status.padEnd(5)} ${finding.check.padEnd(24)}${observed}${expected}`);
    }
    console.log(
      `\nResumen   : PASS ${result.summary.PASS} · FAIL ${result.summary.FAIL} · REVIEW ${result.summary.REVIEW} · NOT_EVALUATED ${result.summary.NOT_EVALUATED}`
    );
    console.log(
      `\nAI (${result.llm.status}${result.llm.model ? ` · ${result.llm.model}` : ''}): ${result.llm.interpretation ?? result.llm.error?.message ?? '-'}`
    );
    if (result.llm.recommendation) console.log(`Recomendacion: ${result.llm.recommendation}`);
    if (result.llm.uncertainty) console.log(`Incertidumbre: ${result.llm.uncertainty}`);
    console.log(
      `\nReproducibilidad: perfil=${result.versions.profile?.name} (${result.versions.profile?.tier}) · corePrompt v${result.versions.corePromptVersion} (${result.versions.corePromptFingerprint}) · ${result.durationMs} ms`
    );
    if (result.warnings.length > 0) console.log(`\nWarnings: ${result.warnings.join(' | ')}`);

    if (result.match.outcome === 'no-reliable-match' || result.summary.FAIL > 0) {
      process.exitCode = 1;
    }
  }
} finally {
  await host.shutdown();
  await new Promise((resolve) => llmServer.close(resolve));
  console.log('\nHost y LLM cerrados (sin procesos huerfanos).\n');
}
