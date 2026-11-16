import React, { useState, useEffect } from 'react';
import { X, Shield, Sliders, Scale, CheckCircle2, AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import type { SlaThresholdConfig } from '../../types/sla';

interface SlaConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: SlaThresholdConfig;
  configVersion: number;
  isConfigPersistedInDb: boolean;
  canEdit: boolean;
  initialTab?: 'thresholds' | 'pks';
  onSave: (nextConfig: SlaThresholdConfig, notes?: string) => Promise<void>;
}

const DEFAULT_FALLBACK: SlaThresholdConfig = {
  globalSlaTarget: 98.4,
  excellentMin: 98.0,
  goodMin: 94.0,
  warningMin: 90.0,
  ftrTarget: 95.0,
  maxDispatchResponseMinutes: 45,
  opmMaxLossDbm: -22.0,
  requiredPhotoCount: 4,
  criticalRemainingMinutes: 15,
  defaultDailyQuotaPerTech: 4,
  ruleVersionLabel: 'v4.18 (Revision 3 - 2026)',
  pksRules: {
    clauseReference: 'Klausul Perjanjian Kerjasama (PKS) 2026',
    bonusEnabled: true,
    bonusRatePerCompliantWo: 85000,
    toleranceMinRate: 97.0,
    penaltyRatePerBreachWo: 500000,
    isCustomConfigured: false
  }
};

export const SlaConfigModal: React.FC<SlaConfigModalProps> = ({
  isOpen,
  onClose,
  config,
  configVersion,
  isConfigPersistedInDb,
  canEdit,
  initialTab = 'thresholds',
  onSave
}) => {
  const [activeTab, setActiveTab] = useState<'thresholds' | 'pks'>(initialTab);
  const [draft, setDraft] = useState<SlaThresholdConfig>(config);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDraft({ ...config, pksRules: { ...config.pksRules } });
      setActiveTab(initialTab);
      setNotes('');
      setError(null);
    }
  }, [isOpen, config, initialTab]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setError(null);

    if (draft.excellentMin < draft.goodMin || draft.goodMin < draft.warningMin) {
      setError('Urutan tier tidak valid: Excellent ≥ Good ≥ Warning harus terpenuhi.');
      return;
    }

    setIsSaving(true);
    try {
      await onSave(draft, notes.trim() || undefined);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Gagal menyimpan konfigurasi SLA.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between bg-[#F7F6FA] dark:bg-[#160D29]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#431599]/10 dark:bg-[#7135B5]/25 text-[#431599] dark:text-[#D8B4FE] flex items-center justify-center">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[#211A2E] dark:text-white">
                Ambang Batas SLA &amp; Klausul PKS Vendor
              </h3>
              <p className="text-[11px] text-[#766B83] dark:text-[#A78BFA]">
                Versi Konfigurasi: v{configVersion} • {isConfigPersistedInDb ? 'Tersimpan di Database Pusat' : 'Baseline Default Sistem'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[#766B83] hover:bg-white dark:hover:bg-[#35105E] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 border-b border-[#E9E5F0] dark:border-[#35105E] flex items-center gap-2 bg-white dark:bg-[#1E1238]">
          <button
            type="button"
            onClick={() => setActiveTab('thresholds')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'thresholds'
                ? 'border-[#431599] text-[#431599] dark:text-[#D8B4FE] dark:border-[#A78BFA]'
                : 'border-transparent text-[#766B83] hover:text-[#211A2E] dark:hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Parameter &amp; Ambang Batas SLA
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pks')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'pks'
                ? 'border-[#431599] text-[#431599] dark:text-[#D8B4FE] dark:border-[#A78BFA]'
                : 'border-transparent text-[#766B83] hover:text-[#211A2E] dark:hover:text-white'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            Klausul Insentif &amp; Penalti (PKS)
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {!canEdit && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-300">
              <Shield className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Mode Read-Only: Perubahan Ambang Batas SLA &amp; Klausul PKS hanya dapat dilakukan oleh <strong>Super Admin</strong> atau <strong>Dispatch</strong>.
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'thresholds' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#766B83] mb-1">
                    Target SLA Global (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="50"
                    max="100"
                    disabled={!canEdit}
                    value={draft.globalSlaTarget}
                    onChange={e => setDraft({ ...draft, globalSlaTarget: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#766B83] mb-1">
                    Target First-Time-Right (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="50"
                    max="100"
                    disabled={!canEdit}
                    value={draft.ftrTarget}
                    onChange={e => setDraft({ ...draft, ftrTarget: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">
                    Excellent Min (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="50"
                    max="100"
                    disabled={!canEdit}
                    value={draft.excellentMin}
                    onChange={e => setDraft({ ...draft, excellentMin: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-1">
                    Good Min (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="40"
                    max="100"
                    disabled={!canEdit}
                    value={draft.goodMin}
                    onChange={e => setDraft({ ...draft, goodMin: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 mb-1">
                    Warning Min (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="20"
                    max="100"
                    disabled={!canEdit}
                    value={draft.warningMin}
                    onChange={e => setDraft({ ...draft, warningMin: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#766B83] mb-1">
                    Batas Respon Dispatch (Menit)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="240"
                    disabled={!canEdit}
                    value={draft.maxDispatchResponseMinutes}
                    onChange={e => setDraft({ ...draft, maxDispatchResponseMinutes: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#766B83] mb-1">
                    Ambang Alert Kritis (Sisa Menit)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="180"
                    disabled={!canEdit}
                    value={draft.criticalRemainingMinutes}
                    onChange={e => setDraft({ ...draft, criticalRemainingMinutes: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#766B83] mb-1">
                    Batas Redaman OPM Min (dBm)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="-35"
                    max="-10"
                    disabled={!canEdit}
                    value={draft.opmMaxLossDbm}
                    onChange={e => setDraft({ ...draft, opmMaxLossDbm: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                  />
                  <span className="text-[10px] text-[#766B83] mt-0.5 block">Contoh: -22.0 berarti daya terima ≥ -22.00 dBm valid.</span>
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#766B83] mb-1">
                    Minimum Foto Eviden &amp; Kuota / Teknisi
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min="1"
                      max="10"
                      disabled={!canEdit}
                      value={draft.requiredPhotoCount}
                      onChange={e => setDraft({ ...draft, requiredPhotoCount: Number(e.target.value) })}
                      title="Minimal Foto Eviden"
                      className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                    />
                    <input
                      type="number"
                      min="1"
                      max="20"
                      disabled={!canEdit}
                      value={draft.defaultDailyQuotaPerTech}
                      onChange={e => setDraft({ ...draft, defaultDailyQuotaPerTech: Number(e.target.value) })}
                      title="Kuota Harian Default per Teknisi"
                      className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                    />
                  </div>
                  <span className="text-[10px] text-[#766B83] mt-0.5 block">Kiri: Min. Foto • Kanan: Kuota WO/Teknisi/Hari</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#766B83] mb-1">
                  Label Versi Aturan SLA
                </label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={draft.ruleVersionLabel}
                  onChange={e => setDraft({ ...draft, ruleVersionLabel: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {!draft.pksRules.isCustomConfigured && (
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 text-xs text-blue-800 dark:text-blue-200">
                  Formula insentif &amp; penalti saat ini menggunakan <strong>baseline default sistem</strong> karena tabel PKS finansial belum dikustomisasi oleh manajemen. Simpan perubahan di bawah untuk mengunci klausul PKS resmi.
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#766B83] mb-1">
                  Referensi Dokumen / Klausul PKS
                </label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={draft.pksRules.clauseReference}
                  onChange={e =>
                    setDraft({
                      ...draft,
                      pksRules: { ...draft.pksRules, clauseReference: e.target.value }
                    })
                  }
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                />
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827]">
                <div>
                  <p className="text-xs font-bold text-[#211A2E] dark:text-white">Aktifkan Skema Bonus Pencapaian Target</p>
                  <p className="text-[11px] text-[#766B83]">Vendor dengan SLA ≥ {draft.globalSlaTarget}% mendapat bonus per WO patuh.</p>
                </div>
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={draft.pksRules.bonusEnabled}
                  onChange={e =>
                    setDraft({
                      ...draft,
                      pksRules: { ...draft.pksRules, bonusEnabled: e.target.checked }
                    })
                  }
                  className="w-4 h-4 accent-[#431599]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">
                    Bonus / WO Patuh (IDR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="5000"
                    disabled={!canEdit || !draft.pksRules.bonusEnabled}
                    value={draft.pksRules.bonusRatePerCompliantWo}
                    onChange={e =>
                      setDraft({
                        ...draft,
                        pksRules: { ...draft.pksRules, bonusRatePerCompliantWo: Number(e.target.value) }
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#766B83] mb-1">
                    Batas Toleransi Netral (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="50"
                    max="100"
                    disabled={!canEdit}
                    value={draft.pksRules.toleranceMinRate}
                    onChange={e =>
                      setDraft({
                        ...draft,
                        pksRules: { ...draft.pksRules, toleranceMinRate: Number(e.target.value) }
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 mb-1">
                    Penalti / WO Breach (IDR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="25000"
                    disabled={!canEdit}
                    value={draft.pksRules.penaltyRatePerBreachWo}
                    onChange={e =>
                      setDraft({
                        ...draft,
                        pksRules: { ...draft.pksRules, penaltyRatePerBreachWo: Number(e.target.value) }
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white disabled:opacity-60"
                  />
                </div>
              </div>
            </div>
          )}

          {canEdit && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#766B83] mb-1">
                Catatan Perubahan (Audit Trail)
              </label>
              <input
                type="text"
                placeholder="Misal: Penyesuaian target Q4 2026 sesuai addendum PKS"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#140827] text-[#211A2E] dark:text-white"
              />
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#160D29] flex items-center justify-between gap-3">
          {canEdit ? (
            <button
              type="button"
              onClick={() => setDraft({ ...DEFAULT_FALLBACK, pksRules: { ...DEFAULT_FALLBACK.pksRules } })}
              className="px-3 py-2 text-xs font-semibold text-[#766B83] hover:text-[#211A2E] dark:hover:text-white flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Default
            </button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#1E1238] text-[#211A2E] dark:text-white hover:bg-slate-50"
            >
              Tutup
            </button>
            {canEdit && (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSubmit}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-[#431599] hover:bg-[#35105E] text-white flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Simpan Konfigurasi
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
