import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getConfigChanges } from '../model/configChanges';
import styles from './ConfigChangesPanel.module.scss';

export function ConfigChangesPanel({
  original,
  modified,
  invalid,
  pending,
}: {
  original: string;
  modified: string;
  invalid: boolean;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const changes = useMemo(() => getConfigChanges(original, modified), [original, modified]);
  return (
    <details className={styles.panel} open>
      <summary>
        <span>{t('config_management.workspace.changes')}</span>
        {changes !== null && <span className={styles.count}>{changes.length}</span>}
      </summary>
      <div className={styles.body}>
        <p className={styles.note} role="status">
          {invalid || changes === null
            ? t('config_management.workspace.fix_errors')
            : changes.length
              ? t('config_management.workspace.pending_note')
              : t(
                  pending
                    ? 'config_management.workspace.source_edits'
                    : 'config_management.workspace.no_changes'
                )}
        </p>
        {changes?.map((change) => (
          <div className={styles.change} key={change.path}>
            <code className={styles.path}>{change.path}</code>
            {change.before !== undefined && (
              <div className={styles.before}>
                <span aria-label={t('config_management.workspace.before')}>−</span>
                <code>
                  {change.sensitive
                    ? t('config_management.workspace.hidden_value')
                    : change.before || '""'}
                </code>
              </div>
            )}
            {change.after !== undefined && (
              <div className={styles.after}>
                <span aria-label={t('config_management.workspace.after')}>+</span>
                <code>
                  {change.sensitive
                    ? t('config_management.workspace.hidden_value')
                    : change.after || '""'}
                </code>
              </div>
            )}
          </div>
        ))}
        {!!changes?.some((change) => change.sensitive) && (
          <p className={styles.note}>{t('config_management.workspace.hidden_note')}</p>
        )}
      </div>
    </details>
  );
}
