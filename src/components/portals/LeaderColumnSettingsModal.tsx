import React, { useState } from 'react';
import {
  RotateCcw,
  Sliders,
  ArrowUp,
  ArrowDown,
  GripVertical
} from 'lucide-react';
import { ResponsiveModal } from '../common/ResponsiveModal';

export interface ColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  canHide?: boolean;
}

export const DEFAULT_LEADER_COLUMNS: ColumnConfig[] = [
  { id: 'checkbox', label: 'Pilih (Checkbox)', visible: true, canHide: false },
  { id: 'woNumber', label: 'WO Number', visible: true, canHide: false },
  { id: 'date', label: 'Tanggal WO', visible: true, canHide: true },
  { id: 'idCustomer', label: 'Customer ID', visible: true, canHide: true },
  { id: 'customerName', label: 'Nama Pelanggan', visible: true, canHide: true },
  { id: 'customerPhone', label: 'Kontak Pelanggan', visible: true, canHide: true },
  { id: 'area', label: 'Area', visible: true, canHide: true },
  { id: 'clusterName', label: 'Cluster Name', visible: true, canHide: true },
  { id: 'streetName', label: 'Alamat / Jalan', visible: true, canHide: true },
  { id: 'appointmentDate', label: 'Appointment Date', visible: true, canHide: true },
  { id: 'slotTime', label: 'Slot Waktu', visible: true, canHide: true },
  { id: 'contractor', label: 'Kontraktor', visible: true, canHide: true },
  { id: 'installer', label: 'Teknisi / Installer', visible: true, canHide: false },
  { id: 'status', label: 'Status WO', visible: true, canHide: false },
  { id: 'workStatus', label: 'Status Pekerjaan', visible: true, canHide: true },
  { id: 'checkInAt', label: 'Waktu Check-in', visible: true, canHide: true },
  { id: 'checkOutAt', label: 'Waktu Check-out', visible: true, canHide: true },
  { id: 'workDuration', label: 'Durasi Kerja', visible: true, canHide: true },
  { id: 'progress', label: 'Progres Pekerjaan', visible: true, canHide: true },
  { id: 'lastUpdate', label: 'Update Terakhir', visible: true, canHide: true },
  { id: 'action', label: 'Action / Aksi', visible: true, canHide: false }
];

interface LeaderColumnSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ColumnConfig[];
  onChangeColumns: (columns: ColumnConfig[]) => void;
  onReset: () => void;
}

export const LeaderColumnSettingsModal: React.FC<LeaderColumnSettingsModalProps> = ({
  isOpen,
  onClose,
  columns,
  onChangeColumns,
  onReset
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const toggleColumn = (id: string) => {
    const next = columns.map(col => {
      if (col.id === id && col.canHide !== false) {
        return { ...col, visible: !col.visible };
      }
      return col;
    });
    onChangeColumns(next);
  };

  const showAll = () => {
    onChangeColumns(columns.map(c => ({ ...c, visible: true })));
  };

  const moveColumn = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= columns.length) return;

    const next = [...columns];
    const item = next[index];
    next[index] = next[targetIndex];
    next[targetIndex] = item;
    onChangeColumns(next);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const next = [...columns];
    const draggedItem = next[draggedIndex];
    next.splice(draggedIndex, 1);
    next.splice(index, 0, draggedItem);
    setDraggedIndex(index);
    onChangeColumns(next);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const visibleCount = columns.filter(c => c.visible).length;

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title="Pengaturan & Urutan Kolom Tabel WO"
      subtitle="Centang untuk menampilkan/menyembunyikan, dan geser atau gunakan tombol ↑ ↓ untuk mengatur posisi urutan kolom."
      icon={<Sliders className="w-5 h-5 text-[#2563EB] dark:text-[#38BDF8]" />}
      size="lg"
      mobileVariant="sheet"
      zIndexClass="z-60"
      headerExtra={
        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-50 text-[#2563EB] dark:bg-blue-950/60 dark:text-[#38BDF8] shrink-0">
          {visibleCount} / {columns.length} Aktif
        </span>
      }
      footer={
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 w-full text-xs">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Urutan dan preferensi kolom tersimpan otomatis di profil Leader Anda
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] sm:min-h-[38px] px-4 py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-bold rounded-xl transition-colors shadow-sm cursor-pointer shrink-0"
          >
            Terapkan &amp; Simpan
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800 text-[11px]">
          <span className="text-slate-500 dark:text-slate-400 font-medium">
            Daftar Kolom (Urut dari Kiri ke Kanan):
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={showAll}
              className="text-[#2563EB] dark:text-[#38BDF8] hover:underline font-semibold cursor-pointer"
            >
              Tampilkan Semua
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={onReset}
              className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Default</span>
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          {columns.map((col, index) => {
            const isLocked = col.canHide === false;
            const isFirst = index === 0;
            const isLast = index === columns.length - 1;

            return (
              <div
                key={col.id}
                draggable
                onDragStart={e => handleDragStart(e, index)}
                onDragOver={e => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border transition-all ${
                  draggedIndex === index
                    ? 'opacity-40 border-dashed border-[#2563EB]'
                    : col.visible
                    ? 'bg-slate-50/90 dark:bg-[#1E293B]/60 border-slate-200 dark:border-slate-700 text-[#0F172A] dark:text-white font-medium'
                    : 'bg-slate-100/50 dark:bg-[#0F172A]/40 border-slate-200 dark:border-slate-800 text-slate-400'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="cursor-grab text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 shrink-0"
                    title="Tarik untuk memindahkan urutan kolom"
                  >
                    <GripVertical className="w-3.5 h-3.5" />
                  </span>

                  <span className="w-5 text-center font-mono text-[10px] text-slate-400 font-bold shrink-0">
                    {index + 1}
                  </span>

                  <label className="flex items-center gap-2 cursor-pointer select-none min-w-0">
                    <input
                      type="checkbox"
                      checked={col.visible}
                      disabled={isLocked}
                      onChange={() => toggleColumn(col.id)}
                      className="w-4 h-4 accent-[#2563EB] rounded border-slate-300 dark:border-slate-700 focus:ring-[#2563EB] cursor-pointer shrink-0"
                    />
                    <span className={`text-xs truncate ${col.visible ? 'font-semibold' : 'line-through text-slate-400'}`}>
                      {col.label}
                    </span>
                  </label>

                  {isLocked && (
                    <span className="text-[10px] text-amber-700 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded shrink-0">
                      Wajib
                    </span>
                  )}
                </div>

                {/* Move Up / Down Buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveColumn(index, 'up')}
                    disabled={isFirst}
                    className="min-h-[40px] min-w-[40px] sm:min-h-[34px] sm:min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-20 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    title="Pindahkan kolom ke atas / kiri"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveColumn(index, 'down')}
                    disabled={isLast}
                    className="min-h-[40px] min-w-[40px] sm:min-h-[34px] sm:min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-20 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    title="Pindahkan kolom ke bawah / kanan"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ResponsiveModal>
  );
};
