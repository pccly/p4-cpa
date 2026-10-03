import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconCheck,
  IconExternalLink,
  IconInfo,
  IconSatellite,
  IconSettings,
  IconTimer,
} from '@/components/ui/icons';
import type { UsageServiceStatus } from '@/services/api/usageService';
import type { ConnectionStatus } from '@/types';
import styles from './VersionCard.module.scss';

interface VersionCardProps {
  appVersion: string;
  apiVersion: string;
  cpaBase: string;
  serverBuildDate?: string;
  connectionStatus: ConnectionStatus;
  refreshSignal?: number;
  usageEnabled: boolean;
  usageLoading: boolean;
  usageError?: string;
  collectorStatus: UsageServiceStatus | null;
  collectorLoading: boolean;
  collectorError?: string;
  errorLogCount: number;
  errorLogsLoading: boolean;
}

type HealthTone = 'ok' | 'warn' | 'error' | 'muted';

interface HealthItem {
  label: string;
  value: string;
  tone: HealthTone;
  icon: ReactNode;
  to?: string;
}

export function VersionCard({
  appVersion,
  apiVersion,
  cpaBase,
  serverBuildDate,
  usageEnabled,
  usageLoading,
  usageError,
  collectorStatus,
  collectorLoading,
  collectorError,
  errorLogCount,
  errorLogsLoading,
}: VersionCardProps) {
  const { t, i18n } = useTranslation();
  const buildTimeDisplay = serverBuildDate
    ? new Date(serverBuildDate).toLocaleString(i18n.language)
    : t('dashboard.version_unknown');

  const collector = collectorStatus?.collector;
  const collectorLastError = collector?.lastError?.trim() || '';
  const usageState: HealthItem = usageEnabled
    ? usageError
      ? {
          label: t('dashboard.health_usage_monitor'),
          value: t('dashboard.health_status_problem'),
          tone: 'error',
          icon: <IconInfo size={16} />,
        }
      : {
          label: t('dashboard.health_usage_monitor'),
          value: usageLoading ? '...' : t('dashboard.health_status_normal'),
          tone: usageLoading ? 'muted' : 'ok',
          icon: <IconCheck size={16} />,
        }
    : {
        label: t('dashboard.health_usage_monitor'),
        value: t('dashboard.health_status_disabled'),
        tone: 'muted',
        icon: <IconInfo size={16} />,
      };

  const collectorState: HealthItem = !usageEnabled
    ? {
        label: t('dashboard.collector_status_title'),
        value: t('dashboard.health_status_disabled'),
        tone: 'muted',
        icon: <IconInfo size={16} />,
      }
    : collectorError
      ? {
          label: t('dashboard.collector_status_title'),
          value: t('dashboard.collector_unavailable'),
          tone: 'error',
          icon: <IconInfo size={16} />,
        }
      : collectorLastError
        ? {
            label: t('dashboard.collector_status_title'),
            value: t('dashboard.health_status_warning'),
            tone: 'warn',
            icon: <IconInfo size={16} />,
          }
        : {
            label: t('dashboard.collector_status_title'),
            value:
              collectorLoading && !collectorStatus ? '...' : t('dashboard.health_status_normal'),
            tone: collectorLoading && !collectorStatus ? 'muted' : 'ok',
            icon: <IconCheck size={16} />,
          };

  const queueState: HealthItem = !usageEnabled
    ? {
        label: t('dashboard.health_queue_status'),
        value: t('dashboard.health_status_disabled'),
        tone: 'muted',
        icon: <IconInfo size={16} />,
      }
    : collectorError
      ? {
          label: t('dashboard.health_queue_status'),
          value: t('dashboard.collector_unavailable'),
          tone: 'error',
          icon: <IconInfo size={16} />,
        }
      : {
          label: t('dashboard.health_queue_status'),
          value:
            collector?.queue ||
            (collectorLoading && !collectorStatus ? '...' : t('dashboard.health_status_normal')),
          tone: collectorLoading && !collectorStatus ? 'muted' : 'ok',
          icon: <IconCheck size={16} />,
        };

  const errorLogState: HealthItem = {
    label: t('dashboard.health_error_logs'),
    value: errorLogsLoading
      ? '...'
      : errorLogCount > 0
        ? t('dashboard.health_error_log_count', { count: errorLogCount })
        : t('dashboard.health_status_normal'),
    tone: errorLogsLoading ? 'muted' : errorLogCount > 0 ? 'warn' : 'ok',
    icon: errorLogCount > 0 ? <IconInfo size={16} /> : <IconCheck size={16} />,
    to: '/logs?tab=errors',
  };

  const healthItems = [usageState, collectorState, queueState, errorLogState];

  return (
    <div className={styles.container}>
      <section className={styles.section}>
        <h2 className={styles.heading}>{t('dashboard.system_overview')}</h2>
        <div className={`${styles.grid} ${styles.systemGrid}`}>
          <div className={styles.item}>
            <div className={styles.icon}>
              <IconSettings size={18} />
            </div>
            <div className={styles.content}>
              <div className={styles.label}>{t('title.abbr')}</div>
              <div className={styles.value}>{appVersion || t('dashboard.version_unknown')}</div>
            </div>
          </div>

          <div className={styles.item}>
            <div className={styles.icon}>
              <IconSatellite size={18} />
            </div>
            <div className={styles.content}>
              <div className={styles.label}>{t('dashboard.api_version')}</div>
              <div className={styles.value}>{apiVersion || t('dashboard.version_unknown')}</div>
            </div>
          </div>

          <div className={styles.item}>
            <div className={styles.icon}>
              <IconTimer size={18} />
            </div>
            <div className={styles.content}>
              <div className={styles.label}>{t('dashboard.build_time')}</div>
              <div className={styles.value}>{buildTimeDisplay}</div>
            </div>
          </div>

          <div className={styles.item}>
            <div className={styles.icon}>
              <IconExternalLink size={18} />
            </div>
            <div className={styles.content}>
              <div className={styles.label}>{t('dashboard.cpa_base')}</div>
              <div className={styles.value}>{cpaBase || '-'}</div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{t('dashboard.health_status')}</h2>
        <div className={`${styles.grid} ${styles.healthGrid}`}>
          {healthItems.map((item) => {
            const content = (
              <>
                <div className={`${styles.healthIcon} ${styles[item.tone]}`}>{item.icon}</div>
                <div className={styles.content}>
                  <div className={styles.label}>{item.label}</div>
                  <div className={`${styles.value} ${styles[`${item.tone}Text`]}`}>
                    {item.value}
                  </div>
                </div>
              </>
            );

            return item.to ? (
              <Link
                key={item.label}
                to={item.to}
                className={`${styles.healthItem} ${styles.healthLink}`}
              >
                {content}
              </Link>
            ) : (
              <div key={item.label} className={styles.healthItem}>
                {content}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
