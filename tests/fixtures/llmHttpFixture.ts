import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * Fixture OpenAI-compatible endpoint (DS-008): a real HTTP server, no mocks.
 * `mode` controls the behaviors required by the acceptance criteria:
 *   ok         /models lists models, /chat/completions answers
 *   no-models  /models returns 404 (manual model IDs remain valid)
 *   auth-error /chat/completions returns 401
 */
export type LlmFixtureMode = 'ok' | 'no-models' | 'auth-error';

export interface StartedLlmFixture {
  url: string;
  close(): Promise<void>;
  lastChatPayload: () => Record<string, unknown> | undefined;
}

export const startLlmFixture = (mode: LlmFixtureMode = 'ok'): Promise<StartedLlmFixture> =>
  new Promise((resolve, reject) => {
    let lastChatPayload: Record<string, unknown> | undefined;
    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        if (req.method === 'GET' && req.url === '/v1/models') {
          if (mode === 'no-models') {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'no models endpoint' } }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ data: [{ id: 'fixture-model-a' }, { id: 'fixture-vision-model' }] })
          );
          return;
        }
        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
          lastChatPayload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          if (mode === 'auth-error') {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
            return;
          }
          const requested = lastChatPayload as { max_tokens?: number };
          const finish = requested.max_tokens === 1 ? 'length' : 'stop';
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: 'pong' }, finish_reason: finish }],
              usage: { prompt_tokens: 3, completion_tokens: 1 }
            })
          );
          return;
        }
        res.writeHead(404).end();
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        reject(new Error('LLM fixture did not bind.'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise<void>((done) => server.close(() => done())),
        lastChatPayload: () => lastChatPayload
      });
    });
  });