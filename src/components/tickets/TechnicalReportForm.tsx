import React, { useState } from 'react';
import { Ticket } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { useMoraJawsSound } from '../../context/SoundContext';
import { useToast } from '../../context/ToastContext';
import { getSafePreviewUrl } from '../../services/storageCompatibility';
import { TactileAlertBanner } from '../common/TactileAlertBanner';
import {
  Wrench,
  CheckCircle2,
  Camera,
  X,
  ShieldCheck,
  Maximize2,
  SlidersHorizontal,
  Radio,
  Package
} from 'lucide-react';

interface TechnicalReportFormProps {
  ticket: Ticket;
  onSuccess?: () => void;
  onRequestProgressCheckIn?: () => void;
}

export const TechnicalReportForm: React.FC<TechnicalReportFormProps> = ({
  ticket,
  onSuccess,
  onRequestProgressCheckIn
}) => {
  const {
    currentUser,
    rootCauseCategories,
    workResultsList,
    saveTechnicalReport,
    verifyTechnicalReport
  } = useApp();
  const { playReportSavedSound, playErrorSound } = useMoraJawsSound();
  const { toast } = useToast();

  const existingReport = ticket.technicalReport;
  const requiresCheckIn = currentUser.role === 'installer' && !ticket.checkInAt;

  const [isEditing, setIsEditing] = useState(!existingReport);
  const [mainCategory, setMainCategory] = useState(
    existingReport?.mainCategory || rootCauseCategories[0]?.name || 'Gangguan Fiber Optic dan Jaringan'
  );
  const [rootCause, setRootCause] = useState(
    existingReport?.rootCause || rootCauseCategories[0]?.items[0] || 'Fiber Optic Putus'
  );
  const [workResult, setWorkResult] = useState(
    existingReport?.workResult || workResultsList[0] || 'Berhasil Diperbaiki'
  );
  const [technicalDescription, setTechnicalDescription] = useState(
    existingReport?.technicalDescription || ''
  );
  const [correctiveAction, setCorrectiveAction] = useState(
    existingReport?.correctiveAction || ''
  );
  const [opticalPowerDbm, setOpticalPowerDbm] = useState(
    existingReport?.opticalPowerDbm || '-18.5 dBm'
  );
  const [deviceSerialNumber, setDeviceSerialNumber] = useState(
    existingReport?.deviceSerialNumber || ''
  );
  const [usedMaterials, setUsedMaterials] = useState(
    existingReport?.usedMaterials || ''
  );
  const [photoBeforeUrl, setPhotoBeforeUrl] = useState(
    existingReport?.photoBeforeUrl || ''
  );
  const [photoAfterUrl, setPhotoAfterUrl] = useState(
    existingReport?.photoAfterUrl || ''
  );
  const [additionalNotes, setAdditionalNotes] = useState(
    existingReport?.additionalNotes || ''
  );

  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const currentCategoryObj = rootCauseCategories.find(c => c.name === mainCategory);
  const availableRootCauses = currentCategoryObj?.items || [];

  const handleMainCategoryChange = (newCat: string) => {
    setMainCategory(newCat);
    const catObj = rootCauseCategories.find(c => c.name === newCat);
    if (catObj && catObj.items.length > 0) {
      setRootCause(catObj.items[0]);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, target: 'before' | 'after') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setNotice({ type: 'error', text: 'Ukuran foto maksimal 5MB.' });
      toast.warning('Ukuran foto maksimal 5MB.', 'File Terlalu Besar');
      setTimeout(() => setNotice(null), 3000);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      if (target === 'before') setPhotoBeforeUrl(url);
      else setPhotoAfterUrl(url);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (requiresCheckIn) {
      playErrorSound();
      const msg =
        'Check-in belum tercatat. Teknisi wajib mengirim pesan LiveChat dengan kategori PROGRESS terlebih dahulu sebelum Save Report.';
      setNotice({ type: 'error', text: msg });
      toast.error(msg, 'Check-in PROGRESS Diperlukan');
      return;
    }

    if (!technicalDescription.trim()) {
      setNotice({ type: 'error', text: 'Deskripsi teknis kendala wajib diisi.' });
      setTimeout(() => setNotice(null), 3000);
      return;
    }

    if (!correctiveAction.trim()) {
      setNotice({ type: 'error', text: 'Tindakan perbaikan wajib diisi.' });
      setTimeout(() => setNotice(null), 3000);
      return;
    }

    const result = saveTechnicalReport(ticket.id, {
      mainCategory,
      rootCause,
      workResult,
      technicalDescription: technicalDescription.trim(),
      correctiveAction: correctiveAction.trim(),
      opticalPowerDbm: opticalPowerDbm.trim(),
      deviceSerialNumber: deviceSerialNumber.trim(),
      usedMaterials: usedMaterials.trim(),
      photoBeforeUrl,
      photoAfterUrl,
      photos: existingReport?.photos,
      photoSlots: existingReport?.photoSlots,
      additionalNotes: additionalNotes.trim()
    });

    if (result.success) {
      playReportSavedSound();
      setIsEditing(false);
      setNotice({ type: 'success', text: 'Laporan teknis pekerjaan & root cause berhasil disimpan!' });
      toast.success('Laporan teknis berhasil disimpan & Check-out tercatat.', 'Laporan Tersimpan', {
        withSound: true
      });
      setTimeout(() => setNotice(null), 3500);
      onSuccess?.();
    } else {
      playErrorSound();
      setNotice({ type: 'error', text: result.error || 'Gagal menyimpan laporan.' });
      setTimeout(() => setNotice(null), 3500);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      {notice && (
        <TactileAlertBanner
          variant={notice.type === 'success' ? 'success' : 'critical'}
          badge={notice.type === 'success' ? 'LAPORAN TERSIMPAN' : 'VALIDASI LAPORAN'}
          title={notice.text}
          onDismiss={() => setNotice(null)}
        />
      )}

      {/* Submitted Report Summary Card */}
      {existingReport && !isEditing && (
        <div className="bg-white/95 dark:bg-[#0F172A] border border-[#DDE6F0] dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#DDE6F0] dark:border-slate-800">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#E4F5EC] text-[#218A63] dark:bg-emerald-950/70 dark:text-emerald-300 border border-[#B7E4CC] dark:border-emerald-700/50">
                  {existingReport.workResult}
                </span>
                {existingReport.verifiedByDispatch && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[#DDF4F4] text-[#2E7D8B] dark:bg-blue-950/60 dark:text-[#38BDF8] border border-[#BDE4E8] dark:border-blue-800">
                    <ShieldCheck className="w-3.5 h-3.5" /> Terverifikasi Dispatch
                  </span>
                )}
              </div>
              <div className="text-[#52647A] dark:text-slate-400 text-[11px] mt-1.5">
                Diserahkan oleh: <span className="font-bold text-[#26364A] dark:text-white">{existingReport.submittedBy}</span> pada{' '}
                {new Date(existingReport.submittedAt).toLocaleString('id-ID')}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {(currentUser.role === 'dispatch' || currentUser.role === 'super_admin') && !existingReport.verifiedByDispatch && (
                <button
                  type="button"
                  onClick={() => verifyTechnicalReport(ticket.id)}
                  className="btn-3d-primary min-h-[44px] sm:min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Verifikasi Laporan</span>
                </button>
              )}

              {(currentUser.role === 'installer' || currentUser.role === 'super_admin') && (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="btn-3d-ceramic min-h-[44px] sm:min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Edit Laporan
                </button>
              )}
            </div>
          </div>

          {/* Optical Telemetry Live Summary */}
          <div className="rounded-2xl bg-gradient-to-br from-[#EDF3F8] via-[#F0EDFF]/75 to-[#DDF4F4]/70 dark:bg-none dark:bg-[#0B1220] border border-[#DCE3F2] dark:border-slate-700/80 p-3.5 text-[#26364A] dark:text-white space-y-2.5">
            <div className="flex items-center justify-between text-[10.5px] font-mono uppercase tracking-wider text-[#2E7D8B] dark:text-[#38BDF8]">
              <span className="flex items-center gap-1.5 font-bold">
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>OPTICAL TELEMETRY RECORD</span>
              </span>
              <span className="text-[#218A63] dark:text-emerald-400 font-bold">VERIFIED</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="rounded-xl bg-white/90 dark:bg-[#1E293B] border border-[#DDE6F0] dark:border-slate-700 p-3">
                <div className="text-[11px] text-[#52647A] dark:text-slate-300">Optical Power (Redaman OPM)</div>
                <div className="mt-1 font-mono text-[18px] font-bold text-[#218A63] dark:text-emerald-400 tabular-nums">
                  {existingReport.opticalPowerDbm || '-'}
                </div>
              </div>
              <div className="rounded-xl bg-white/90 dark:bg-[#1E293B] border border-[#DDE6F0] dark:border-slate-700 p-3">
                <div className="text-[11px] text-[#52647A] dark:text-slate-300">Serial Number ONT / CPE</div>
                <div className="mt-1 font-mono text-[15px] font-bold text-[#26364A] dark:text-white flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#38BDF8]" />
                  <span>{existingReport.deviceSerialNumber || '-'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 bg-[#F8FAFD] dark:bg-[#1E293B] rounded-xl border border-[#DDE6F0] dark:border-slate-700 space-y-1">
              <span className="text-[10.5px] text-[#8492A5] dark:text-slate-400 uppercase font-mono block">Kategori Utama</span>
              <span className="font-bold text-[#26364A] dark:text-white text-xs">{existingReport.mainCategory}</span>
            </div>

            <div className="p-3 bg-[#F8FAFD] dark:bg-[#1E293B] rounded-xl border border-[#DDE6F0] dark:border-slate-700 space-y-1">
              <span className="text-[10.5px] text-[#8492A5] dark:text-slate-400 uppercase font-mono block">Penyebab Utama (Root Cause)</span>
              <span className="font-bold text-[#9B2C37] dark:text-rose-300 text-xs">{existingReport.rootCause}</span>
            </div>

            <div className="md:col-span-2 p-3 bg-[#F8FAFD] dark:bg-[#1E293B] rounded-xl border border-[#DDE6F0] dark:border-slate-700 space-y-1">
              <span className="text-[10.5px] text-[#8492A5] dark:text-slate-400 uppercase font-mono block">Deskripsi Teknis Kendala</span>
              <p className="text-[#26364A] dark:text-slate-200 leading-relaxed whitespace-pre-wrap">{existingReport.technicalDescription}</p>
            </div>

            <div className="md:col-span-2 p-3 bg-[#F8FAFD] dark:bg-[#1E293B] rounded-xl border border-[#DDE6F0] dark:border-slate-700 space-y-1">
              <span className="text-[10.5px] text-[#8492A5] dark:text-slate-400 uppercase font-mono block">Tindakan Perbaikan / Langkah Kerja</span>
              <p className="text-[#26364A] dark:text-slate-200 leading-relaxed whitespace-pre-wrap">{existingReport.correctiveAction}</p>
            </div>

            {existingReport.usedMaterials && (
              <div className="md:col-span-2 p-3 bg-[#F8FAFD] dark:bg-[#1E293B] rounded-xl border border-[#DDE6F0] dark:border-slate-700 space-y-1">
                <span className="text-[10.5px] text-[#8492A5] dark:text-slate-400 uppercase font-mono flex items-center gap-1">
                  <Package className="w-3 h-3 text-[#6657C8] dark:text-[#38BDF8]" />
                  <span>Material &amp; Spare Part Terpakai</span>
                </span>
                <p className="font-semibold text-[#26364A] dark:text-white">{existingReport.usedMaterials}</p>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-[#DDE6F0] dark:border-slate-800">
            <h5 className="font-display font-bold text-[#26364A] dark:text-white text-xs mb-3">Foto Bukti Pengerjaan</h5>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="text-[11px] text-[#52647A] dark:text-slate-400 mb-1 block">Foto Kondisi Awal (Before):</span>
                {existingReport.photoBeforeUrl ? (
                  <div
                    onClick={() => setZoomImage(existingReport.photoBeforeUrl!)}
                    className="cursor-pointer group relative rounded-xl overflow-hidden border border-[#DDE6F0] dark:border-slate-700 h-40 bg-[#EDF3F8] dark:bg-[#1E293B]"
                  >
                    <img src={getSafePreviewUrl(existingReport.photoBeforeUrl)} alt="Foto Sebelum" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    <div className="absolute inset-0 bg-[#26364A]/45 dark:bg-[#0B1220]/45 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                      <Maximize2 className="w-5 h-5" />
                    </div>
                  </div>
                ) : (
                  <div className="h-40 rounded-xl border border-dashed border-[#CFDCE8] dark:border-slate-700 flex items-center justify-center text-[#8492A5] dark:text-slate-400 text-xs">
                    Tidak ada foto awal
                  </div>
                )}
              </div>

              <div>
                <span className="text-[11px] text-[#52647A] dark:text-slate-400 mb-1 block">Foto Kondisi Akhir (After &amp; OPM):</span>
                {existingReport.photoAfterUrl ? (
                  <div
                    onClick={() => setZoomImage(existingReport.photoAfterUrl!)}
                    className="cursor-pointer group relative rounded-xl overflow-hidden border border-[#DDE6F0] dark:border-slate-700 h-40 bg-[#EDF3F8] dark:bg-[#1E293B]"
                  >
                    <img src={getSafePreviewUrl(existingReport.photoAfterUrl)} alt="Foto Sesudah" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    <div className="absolute inset-0 bg-[#26364A]/45 dark:bg-[#0B1220]/45 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                      <Maximize2 className="w-5 h-5" />
                    </div>
                  </div>
                ) : (
                  <div className="h-40 rounded-xl border border-dashed border-[#CFDCE8] dark:border-slate-700 flex items-center justify-center text-[#8492A5] dark:text-slate-400 text-xs">
                    Tidak ada foto akhir
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Editing / New Form */}
      {isEditing && (
        <form onSubmit={handleSubmit} className="bg-white/95 dark:bg-[#0F172A] border border-[#DDE6F0] dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-[#DDE6F0] dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#6657C8] to-[#5145A6] dark:bg-none dark:bg-[#2563EB] text-white flex items-center justify-center shadow-xs shrink-0">
                <Wrench className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-display font-bold text-[#26364A] dark:text-white text-[13.5px]">
                  Formulir Laporan Lapangan &amp; Root Cause
                </h4>
                <p className="text-[11px] text-[#52647A] dark:text-slate-400">
                  Wajib diisi oleh teknisi sebelum WO diverifikasi &amp; ditutup oleh Dispatch.
                </p>
              </div>
            </div>

            {existingReport && (
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="btn-3d-ceramic min-h-[40px] sm:min-h-[34px] px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
              >
                Batal
              </button>
            )}
          </div>

          {requiresCheckIn && (
            <TactileAlertBanner
              variant="warning"
              badge="CHECK-IN WAJIB (SOP)"
              title="Check-in via LiveChat Kategori #PROGRESS Diperlukan"
              description="Save Report memicu Check-out otomatis dan diblokir sebelum Anda mengirim minimal 1 pesan LiveChat dengan kategori PROGRESS."
              primaryAction={
                onRequestProgressCheckIn
                  ? {
                      label: 'Buka LiveChat (Kategori PROGRESS)',
                      onClick: onRequestProgressCheckIn
                    }
                  : undefined
              }
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[#26364A] dark:text-slate-300 font-bold mb-1">
                Kategori Utama Gangguan <span className="text-[#D45B66]">*</span>
              </label>
              <select
                value={mainCategory}
                onChange={e => handleMainCategoryChange(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-[#F8FAFD] dark:bg-[#1E293B] border border-[#DDE6F0] dark:border-slate-700 rounded-xl text-[#26364A] dark:text-white font-semibold focus:outline-hidden focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#2563EB]"
              >
                {rootCauseCategories.map(cat => (
                  <option key={cat.id} value={cat.name}>{cat.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[#26364A] dark:text-slate-300 font-bold mb-1">
                Penyebab Masalah (Root Cause) <span className="text-[#D45B66]">*</span>
              </label>
              <select
                value={rootCause}
                onChange={e => setRootCause(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-[#F8FAFD] dark:bg-[#1E293B] border border-[#DDE6F0] dark:border-slate-700 rounded-xl text-[#26364A] dark:text-white font-semibold focus:outline-hidden focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#2563EB]"
              >
                {availableRootCauses.map(rc => (
                  <option key={rc} value={rc}>{rc}</option>
                ))}
                <option value="Lainnya">Lainnya (Jelaskan di deskripsi teknis)</option>
              </select>
            </div>

            <div>
              <label className="block text-[#26364A] dark:text-slate-300 font-bold mb-1">
                Hasil Pengerjaan Lapangan <span className="text-[#D45B66]">*</span>
              </label>
              <select
                value={workResult}
                onChange={e => setWorkResult(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-[#F8FAFD] dark:bg-[#1E293B] border border-[#DDE6F0] dark:border-slate-700 rounded-xl text-[#26364A] dark:text-white font-semibold focus:outline-hidden focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#2563EB]"
              >
                {workResultsList.map(res => (
                  <option key={res} value={res}>{res}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[#26364A] dark:text-slate-300 font-bold mb-1">
                Redaman Fiber Optik (OPM dBm)
              </label>
              <input
                type="text"
                placeholder="Contoh: -18.5 dBm"
                value={opticalPowerDbm}
                onChange={e => setOpticalPowerDbm(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-[#F8FAFD] dark:bg-[#1E293B] border border-[#DDE6F0] dark:border-slate-700 rounded-xl font-mono font-bold text-[#26364A] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#2563EB]"
              />
            </div>

            <div>
              <label className="block text-[#26364A] dark:text-slate-300 font-bold mb-1">
                Serial Number Perangkat (ONT / Router)
              </label>
              <input
                type="text"
                placeholder="Contoh: HWTC12345678"
                value={deviceSerialNumber}
                onChange={e => setDeviceSerialNumber(e.target.value.toUpperCase())}
                className="w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-[#F8FAFD] dark:bg-[#1E293B] border border-[#DDE6F0] dark:border-slate-700 rounded-xl font-mono font-bold text-[#26364A] dark:text-white uppercase focus:outline-hidden focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#2563EB]"
              />
            </div>

            <div>
              <label className="block text-[#26364A] dark:text-slate-300 font-bold mb-1">
                Material / Spare Part Terpakai
              </label>
              <input
                type="text"
                placeholder="Contoh: Dropcore 120m, Fast Connector 2 pcs, Roset 1 port"
                value={usedMaterials}
                onChange={e => setUsedMaterials(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-[#F8FAFD] dark:bg-[#1E293B] border border-[#DDE6F0] dark:border-slate-700 rounded-xl text-[#26364A] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#2563EB]"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[#26364A] dark:text-slate-300 font-bold mb-1">
                Deskripsi Teknis Kendala / Kondisi Lapangan <span className="text-[#D45B66]">*</span>
              </label>
              <textarea
                rows={2}
                placeholder="Jelaskan kondisi sebelum diperbaiki, posisi kabel, titik redaman tinggi, atau kendala akses..."
                value={technicalDescription}
                onChange={e => setTechnicalDescription(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#F8FAFD] dark:bg-[#1E293B] border border-[#DDE6F0] dark:border-slate-700 rounded-xl text-[#26364A] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#2563EB]"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[#26364A] dark:text-slate-300 font-bold mb-1">
                Tindakan Perbaikan / Langkah Solusi <span className="text-[#D45B66]">*</span>
              </label>
              <textarea
                rows={2}
                placeholder="Jelaskan tindakan yang dilakukan: penarikan ulang kabel, pembersihan konektor, splicing ulang, atau penggantian ONT..."
                value={correctiveAction}
                onChange={e => setCorrectiveAction(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#F8FAFD] dark:bg-[#1E293B] border border-[#DDE6F0] dark:border-slate-700 rounded-xl text-[#26364A] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#2563EB]"
              />
            </div>

            <div className="p-3 bg-[#F8FAFD] dark:bg-[#1E293B] rounded-xl border border-[#DDE6F0] dark:border-slate-700 space-y-2">
              <label className="font-bold text-[#26364A] dark:text-white block">
                Foto Sebelum Perbaikan
              </label>
              {photoBeforeUrl ? (
                <div className="relative group rounded-xl overflow-hidden border border-[#DDE6F0] dark:border-slate-700 h-32">
                  <img src={getSafePreviewUrl(photoBeforeUrl)} alt="Foto Sebelum" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPhotoBeforeUrl('')}
                    className="absolute top-1.5 right-1.5 w-8 h-8 flex items-center justify-center bg-[#26364A]/80 dark:bg-[#0B1220]/80 text-white rounded-full hover:bg-[#D45B66] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <label className="h-32 border-2 border-dashed border-[#CFDCE8] dark:border-slate-600 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-[#EAE8FF]/45 dark:hover:bg-slate-800 transition-colors">
                  <Camera className="w-6 h-6 text-[#6657C8] dark:text-[#38BDF8] mb-1" />
                  <span className="text-[11px] text-[#52647A] dark:text-slate-400">Klik untuk upload foto awal</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => handlePhotoUpload(e, 'before')}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            <div className="p-3 bg-[#F8FAFD] dark:bg-[#1E293B] rounded-xl border border-[#DDE6F0] dark:border-slate-700 space-y-2">
              <label className="font-bold text-[#26364A] dark:text-white block">
                Foto Sesudah Perbaikan / Redaman OPM
              </label>
              {photoAfterUrl ? (
                <div className="relative group rounded-xl overflow-hidden border border-[#DDE6F0] dark:border-slate-700 h-32">
                  <img src={getSafePreviewUrl(photoAfterUrl)} alt="Foto Sesudah" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPhotoAfterUrl('')}
                    className="absolute top-1.5 right-1.5 w-8 h-8 flex items-center justify-center bg-[#26364A]/80 dark:bg-[#0B1220]/80 text-white rounded-full hover:bg-[#D45B66] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <label className="h-32 border-2 border-dashed border-[#CFDCE8] dark:border-slate-600 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-[#EAE8FF]/45 dark:hover:bg-slate-800 transition-colors">
                  <Camera className="w-6 h-6 text-[#6657C8] dark:text-[#38BDF8] mb-1" />
                  <span className="text-[11px] text-[#52647A] dark:text-slate-400">Klik untuk upload foto hasil &amp; OPM</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => handlePhotoUpload(e, 'after')}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#DDE6F0] dark:border-slate-800">
            <button
              type="submit"
              disabled={requiresCheckIn}
              title={requiresCheckIn ? 'Kirim pesan LiveChat kategori PROGRESS terlebih dahulu untuk Check-in' : 'Simpan Laporan Teknis & Check-out'}
              className="btn-3d-primary w-full sm:w-auto px-5 py-2.5 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Simpan Laporan &amp; Selesaikan Tugas Lapangan</span>
            </button>
          </div>
        </form>
      )}

      {zoomImage && (
        <div
          className="fixed inset-0 z-70 bg-[#0B1220]/85 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setZoomImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setZoomImage(null)}
              className="absolute top-3 right-3 w-11 h-11 flex items-center justify-center bg-[#0F172A]/90 text-white rounded-full hover:bg-rose-600 transition-colors z-10 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <img src={getSafePreviewUrl(zoomImage)} alt="Bukti Foto Zoom" className="max-w-full max-h-[85vh] object-contain rounded-xl" />
          </div>
        </div>
      )}
    </div>
  );
};
