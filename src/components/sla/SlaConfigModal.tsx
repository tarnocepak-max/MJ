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
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center bg-[#26364A]/45 dark:bg-[#160D29]/75 backdrop-blur-sm sm:p-4">
      <div className="bg-white/95 dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between gap-2 bg-[#EDF3F8] dark:bg-[#160D29]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DCE3F2] dark:border-transparent flex items-center justify-center shrink-0">
              <Sliders className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-sm sm:text-base text-[#26364A] dark:text-white truncate">
                Ambang Batas SLA &amp; Klausul PKS Vendor
              </h3>
              <p className="text-[11px] text-[#52647A] dark:text-[#DAB9FF] truncate">
                Versi Konfigurasi: v{configVersion} • {isConfigPersistedInDb ? 'Tersimpan di Database Pusat' : 'Baseline Default Sistem'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="btn-3d-icon w-10 h-10 sm:w-9 sm:h-9 shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-4 sm:px-6 pt-3 border-b border-[#DDE6F0] dark:border-[#35105E] flex items-center gap-2 bg-white dark:bg-[#1E1238] overflow-x-auto no-scrollbar shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('thresholds')}
            className={`px-3.5 py-2 min-h-[42px] text-xs font-semibold rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'thresholds'
                ? 'border-[#6657C8] text-[#5145A6] dark:text-[#DAB9FF] dark:border-[#DAB9FF]'
                : 'border-transparent text-[#8492A5] hover:text-[#26364A] dark:text-[#C5B3DF] dark:hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Parameter &amp; Ambang Batas SLA
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pks')}
            className={`px-3.5 py-2 min-h-[42px] text-xs font-semibold rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'pks'
                ? 'border-[#6657C8] text-[#5145A6] dark:text-[#DAB9FF] dark:border-[#DAB9FF]'
                : 'border-transparent text-[#8492A5] hover:text-[#26364A] dark:text-[#C5B3DF] dark:hover:text-white'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            Klausul Insentif &amp; Penalti (PKS)
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {!canEdit && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#FFF2D9] dark:bg-amber-950/30 border border-[#F2CF95] dark:border-amber-800/60 text-xs text-[#9D661F] dark:text-amber-300">
              <Shield className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Mode Read-Only: Perubahan Ambang Batas SLA &amp; Klausul PKS hanya dapat dilakukan oleh <strong>Super Admin</strong> atau <strong>Dispatch</strong>.
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-[#FCE9EB] dark:bg-rose-950/30 border border-[#F3C5CA] dark:border-rose-800 text-xs text-[#9B2C37] dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'thresholds' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF] mb-1">
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
                    className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm font-mono rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF] mb-1">
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
                    className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm font-mono rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
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
                    className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm font-mono rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
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
                    className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm font-mono rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
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
                    className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm font-mono rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF] mb-1">
                    Batas Respon Dispatch (Menit)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="240"
                    disabled={!canEdit}
                    value={draft.maxDispatchResponseMinutes}
                    onChange={e => setDraft({ ...draft, maxDispatchResponseMinutes: Number(e.target.value) })}
                    className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm font-mono rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF] mb-1">
                    Ambang Alert Kritis (Sisa Menit)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="180"
                    disabled={!canEdit}
                    value={draft.criticalRemainingMinutes}
                    onChange={e => setDraft({ ...draft, criticalRemainingMinutes: Number(e.target.value) })}
                    className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm font-mono rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF] mb-1">
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
                    className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm font-mono rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
                  />
                  <span className="text-[10px] text-[#52647A] dark:text-[#C5B3DF] mt-0.5 block">Contoh: -22.0 berarti daya terima ≥ -22.00 dBm valid.</span>
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF] mb-1">
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
                      className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm font-mono rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
                    />
                    <input
                      type="number"
                      min="1"
                      max="20"
                      disabled={!canEdit}
                      value={draft.defaultDailyQuotaPerTech}
                      onChange={e => setDraft({ ...draft, defaultDailyQuotaPerTech: Number(e.target.value) })}
                      title="Kuota Harian Default per Teknisi"
                      className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm font-mono rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
                    />
                  </div>
                  <span className="text-[10px] text-[#52647A] dark:text-[#C5B3DF] mt-0.5 block">Kiri: Min. Foto • Kanan: Kuota WO/Teknisi/Hari</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF] mb-1">
                  Label Versi Aturan SLA
                </label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={draft.ruleVersionLabel}
                  onChange={e => setDraft({ ...draft, ruleVersionLabel: e.target.value })}
                  className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {!draft.pksRules.isCustomConfigured && (
                <div className="p-3 rounded-xl bg-[#EAE8FF] dark:bg-[#2E1459]/70 border border-[#DCE3F2] dark:border-[#5B35B1] text-xs text-[#5145A6] dark:text-[#E8DDFF]">
                  Formula insentif &amp; penalti saat ini menggunakan <strong>baseline default sistem</strong> karena tabel PKS finansial belum dikustomisasi oleh manajemen. Simpan perubahan di bawah untuk mengunci klausul PKS resmi.
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF] mb-1">
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
                  className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
                />
              </div>

              <div className="mj-tactile-well flex items-center justify-between p-3.5 border border-[#DDE6F0] dark:border-[#35105E]">
                <div>
                  <p className="text-xs font-bold text-[#26364A] dark:text-white">Aktifkan Skema Bonus Pencapaian Target</p>
                  <p className="text-[11px] text-[#52647A] dark:text-[#C5B3DF]">Vendor dengan SLA ≥ {draft.globalSlaTarget}% mendapat bonus per WO patuh.</p>
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
                  className="w-4 h-4 accent-[#6657C8] dark:accent-[#58149C]"
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
                    className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm font-mono rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF] mb-1">
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
                    className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm font-mono rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
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
                    className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-sm font-mono rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] disabled:opacity-60"
                  />
                </div>
              </div>
            </div>
          )}

          {canEdit && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#C5B3DF] mb-1">
                Catatan Perubahan (Audit Trail)
              </label>
              <input
                type="text"
                placeholder="Misal: Penyesuaian target Q4 2026 sesuai addendum PKS"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="tactile-debossed-input w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] text-xs rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
              />
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-4 border-t border-[#DDE6F0] dark:border-[#35105E] bg-[#EDF3F8] dark:bg-[#160D29] flex flex-wrap items-center justify-between gap-3">
          {canEdit ? (
            <button
              type="button"
              onClick={() => setDraft({ ...DEFAULT_FALLBACK, pksRules: { ...DEFAULT_FALLBACK.pksRules } })}
              className="px-3 py-2 min-h-[44px] sm:min-h-[38px] text-xs font-semibold text-[#52647A] hover:text-[#5145A6] dark:text-[#C5B3DF] dark:hover:text-white flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Default
            </button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="btn-3d-ceramic px-4 py-2 min-h-[44px] sm:min-h-[38px] text-xs font-semibold rounded-xl cursor-pointer"
            >
              Tutup
            </button>
            {canEdit && (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSubmit}
                className="btn-3d-primary px-4 py-2 min-h-[44px] sm:min-h-[38px] text-xs font-bold rounded-xl flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
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
