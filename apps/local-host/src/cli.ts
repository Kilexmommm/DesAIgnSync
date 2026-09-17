#!/usr/bin/env node
import { DEFAULT_PORT, HOST_VERSION, type LogLevel } from './config/hostConfig.js';
import { startLocalHost } from './host.js';

interface CliOptions {
  port?: number;
  logLevel?: string;
  pair: boolean;
  connectAutoStart: boolean;
  help: boolean;
  version: boolean;
}

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = { pair: false, connectAutoStart: true, help: false, version: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--port': {
        const value = argv[index + 1];
        index += 1;
        options.port = value ? Number.parseInt(value, 10) : DEFAULT_PORT;
        break;
      }
      case '--log-level': {
        const value = argv[index + 1];
        index += 1;
        options.logLevel = value;
        break;
      }
      case '--pair':
        options.pair = true;
        break;
      case '--no-autostart':
        options.connectAutoStart = false;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--version':
      case '-v':
        options.version = true;
        break;
      default:
        break;
    }
  }
  return options;
};

const printHelp = (): void => {
  process.stdout.write(
    [
      'DesAIgnSync Local MCP Host',
      '',
      'Usage: desaignsync-host [options]',
      '',
      '  --port <number>     Loopback port (default ' + DEFAULT_PORT + ', 0 picks a free port)',
      '  --log-level <level> silent | error | warn | info | debug',
      '  --pair              Open a new pairing window with a fresh code',
      '  --no-autostart      Do not connect autoStart MCP servers on boot',
      '  -h, --help          Show this help',
      '  -v, --version       Show the host version',
      ''
    ].join('\n')
  );
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.version) {
    process.stdout.write(`${HOST_VERSION}\n`);
    return;
  }

  const host = await startLocalHost({
    ...(options.port !== undefined ? { overrides: { port: options.port } } : {}),
    ...(options.logLevel !== undefined
      ? { overrides: { logLevel: options.logLevel as LogLevel } }
      : {}),
    connectAutoStart: options.connectAutoStart
  });

  if (options.pair) host.sessions.reopenPairingWindow();

  process.stdout.write(
    [
      '',
      'DesAIgnSync Local MCP Host',
      `  version        ${HOST_VERSION}`,
      `  api            ${host.server.url}`,
      `  pairing code   ${host.sessions.pairingCode}`,
      `  pairing open   ${host.sessions.isPairingOpen() ? 'yes' : 'no'}`,
      '  loopback only  127.0.0.1 (no public listener)',
      '',
      'Open the DesAIgnSync Side Panel and enter the pairing code in Settings.',
      'Press Ctrl+C to stop the host.',
      ''
    ].join('\n')
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\nReceived ${signal}; shutting down DesAIgnSync Local Host...\n`);
    try {
      await host.shutdown();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
};

main().catch((error: unknown) => {
  process.stderr.write(
    `DesAIgnSync Local Host failed to start: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});