# ADR-008 — Probar dos proveedores OpenAI-compatible (remoto + local)

- **Fecha:** 2026-09-17
- **Estado:** Propuesto (pendiente de ejecución)
- **Spec:** §27 decisión pendiente 8 (§8, DoD §25)
- **Contexto:** V1 debe funcionar con cualquier endpoint OpenAI-compatible, con modelos manuales y fetch opcional.
- **Decisión:** Validar al menos **un proveedor remoto** (p. ej. OpenRouter) y **uno local**
  (p. ej. Ollama/LM Studio) con: `Test connection` mínimo sin datos de página, `GET {baseUrl}/models`
  cuando exista, alta manual de modelos, flag de visión (auto/yes/no) y temperature baja.
  La key vive en el Host (ADR-005).
- **Alternativas:** un solo proveedor (rechazado: no demuestra compatibilidad).
- **Consecuencias:** la UI de provider debe soportar ambos perfiles; documentar Base URLs y modelos probados.
- **Trazabilidad:** DS-003 (config provider, trabajo futuro).
