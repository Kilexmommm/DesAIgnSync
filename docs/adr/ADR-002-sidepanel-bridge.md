# ADR-002 — Bridge Side Panel ↔ Local Host: loopback HTTP/WebSocket

- **Fecha:** 2026-09-17
- **Estado:** Aceptado
- **Spec:** §27 decisión pendiente 2 (§6.2, §8)
- **Contexto:** La extensión no puede lanzar procesos stdio. Opciones: loopback HTTP/WS autenticado vs Chrome Native Messaging.
- **Decisión:** V1 usa **HTTP/WebSocket sobre 127.0.0.1** con token de sesión efímero,
  CORS/origin allowlist limitado a `chrome-extension://<id>`, health/version endpoint,
  lifecycle start/ready/degraded/shutdown. Sin listener público. Native Messaging queda como
  alternativa futura de mayor aislamiento.
- **Alternativas:** Native Messaging desde V1 (rechazado: más fricción de instalación por SO);
  MCP stdio directo desde la extensión (rechazado: imposible técnicamente).
- **Consecuencias:** pairing simple, depuración con `/health`; obliga a gestionar token efímero y cerrar hijos MCP al apagar.
- **Trazabilidad:** DS-002, DS-003.
