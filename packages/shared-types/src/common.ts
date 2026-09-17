/**
 * Cross-cutting primitives for DesAIgnSync.
 *
 * Design rule (spec v2.1 §14.1): measured facts and inferred facts must never be
 * mixed in the same field. `EvidenceKind` is how every value declares which it is.
 */

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/**
 * `observed`  - read directly from the inspected page / MCP reference.
 * `derived`   - computed deterministically from observed values (rules engine).
 * `unknown`   - not enough evidence; must never be presented as a fact.
 */
export type EvidenceKind = 'observed' | 'derived' | 'unknown';

/** Normalized 0..1 confidence. Only meaningful where inference exists. */
export type Confidence = number;

export interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const SHARED_TYPES_VERSION = '0.1.0';

/** Bump when the shape of `PageElementEvidence` changes incompatibly. */
export const EVIDENCE_SCHEMA_VERSION = 1;
