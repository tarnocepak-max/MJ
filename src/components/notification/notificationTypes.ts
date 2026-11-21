import { Ticket, UserRole } from '../../types/index.ts';

export type NotificationCategory =
  | 'wo_assignment'
  | 'overdue_warning'
  | 'live_chat'
  | 'system_database'
  | 'success'
  | 'security';

export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low';

export type NotificationTab = 'all' | 'unread' | 'read';

export type NotificationDateFilter = 'all' | 'today' | 'last_7_days';

export interface NotificationActionTarget {
  type: 'ticket' | 'tab' | 'offline_sync' | 'refresh';
  tab?: string;
  ticket?: Ticket;
  defaultTab?: 'overview' | 'report' | 'chat' | 'history';
  allowedRoles?: UserRole[];
}

export interface NotificationItem {
  id: string;
  /** Version/state fingerprint so returning or escalated events re-surface as unread cleanly */
  signature: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  description: string;
  timestamp: string;
  dateWIB: string;
  woNumber?: string;
  metaLabel?: string;
  isRead: boolean;
  target?: NotificationActionTarget;
}

export interface NotificationFilterState {
  tab: NotificationTab;
  category: 'all' | NotificationCategory;
  priority: 'all' | NotificationPriority;
  dateRange: NotificationDateFilter;
  search: string;
}

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  wo_assignment: 'WO / Assignment',
  overdue_warning: 'Overdue / Warning',
  live_chat: 'Live Chat',
  system_database: 'System / Database',
  success: 'Success',
  security: 'Security'
};

export const PRIORITY_LABELS: Record<NotificationPriority, string> = {
  critical: 'Critical',
  high: 'High',
  normal: 'Normal',
  low: 'Low'
};
