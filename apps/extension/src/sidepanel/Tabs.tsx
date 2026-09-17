export type TabId = 'review' | 'mcp' | 'llm' | 'profiles';

export interface TabDefinition {
  id: TabId;
  label: string;
}

interface TabBarProps {
  tabs: readonly TabDefinition[];
  active: TabId;
  onChange: (tab: TabId) => void;
}

/** Compact settings-style tab bar (DS-028). */
export function TabBar({ tabs, active, onChange }: TabBarProps): React.JSX.Element {
  return (
    <nav className="ds-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`ds-tab${active === tab.id ? ' ds-tab--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
