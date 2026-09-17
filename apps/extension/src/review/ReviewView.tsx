import type { Finding, FindingStatus, ReviewResult } from '@desaignsync/shared-types';

const STATUS_CLASS: Record<FindingStatus, string> = {
  PASS: 'ds-badge--ready',
  FAIL: 'ds-badge--error',
  REVIEW: 'ds-badge--degraded',
  NOT_EVALUATED: 'ds-badge--stopped'
};

const OUTCOME_CLASS: Record<ReviewResult['match']['outcome'], string> = {
  primary: 'ds-badge--ready',
  inferred: 'ds-badge--degraded',
  review: 'ds-badge--degraded',
  'no-reliable-match': 'ds-badge--stopped'
};

const CATEGORY_LABEL: Record<string, string> = {
  component: 'Component',
  semantics: 'Semantics',
  color: 'Colors',
  typography: 'Typography',
  spacing: 'Spacing',
  shape: 'Shape',
  dimensions: 'Dimensions',
  accessibility: 'Accessibility'
};

const formatValue = (value: unknown): string => {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

const groupByCategory = (findings: readonly Finding[]): Array<{ category: string; findings: Finding[] }> => {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = groups.get(finding.category) ?? [];
    list.push(finding);
    groups.set(finding.category, list);
  }
  return [...groups.entries()].map(([category, list]) => ({ category, findings: list }));
};

/**
 * Auditable review result (DS-018 / DS-020 preview).
 * Match confidence is shown separately from the deterministic PASS/FAIL checklist, and the AI text
 * is always labelled as interpretation.
 */
export function ReviewView({ result }: { result: ReviewResult }): React.JSX.Element {
  const selected = result.match.selected;
  return (
    <div className="ds-review">
      <div className="ds-row">
        <span className="ds-match-name">
          {selected
            ? `${selected.componentName}${selected.variantName ? ` / ${selected.variantName}` : ''}`
            : 'No reliable match'}
        </span>
        <span className={`ds-badge ${OUTCOME_CLASS[result.match.outcome]}`}>
          {result.match.confidence !== undefined
            ? `${Math.round(result.match.confidence * 100)}%`
            : result.match.outcome}
        </span>
      </div>

      <div className="ds-row">
        <span>Observed</span>
        <span className="ds-muted">
          {result.evidence.tagName ?? 'unknown'}
          {result.evidence.role ? ` · role=${result.evidence.role}` : ''}
          {result.evidence.accessibleName ? ` · "${result.evidence.accessibleName}"` : ''}
        </span>
      </div>
      <div className="ds-row">
        <span>Evidence coverage</span>
        <span className="ds-muted">{Math.round(result.evidenceCoverage * 100)}%</span>
      </div>

      {result.match.candidates.length > 1 ? (
        <ul className="ds-list">
          {result.match.candidates.map((candidate, index) => (
            <li key={`${candidate.componentId}-${candidate.variantName ?? index}`} className="ds-row">
              <span className="ds-muted">
                {candidate.componentName}
                {candidate.variantName ? ` / ${candidate.variantName}` : ''}
              </span>
              <span className="ds-muted">{Math.round(candidate.confidence * 100)}%</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="ds-summary">
        <span className="ds-badge ds-badge--ready">PASS {result.summary.PASS}</span>
        <span className="ds-badge ds-badge--error">FAIL {result.summary.FAIL}</span>
        <span className="ds-badge ds-badge--degraded">REVIEW {result.summary.REVIEW}</span>
        <span className="ds-badge ds-badge--stopped">N/E {result.summary.NOT_EVALUATED}</span>
      </div>

      {groupByCategory(result.findings).map((group) => (
        <div key={group.category} className="ds-check-group">
          <h3>{CATEGORY_LABEL[group.category] ?? group.category}</h3>
          <ul className="ds-list">
            {group.findings.map((finding) => (
              <li key={finding.id} className="ds-check">
                <div className="ds-row">
                  <span>
                    <span className={`ds-badge ${STATUS_CLASS[finding.status]}`}>{finding.status}</span>{' '}
                    {finding.check}
                  </span>
                  <span className="ds-muted">{finding.severity}</span>
                </div>
                {finding.status === 'FAIL' || finding.status === 'REVIEW' ? (
                  <div className="ds-muted ds-check-detail">
                    observed {formatValue(finding.observed)} · expected {formatValue(finding.expected)}
                    {finding.tolerance !== undefined ? ` · tolerance ${formatValue(finding.tolerance)}` : ''}
                  </div>
                ) : null}
                {finding.explanation ? <div className="ds-muted ds-check-detail">{finding.explanation}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="ds-check-group">
        <h3>AI interpretation</h3>
        {result.llm.status === 'ok' ? (
          <>
            <p className="ds-note">{result.llm.interpretation ?? 'The model returned no summary.'}</p>
            {result.llm.recommendation ? (
              <p className="ds-note">Recommendation: {result.llm.recommendation}</p>
            ) : null}
            {result.llm.uncertainty ? <p className="ds-note">Uncertainty: {result.llm.uncertainty}</p> : null}
            {(result.llm.rejectedFindings ?? 0) > 0 ? (
              <p className="ds-note ds-badge--error">
                {result.llm.rejectedFindings} AI claim(s) contradicted a measured result and were discarded.
              </p>
            ) : null}
          </>
        ) : (
          <p className="ds-note">
            {result.llm.status === 'skipped'
              ? 'LLM interpretation was skipped; the deterministic checklist above is complete.'
              : `LLM interpretation failed (${result.llm.error?.code ?? 'error'}); the deterministic checklist above is complete.`}
          </p>
        )}
      </div>

      {result.warnings.length > 0 ? (
        <ul className="ds-upcoming">
          {result.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <p className="ds-note ds-review-footer">
        profile {result.versions.profile?.name ?? 'n/a'} · core prompt v{result.versions.corePromptVersion} (
        {result.versions.corePromptFingerprint}) · model {result.reproducibility.model ?? 'n/a'} · {result.durationMs} ms
      </p>
    </div>
  );
}
