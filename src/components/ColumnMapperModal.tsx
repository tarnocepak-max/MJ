import React, { useState } from 'react';
import { Check, Sliders, Info } from 'lucide-react';
import { CANONICAL_FIELD_DEFINITIONS } from '../utils/woImportEngine';
import { ResponsiveModal } from './common/ResponsiveModal';

interface ColumnMapperModalProps {
  isOpen: boolean;
  onClose: () => void;
  rawHeaders: string[];
  currentMappings: Record<string, string>;
  sampleRow?: Record<string, string>;
  onSaveMappings: (newMappings: Record<string, string>) => void;
}

export const ColumnMapperModal: React.FC<ColumnMapperModalProps> = ({
  isOpen,
  onClose,
  rawHeaders,
  currentMappings,
  sampleRow = {},
  onSaveMappings
}) => {
  const [mappings, setMappings] = useState<Record<string, string>>({ ...currentMappings });

  if (!isOpen) return null;

  const handleSelectField = (rawHeader: string, canonicalKey: string) => {
    setMappings(prev => {
      const next = { ...prev };
      if (!canonicalKey || canonicalKey === '__IGNORE__') {
        delete next[rawHeader];
      } else {
        // Prevent duplicate mapping: remove canonicalKey from other headers
        Object.keys(next).forEach(k => {
          if (next[k] === canonicalKey && k !== rawHeader) {
            delete next[k];
          }
        });
        next[rawHeader] = canonicalKey;
      }
      return next;
    });
  };

  const handleSave = () => {
    onSaveMappings(mappings);
    onClose();
  };

  const handleResetToAuto = () => {
    // Clear custom overrides to re-trigger auto mapping
    setMappings({});
  };

  const mappedCount = Object.keys(mappings).length;
  const unmappedCount = Math.max(0, rawHeaders.length - mappedCount);

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      mobileVariant="fullscreen"
      zIndexClass="z-[100]"
      icon={<Sliders className="w-4 h-4" />}
      title="Konfigurasi Pemetaan Kolom (Column Mapper)"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>Total {rawHeaders.length} kolom terdeteksi</span>
          <span>•</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{mappedCount} Dipetakan</span>
          <span>•</span>
          <span className="text-amber-600 dark:text-amber-400">{unmappedCount} Diabaikan / Opsional</span>
        </span>
      }
      footer={
        <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleResetToAuto}
            className="text-xs text-[#5145A6] dark:text-indigo-400 hover:underline font-semibold cursor-pointer text-left sm:text-center"
          >
            Reset ke Pemetaan Otomatis
          </button>
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="btn-3d-ceramic px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer min-h-[38px]"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="btn-3d-primary px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer min-h-[38px]"
            >
              <Check className="w-4 h-4" />
              <span>Terapkan Pemetaan</span>
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Informational Guidance Banner */}
        <div className="px-4 py-2.5 rounded-xl bg-[#EAE8FF]/70 dark:bg-indigo-950/40 border border-[#DCE3F2] dark:border-indigo-900/60 flex items-start sm:items-center gap-2 text-xs text-[#5145A6] dark:text-indigo-200">
          <Info className="w-4 h-4 text-[#6657C8] dark:text-indigo-600 shrink-0 mt-0.5 sm:mt-0" />
          <span>
            Satu kolom hanya dapat dipetakan ke 1 field kanonis. Kolom yang diabaikan tetap disimpan aman dalam{' '}
            <em>additionalFields</em> tanpa membuat data palsu.
          </span>
        </div>

        {/* Desktop Column Headers */}
        <div className="hidden sm:grid grid-cols-12 gap-3 pb-2 border-b border-[#DDE6F0] dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-[#52647A] dark:text-slate-400 px-2">
          <div className="col-span-4">Kolom Header File</div>
          <div className="col-span-4">Contoh Nilai (Baris 1)</div>
          <div className="col-span-4">Target Field MoraJaws</div>
        </div>

        <div className="space-y-2.5 sm:space-y-2">
          {rawHeaders.map((rawH, idx) => {
            const currentCanonical = mappings[rawH] || '';
            const matchedDef = CANONICAL_FIELD_DEFINITIONS.find(d => d.canonicalKey === currentCanonical);
            const sampleVal = sampleRow[rawH] || '-';

            return (
              <div
                key={`${rawH}-${idx}`}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 items-start sm:items-center p-3 sm:p-2.5 rounded-xl bg-[#F8FAFD] sm:bg-transparent dark:bg-slate-800/30 sm:dark:bg-transparent hover:bg-[#F0EDFF]/55 dark:hover:bg-slate-800/50 transition-colors border border-[#DDE6F0] sm:border-transparent hover:border-[#DDE6F0] dark:border-slate-700/60 sm:dark:border-transparent dark:hover:border-slate-700/60 text-xs"
              >
                {/* Raw Header Name */}
                <div className="sm:col-span-4 min-w-0">
                  <span className="sm:hidden text-[10px] font-bold uppercase tracking-wider text-[#8492A5] block mb-0.5">
                    Header File
                  </span>
                  <span className="font-mono font-bold text-[#26364A] dark:text-slate-200 truncate block" title={rawH}>
                    {rawH}
                  </span>
                  {matchedDef?.requiredForWO && (
                    <span className="text-[10px] text-[#D45B66] font-semibold">Wajib untuk WO</span>
                  )}
                </div>

                {/* Sample Value */}
                <div className="sm:col-span-4 min-w-0">
                  <span className="sm:hidden text-[10px] font-bold uppercase tracking-wider text-[#8492A5] block mb-0.5">
                    Contoh Nilai
                  </span>
                  <span
                    className="font-mono text-[#52647A] dark:text-slate-400 truncate block bg-[#EDF3F8] dark:bg-slate-900 px-2 py-1 rounded-md text-[11px]"
                    title={sampleVal}
                  >
                    {sampleVal}
                  </span>
                </div>

                {/* Field Selector */}
                <div className="sm:col-span-4 w-full">
                  <span className="sm:hidden text-[10px] font-bold uppercase tracking-wider text-[#8492A5] block mb-0.5">
                    Target Field MoraJaws
                  </span>
                  <select
                    value={currentCanonical || '__IGNORE__'}
                    onChange={e => handleSelectField(rawH, e.target.value)}
                    className={`w-full py-2 sm:py-1.5 px-2.5 rounded-lg border text-xs font-medium transition-colors focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-indigo-500 outline-none cursor-pointer ${
                      currentCanonical
                        ? 'border-[#DCE3F2] dark:border-indigo-700 bg-[#EAE8FF]/70 dark:bg-indigo-950/40 text-[#5145A6] dark:text-indigo-200'
                        : 'border-[#DDE6F0] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#8492A5] dark:text-slate-500'
                    }`}
                  >
                    <option value="__IGNORE__">-- Abaikan Kolom Ini --</option>
                    <optgroup label="Kolom Inti Work Order">
                      {CANONICAL_FIELD_DEFINITIONS.filter(d => d.category === 'core').map(d => (
                        <option key={d.canonicalKey} value={d.canonicalKey}>
                          {d.label} {d.requiredForWO ? '(*Wajib)' : ''}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Pelanggan & Kontak">
                      {CANONICAL_FIELD_DEFINITIONS.filter(d => d.category === 'customer').map(d => (
                        <option key={d.canonicalKey} value={d.canonicalKey}>
                          {d.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Lokasi & Geografis">
                      {CANONICAL_FIELD_DEFINITIONS.filter(d => d.category === 'location').map(d => (
                        <option key={d.canonicalKey} value={d.canonicalKey}>
                          {d.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Mitra & Penugasan">
                      {CANONICAL_FIELD_DEFINITIONS.filter(d => d.category === 'mitra').map(d => (
                        <option key={d.canonicalKey} value={d.canonicalKey}>
                          {d.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Teknis & Jaringan">
                      {CANONICAL_FIELD_DEFINITIONS.filter(d => d.category === 'technical').map(d => (
                        <option key={d.canonicalKey} value={d.canonicalKey}>
                          {d.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Metadata & Agent">
                      {CANONICAL_FIELD_DEFINITIONS.filter(d => d.category === 'metadata').map(d => (
                        <option key={d.canonicalKey} value={d.canonicalKey}>
                          {d.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ResponsiveModal>
  );
};
