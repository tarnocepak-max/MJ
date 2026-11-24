import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  Server,
  Database,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Clock,
  HardDrive,
  Cpu,
  Layers,
  Sparkles,
  Download
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export const SystemHealthView: React.FC = () => {
  const { tickets, auditLogs, googleSheetsConfig, users, databaseStatus } = useApp();
  const { toast } = useToast();

  const [healthData, setHealthData] = useState<{
    status: string;
    environment: string;
    database: any;
    integrations: any;
    serverTime: string;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setIsLoading(true);
    setHealthError(null);
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const d = await res.json();
        setHealthData(d);
      } else {
        setHealthError(`HTTP ${res.status}`);
      }
    } catch (err: any) {
      setHealthError(err?.message || 'Koneksi /api/health gagal');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const recentErrors = auditLogs
    .filter(l => {
      const act = String(l.action || '').toLowerCase();
      return act.includes('failed') || act.includes('blocked') || act.includes('error');
    })
    .slice(0, 10);

  const recentAuthFailures = auditLogs
    .filter(l => l.entity === 'auth' && (String(l.action || '').toLowerCase().includes('failed') || String(l.action || '').toLowerCase().includes('blocked')))
    .slice(0, 5);

  const isBackendHealthy = !healthError && healthData?.status === 'ok';
  const dbEngineLabel =
    healthData?.database?.engine ||
    (databaseStatus === 'connected' ? 'Supabase PostgreSQL' : databaseStatus === 'error' ? 'Koneksi Bermasalah' : 'Memeriksa Koneksi');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#EAE8FF] to-[#DDF4F4] dark:from-[#5B289B] dark:to-[#35105E] border border-[#C5BEEF] dark:border-transparent text-[#5145A6] dark:text-[#E8DDFF] flex items-center justify-center font-bold shadow-[0_4px_12px_rgba(81,69,166,0.14)] dark:shadow-[0_6px_14px_rgba(53,16,94,0.28)] shrink-0">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-[#EAE8FF] text-[#5145A6] border border-[#C5BEEF] dark:border-transparent dark:bg-gradient-to-b dark:from-[#6b103b] dark:to-[#480123] dark:text-white shadow-xs">
                DIAGNOSTIK SISTEM
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                  healthError
                    ? 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
                    : isBackendHealthy
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                    : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                }`}
              >
                {healthError
                  ? `Health Check Gagal (${healthError})`
                  : isBackendHealthy
                  ? 'Backend & API Operasional'
                  : isLoading
                  ? 'Memeriksa Status...'
                  : 'Menunggu Respons Server'}
              </span>
            </div>
            <h2 className="text-base font-display font-extrabold text-[#26364A] dark:text-white tracking-tight">
              System Health &amp; Integrations Diagnostic
            </h2>
            <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mt-0.5">
              Pemantauan kesehatan backend, status database, sinkronisasi Google Sheets, dan deteksi anomali.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={fetchHealth}
          className="btn-3d-lilac px-3.5 py-2 font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Diagnostik</span>
        </button>
      </div>

      {/* 4 Health Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Backend Status */}
        <div className="card-3d-lavender p-4 rounded-2xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase">Backend Node.js</span>
            <Server className={`w-4 h-4 ${healthError ? 'text-rose-600' : isBackendHealthy ? 'text-emerald-600' : 'text-amber-500'}`} />
          </div>
          <div className={`text-lg font-black flex items-center gap-1.5 ${healthError ? 'text-rose-600' : isBackendHealthy ? 'text-emerald-600' : 'text-amber-600'}`}>
            {healthError ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            <span>
              {healthError
                ? 'Tidak Terjangkau'
                : isBackendHealthy
                ? 'Aktif & Terhubung'
                : 'Memeriksa...'}
            </span>
          </div>
          <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] font-mono">
            Environment: {healthData?.environment || (healthError ? 'Offline' : 'Memuat...')} (Express + Vite)
          </div>
        </div>

        {/* Database Status */}
        <div className="card-3d-lavender p-4 rounded-2xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase">Database Operasional</span>
            <Database className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
          </div>
          <div className="text-lg font-black text-[#26364A] dark:text-white font-mono tabular-nums flex items-center gap-1.5">
            <span>{tickets.length} Work Orders</span>
          </div>
          <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] font-mono">
            Engine: {dbEngineLabel}
          </div>
        </div>

        {/* Google Sheets Status */}
        <div className="card-3d-lavender p-4 rounded-2xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase">Google Sheets API</span>
            <FileSpreadsheet className="w-4 h-4 text-[#2E7D8B] dark:text-[#D8B4FE]" />
          </div>
          <div className="text-lg font-black text-[#2E7D8B] dark:text-[#D8B4FE]">
            {googleSheetsConfig.spreadsheetId ? 'Terhubung (Connected)' : 'Belum Dikonfigurasi'}
          </div>
          <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate">
            {googleSheetsConfig.spreadsheetTitle || googleSheetsConfig.sheetName || 'Spreadsheet belum dipilih'}
          </div>
        </div>

        {/* App Version */}
        <div className="card-3d-lavender p-4 rounded-2xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase">Versi &amp; Integritas</span>
            <ShieldCheck className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
          </div>
          <div className="text-lg font-black text-[#5145A6] dark:text-[#E8DDFF] font-mono">
            MoraJaws v5.0.0
          </div>
          <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
            Role-Based Access: 4 Peran Resmi ({users.length} Akun)
          </div>
        </div>
      </div>

      {/* Diagnostics Grid: Recent Errors & Auth Security Failures */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
        {/* Recent System Alerts */}
        <div className="card-3d-lavender p-5 rounded-2xl space-y-3">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#35105E] pb-2.5">
            <h3 className="font-bold text-sm text-[#26364A] dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>Log Peringatan &amp; Kesalahan Terbaru</span>
            </h3>
            <span className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] font-mono tabular-nums">{recentErrors.length} Tercatat</span>
          </div>

          {recentErrors.length === 0 ? (
            <div className="py-8 text-center text-emerald-600 dark:text-emerald-400 font-bold">
              Tidak ada kesalahan sistem atau anomali terkini.
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {recentErrors.map(err => (
                <div key={err.id} className="p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] space-y-0.5">
                  <div className="flex items-center justify-between font-bold text-amber-900 dark:text-amber-200">
                    <span>{err.action}</span>
                    <span className="font-mono text-[9.5px] text-[#8492A5] dark:text-[#CEC0E8]">{new Date(err.timestamp).toLocaleTimeString('id-ID')}</span>
                  </div>
                  <div className="text-[#52647A] dark:text-[#D9CCF2]">{err.details}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Authentication Security Monitor */}
        <div className="card-3d-lavender p-5 rounded-2xl space-y-3">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#35105E] pb-2.5">
            <h3 className="font-bold text-sm text-[#26364A] dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-500" />
              <span>Proteksi Autentikasi &amp; Brute-Force Gate</span>
            </h3>
            <span className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] font-mono">Batas 5x Gagal</span>
          </div>

          <div className="p-3 bg-[#F4F7FB] dark:bg-[#160D29] rounded-xl border border-[#DDE6F0] dark:border-[#35105E] space-y-1.5 text-[11.5px] text-[#52647A] dark:text-[#D9CCF2]">
            <div className="font-bold text-[#26364A] dark:text-white">Protokol Keamanan Aktif:</div>
            <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
              <li>Password disimpan dalam hash algoritma dengan salt rahasia</li>
              <li>Akun dinonaktifkan ditolak secara instan pada level backend</li>
              <li>Percobaan login gagal berturut-turut diblokir otomatis 5 menit</li>
              <li>Tidak ada token atau credential rahasia yang diekspos ke client</li>
            </ul>
          </div>

          <div className="space-y-2 pt-1">
            <span className="text-[11px] font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase block">
              Percobaan Login Gagal / Ditolak Terbaru:
            </span>
            {recentAuthFailures.length === 0 ? (
              <div className="text-[#8492A5] dark:text-[#A78BFA] text-[11px] italic">
                Tidak ada upaya login mencurigakan yang diblokir.
              </div>
            ) : (
              recentAuthFailures.map(log => (
                <div key={log.id} className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[10.5px]">
                  <strong>{log.action}</strong>: {log.details}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
