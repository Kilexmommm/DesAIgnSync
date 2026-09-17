# @desaignsync/local-host

Local MCP Host de DesAIgnSync (Node.js/TypeScript). Puente entre el Side Panel,
los servidores MCP (stdio + streamable-http) y el proveedor LLM OpenAI-compatible.

- Solo escucha en loopback (`127.0.0.1`), token de sesión efímero, origin allowlist.
- `GET /health` → `{ version, status }`. Lifecycle: start/ready/degraded/shutdown.
- Configuración local de puerto/logging sin recompilar; secretos en credential store del SO.
- Binario: `desaignsync-host` (`bin/desaignsync-host.mjs`).

```bash
npm run build -w @desaignsync/local-host
npm run host            # desde la raíz
node dist/cli.js        # directo
```

Ver `docs/adr/ADR-002-*`, `ADR-005-*` y `docs/backlog/DS-003.md`, `DS-004.md`.
