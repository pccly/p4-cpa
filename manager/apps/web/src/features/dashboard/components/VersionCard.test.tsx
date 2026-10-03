import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { VersionCard } from './VersionCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ checkLatest: vi.fn(), checkManagerUpdateIndex: vi.fn() }));
vi.mock('@/services/api', () => ({ versionApi: api }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));
let renderer: ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
  vi.clearAllMocks();
});

async function render(appVersion = '1.0.0', apiVersion = '1.0.0') {
  await act(async () => {
    renderer = create(
      <MemoryRouter>
        <VersionCard
          appVersion={appVersion}
          apiVersion={apiVersion}
          cpaBase="http://cli-proxy-api:8317"
          connectionStatus="connected"
          usageEnabled
          usageLoading={false}
          collectorStatus={null}
          collectorLoading={false}
          errorLogCount={0}
          errorLogsLoading={false}
        />
      </MemoryRouter>
    );
  });
}

describe('P4 CPA version overview', () => {
  it('shows the actual product versions without release links or update requests', async () => {
    await render();
    const versions = renderer.root.findAll(
      (node) => node.type === 'div' && node.children.length === 1 && node.children[0] === '1.0.0'
    );
    expect(versions).toHaveLength(2);
    expect(renderer.root.findAll((node) => node.type === 'button')).toHaveLength(0);
    expect(
      renderer.root.findAll((node) => node.type === 'a' && /github|updates/.test(node.props.href))
    ).toHaveLength(0);
    expect(api.checkLatest).not.toHaveBeenCalled();
    expect(api.checkManagerUpdateIndex).not.toHaveBeenCalled();
  });
  it('does not hardcode the initial release over future runtime versions', async () => {
    await render('1.1.0', '1.2.0');
    const output = JSON.stringify(renderer.toJSON());
    expect(output).toContain('1.1.0');
    expect(output).toContain('1.2.0');
  });
  it('keeps health status and the error log navigation', async () => {
    await render();
    expect(JSON.stringify(renderer.toJSON())).toContain('dashboard.health_status');
    expect(renderer.root.findByType('a').props.href).toBe('/logs?tab=errors');
  });
});
