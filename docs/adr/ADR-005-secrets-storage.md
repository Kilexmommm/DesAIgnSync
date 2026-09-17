# ADR-005 — Almacenamiento de secrets por sistema operativo

- **Fecha:** 2026-09-17
- **Estado:** Aceptado
- **Spec:** §27 decisión pendiente 5 (§8)
- **Contexto:** API keys del proveedor LLM se configuran en el Host; prohibido guardarlas en `chrome.storage` o texto plano.
- **Decisión:** Secrets en **credential store del SO** (macOS Keychain, Windows Credential Manager,
  Linux Secret Service) cuando esté disponible; fallback local cifrado con permisos restrictivos.
  La configuración guarda Base URL/modelo/parámetros en claro y la key solo como referencia.
  El Host nunca retorna secretos al Side Panel (respuestas con redacción).
- **Alternativas:** `.env`/JSON en claro (rechazado: fuga en repos); `chrome.storage` (rechazado por spec).
- **Consecuencias:** requiere abstracción `secretStore` por SO + tests de redacción; UX con `Test connection` sin exponer la key.
- **Trazabilidad:** DS-003.
