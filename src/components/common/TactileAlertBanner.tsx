import React from 'react';
import {
  NotificationBanner,
  NotificationBannerVariant
} from '../notification/NotificationBanner';

export type TactileAlertVariant = NotificationBannerVariant;

interface TactileAlertBannerProps {
  variant?: TactileAlertVariant;
  badge?: string;
  title: string;
  description?: string;
  metricBadge?: string;
  progressPercent?: number;
  primaryAction?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  onDismiss?: () => void;
  className?: string;
}

export const TactileAlertBanner: React.FC<TactileAlertBannerProps> = props => {
  return <NotificationBanner {...props} />;
};
