import { useCallback, useId, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconCode,
  IconDiamond,
  IconKey,
  IconSatellite,
  IconSettings,
  IconShield,
  IconTimer,
  IconTrendingUp,
  type IconProps,
} from '@/components/ui/icons';
import { ConfigSection } from '@/components/config/ConfigSection';
import type {
  PayloadFilterRule,
  PayloadParamValidationErrorCode,
  PayloadRule,
  VisualConfigFieldPath,
  VisualConfigValidationErrorCode,
  VisualConfigValidationErrors,
  VisualConfigValues,
} from '@/types/visualConfig';
import {
  ApiKeysCardEditor,
  PayloadFilterRulesEditor,
  PayloadRulesEditor,
  PluginStoreAuthEditor,
  StringListEditor,
} from './VisualConfigEditorBlocks';
import type { ApiKeyMutation } from './ApiKeysCardEditor';
import styles from './VisualConfigEditor.module.scss';

type VisualSectionId =
  | 'server'
  | 'tls'
  | 'remote'
  | 'auth'
  | 'system'
  | 'network'
  | 'quota'
  | 'streaming'
  | 'payload';

type VisualSection = {
  id: VisualSectionId;
  title: string;
  description: string;
  icon: ComponentType<IconProps>;
  errorCount: number;
};

interface VisualConfigEditorProps {
  values: VisualConfigValues;
  changesPanel?: ReactNode;
  validationErrors?: VisualConfigValidationErrors;
  hasPayloadValidationErrors?: boolean;
  disabled?: boolean;
  onChange: (values: Partial<VisualConfigValues>) => void;
  onPersistApiKeyMutation: (mutation: ApiKeyMutation) => Promise<string[]>;
  onRefreshApiKeys: () => Promise<string[]>;
  onApiKeyOperationStart: () => void;
  onApiKeyOperationEnd: () => void;
}

function getValidationMessage(
  t: ReturnType<typeof useTranslation>['t'],
  errorCode?: VisualConfigValidationErrorCode | PayloadParamValidationErrorCode
) {
  if (!errorCode) return undefined;
  return t(`config_management.visual.validation.${errorCode}`);
}

type ToggleRowProps = {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
};

function ToggleRow({ title, description, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleCopy}>
        <div className={styles.toggleTitle}>{title}</div>
        {description ? <div className={styles.toggleDescription}>{description}</div> : null}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={title} />
    </div>
  );
}

function SectionGrid({ children }: { children: ReactNode }) {
  return <div className={styles.sectionGrid}>{children}</div>;
}

function SectionStack({ children }: { children: ReactNode }) {
  return <div className={styles.sectionStack}>{children}</div>;
}

function Divider() {
  return <div className={styles.divider} />;
}

function SectionSubsection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.subsection}>
      <div className={styles.subsectionHeader}>
        <h3 className={styles.subsectionTitle}>{title}</h3>
        {description ? <p className={styles.subsectionDescription}>{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function FieldShell({
  label,
  labelId,
  htmlFor,
  hint,
  hintId,
  error,
  errorId,
  children,
}: {
  label: string;
  labelId?: string;
  htmlFor?: string;
  hint?: string;
  hintId?: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.fieldShell}>
      <label id={labelId} htmlFor={htmlFor} className={styles.fieldLabel}>
        {label}
      </label>
      {children}
      {error ? (
        <div id={errorId} className="error-box">
          {error}
        </div>
      ) : null}
      {hint ? (
        <div id={hintId} className={styles.fieldHint}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function VisualConfigEditor({
  values,
  changesPanel,
  validationErrors,
  hasPayloadValidationErrors = false,
  disabled = false,
  onChange,
  onPersistApiKeyMutation,
  onRefreshApiKeys,
  onApiKeyOperationStart,
  onApiKeyOperationEnd,
}: VisualConfigEditorProps) {
  const { t } = useTranslation();
  const routingStrategyLabelId = useId();
  const routingStrategyHintId = `${routingStrategyLabelId}-hint`;
  const disableImageGenerationLabelId = useId();
  const disableImageGenerationHintId = `${disableImageGenerationLabelId}-hint`;
  const pluginStoreSourcesInputId = useId();
  const pluginStoreSourcesHintId = `${pluginStoreSourcesInputId}-hint`;
  const keepaliveInputId = useId();
  const keepaliveHintId = `${keepaliveInputId}-hint`;
  const keepaliveErrorId = `${keepaliveInputId}-error`;
  const nonstreamKeepaliveInputId = useId();
  const nonstreamKeepaliveHintId = `${nonstreamKeepaliveInputId}-hint`;
  const nonstreamKeepaliveErrorId = `${nonstreamKeepaliveInputId}-error`;
  const [searchParams, setSearchParams] = useSearchParams();
  const [categoryQuery, setCategoryQuery] = useState('');
  const categorySelectId = useId();

  const isKeepaliveDisabled =
    values.streaming.keepaliveSeconds === '' || values.streaming.keepaliveSeconds === '0';
  const isNonstreamKeepaliveDisabled =
    values.streaming.nonstreamKeepaliveInterval === '' ||
    values.streaming.nonstreamKeepaliveInterval === '0';

  const portError = getValidationMessage(t, validationErrors?.port);
  const logsMaxSizeError = getValidationMessage(t, validationErrors?.logsMaxTotalSizeMb);
  const errorLogsMaxFilesError = getValidationMessage(t, validationErrors?.errorLogsMaxFiles);
  const redisUsageQueueRetentionError = getValidationMessage(
    t,
    validationErrors?.redisUsageQueueRetentionSeconds
  );
  const transientErrorCooldownError = getValidationMessage(
    t,
    validationErrors?.transientErrorCooldownSeconds
  );
  const requestRetryError = getValidationMessage(t, validationErrors?.requestRetry);
  const maxRetryCredentialsError = getValidationMessage(t, validationErrors?.maxRetryCredentials);
  const maxRetryIntervalError = getValidationMessage(t, validationErrors?.maxRetryInterval);
  const authAutoRefreshWorkersError = getValidationMessage(
    t,
    validationErrors?.authAutoRefreshWorkers
  );
  const keepaliveError = getValidationMessage(t, validationErrors?.['streaming.keepaliveSeconds']);
  const bootstrapRetriesError = getValidationMessage(
    t,
    validationErrors?.['streaming.bootstrapRetries']
  );
  const nonstreamKeepaliveError = getValidationMessage(
    t,
    validationErrors?.['streaming.nonstreamKeepaliveInterval']
  );

  const handlePayloadDefaultRulesChange = useCallback(
    (payloadDefaultRules: PayloadRule[]) => onChange({ payloadDefaultRules }),
    [onChange]
  );
  const handlePayloadDefaultRawRulesChange = useCallback(
    (payloadDefaultRawRules: PayloadRule[]) => onChange({ payloadDefaultRawRules }),
    [onChange]
  );
  const handlePayloadOverrideRulesChange = useCallback(
    (payloadOverrideRules: PayloadRule[]) => onChange({ payloadOverrideRules }),
    [onChange]
  );
  const handlePayloadOverrideRawRulesChange = useCallback(
    (payloadOverrideRawRules: PayloadRule[]) => onChange({ payloadOverrideRawRules }),
    [onChange]
  );
  const handlePayloadFilterRulesChange = useCallback(
    (payloadFilterRules: PayloadFilterRule[]) => onChange({ payloadFilterRules }),
    [onChange]
  );

  const countErrors = useCallback(
    (fields: VisualConfigFieldPath[]) =>
      fields.reduce((total, field) => total + (validationErrors?.[field] ? 1 : 0), 0),
    [validationErrors]
  );

  const sections = useMemo<VisualSection[]>(
    () => [
      {
        id: 'server',
        title: t('config_management.visual.sections.server.title'),
        description: t('config_management.visual.sections.server.description'),
        icon: IconSettings,
        errorCount: countErrors(['port']),
      },
      {
        id: 'tls',
        title: t('config_management.visual.sections.tls.title'),
        description: t('config_management.visual.sections.tls.description'),
        icon: IconShield,
        errorCount: 0,
      },
      {
        id: 'remote',
        title: t('config_management.visual.sections.remote.title'),
        description: t('config_management.visual.sections.remote.description'),
        icon: IconSatellite,
        errorCount: 0,
      },
      {
        id: 'auth',
        title: t('config_management.visual.sections.auth.title'),
        description: t('config_management.visual.sections.auth.description'),
        icon: IconKey,
        errorCount: 0,
      },
      {
        id: 'system',
        title: t('config_management.visual.sections.system.title'),
        description: t('config_management.visual.sections.system.description'),
        icon: IconDiamond,
        errorCount: countErrors([
          'logsMaxTotalSizeMb',
          'errorLogsMaxFiles',
          'redisUsageQueueRetentionSeconds',
        ]),
      },
      {
        id: 'network',
        title: t('config_management.visual.sections.network.title'),
        description: t('config_management.visual.sections.network.description'),
        icon: IconTrendingUp,
        errorCount: countErrors([
          'requestRetry',
          'maxRetryCredentials',
          'maxRetryInterval',
          'transientErrorCooldownSeconds',
          'authAutoRefreshWorkers',
        ]),
      },
      {
        id: 'quota',
        title: t('config_management.visual.sections.quota.title'),
        description: t('config_management.visual.sections.quota.description'),
        icon: IconTimer,
        errorCount: 0,
      },
      {
        id: 'streaming',
        title: t('config_management.visual.sections.streaming.title'),
        description: t('config_management.visual.sections.streaming.description'),
        icon: IconSatellite,
        errorCount: countErrors([
          'streaming.keepaliveSeconds',
          'streaming.bootstrapRetries',
          'streaming.nonstreamKeepaliveInterval',
        ]),
      },
      {
        id: 'payload',
        title: t('config_management.visual.sections.payload.title'),
        description: t('config_management.visual.sections.payload.description'),
        icon: IconCode,
        errorCount: hasPayloadValidationErrors ? 1 : 0,
      },
    ],
    [countErrors, hasPayloadValidationErrors, t]
  );

  const activeSectionId =
    sections.find((section) => section.id === searchParams.get('section'))?.id ?? 'server';
  const visibleSections = sections.filter((section) =>
    `${section.title} ${section.description}`
      .toLocaleLowerCase()
      .includes(categoryQuery.trim().toLocaleLowerCase())
  );
  const selectSection = (sectionId: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('section', sectionId);
        return next;
      },
      { preventScrollReset: true }
    );
  };

  return (
    <div className={styles.visualEditor}>
      <div className={styles.workspace}>
        <nav className={styles.sidebar} aria-label={t('config_management.workspace.categories')}>
          <Input
            value={categoryQuery}
            onChange={(event) => setCategoryQuery(event.target.value)}
            placeholder={t('config_management.workspace.find_category')}
            aria-label={t('config_management.workspace.find_category')}
            type="search"
          />
          <div className={styles.navList}>
            {visibleSections.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`${styles.navButton} ${activeSectionId === section.id ? styles.navButtonActive : ''}`}
                  aria-current={activeSectionId === section.id ? 'page' : undefined}
                  onClick={() => selectSection(section.id)}
                >
                  <Icon size={16} />
                  <span className={styles.navLabel}>{section.title}</span>
                  {section.errorCount > 0 && (
                    <span
                      className={styles.navBadge}
                      aria-label={t('config_management.workspace.errors', {
                        count: section.errorCount,
                      })}
                    >
                      {section.errorCount}
                    </span>
                  )}
                </button>
              );
            })}
            {visibleSections.length === 0 && (
              <p className={styles.fieldHint}>{t('config_management.workspace.no_categories')}</p>
            )}
          </div>
        </nav>
        <div className={styles.mobileSectionNav}>
          <label htmlFor={categorySelectId}>{t('config_management.workspace.categories')}</label>
          <select
            id={categorySelectId}
            value={activeSectionId}
            onChange={(event) => selectSection(event.target.value)}
          >
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
                {section.errorCount
                  ? ` (${t('config_management.workspace.errors', { count: section.errorCount })})`
                  : ''}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.sections}>
          <ConfigSection
            id="server"
            hidden={activeSectionId !== 'server'}
            icon={<IconSettings size={16} />}
            title={t('config_management.visual.sections.server.title')}
            description={t('config_management.visual.sections.server.description')}
          >
            <SectionGrid>
              <Input
                label={t('config_management.visual.sections.server.host')}
                placeholder="0.0.0.0"
                value={values.host}
                onChange={(e) => onChange({ host: e.target.value })}
                disabled={disabled}
              />
              <Input
                label={t('config_management.visual.sections.server.port')}
                type="number"
                placeholder="8317"
                value={values.port}
                onChange={(e) => onChange({ port: e.target.value })}
                disabled={disabled}
                error={portError}
              />
            </SectionGrid>
          </ConfigSection>

          <ConfigSection
            id="tls"
            hidden={activeSectionId !== 'tls'}
            icon={<IconShield size={16} />}
            title={t('config_management.visual.sections.tls.title')}
            description={t('config_management.visual.sections.tls.description')}
          >
            <SectionStack>
              <ToggleRow
                title={t('config_management.visual.sections.tls.enable')}
                description={t('config_management.visual.sections.tls.enable_desc')}
                checked={values.tlsEnable}
                disabled={disabled}
                onChange={(tlsEnable) => onChange({ tlsEnable })}
              />

              {values.tlsEnable ? (
                <>
                  <Divider />
                  <SectionGrid>
                    <Input
                      label={t('config_management.visual.sections.tls.cert')}
                      placeholder="/path/to/cert.pem"
                      value={values.tlsCert}
                      onChange={(e) => onChange({ tlsCert: e.target.value })}
                      disabled={disabled}
                    />
                    <Input
                      label={t('config_management.visual.sections.tls.key')}
                      placeholder="/path/to/key.pem"
                      value={values.tlsKey}
                      onChange={(e) => onChange({ tlsKey: e.target.value })}
                      disabled={disabled}
                    />
                  </SectionGrid>
                </>
              ) : null}
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="remote"
            hidden={activeSectionId !== 'remote'}
            icon={<IconSatellite size={16} />}
            title={t('config_management.visual.sections.remote.title')}
            description={t('config_management.visual.sections.remote.description')}
          >
            <SectionStack>
              <ToggleRow
                title={t('config_management.visual.sections.remote.allow_remote')}
                description={t('config_management.visual.sections.remote.allow_remote_desc')}
                checked={values.rmAllowRemote}
                disabled={disabled}
                onChange={(rmAllowRemote) => onChange({ rmAllowRemote })}
              />
              <ToggleRow
                title={t('config_management.visual.sections.remote.disable_panel')}
                description={t('config_management.visual.sections.remote.disable_panel_desc')}
                checked={values.rmDisableControlPanel}
                disabled={disabled}
                onChange={(rmDisableControlPanel) => onChange({ rmDisableControlPanel })}
              />
              <ToggleRow
                title={t('config_management.visual.sections.remote.disable_auto_update_panel')}
                description={t(
                  'config_management.visual.sections.remote.disable_auto_update_panel_desc'
                )}
                checked={values.rmDisableAutoUpdatePanel}
                disabled={disabled}
                onChange={(rmDisableAutoUpdatePanel) => onChange({ rmDisableAutoUpdatePanel })}
              />
              <SectionGrid>
                <div>
                  <Input
                    label={t('config_management.visual.sections.remote.secret_key')}
                    type="password"
                    placeholder={t(
                      'config_management.visual.sections.remote.secret_key_placeholder'
                    )}
                    value={values.rmSecretKey}
                    onChange={(e) => {
                      const rmSecretKey = e.target.value;
                      onChange({
                        rmSecretKey,
                        rmSecretKeyAction: rmSecretKey.length > 0 ? 'replace' : 'unchanged',
                      });
                    }}
                    hint={t(
                      values.rmSecretKeyAction === 'clear'
                        ? 'config_management.visual.sections.remote.secret_key_clear_pending'
                        : values.rmSecretKeyConfigured
                          ? 'config_management.visual.sections.remote.secret_key_configured_hint'
                          : 'config_management.visual.sections.remote.secret_key_empty_hint'
                    )}
                    disabled={disabled}
                  />
                  <div className={styles.secretKeyActions}>
                    <Button
                      variant="secondary"
                      size="xs"
                      disabled={disabled || values.rmSecretKeyAction === 'unchanged'}
                      onClick={() => onChange({ rmSecretKey: '', rmSecretKeyAction: 'unchanged' })}
                    >
                      {t('config_management.visual.sections.remote.secret_key_keep')}
                    </Button>
                    <Button
                      variant="danger"
                      size="xs"
                      disabled={disabled || values.rmSecretKeyAction === 'clear'}
                      onClick={() => onChange({ rmSecretKey: '', rmSecretKeyAction: 'clear' })}
                    >
                      {t('config_management.visual.sections.remote.secret_key_clear')}
                    </Button>
                  </div>
                </div>
                <Input
                  label={t('config_management.visual.sections.remote.panel_repo')}
                  placeholder="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
                  value={values.rmPanelRepo}
                  onChange={(e) => onChange({ rmPanelRepo: e.target.value })}
                  disabled={disabled}
                />
              </SectionGrid>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="auth"
            hidden={activeSectionId !== 'auth'}
            icon={<IconKey size={16} />}
            title={t('config_management.visual.sections.auth.title')}
            description={t('config_management.visual.sections.auth.description')}
          >
            <SectionStack>
              <Input
                label={t('config_management.visual.sections.auth.auth_dir')}
                placeholder="~/.cli-proxy-api"
                value={values.authDir}
                onChange={(e) => onChange({ authDir: e.target.value })}
                disabled={disabled}
                hint={t('config_management.visual.sections.auth.auth_dir_hint')}
              />
              <div className={styles.subsection}>
                <ApiKeysCardEditor
                  value={values.apiKeysText}
                  disabled={disabled}
                  onPersistApiKeyMutation={onPersistApiKeyMutation}
                  onRefreshApiKeys={onRefreshApiKeys}
                  onApiKeyOperationStart={onApiKeyOperationStart}
                  onApiKeyOperationEnd={onApiKeyOperationEnd}
                />
              </div>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="system"
            hidden={activeSectionId !== 'system'}
            icon={<IconDiamond size={16} />}
            title={t('config_management.visual.sections.system.title')}
            description={t('config_management.visual.sections.system.description')}
          >
            <SectionStack>
              <SectionGrid>
                <ToggleRow
                  title={t('config_management.visual.sections.system.debug')}
                  description={t('config_management.visual.sections.system.debug_desc')}
                  checked={values.debug}
                  disabled={disabled}
                  onChange={(debug) => onChange({ debug })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.pprof_enable')}
                  description={t('config_management.visual.sections.system.pprof_enable_desc')}
                  checked={values.pprofEnable}
                  disabled={disabled}
                  onChange={(pprofEnable) => onChange({ pprofEnable })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.commercial_mode')}
                  description={t('config_management.visual.sections.system.commercial_mode_desc')}
                  checked={values.commercialMode}
                  disabled={disabled}
                  onChange={(commercialMode) => onChange({ commercialMode })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.usage_statistics_enabled')}
                  description={t(
                    'config_management.visual.sections.system.usage_statistics_enabled_desc'
                  )}
                  checked={values.usageStatisticsEnabled}
                  disabled={disabled}
                  onChange={(usageStatisticsEnabled) => onChange({ usageStatisticsEnabled })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.logging_to_file')}
                  description={t('config_management.visual.sections.system.logging_to_file_desc')}
                  checked={values.loggingToFile}
                  disabled={disabled}
                  onChange={(loggingToFile) => onChange({ loggingToFile })}
                />
                <ToggleRow
                  title={t('basic_settings.request_log_enable')}
                  description={t('basic_settings.request_log_warning')}
                  checked={values.requestLog}
                  disabled={disabled}
                  onChange={(requestLog) => onChange({ requestLog })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.plugins_enabled')}
                  description={t('config_management.visual.sections.system.plugins_enabled_desc')}
                  checked={values.pluginsEnabled}
                  disabled={disabled}
                  onChange={(pluginsEnabled) => onChange({ pluginsEnabled })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.antigravity_signature_cache')}
                  description={t(
                    'config_management.visual.sections.system.antigravity_signature_cache_desc'
                  )}
                  checked={values.antigravitySignatureCacheEnabled}
                  disabled={disabled}
                  onChange={(antigravitySignatureCacheEnabled) =>
                    onChange({ antigravitySignatureCacheEnabled })
                  }
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.antigravity_signature_strict')}
                  description={t(
                    'config_management.visual.sections.system.antigravity_signature_strict_desc'
                  )}
                  checked={values.antigravitySignatureBypassStrict}
                  disabled={disabled}
                  onChange={(antigravitySignatureBypassStrict) =>
                    onChange({ antigravitySignatureBypassStrict })
                  }
                />
              </SectionGrid>

              <SectionGrid>
                <Input
                  label={t('config_management.visual.sections.system.pprof_addr')}
                  placeholder="127.0.0.1:8316"
                  value={values.pprofAddr}
                  onChange={(e) => onChange({ pprofAddr: e.target.value })}
                  disabled={disabled}
                  hint={t('config_management.visual.sections.system.pprof_addr_hint')}
                />
                <Input
                  label={t('config_management.visual.sections.system.plugins_dir')}
                  placeholder="plugins"
                  value={values.pluginsDir}
                  onChange={(e) => onChange({ pluginsDir: e.target.value })}
                  disabled={disabled}
                  hint={t('config_management.visual.sections.system.plugins_dir_desc')}
                />
                <FieldShell
                  label={t('config_management.visual.sections.system.plugin_store_sources')}
                  htmlFor={pluginStoreSourcesInputId}
                  hint={t('config_management.visual.sections.system.plugin_store_sources_desc')}
                  hintId={pluginStoreSourcesHintId}
                >
                  <textarea
                    id={pluginStoreSourcesInputId}
                    className="input"
                    rows={4}
                    value={values.pluginStoreSourcesText}
                    onChange={(e) => onChange({ pluginStoreSourcesText: e.target.value })}
                    disabled={disabled}
                    aria-describedby={pluginStoreSourcesHintId}
                    placeholder="https://example.com/plugins.json"
                  />
                </FieldShell>
                <div className={styles.fieldWide}>
                  <FieldShell
                    label={t('config_management.visual.sections.system.plugin_store_auth')}
                    hint={t('config_management.visual.sections.system.plugin_store_auth_desc')}
                  >
                    <PluginStoreAuthEditor
                      value={values.pluginStoreAuth}
                      disabled={disabled}
                      onChange={(pluginStoreAuth) => onChange({ pluginStoreAuth })}
                    />
                  </FieldShell>
                </div>
              </SectionGrid>

              <SectionGrid>
                <Input
                  label={t('config_management.visual.sections.system.logs_max_size')}
                  type="number"
                  placeholder="0"
                  value={values.logsMaxTotalSizeMb}
                  onChange={(e) => onChange({ logsMaxTotalSizeMb: e.target.value })}
                  disabled={disabled}
                  error={logsMaxSizeError}
                />
                <Input
                  label={t('config_management.visual.sections.system.error_logs_max_files')}
                  type="number"
                  placeholder="5"
                  value={values.errorLogsMaxFiles}
                  onChange={(e) => onChange({ errorLogsMaxFiles: e.target.value })}
                  disabled={disabled}
                  error={errorLogsMaxFilesError}
                />
                <Input
                  label={t('config_management.visual.sections.system.redis_usage_queue_retention')}
                  type="number"
                  min="1"
                  max="3600"
                  placeholder="60"
                  value={values.redisUsageQueueRetentionSeconds}
                  onChange={(e) => onChange({ redisUsageQueueRetentionSeconds: e.target.value })}
                  disabled={disabled}
                  hint={t(
                    'config_management.visual.sections.system.redis_usage_queue_retention_hint'
                  )}
                  error={redisUsageQueueRetentionError}
                />
              </SectionGrid>

              <SectionSubsection
                title={t('config_management.visual.sections.system.devin_title')}
                description={t(
                  'config_management.visual.sections.system.devin_sensitive_words_desc'
                )}
              >
                <FieldShell
                  label={t('config_management.visual.sections.system.devin_sensitive_words_label')}
                  hint={t('config_management.visual.sections.system.devin_sensitive_words_hint')}
                >
                  <StringListEditor
                    value={values.devinSensitiveWords}
                    disabled={disabled}
                    placeholder={t(
                      'config_management.visual.sections.system.devin_sensitive_words_placeholder'
                    )}
                    inputAriaLabel={t(
                      'config_management.visual.sections.system.devin_sensitive_words_label'
                    )}
                    onChange={(devinSensitiveWords) => onChange({ devinSensitiveWords })}
                  />
                </FieldShell>
              </SectionSubsection>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="network"
            hidden={activeSectionId !== 'network'}
            icon={<IconTrendingUp size={16} />}
            title={t('config_management.visual.sections.network.title')}
            description={t('config_management.visual.sections.network.description')}
          >
            <SectionStack>
              <SectionSubsection title={t('config_management.workspace.account_selection')}>
                <SectionGrid>
                  <FieldShell
                    label={t('config_management.visual.sections.network.routing_strategy')}
                    labelId={routingStrategyLabelId}
                    hint={t(
                      values.routingStrategy === 'reset-first'
                        ? 'config_management.visual.sections.network.strategy_reset_first_hint'
                        : 'config_management.visual.sections.network.routing_strategy_hint'
                    )}
                    hintId={routingStrategyHintId}
                  >
                    <Select
                      value={values.routingStrategy}
                      options={[
                        {
                          value: 'round-robin',
                          label: t(
                            'config_management.visual.sections.network.strategy_round_robin'
                          ),
                        },
                        {
                          value: 'weighted-round-robin',
                          label: t(
                            'config_management.visual.sections.network.strategy_weighted_round_robin'
                          ),
                        },
                        {
                          value: 'reset-first',
                          label: t(
                            'config_management.visual.sections.network.strategy_reset_first'
                          ),
                        },
                        {
                          value: 'fill-first',
                          label: t('config_management.visual.sections.network.strategy_fill_first'),
                        },
                      ]}
                      id={`${routingStrategyLabelId}-select`}
                      disabled={disabled}
                      ariaLabelledBy={routingStrategyLabelId}
                      ariaDescribedBy={routingStrategyHintId}
                      onChange={(nextValue) =>
                        onChange({
                          routingStrategy: nextValue as VisualConfigValues['routingStrategy'],
                        })
                      }
                    />
                  </FieldShell>
                  <Input
                    label={t('config_management.visual.sections.network.session_affinity_ttl')}
                    placeholder="1h"
                    value={values.routingSessionAffinityTTL}
                    onChange={(e) => onChange({ routingSessionAffinityTTL: e.target.value })}
                    disabled={disabled}
                  />
                </SectionGrid>
                <ToggleRow
                  title={t('config_management.visual.sections.network.session_affinity')}
                  checked={values.routingSessionAffinity}
                  disabled={disabled}
                  onChange={(routingSessionAffinity) => onChange({ routingSessionAffinity })}
                />
              </SectionSubsection>

              <details
                className={styles.advancedGroup}
                open={
                  sections.find((section) => section.id === 'network')!.errorCount > 0 || undefined
                }
              >
                <summary>{t('config_management.workspace.connection_settings')}</summary>
                <SectionGrid>
                  <Input
                    label={t('config_management.visual.sections.network.proxy_url')}
                    placeholder="socks5://user:pass@127.0.0.1:1080/"
                    value={values.proxyUrl}
                    onChange={(e) => onChange({ proxyUrl: e.target.value })}
                    disabled={disabled}
                  />
                  <Input
                    label={t('config_management.visual.sections.network.request_retry')}
                    type="number"
                    placeholder="3"
                    value={values.requestRetry}
                    onChange={(e) => onChange({ requestRetry: e.target.value })}
                    disabled={disabled}
                    error={requestRetryError}
                  />
                  <Input
                    label={t('config_management.visual.sections.network.max_retry_credentials')}
                    type="number"
                    placeholder="0"
                    value={values.maxRetryCredentials}
                    onChange={(e) => onChange({ maxRetryCredentials: e.target.value })}
                    disabled={disabled}
                    hint={t('config_management.visual.sections.network.max_retry_credentials_hint')}
                    error={maxRetryCredentialsError}
                  />
                  <Input
                    label={t('config_management.visual.sections.network.max_retry_interval')}
                    type="number"
                    placeholder="30"
                    value={values.maxRetryInterval}
                    onChange={(e) => onChange({ maxRetryInterval: e.target.value })}
                    disabled={disabled}
                    error={maxRetryIntervalError}
                  />
                  <Input
                    label={t('config_management.visual.sections.network.auth_auto_refresh_workers')}
                    type="number"
                    placeholder="16"
                    value={values.authAutoRefreshWorkers}
                    onChange={(e) => onChange({ authAutoRefreshWorkers: e.target.value })}
                    disabled={disabled}
                    hint={t(
                      'config_management.visual.sections.network.auth_auto_refresh_workers_hint'
                    )}
                    error={authAutoRefreshWorkersError}
                  />
                  <Input
                    label={t(
                      'config_management.visual.sections.network.transient_error_cooldown_seconds'
                    )}
                    type="number"
                    placeholder="0"
                    value={values.transientErrorCooldownSeconds}
                    onChange={(e) => onChange({ transientErrorCooldownSeconds: e.target.value })}
                    disabled={disabled}
                    hint={t(
                      'config_management.visual.sections.network.transient_error_cooldown_seconds_hint'
                    )}
                    error={transientErrorCooldownError}
                  />
                  <FieldShell
                    label={t('config_management.visual.sections.network.disable_image_generation')}
                    labelId={disableImageGenerationLabelId}
                    hint={t(
                      'config_management.visual.sections.network.disable_image_generation_hint'
                    )}
                    hintId={disableImageGenerationHintId}
                  >
                    <Select
                      value={values.disableImageGeneration}
                      options={[
                        {
                          value: 'false',
                          label: t(
                            'config_management.visual.sections.network.disable_image_generation_false'
                          ),
                        },
                        {
                          value: 'true',
                          label: t(
                            'config_management.visual.sections.network.disable_image_generation_true'
                          ),
                        },
                        {
                          value: 'chat',
                          label: t(
                            'config_management.visual.sections.network.disable_image_generation_chat'
                          ),
                        },
                        {
                          value: 'passthrough',
                          label: t(
                            'config_management.visual.sections.network.disable_image_generation_passthrough'
                          ),
                        },
                      ]}
                      id={`${disableImageGenerationLabelId}-select`}
                      disabled={disabled}
                      ariaLabelledBy={disableImageGenerationLabelId}
                      ariaDescribedBy={disableImageGenerationHintId}
                      onChange={(nextValue) =>
                        onChange({
                          disableImageGeneration:
                            nextValue as VisualConfigValues['disableImageGeneration'],
                        })
                      }
                    />
                  </FieldShell>

                  <Input
                    label={t('config_management.visual.sections.network.gpt_image_2_base_model')}
                    placeholder="gpt-5.4-mini"
                    value={values.gptImage2BaseModel}
                    onChange={(e) => onChange({ gptImage2BaseModel: e.target.value })}
                    disabled={disabled}
                    hint={t(
                      'config_management.visual.sections.network.gpt_image_2_base_model_hint'
                    )}
                  />
                  <Input
                    label={t(
                      'config_management.visual.sections.network.video_result_auth_cache_ttl'
                    )}
                    placeholder="3h"
                    value={values.videoResultAuthCacheTtl}
                    onChange={(e) => onChange({ videoResultAuthCacheTtl: e.target.value })}
                    disabled={disabled}
                    hint={t(
                      'config_management.visual.sections.network.video_result_auth_cache_ttl_hint'
                    )}
                  />
                </SectionGrid>

                <SectionGrid>
                  <ToggleRow
                    title={t('config_management.visual.sections.network.force_model_prefix')}
                    description={t(
                      'config_management.visual.sections.network.force_model_prefix_desc'
                    )}
                    checked={values.forceModelPrefix}
                    disabled={disabled}
                    onChange={(forceModelPrefix) => onChange({ forceModelPrefix })}
                  />
                  <ToggleRow
                    title={t('config_management.visual.sections.network.passthrough_headers')}
                    description={t(
                      'config_management.visual.sections.network.passthrough_headers_desc'
                    )}
                    checked={values.passthroughHeaders}
                    disabled={disabled}
                    onChange={(passthroughHeaders) => onChange({ passthroughHeaders })}
                  />
                  <ToggleRow
                    title={t('config_management.visual.sections.network.disable_cooling')}
                    description={t(
                      'config_management.visual.sections.network.disable_cooling_desc'
                    )}
                    checked={values.disableCooling}
                    disabled={disabled}
                    onChange={(disableCooling) => onChange({ disableCooling })}
                  />
                  <ToggleRow
                    title={t('config_management.visual.sections.network.save_cooldown_status')}
                    description={t(
                      'config_management.visual.sections.network.save_cooldown_status_desc'
                    )}
                    checked={values.saveCooldownStatus}
                    disabled={disabled}
                    onChange={(saveCooldownStatus) => onChange({ saveCooldownStatus })}
                  />
                  <ToggleRow
                    title={t('config_management.visual.sections.network.disable_claude_cloak_mode')}
                    description={t(
                      'config_management.visual.sections.network.disable_claude_cloak_mode_desc'
                    )}
                    checked={values.disableClaudeCloakMode}
                    disabled={disabled}
                    onChange={(disableClaudeCloakMode) => onChange({ disableClaudeCloakMode })}
                  />

                  <ToggleRow
                    title={t('config_management.visual.sections.network.ws_auth')}
                    description={t('config_management.visual.sections.network.ws_auth_desc')}
                    checked={values.wsAuth}
                    disabled={disabled}
                    onChange={(wsAuth) => onChange({ wsAuth })}
                  />
                </SectionGrid>
              </details>
              <details className={styles.advancedGroup}>
                <summary>{t('config_management.visual.sections.headers.title')}</summary>
                <SectionSubsection
                  title={t('config_management.visual.sections.headers.title')}
                  description={t('config_management.visual.sections.headers.description')}
                >
                  <SectionStack>
                    <SectionSubsection
                      title={t('config_management.visual.sections.headers.claude_title')}
                    >
                      <SectionGrid>
                        <Input
                          label={t('config_management.visual.sections.headers.user_agent')}
                          value={values.claudeHeaderUserAgent}
                          onChange={(e) => onChange({ claudeHeaderUserAgent: e.target.value })}
                          disabled={disabled}
                        />
                        <Input
                          label={t('config_management.visual.sections.headers.package_version')}
                          value={values.claudeHeaderPackageVersion}
                          onChange={(e) => onChange({ claudeHeaderPackageVersion: e.target.value })}
                          disabled={disabled}
                        />
                        <Input
                          label={t('config_management.visual.sections.headers.runtime_version')}
                          value={values.claudeHeaderRuntimeVersion}
                          onChange={(e) => onChange({ claudeHeaderRuntimeVersion: e.target.value })}
                          disabled={disabled}
                        />
                        <Input
                          label={t('config_management.visual.sections.headers.os')}
                          value={values.claudeHeaderOs}
                          onChange={(e) => onChange({ claudeHeaderOs: e.target.value })}
                          disabled={disabled}
                        />
                        <Input
                          label={t('config_management.visual.sections.headers.arch')}
                          value={values.claudeHeaderArch}
                          onChange={(e) => onChange({ claudeHeaderArch: e.target.value })}
                          disabled={disabled}
                        />
                        <Input
                          label={t('config_management.visual.sections.headers.timeout')}
                          value={values.claudeHeaderTimeout}
                          onChange={(e) => onChange({ claudeHeaderTimeout: e.target.value })}
                          disabled={disabled}
                        />
                        <ToggleRow
                          title={t('config_management.visual.sections.headers.stabilize_device')}
                          description={t(
                            'config_management.visual.sections.headers.stabilize_device_desc'
                          )}
                          checked={values.claudeHeaderStabilizeDeviceProfile}
                          disabled={disabled}
                          onChange={(claudeHeaderStabilizeDeviceProfile) =>
                            onChange({ claudeHeaderStabilizeDeviceProfile })
                          }
                        />
                      </SectionGrid>
                    </SectionSubsection>

                    <SectionSubsection
                      title={t('config_management.visual.sections.headers.codex_title')}
                    >
                      <SectionGrid>
                        <Input
                          label={t('config_management.visual.sections.headers.user_agent')}
                          value={values.codexHeaderUserAgent}
                          onChange={(e) => onChange({ codexHeaderUserAgent: e.target.value })}
                          disabled={disabled}
                        />
                        <Input
                          label={t('config_management.visual.sections.headers.beta_features')}
                          value={values.codexHeaderBetaFeatures}
                          onChange={(e) => onChange({ codexHeaderBetaFeatures: e.target.value })}
                          disabled={disabled}
                        />
                        <ToggleRow
                          title={t('config_management.visual.sections.headers.identity_confuse')}
                          description={t(
                            'config_management.visual.sections.headers.identity_confuse_desc'
                          )}
                          checked={values.codexIdentityConfuse}
                          disabled={disabled}
                          onChange={(codexIdentityConfuse) => onChange({ codexIdentityConfuse })}
                        />
                      </SectionGrid>
                    </SectionSubsection>
                  </SectionStack>
                </SectionSubsection>
              </details>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="quota"
            hidden={activeSectionId !== 'quota'}
            icon={<IconTimer size={16} />}
            title={t('config_management.visual.sections.quota.title')}
            description={t('config_management.visual.sections.quota.description')}
          >
            <SectionGrid>
              <ToggleRow
                title={t('config_management.visual.sections.quota.switch_project')}
                description={t('config_management.visual.sections.quota.switch_project_desc')}
                checked={values.quotaSwitchProject}
                disabled={disabled}
                onChange={(quotaSwitchProject) => onChange({ quotaSwitchProject })}
              />
              <ToggleRow
                title={t('config_management.visual.sections.quota.switch_preview_model')}
                description={t('config_management.visual.sections.quota.switch_preview_model_desc')}
                checked={values.quotaSwitchPreviewModel}
                disabled={disabled}
                onChange={(quotaSwitchPreviewModel) => onChange({ quotaSwitchPreviewModel })}
              />
              <ToggleRow
                title={t('config_management.visual.sections.quota.antigravity_credits')}
                description={t('config_management.visual.sections.quota.antigravity_credits_desc')}
                checked={values.quotaAntigravityCredits}
                disabled={disabled}
                onChange={(quotaAntigravityCredits) => onChange({ quotaAntigravityCredits })}
              />
            </SectionGrid>
          </ConfigSection>

          <ConfigSection
            id="streaming"
            hidden={activeSectionId !== 'streaming'}
            icon={<IconSatellite size={16} />}
            title={t('config_management.visual.sections.streaming.title')}
            description={t('config_management.visual.sections.streaming.description')}
          >
            <SectionStack>
              <SectionGrid>
                <FieldShell
                  label={t('config_management.visual.sections.streaming.keepalive_seconds')}
                  htmlFor={keepaliveInputId}
                  hint={t('config_management.visual.sections.streaming.keepalive_hint')}
                  hintId={keepaliveHintId}
                  error={keepaliveError}
                  errorId={keepaliveErrorId}
                >
                  <div className={styles.fieldControl}>
                    <input
                      id={keepaliveInputId}
                      className="input"
                      type="number"
                      placeholder="0"
                      value={values.streaming.keepaliveSeconds}
                      onChange={(e) =>
                        onChange({
                          streaming: {
                            ...values.streaming,
                            keepaliveSeconds: e.target.value,
                          },
                        })
                      }
                      disabled={disabled}
                    />
                    {isKeepaliveDisabled ? (
                      <span className={styles.inlinePill}>
                        {t('config_management.visual.sections.streaming.disabled')}
                      </span>
                    ) : null}
                  </div>
                </FieldShell>

                <Input
                  label={t('config_management.visual.sections.streaming.bootstrap_retries')}
                  type="number"
                  placeholder="1"
                  value={values.streaming.bootstrapRetries}
                  onChange={(e) =>
                    onChange({
                      streaming: {
                        ...values.streaming,
                        bootstrapRetries: e.target.value,
                      },
                    })
                  }
                  disabled={disabled}
                  hint={t('config_management.visual.sections.streaming.bootstrap_hint')}
                  error={bootstrapRetriesError}
                />
              </SectionGrid>

              <SectionGrid>
                <FieldShell
                  label={t('config_management.visual.sections.streaming.nonstream_keepalive')}
                  htmlFor={nonstreamKeepaliveInputId}
                  hint={t('config_management.visual.sections.streaming.nonstream_keepalive_hint')}
                  hintId={nonstreamKeepaliveHintId}
                  error={nonstreamKeepaliveError}
                  errorId={nonstreamKeepaliveErrorId}
                >
                  <div className={styles.fieldControl}>
                    <input
                      id={nonstreamKeepaliveInputId}
                      className="input"
                      type="number"
                      placeholder="0"
                      value={values.streaming.nonstreamKeepaliveInterval}
                      onChange={(e) =>
                        onChange({
                          streaming: {
                            ...values.streaming,
                            nonstreamKeepaliveInterval: e.target.value,
                          },
                        })
                      }
                      disabled={disabled}
                    />
                    {isNonstreamKeepaliveDisabled ? (
                      <span className={styles.inlinePill}>
                        {t('config_management.visual.sections.streaming.disabled')}
                      </span>
                    ) : null}
                  </div>
                </FieldShell>
              </SectionGrid>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="payload"
            hidden={activeSectionId !== 'payload'}
            icon={<IconCode size={16} />}
            title={t('config_management.visual.sections.payload.title')}
            description={t('config_management.visual.sections.payload.description')}
          >
            <SectionStack>
              <SectionSubsection
                title={t('config_management.visual.sections.payload.default_rules')}
                description={t('config_management.visual.sections.payload.default_rules_desc')}
              >
                <PayloadRulesEditor
                  value={values.payloadDefaultRules}
                  disabled={disabled}
                  onChange={handlePayloadDefaultRulesChange}
                />
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.payload.default_raw_rules')}
                description={t('config_management.visual.sections.payload.default_raw_rules_desc')}
              >
                <PayloadRulesEditor
                  value={values.payloadDefaultRawRules}
                  disabled={disabled}
                  rawJsonValues
                  onChange={handlePayloadDefaultRawRulesChange}
                />
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.payload.override_rules')}
                description={t('config_management.visual.sections.payload.override_rules_desc')}
              >
                <PayloadRulesEditor
                  value={values.payloadOverrideRules}
                  disabled={disabled}
                  protocolFirst
                  onChange={handlePayloadOverrideRulesChange}
                />
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.payload.override_raw_rules')}
                description={t('config_management.visual.sections.payload.override_raw_rules_desc')}
              >
                <PayloadRulesEditor
                  value={values.payloadOverrideRawRules}
                  disabled={disabled}
                  protocolFirst
                  rawJsonValues
                  onChange={handlePayloadOverrideRawRulesChange}
                />
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.payload.filter_rules')}
                description={t('config_management.visual.sections.payload.filter_rules_desc')}
              >
                <PayloadFilterRulesEditor
                  value={values.payloadFilterRules}
                  disabled={disabled}
                  onChange={handlePayloadFilterRulesChange}
                />
              </SectionSubsection>
            </SectionStack>
          </ConfigSection>
        </div>
        {changesPanel && <aside className={styles.inspector}>{changesPanel}</aside>}
      </div>
    </div>
  );
}
