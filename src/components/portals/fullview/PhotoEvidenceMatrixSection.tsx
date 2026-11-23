import React, { useState } from 'react';
import {
  Activity,
  BadgeCheck,
  Cable,
  Camera,
  ExternalLink,
  Eye,
  Gauge,
  GitBranch,
  Home,
  LocateFixed,
  MapPin,
  QrCode,
  RefreshCw,
  RotateCcw,
  Router,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import { TechnicalPhotoSlot, Ticket } from '../../../types/index.ts';
import { getSafePreviewUrl } from '../../../services/storageCompatibility';
import {
  buildGoogleMapsCoordinateUrl,
  formatCoordinates,
  isValidCoordinatePair
} from '../../../services/mapsService';
import { GeoLocationMiniMap } from '../../maps/GeoLocationMiniMap';
import {
  PHOTO_SLOT_DEFINITIONS,
  PhotoSlotDefinition,
  PhotoSlotKey,
  PhotoSlotsRecord,
  SlotUploadMeta
} from './types';

interface PhotoEvidenceMatrixSectionProps {
  sectionRef?: React.RefObject<HTMLElement | null>;
  activeTicket: Ticket;
  photoSlots: PhotoSlotsRecord;
  uploadedCount: number;
  slotUploadState: Partial<Record<PhotoSlotKey, SlotUploadMeta>>;
  expandedMapSlot: PhotoSlotKey | null;
  onToggleMapSlot: (slotKey: PhotoSlotKey | null) => void;
  ticketClosed: boolean;
  opmDbm: string;
  fatPort: string;
  ontSerialNumber: string;
  onOpenCamera: (slotDef: PhotoSlotDefinition) => void;
  onRetryUpload: (slotDef: PhotoSlotDefinition) => void;
  onViewPhoto: (url: string, slotDef: PhotoSlotDefinition) => void;
  onDeletePhoto?: (slotDef: PhotoSlotDefinition) => void;
  deletingSlotKey?: PhotoSlotKey | null;
  verifiedUploadedCount?: number;
}

function getEmptySlotIcon(slotKey: PhotoSlotKey) {
  switch (slotKey) {
    case 'customer_house':
      return <Home className="w-5 h-5" />;
    case 'fat_pole':
      return <GitBranch className="w-5 h-5" />;
    case 'fat_attenuation':
      return <Activity className="w-5 h-5" />;
    case 'fat_port':
      return <Cable className="w-5 h-5" />;
    case 'customer_install':
      return <Router className="w-5 h-5" />;
    case 'barcode_sn':
      return <QrCode className="w-5 h-5" />;
    case 'opm':
    default:
      return <Gauge className="w-5 h-5" />;
  }
}

export const PhotoEvidenceMatrixSection: React.FC<PhotoEvidenceMatrixSectionProps> = ({
  sectionRef,
  activeTicket,
  photoSlots,
  uploadedCount,
  slotUploadState,
  expandedMapSlot,
  onToggleMapSlot,
  ticketClosed,
  opmDbm,
  fatPort,
  ontSerialNumber,
  onOpenCamera,
  onRetryUpload,
  onViewPhoto,
  onDeletePhoto,
  deletingSlotKey = null,
  verifiedUploadedCount
}) => {
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  const totalSlots = PHOTO_SLOT_DEFINITIONS.length;
  const verifiedCount = typeof verifiedUploadedCount === 'number' ? verifiedUploadedCount : uploadedCount;
  const mandatoryReady = verifiedCount >= 3;
  const progressPct = Math.round((uploadedCount / totalSlots) * 1000) / 10;

  const resolveOverlayBadge = (slotDef: PhotoSlotDefinition, slotData: TechnicalPhotoSlot) => {
    const hasCoords = isValidCoordinatePair(slotData.latitude, slotData.longitude);
    const accLabel =
      typeof slotData.gpsAccuracyMeters === 'number'
        ? `±${Math.round(slotData.gpsAccuracyMeters)}m GPS`
        : 'GPS OK';

    if (slotDef.slotKey === 'customer_house') {
      return hasCoords ? accLabel : slotData.badgeText || 'Lokasi Rumah';
    }
    if (slotDef.slotKey === 'fat_pole') {
      return activeTicket.fatCode || activeTicket.fdtCode || slotData.badgeText || 'Tiang FAT';
    }
    if (slotDef.slotKey === 'fat_attenuation') {
      if (activeTicket.fatRedamanDbm) {
        const clean = String(activeTicket.fatRedamanDbm).replace(/dbm/gi, '').trim();
        return `${clean} dBm`;
      }
      return hasCoords ? accLabel : slotData.badgeText || 'Redaman FAT';
    }
    if (slotDef.slotKey === 'fat_port') {
      const cleanPort = (fatPort || activeTicket.fatPort || '').replace(/^#/, '').trim();
      return cleanPort ? `Port #${cleanPort}` : slotData.badgeText || 'Port FAT';
    }
    if (slotDef.slotKey === 'customer_install') {
      return slotData.badgeText || 'Instalasi Rapi';
    }
    if (slotDef.slotKey === 'barcode_sn') {
      return ontSerialNumber.trim() ? `SN ${ontSerialNumber.trim().slice(0, 14)}` : slotData.badgeText || 'SN & MAC';
    }
    if (slotDef.slotKey === 'opm') {
      return opmDbm.trim() ? `${opmDbm.trim()} dBm` : slotData.badgeText || 'OPM Roset';
    }
    return slotData.badgeText || slotDef.defaultTag;
  };

  return (
    <div ref={sectionRef as React.RefObject<HTMLDivElement | null>} className="space-y-3">
      {/* Progress Summary Bar */}
      <div className="bg-[#F8FAFD] dark:bg-[#f8f1ff] rounded-xl p-3 border border-[#DDE6F0] dark:border-[#e8ddff] space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-bold text-[#26364A] dark:text-[#1f1638]">
            Bukti Foto Fisik Pekerjaan (Minimal 3 Foto Wajib Check-Out)
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold tabular-nums border ${
                mandatoryReady
                  ? 'bg-[#E4F5EC] dark:bg-emerald-50 text-[#218A63] dark:text-emerald-700 border-[#B7E4CC] dark:border-emerald-200'
                  : 'bg-[#FCE9EB] dark:bg-rose-50 text-[#9B2C37] dark:text-[#ba1a1a] border-[#F3C5CA] dark:border-rose-200'
              }`}
            >
              Wajib: {Math.min(3, verifiedCount)} / 3
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold tabular-nums border bg-[#EAE8FF] dark:bg-[#f3eaff] text-[#5145A6] dark:text-[#58149c] border-[#DCE3F2] dark:border-[#d8ccf3]">
              Total: {uploadedCount} / {totalSlots} ({progressPct.toFixed(0)}%)
            </span>
          </div>
        </div>

        <div className="w-full h-2 rounded-full bg-[#EDF3F8] dark:bg-[#e8ddff] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#65B8C4] to-[#6657C8] dark:bg-none dark:bg-[#7135b5] transition-all duration-300"
            style={{ width: `${Math.max(uploadedCount > 0 ? 5 : 0, Math.min(100, progressPct))}%` }}
          />
        </div>

        <p className="text-[11px] text-[#52647A] dark:text-[#4b4452] leading-snug">
          {mandatoryReady ? (
            <span className="font-semibold text-[#218A63] dark:text-emerald-700">
              Syarat minimal 3 foto bukti fisik terpenuhi ({verifiedCount} terunggah ke server).
            </span>
          ) : (
            <span className="font-semibold text-[#9B2C37] dark:text-[#ba1a1a]">
              Unggah minimal {3 - Math.min(3, verifiedCount)} foto bukti fisik lagi sebelum Check-Out.
            </span>
          )}{' '}
          <span className="font-semibold text-[#5145A6] dark:text-[#58149c]">
            Foto #01 mengisi Lokasi Rumah &amp; Foto #03 mengisi Lokasi FAT.
          </span>
        </p>
      </div>

      {/* 7 Ordered Evidence Slots (2-col mobile / 3-col desktop) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {PHOTO_SLOT_DEFINITIONS.map(slotDef => {
          const slotData = photoSlots[slotDef.slotKey];
          const uploadMeta = slotUploadState[slotDef.slotKey];
          const isDeleting = deletingSlotKey === slotDef.slotKey;
          const isBusy = uploadMeta?.status === 'uploading' || isDeleting;
          const isFailed = uploadMeta?.status === 'failed' || slotData?.uploadStatus === 'failed';
          const hasValidCoords = Boolean(
            slotData && isValidCoordinatePair(slotData.latitude, slotData.longitude)
          );
          const isMapExpanded = expandedMapSlot === slotDef.slotKey;
          const safeUrl = slotData?.url ? getSafePreviewUrl(slotData.url) : '';
          const imageBroken = Boolean(safeUrl && brokenImages[slotDef.slotKey]);

          if (slotData?.url) {
            const overlayBadgeText = resolveOverlayBadge(slotDef, slotData);
            const statusSummary = isDeleting
              ? { cls: 'text-[#9B2C37] dark:text-[#ba1a1a]', text: 'Menghapus...', icon: 'busy' as const }
              : uploadMeta?.status === 'uploading'
              ? { cls: 'text-[#5145A6] dark:text-[#58149c]', text: 'Mengunggah...', icon: 'busy' as const }
              : isFailed
              ? { cls: 'text-[#9B2C37] dark:text-[#ba1a1a]', text: 'Upload Gagal', icon: 'error' as const }
              : hasValidCoords && slotData.geotagStatus === 'weak'
              ? { cls: 'text-[#9D661F] dark:text-amber-700', text: 'Berhasil Diunggah (Weak GPS)', icon: 'warn' as const }
              : { cls: 'text-[#218A63] dark:text-emerald-700', text: 'Berhasil Diunggah', icon: 'ok' as const };

            return (
              <div
                key={slotDef.slotKey}
                className={`bg-white/95 dark:bg-white rounded-xl overflow-hidden flex flex-col border transition-colors shadow-xs ${
                  isFailed ? 'border-[#F3C5CA] dark:border-rose-300' : 'border-[#DDE6F0] dark:border-[#e8ddff]'
                }`}
              >
                {/* 4:3 Photo Thumbnail */}
                <div className="relative w-full aspect-[4/3] bg-[#F8FAFD] dark:bg-[#f8f1ff] overflow-hidden">
                  {safeUrl && !imageBroken ? (
                    <img
                      src={safeUrl}
                      alt={slotDef.title}
                      onClick={() => onViewPhoto(slotData.url, slotDef)}
                      onError={() =>
                        setBrokenImages(prev => ({ ...prev, [slotDef.slotKey]: true }))
                      }
                      className="w-full h-full object-cover cursor-pointer hover:scale-[1.02] transition-transform duration-200"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenCamera(slotDef)}
                      disabled={ticketClosed || isBusy}
                      className="w-full h-full flex flex-col items-center justify-center gap-1.5 p-2 text-[#8492A5] dark:text-[#7d7484] hover:text-[#5145A6] dark:hover:text-[#58149c] cursor-pointer"
                    >
                      {slotDef.slotKey === 'barcode_sn' ? (
                        <QrCode className="w-6 h-6" />
                      ) : (
                        <Camera className="w-6 h-6" />
                      )}
                      <span className="font-mono text-[10px]">
                        {slotDef.slotKey === 'barcode_sn'
                          ? 'Pratinjau tidak tersedia · Scan Ulang'
                          : 'Pratinjau tidak tersedia · Foto Ulang'}
                      </span>
                    </button>
                  )}

                  {/* Slot Order Tag Top Left */}
                  <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-white/95 text-[#5145A6] dark:text-[#58149c] font-mono text-[9.5px] font-bold tracking-wide border border-[#DDE6F0] dark:border-[#e8ddff] shadow-2xs">
                    {slotDef.mandatoryLabel ? `Wajib #${slotDef.mandatoryOrder}` : `${slotDef.slotNumber}. ${slotDef.codeLabel}`}
                  </span>

                  {/* Telemetry Tag Bottom Left */}
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-1 pointer-events-none">
                    <span className="px-1.5 py-0.5 rounded bg-white/95 text-[#26364A] dark:text-[#1f1638] border border-[#DDE6F0] dark:border-[#e8ddff] font-mono text-[9.5px] font-semibold truncate max-w-full inline-flex items-center gap-1 shadow-2xs">
                      {slotDef.slotKey === 'customer_house' && (
                        <LocateFixed className="w-3 h-3 text-[#2E7D8B] dark:text-[#58149c] shrink-0" />
                      )}
                      <span className="truncate">{overlayBadgeText}</span>
                    </span>
                  </div>
                </div>

                {/* Metadata + Actions */}
                <div className="p-2.5 flex flex-col justify-between flex-1 gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <h4 className="text-[11.5px] text-[#26364A] dark:text-[#1f1638] font-bold truncate">
                      {slotDef.mandatoryLabel ? `${slotDef.mandatoryLabel} · ${slotDef.title}` : slotDef.title}
                    </h4>
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`text-[10px] font-semibold flex items-center gap-1 truncate ${statusSummary.cls}`}
                      >
                        {statusSummary.icon === 'ok' && <BadgeCheck className="w-3.5 h-3.5 shrink-0" />}
                        {statusSummary.icon === 'warn' && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                        {statusSummary.icon === 'error' && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                        {statusSummary.icon === 'busy' && <RefreshCw className="w-3 h-3 animate-spin shrink-0" />}
                        <span className="truncate">{statusSummary.text}</span>
                      </span>

                      {hasValidCoords && (
                        <button
                          type="button"
                          onClick={() => onToggleMapSlot(isMapExpanded ? null : slotDef.slotKey)}
                          className="text-[10px] font-mono font-bold text-[#2E7D8B] dark:text-[#58149c] hover:underline inline-flex items-center gap-0.5 shrink-0 cursor-pointer"
                          title={isMapExpanded ? 'Tutup Mini Map' : 'Lihat Titik GPS'}
                        >
                          <MapPin className="w-3 h-3" />
                          <span>{isMapExpanded ? 'Tutup' : 'Peta'}</span>
                        </button>
                      )}
                    </div>

                    {isFailed && uploadMeta?.error && (
                      <p className="text-[10px] text-[#9B2C37] dark:text-[#ba1a1a] leading-tight line-clamp-2 pt-0.5">
                        {uploadMeta.error}
                      </p>
                    )}

                    {isMapExpanded && hasValidCoords && (
                      <div className="pt-1.5 space-y-1">
                        <div className="flex items-center justify-between gap-1 text-[9.5px] font-mono text-[#26364A] dark:text-[#1f1638] bg-[#F8FAFD] dark:bg-[#f8f1ff] border border-[#DDE6F0] dark:border-[#e8ddff] px-2 py-1 rounded">
                          <span className="truncate">
                            {formatCoordinates(slotData.latitude!, slotData.longitude!)}
                          </span>
                          <a
                            href={buildGoogleMapsCoordinateUrl(slotData.latitude!, slotData.longitude!)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-[#5145A6] dark:text-[#58149c] font-bold hover:underline shrink-0"
                          >
                            <span>Maps</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                        <GeoLocationMiniMap
                          latitude={slotData.latitude}
                          longitude={slotData.longitude}
                          accuracyMeters={slotData.gpsAccuracyMeters}
                          geotagStatus={slotData.geotagStatus}
                          label={slotDef.title}
                          markerVariant={
                            slotDef.slotKey === 'customer_house'
                              ? 'house'
                              : slotDef.slotKey === 'fat_attenuation'
                              ? 'fat'
                              : 'photo'
                          }
                          heightClass="h-28"
                          compact
                        />
                      </div>
                    )}
                  </div>

                  {/* Card Footer Buttons */}
                  <div className="flex items-center gap-1.5">
                    {isFailed && uploadMeta?.pendingPayload ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onRetryUpload(slotDef)}
                        className={`mj-btn-installer-danger mj-btn-compact flex-1 py-1.5 px-2 text-[11px] gap-1 cursor-pointer ${
                          isBusy ? 'mj-btn-loading' : ''
                        }`}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onViewPhoto(slotData.url, slotDef)}
                        className="mj-btn-installer-neutral mj-btn-compact flex-1 py-1.5 px-2 text-[11px] gap-1 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                        <span>Lihat</span>
                      </button>
                    )}

                    {!ticketClosed && (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onOpenCamera(slotDef)}
                          aria-label={
                            slotDef.slotKey === 'barcode_sn'
                              ? `Scan Ulang Barcode ${slotDef.title}`
                              : `Foto Ulang ${slotDef.title}`
                          }
                          title={
                            slotDef.slotKey === 'barcode_sn'
                              ? `Scan Ulang Barcode ${slotDef.title}`
                              : `Foto Ulang / Ganti ${slotDef.title}`
                          }
                          className={`mj-btn-icon-3d-installer w-9 h-9 cursor-pointer shrink-0 ${
                            isBusy ? 'mj-btn-loading' : ''
                          }`}
                        >
                          {slotDef.slotKey === 'barcode_sn' ? (
                            <QrCode className={`w-3.5 h-3.5 ${isBusy ? 'animate-pulse' : ''}`} />
                          ) : (
                            <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                          )}
                        </button>
                        {onDeletePhoto && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onDeletePhoto(slotDef)}
                            aria-label={`Hapus ${slotDef.title}`}
                            title={`Hapus Foto ${slotDef.title}`}
                            className="w-9 h-9 rounded-lg border border-[#F3C5CA] dark:border-rose-300 bg-[#FCE9EB] dark:bg-rose-50 text-[#9B2C37] dark:text-[#ba1a1a] hover:bg-rose-100 flex items-center justify-center cursor-pointer shrink-0 disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          // EMPTY SLOT STATE CARD
          return (
            <div
              key={slotDef.slotKey}
              className="bg-white/95 dark:bg-white rounded-xl p-2.5 flex flex-col justify-between border border-[#DDE6F0] dark:border-[#e8ddff] shadow-xs"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="px-1.5 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#f3eaff] text-[#5145A6] dark:text-[#58149c] font-mono text-[9.5px] font-bold tracking-wide truncate">
                  {slotDef.mandatoryLabel ? `Wajib #${slotDef.mandatoryOrder}` : `${slotDef.slotNumber}. ${slotDef.codeLabel}`}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-[#FCE9EB] dark:bg-rose-50 text-[#9B2C37] dark:text-[#ba1a1a] border border-[#F3C5CA] dark:border-rose-200 font-mono text-[9.5px] font-bold shrink-0">
                  Belum Diunggah
                </span>
              </div>

              <div className="my-2 py-2.5 px-2 rounded-lg bg-[#F8FAFD] dark:bg-[#f8f1ff] border border-[#DDE6F0] dark:border-[#e8ddff]/80 flex flex-col items-center justify-center text-center min-h-[96px]">
                <div className="w-9 h-9 rounded-full bg-[#DDF4F4] dark:bg-[#eedbff] text-[#2E7D8B] dark:text-[#58149c] flex items-center justify-center mb-1.5">
                  {getEmptySlotIcon(slotDef.slotKey)}
                </div>
                <div className="text-[11px] font-bold text-[#26364A] dark:text-[#1f1638] leading-tight mb-0.5 line-clamp-2">
                  {slotDef.mandatoryLabel ? `${slotDef.mandatoryLabel} · ${slotDef.title}` : slotDef.title}
                </div>
                <p className="text-[10px] text-[#52647A] dark:text-[#4b4452] leading-tight line-clamp-2">
                  {isBusy ? 'Mengunggah foto...' : slotDef.emptyHint}
                </p>
              </div>

              <button
                type="button"
                disabled={ticketClosed || isBusy}
                onClick={() => onOpenCamera(slotDef)}
                className={`mj-btn-installer-primary mj-btn-compact w-full py-2 px-2.5 text-[11px] gap-1.5 cursor-pointer ${
                  isBusy ? 'mj-btn-loading' : ''
                }`}
              >
                {slotDef.slotKey === 'barcode_sn' ? (
                  <>
                    <QrCode className="w-3.5 h-3.5" />
                    <span>{ticketClosed ? 'Terkunci' : 'Scan Barcode'}</span>
                  </>
                ) : (
                  <>
                    <Camera className="w-3.5 h-3.5" />
                    <span>{ticketClosed ? 'Terkunci' : 'Ambil Foto'}</span>
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
