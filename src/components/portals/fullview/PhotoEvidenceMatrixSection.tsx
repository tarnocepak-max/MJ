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
import { WorkOrderLocationsCard } from '../../maps/WorkOrderLocationsCard';
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
  onOpenCameraByKey: (slotKey: PhotoSlotKey) => void;
  onRetryUpload: (slotDef: PhotoSlotDefinition) => void;
  onViewPhoto: (url: string, slotDef: PhotoSlotDefinition) => void;
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
  onOpenCameraByKey,
  onRetryUpload,
  onViewPhoto
}) => {
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  const totalSlots = PHOTO_SLOT_DEFINITIONS.length;
  const remaining = Math.max(0, totalSlots - uploadedCount);
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
      <div className="bg-[#f8f1ff] rounded-xl p-3 border border-[#e8ddff] space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-bold text-[#1f1638]">
            Kelengkapan Berkas Foto SOP
          </span>
          <span
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold tabular-nums border ${
              remaining === 0
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-[#f3eaff] text-[#58149c] border-[#d8ccf3]'
            }`}
          >
            {uploadedCount} / {totalSlots} Foto ({progressPct.toFixed(0)}%)
          </span>
        </div>

        <div className="w-full h-2 rounded-full bg-[#e8ddff] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#7135b5] transition-all duration-300"
            style={{ width: `${Math.max(uploadedCount > 0 ? 5 : 0, Math.min(100, progressPct))}%` }}
          />
        </div>

        <p className="text-[11px] text-[#4b4452] leading-snug">
          Foto diambil langsung via kamera GPS terenkripsi.{' '}
          <span className="font-semibold text-[#58149c]">
            Foto #01 mengisi Lokasi Rumah &amp; Foto #03 mengisi Lokasi FAT.
          </span>
        </p>
      </div>

      {/* 7 Ordered Evidence Slots (2-col mobile / 3-col desktop) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {PHOTO_SLOT_DEFINITIONS.map(slotDef => {
          const slotData = photoSlots[slotDef.slotKey];
          const uploadMeta = slotUploadState[slotDef.slotKey];
          const isBusy = uploadMeta?.status === 'uploading';
          const isFailed = uploadMeta?.status === 'failed' || slotData?.uploadStatus === 'failed';
          const hasValidCoords = Boolean(
            slotData && isValidCoordinatePair(slotData.latitude, slotData.longitude)
          );
          const isMapExpanded = expandedMapSlot === slotDef.slotKey;
          const safeUrl = slotData?.url ? getSafePreviewUrl(slotData.url) : '';
          const imageBroken = Boolean(safeUrl && brokenImages[slotDef.slotKey]);

          if (slotData?.url) {
            const overlayBadgeText = resolveOverlayBadge(slotDef, slotData);
            const statusSummary = isBusy
              ? { cls: 'text-[#58149c]', text: 'Mengunggah...', icon: 'busy' as const }
              : isFailed
              ? { cls: 'text-[#ba1a1a]', text: 'Upload Tertunda', icon: 'error' as const }
              : hasValidCoords && slotData.geotagStatus === 'weak'
              ? { cls: 'text-amber-700', text: 'Weak GPS', icon: 'warn' as const }
              : { cls: 'text-emerald-700', text: slotDef.validLabel, icon: 'ok' as const };

            return (
              <div
                key={slotDef.slotKey}
                className={`bg-white rounded-xl overflow-hidden flex flex-col border transition-colors shadow-xs ${
                  isFailed ? 'border-rose-300' : 'border-[#e8ddff]'
                }`}
              >
                {/* 4:3 Photo Thumbnail */}
                <div className="relative w-full aspect-[4/3] bg-[#f8f1ff] overflow-hidden">
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
                      className="w-full h-full flex flex-col items-center justify-center gap-1.5 p-2 text-[#7d7484] hover:text-[#58149c] cursor-pointer"
                    >
                      <Camera className="w-6 h-6" />
                      <span className="font-mono text-[10px]">Pratinjau tidak tersedia · Foto Ulang</span>
                    </button>
                  )}

                  {/* Slot Order Tag Top Left */}
                  <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-white/95 text-[#58149c] font-mono text-[9.5px] font-bold tracking-wide border border-[#e8ddff] shadow-2xs">
                    {slotDef.slotNumber}. {slotDef.codeLabel}
                  </span>

                  {/* Telemetry Tag Bottom Left */}
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-1 pointer-events-none">
                    <span className="px-1.5 py-0.5 rounded bg-white/95 text-[#1f1638] border border-[#e8ddff] font-mono text-[9.5px] font-semibold truncate max-w-full inline-flex items-center gap-1 shadow-2xs">
                      {slotDef.slotKey === 'customer_house' && (
                        <LocateFixed className="w-3 h-3 text-[#58149c] shrink-0" />
                      )}
                      <span className="truncate">{overlayBadgeText}</span>
                    </span>
                  </div>
                </div>

                {/* Metadata + Actions */}
                <div className="p-2.5 flex flex-col justify-between flex-1 gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <h4 className="text-[11.5px] text-[#1f1638] font-bold truncate">
                      {slotDef.title}
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
                          className="text-[10px] font-mono font-bold text-[#58149c] hover:underline inline-flex items-center gap-0.5 shrink-0 cursor-pointer"
                          title={isMapExpanded ? 'Tutup Mini Map' : 'Lihat Titik GPS'}
                        >
                          <MapPin className="w-3 h-3" />
                          <span>{isMapExpanded ? 'Tutup' : 'Peta'}</span>
                        </button>
                      )}
                    </div>

                    {isFailed && uploadMeta?.error && (
                      <p className="text-[10px] text-[#ba1a1a] leading-tight line-clamp-2 pt-0.5">
                        {uploadMeta.error}
                      </p>
                    )}

                    {isMapExpanded && hasValidCoords && (
                      <div className="pt-1.5 space-y-1">
                        <div className="flex items-center justify-between gap-1 text-[9.5px] font-mono text-[#1f1638] bg-[#f8f1ff] border border-[#e8ddff] px-2 py-1 rounded">
                          <span className="truncate">
                            {formatCoordinates(slotData.latitude!, slotData.longitude!)}
                          </span>
                          <a
                            href={buildGoogleMapsCoordinateUrl(slotData.latitude!, slotData.longitude!)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-[#58149c] font-bold hover:underline shrink-0"
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

                  {/* Card Footer Buttons (Existing MoraJaws Secondary Buttons) */}
                  <div className="flex items-center gap-1.5">
                    {isFailed && uploadMeta?.pendingPayload ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onRetryUpload(slotDef)}
                        className="flex-1 py-1.5 px-2 rounded-lg mj-tactile-btn-danger text-[10.5px] flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onViewPhoto(slotData.url, slotDef)}
                        className="flex-1 py-1.5 px-2 rounded-lg mj-btn-secondary text-[11px] flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#58149c]" />
                        <span>Lihat</span>
                      </button>
                    )}

                    {!ticketClosed && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onOpenCamera(slotDef)}
                        aria-label={`Foto Ulang ${slotDef.title}`}
                        title={`Foto Ulang ${slotDef.title}`}
                        className="w-8 h-8 rounded-lg mj-btn-secondary text-[#58149c] flex items-center justify-center cursor-pointer shrink-0 disabled:opacity-40"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                      </button>
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
              className="bg-white rounded-xl p-2.5 flex flex-col justify-between border border-[#e8ddff] shadow-xs"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="px-1.5 py-0.5 rounded bg-[#f3eaff] text-[#58149c] font-mono text-[9.5px] font-bold tracking-wide truncate">
                  {slotDef.slotNumber}. {slotDef.codeLabel}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-rose-50 text-[#ba1a1a] border border-rose-200 font-mono text-[9.5px] font-bold shrink-0">
                  Belum Ada
                </span>
              </div>

              <div className="my-2 py-2.5 px-2 rounded-lg bg-[#f8f1ff] border border-[#e8ddff]/80 flex flex-col items-center justify-center text-center min-h-[96px]">
                <div className="w-9 h-9 rounded-full bg-[#eedbff] text-[#58149c] flex items-center justify-center mb-1.5">
                  {getEmptySlotIcon(slotDef.slotKey)}
                </div>
                <div className="text-[11px] font-bold text-[#1f1638] leading-tight mb-0.5 line-clamp-1">
                  {slotDef.title}
                </div>
                <p className="text-[10px] text-[#4b4452] leading-tight line-clamp-2">
                  {isBusy ? 'Mengunggah foto...' : slotDef.emptyHint}
                </p>
              </div>

              <button
                type="button"
                disabled={ticketClosed || isBusy}
                onClick={() => onOpenCamera(slotDef)}
                className="w-full py-2 px-2.5 rounded-lg mj-tactile-btn-primary text-[11px] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{ticketClosed ? 'Terkunci' : 'Ambil Foto'}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* House & FAT Geo-Location Telemetry Cards */}
      <div className="pt-1">
        <WorkOrderLocationsCard
          ticket={activeTicket}
          compact
          canQuickCapture={!ticketClosed}
          onQuickCaptureHouse={() => onOpenCameraByKey('customer_house')}
          onQuickCaptureFat={() => onOpenCameraByKey('fat_attenuation')}
        />
      </div>
    </div>
  );
};
