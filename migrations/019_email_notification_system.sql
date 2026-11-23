-- ============================================================================
-- Migration 019: MoraJaws Automated Email Notification System
-- Target: PostgreSQL / Supabase
-- Additive & Non-Destructive: Creates configuration, template, queue, and log
-- tables for automated operational email notifications with strict RLS.
-- ============================================================================

-- 1. Global Email Notification Settings (Singleton Row 'default')
CREATE TABLE IF NOT EXISTS public.email_notification_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  enabled BOOLEAN NOT NULL DEFAULT false,
  sender_name TEXT NOT NULL DEFAULT 'MoraJaws Ops Dispatch',
  sender_email TEXT NOT NULL DEFAULT 'noreply@morajaws.local',
  reply_to_email TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  rules JSONB NOT NULL DEFAULT '{
    "dailyReset": { "enabled": true, "scheduleTime": "00:05" },
    "newWoLeader": { "enabled": true },
    "woAssignedInstaller": { "enabled": true },
    "woReassigned": { "enabled": true },
    "dailySummary": { "enabled": true, "scheduleTime": "18:00" }
  }'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Email Notification Templates (7 Operational Variants)
CREATE TABLE IF NOT EXISTS public.email_notification_templates (
  template_key TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  subject TEXT NOT NULL,
  greeting TEXT NOT NULL,
  body_intro TEXT NOT NULL,
  footer_text TEXT NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_event_type
  ON public.email_notification_templates (event_type);

-- 3. Email Notification Queue (Idempotent & Retry-Capable)
CREATE TABLE IF NOT EXISTS public.email_notification_queue (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  template_key TEXT NOT NULL,
  recipient_user_id TEXT,
  recipient_email TEXT,
  recipient_name TEXT,
  recipient_role TEXT,
  related_ticket_id TEXT,
  related_wo_number TEXT,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'processing', 'sent', 'delivered', 'failed', 'retry_pending', 'skipped')
  ),
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  next_retry_at TIMESTAMPTZ,
  provider_message_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_queue_status_next_retry
  ON public.email_notification_queue (status, next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS idx_email_queue_event_type_created
  ON public.email_notification_queue (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_queue_wo_number
  ON public.email_notification_queue (related_wo_number);

-- 4. Email Delivery Logs (Audit & Superadmin Monitoring)
CREATE TABLE IF NOT EXISTS public.email_delivery_logs (
  id TEXT PRIMARY KEY,
  queue_id TEXT REFERENCES public.email_notification_queue(id) ON DELETE SET NULL,
  event_key TEXT,
  notification_type TEXT NOT NULL,
  recipient_user_id TEXT,
  recipient_email TEXT,
  recipient_name TEXT,
  recipient_role TEXT,
  subject TEXT NOT NULL,
  related_wo_number TEXT,
  delivery_status TEXT NOT NULL,
  provider_message_id TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_created
  ON public.email_delivery_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_filters
  ON public.email_delivery_logs (notification_type, delivery_status, recipient_role, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_provider_msg
  ON public.email_delivery_logs (provider_message_id);

-- 5. Enable Row Level Security (Restricted strictly to Superadmin)
ALTER TABLE public.email_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_settings_superadmin_all" ON public.email_notification_settings;
CREATE POLICY "email_settings_superadmin_all"
  ON public.email_notification_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()::text
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()::text
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "email_templates_superadmin_all" ON public.email_notification_templates;
CREATE POLICY "email_templates_superadmin_all"
  ON public.email_notification_templates
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()::text
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()::text
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "email_queue_superadmin_all" ON public.email_notification_queue;
CREATE POLICY "email_queue_superadmin_all"
  ON public.email_notification_queue
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()::text
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()::text
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "email_delivery_logs_superadmin_all" ON public.email_delivery_logs;
CREATE POLICY "email_delivery_logs_superadmin_all"
  ON public.email_delivery_logs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()::text
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()::text
        AND COALESCE(u.is_deleted, false) = false
        AND u.role = 'super_admin'
    )
  );
