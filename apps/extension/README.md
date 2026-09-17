# @desaignsync/extension

Extensión Chrome Manifest V3 de DesAIgnSync. El Side Panel (`chrome.sidePanel`)
es la superficie principal: estado del Host, Inspect / Audit Page y checklist.
Cliente del Local Host por loopback autenticado; nunca ejecuta `npx`/stdio ni
guarda secretos.

```bash
npm run build -w @desaignsync/extension
# Chrome: chrome://extensions → modo desarrollador → Load unpacked → apps/extension/dist
```

Ver `docs/backlog/DS-002.md` y `docs/adr/ADR-002-*`.

Trazabilidad: DS-002 (Extension MV3 Side Panel).
