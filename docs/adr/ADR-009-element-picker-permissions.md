# ADR-009 — Permisos y garantías del Element Picker (DS-012)

- **Estado:** aceptada
- **Fecha:** 2026-09-17
- **Contexto de wave:** Wave 3 (DS-012)

## Contexto

DesAIgnSync debe permitir seleccionar visualmente un elemento de una aplicación web **sin
modificarla** (principio *read-only by default*, spec v2.1 §3). La extensión necesita saber sobre qué
elemento el usuario hizo clic para poder pedir su evidencia al Chrome DevTools MCP.

Opciones evaluadas:

1. **Solo `take_snapshot` vía Chrome MCP** (uid del árbol de accesibilidad): cero permisos sobre la
   página, pero exige que el MCP ya esté conectado y no permite apuntar con el mouse.
2. **Content script declarado en el manifest**: se inyecta en todas las páginas automáticamente;
   más intrusivo y con permisos permanentes amplios.
3. **`host_permissions: ["<all_urls>"]`**: consentimiento muy amplio y difícil de justificar.
4. **Permisos opcionales solicitados bajo demanda + `chrome.scripting.executeScript`** con una
   función autocontenida (elegida).

## Decisión

- El manifest declara `scripting` y `optional_host_permissions: ["http://*/*", "https://*/*"]`.
  **No** se declara `<all_urls>` ni ningún content script permanente.
- El permiso se pide desde el Side Panel (`chrome.permissions.request`) solo cuando el usuario
  pulsa **Select element**; el usuario puede revocarlo en cualquier momento.
- La selección se ejecuta con `chrome.scripting.executeScript({ func: pickElementInPage })`.
  Esa función es autocontenida (no puede importar módulos porque Chrome la serializa), dibuja un
  overlay propio con `pointer-events: none` y **elimina todo lo que agregó** antes de resolver.
- El picker devuelve un objeto serializable (`selector`, `tagName`, `rect`, `viewport`, `url`,
  `role`, `accessibleName`, `textHint`). Ese payload se considera **contenido no confiable**: se
  valida con `core.normalizeElementTarget()` antes de usarse.
- El picker **no recolecta evidencia**: no lee CSS computado ni ejecuta JS arbitrario en la página.
  La evidencia llega después por Chrome DevTools MCP (DS-005), que es la fuente autorizada.
- Páginas `chrome://` y `chrome-extension://` quedan fuera de alcance por diseño.

## Consecuencias

- Una sola vez por origen, el usuario ve el prompt de permisos de Chrome; después la selección es
  inmediata.
- La garantía de read-only es verificable: la extensión solo agrega/elimina sus propios nodos y no
  modifica atributos, estilos ni datos de la aplicación inspeccionada.
- Si el permiso se rechaza, el Side Panel muestra un error explicable y no inventa resultados
  (consistente con §20 de la especificación).
- `packages/ui` y Storybook no participan en este flujo.

## Alternativas descartadas

- **Content script permanente:** habría que mantener una UI inyectada en todas las pestañas y se
  pierde la noción de consentimiento por acción.
- **`<all_urls>`:** contradice el principio local-first y de mínimo privilegio, y complica la
  revisión de privacidad (DS-022).
- **Selección solo por snapshot:** se mantiene como alternativa de Expert (elegir un uid del
  snapshot) cuando Chrome MCP ya está conectado; no reemplaza al picker.
