# ADR-001 — Nombre final del producto y package IDs

- **Fecha:** 2026-09-17
- **Estado:** Aceptado
- **Spec:** §27 decisión pendiente 1
- **Contexto:** La spec v2.1 §27 exige elegir nombre final y package IDs antes de construir.
- **Decisión:** Producto **DesAIgnSync**. Root package `desaignsync` (privado, v0.1.0).
  Scoped packages: `@desaignsync/local-host`, `@desaignsync/extension`,
  `@desaignsync/core`, `@desaignsync/mcp-adapters`, `@desaignsync/shared-types`.
  Binario del host: `desaignsync-host`.
- **Alternativas:** nombre sin scope / bin genérico `host` (rechazado: colisiona en PATH y npm).
- **Consecuencias:** IDs estables para workspaces, imports y `Load unpacked`; renombrar después exige migrar storage y docs.
- **Trazabilidad:** DS-001 (Foundation).
