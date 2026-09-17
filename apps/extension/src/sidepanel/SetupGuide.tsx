import type { HostConnectionSnapshot } from './useHostConnection.js';
import type { TabId } from './Tabs.js';

export interface SetupGuideProps {
  hostState: HostConnectionSnapshot['state'];
  pairingOpen: boolean;
  inspectionReady: boolean;
  designSystemReady: boolean;
  llmReady: boolean;
  hasTarget: boolean;
  hasReview: boolean;
  onGoTo: (tab: TabId) => void;
}

interface StepView {
  title: string;
  detail: string;
  done: boolean;
  optional?: boolean;
  action?: { label: string; tab: TabId };
}

/**
 * Step-by-step onboarding (DS-028): shows what is still missing and links to the right tab.
 * It only reflects real state reported by the host; nothing is marked done optimistically.
 */
export function SetupGuide(props: SetupGuideProps): React.JSX.Element {
  const steps = buildSteps(props);
  const done = steps.filter((step) => step.done).length;

  return (
    <section className="ds-card">
      <div className="ds-row">
        <h2>Antes de revisar</h2>
        <span className="ds-muted">
          {done}/{steps.length}
        </span>
      </div>
      <ol className="ds-steps">
        {steps.map((step, index) => (
          <li key={step.title} className={`ds-step ${step.done ? 'ds-step--done' : 'ds-step--todo'}`}>
            <span className="ds-step-index">{step.done ? '✓' : index + 1}</span>
            <span className="ds-step-body">
              <span className="ds-step-title">
                {step.title}
                {step.optional === true ? <span className="ds-muted"> · opcional</span> : null}
              </span>
              <span className="ds-step-detail ds-muted">{step.detail}</span>
              {step.action !== undefined && !step.done ? (
                <span className="ds-step-actions">
                  <button
                    className="ds-button ds-button--chip"
                    type="button"
                    onClick={() => {
                      if (step.action !== undefined) props.onGoTo(step.action.tab);
                    }}
                  >
                    {step.action.label}
                  </button>
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const buildSteps = ({
  hostState,
  pairingOpen,
  inspectionReady,
  designSystemReady,
  llmReady,
  hasTarget,
  hasReview
}: SetupGuideProps): StepView[] => [
  {
    title: 'Arranca el Local Host y empareja',
    detail:
      hostState === 'connected'
        ? 'Host conectado y sesión activa.'
        : hostState === 'pairing-required'
          ? pairingOpen
            ? 'Pega el pairing code que imprime la terminal del host.'
            : 'La ventana de pairing está cerrada: reinicia el host con npm run host.'
          : 'Ejecuta npm run host en el repo y empareja este panel.',
    done: hostState === 'connected'
  },
  {
    title: 'Conecta Chrome DevTools MCP',
    detail: inspectionReady
      ? 'Fuente de evidencia lista.'
      : 'En MCP, pulsa Test en Chrome DevTools (lanza chrome-devtools-mcp).',
    done: inspectionReady,
    action: { label: 'Ir a MCP', tab: 'mcp' }
  },
  {
    title: 'Conecta tu Design System MCP',
    detail: designSystemReady
      ? 'Referencia del Design System lista.'
      : 'Añade el MCP de tu Design System (Storybook u otro) y conéctalo.',
    done: designSystemReady,
    action: { label: 'Ir a MCP', tab: 'mcp' }
  },
  {
    title: 'Configura el proveedor LLM',
    detail: llmReady
      ? 'Interpretación AI disponible.'
      : 'Sin proveedor el review sigue: solo verás los resultados determinísticos.',
    done: llmReady,
    optional: true,
    action: { label: 'Ir a LLM', tab: 'llm' }
  },
  {
    title: 'Selecciona un elemento y revisa',
    detail: hasReview
      ? 'Revisión completada.'
      : hasTarget
        ? 'Elemento seleccionado; pulsa Review element en Revisar.'
        : 'Usa Select element sobre la página auditada (http/https).',
    done: hasTarget && hasReview,
    action: { label: 'Ir a Revisar', tab: 'review' }
  }
];
