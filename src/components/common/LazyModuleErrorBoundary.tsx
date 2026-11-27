import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Compass, LayoutDashboard, RefreshCw, RotateCcw } from 'lucide-react';
import {
  clearChunkReloadGuard,
  extractFailedModuleName,
  isDynamicImportChunkError
} from '../../utils/lazyChunkRecovery';

interface LazyModuleErrorBoundaryProps {
  children: ReactNode;
  activeTab: string;
  onRetryModule?: () => void;
  onNavigate?: (tab: string) => void;
}

interface LazyModuleErrorBoundaryState {
  hasError: boolean;
  isChunkError: boolean;
  errorMessage: string;
  failedModule: string;
  lastTab: string;
}

function getFriendlyModuleLabel(activeTab: string): string {
  switch (activeTab) {
    case 'monitoring_maps':
      return 'Monitoring Maps GIS';
    case 'contact_centre':
    case 'live_chat':
    case 'installer_chat':
      return 'LiveChat / Contact Centre';
    case 'database_management':
    case 'database_sync_monitoring':
      return 'Database Management';
    case 'setup_hub':
      return 'Setup Hub';
    case 'report_data_wo':
    case 'history_progress_report':
    case 'contractor_area_recap':
      return 'Laporan Operasional WO';
    case 'schedule_calendar':
      return 'Jadwal & Kalender';
    case 'sla_telemetry':
      return 'SLA Telemetry';
    case 'location_basecamp':
      return 'Lokasi & Basecamp';
    case 'text_to_table':
      return 'Impor Data WO';
    case 'google_sheets_sync':
      return 'Google Sheets Sync';
    case 'template_builder':
      return 'Template WhatsApp';
    case 'login_log':
    case 'audit_log':
      return 'Log Audit & Aktivitas';
    default:
      return 'Halaman Operasional';
  }
}

/**
 * Isolated route-level ErrorBoundary around <Suspense> in MainLayout.
 * If a lazy-loaded module (e.g. MonitoringMapsView) fails to fetch due to
 * deployment skew or transient network failure, ONLY the main content pane
 * falls back cleanly — keeping Sidebar, Header, BottomNav, other menus,
 * and Custom Auth session completely intact.
 */
export class LazyModuleErrorBoundary extends Component<
  LazyModuleErrorBoundaryProps,
  LazyModuleErrorBoundaryState
> {
  public state: LazyModuleErrorBoundaryState = {
    hasError: false,
    isChunkError: false,
    errorMessage: '',
    failedModule: '',
    lastTab: this.props.activeTab
  };

  public static getDerivedStateFromProps(
    nextProps: LazyModuleErrorBoundaryProps,
    prevState: LazyModuleErrorBoundaryState
  ): Partial<LazyModuleErrorBoundaryState> | null {
    if (nextProps.activeTab !== prevState.lastTab) {
      return {
        hasError: false,
        isChunkError: false,
        errorMessage: '',
        failedModule: '',
        lastTab: nextProps.activeTab
      };
    }
    return null;
  }

  public static getDerivedStateFromError(error: Error): Partial<LazyModuleErrorBoundaryState> {
    const isChunk = isDynamicImportChunkError(error);
    return {
      hasError: true,
      isChunkError: isChunk,
      errorMessage: error?.message || 'Gagal memuat modul halaman.',
      failedModule: extractFailedModuleName(error, 'ChunkModule')
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[MoraJaws Route Boundary] Isolated lazy route failure:', {
      activeTab: this.props.activeTab,
      isChunkError: isDynamicImportChunkError(error),
      message: error?.message,
      componentStack: errorInfo?.componentStack
    });
  }

  private handleRetryInPlace = () => {
    if (this.state.isChunkError) {
      // Browser ES module loaders cache failed dynamic import() URLs per document;
      // a fresh reload clears the module-map rejection while preserving Custom Auth & active tab.
      clearChunkReloadGuard();
      window.location.reload();
      return;
    }
    this.setState({
      hasError: false,
      isChunkError: false,
      errorMessage: '',
      failedModule: ''
    });
    if (this.props.onRetryModule) {
      this.props.onRetryModule();
    }
  };

  private handleHardRefreshPreservingSession = () => {
    clearChunkReloadGuard();
    // Preserve Custom Auth tokens & session completely; only reload page assets
    window.location.reload();
  };

  public render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const isMaps = this.props.activeTab === 'monitoring_maps';
    const moduleLabel = getFriendlyModuleLabel(this.props.activeTab);

    return (
      <div className="w-full py-8 px-4 flex items-center justify-center">
        <div className="w-full max-w-xl rounded-2xl border border-amber-500/35 bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl shadow-xl p-6 sm:p-7 space-y-5">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center shrink-0">
              {isMaps ? (
                <Compass className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-mono uppercase tracking-wider text-amber-600 dark:text-amber-300 font-bold">
                {this.state.isChunkError ? 'Pembaruan Modul / Koneksi Aset' : 'Kendala Pemuatan Modul'}
              </div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-white mt-0.5">
                {isMaps ? 'Monitoring Maps gagal dimuat' : `${moduleLabel} gagal dimuat`}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
                {this.state.isChunkError
                  ? `Berkas modul ${moduleLabel} tidak dapat diambil (kemungkinan ada deployment versi baru atau koneksi terputus). Sesi login Anda tetap aman dan menu lain tetap dapat digunakan.`
                  : `Terjadi kendala saat menampilkan ${moduleLabel}. Anda dapat mencoba memuat ulang modul ini atau berpindah ke menu operasional lain.`}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-slate-100/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-[11px] font-mono text-slate-600 dark:text-slate-300 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500 dark:text-slate-400">Modul:</span>
              <span className="font-semibold truncate">{this.state.failedModule || moduleLabel}</span>
            </div>
            <div className="text-[10px] text-rose-600 dark:text-rose-300 break-words">
              {this.state.errorMessage}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={this.handleRetryInPlace}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md cursor-pointer transition-all"
            >
              <RefreshCw className="w-4 h-4 shrink-0" />
              <span>Coba Muat Ulang</span>
            </button>

            <button
              type="button"
              onClick={this.handleHardRefreshPreservingSession}
              className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300/80 dark:border-slate-700 font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span>Muat Ulang Halaman</span>
            </button>

            {this.props.onNavigate && this.props.activeTab !== 'dashboard' && (
              <button
                type="button"
                onClick={() => this.props.onNavigate?.('dashboard')}
                className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300/80 dark:border-slate-700 font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <LayoutDashboard className="w-4 h-4 shrink-0" />
                <span>Ke Dashboard</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
