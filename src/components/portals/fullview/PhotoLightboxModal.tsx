import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, RefreshCw, Satellite, Trash2, X } from 'lucide-react';
import { TechnicalPhotoSlot } from '../../../types/index.ts';
import { getSafePreviewUrl } from '../../../services/storageCompatibility';
import { formatJakartaTimeOnly } from '../../../services/workSessionService';
import {
  buildGoogleMapsCoordinateUrl,
  formatCoordinates,
  isValidCoordinatePair
} from '../../../services/mapsService';
import { GeoLocationMiniMap } from '../../maps/GeoLocationMiniMap';
import { PhotoSlotDefinition } from './types';
import { useModalLayer } from '../../../hooks/useModalLayer';

interface PhotoLightboxModalProps {
  imageUrl: string | null;
  matchedSlot?: TechnicalPhotoSlot;
  matchedSlotDef?: PhotoSlotDefinition;
  ticketClosed: boolean;
  onClose: () => void;
  onRetake?: (slotDef: PhotoSlotDefinition) => void;
  onDelete?: (slotDef: PhotoSlotDefinition) => void;
}

export const PhotoLightboxModal: React.FC<PhotoLightboxModalProps> = ({
  imageUrl,
  matchedSlot,
  matchedSlotDef,
  ticketClosed,
  onClose,
  onRetake,
  onDelete
}) => {
  const layerZ = useModalLayer(Boolean(imageUrl), { tier: 'nested' });

  useEffect(() => {
    if (!imageUrl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [imageUrl, onClose]);

  if (!imageUrl) return null;

  const hasZoomGps = Boolean(
    matchedSlot && isValidCoordinatePair(matchedSlot.latitude, matchedSlot.longitude)
  );
  const stepLabel = matchedSlotDef
    ? `BUKTI FOTO #${matchedSlotDef.slotNumber}`
    : 'PRATINJAU BUKTI LAPANGAN';
  const titleLabel = matchedSlotDef?.title || matchedSlot?.title || 'Lampiran Bukti Lapangan';
  const timeLabel = matchedSlot?.capturedAtIso
    ? `${formatJakartaTimeOnly(matchedSlot.capturedAtIso)} WIB`
    : matchedSlot?.capturedAt || '';
  const accLabel =
    typeof matchedSlot?.gpsAccuracyMeters === 'number'
      ? `Akurasi: ±${Math.round(matchedSlot.gpsAccuracyMeters)}m`
      : '';
  const altLabel =
    typeof matchedSlot?.altitudeMeters === 'number'
      ? `Elev: ${Math.round(matchedSlot.altitudeMeters)}m`
      : '';
  const metaLine = [accLabel, altLabel, timeLabel].filter(Boolean).join(' • ');

  const lightboxContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titleLabel}
      style={{ zIndex: layerZ }}
      className="fixed inset-0 bg-slate-900/55 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white/95 dark:bg-white rounded-2xl border border-[#DDE6F0] dark:border-[#e8ddff] shadow-xl overflow-hidden flex flex-col max-h-[92dvh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="px-4 py-3 border-b border-[#DDE6F0] dark:border-[#e8ddff] bg-[#EDF3F8] dark:bg-[#fdf7ff] flex items-center justify-between gap-3 shrink-0">
          <div className="flex flex-col min-w-0">
            <span className="font-mono text-[10px] text-[#2E7D8B] dark:text-[#7135b5] font-bold tracking-wider uppercase">
              {stepLabel}
            </span>
            <h4 className="font-display text-base text-[#26364A] dark:text-[#1f1638] font-bold truncate">
              {titleLabel}
            </h4>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup Pratinjau"
            className="mj-btn-icon-3d-installer min-w-[44px] min-h-[44px] sm:w-9 sm:h-9 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preview Image Area */}
        <div className="flex-1 min-h-0 p-3 sm:p-4 overflow-y-auto overscroll-contain space-y-3">
          <div className="relative w-full aspect-[4/3] max-h-[48vh] bg-[#F8FAFD] dark:bg-[#f8f1ff] rounded-xl overflow-hidden border border-[#DDE6F0] dark:border-[#e8ddff] flex items-center justify-center">
            <img
              src={getSafePreviewUrl(imageUrl)}
              alt={titleLabel}
              className="w-full h-full object-contain"
            />
          </div>

          {/* GPS & Telemetry Card */}
          <div className="bg-[#F8FAFD] dark:bg-[#f8f1ff] rounded-xl p-3 space-y-2.5 border border-[#DDE6F0] dark:border-[#e8ddff]">
            <div className="flex items-center justify-between gap-2 flex-wrap text-[#26364A] dark:text-[#1f1638]">
              <div className="flex items-center gap-1.5 min-w-0">
                <Satellite className="w-4 h-4 text-[#2E7D8B] dark:text-[#58149c] shrink-0" />
                {hasZoomGps && matchedSlot ? (
                  <a
                    href={buildGoogleMapsCoordinateUrl(matchedSlot.latitude!, matchedSlot.longitude!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[11px] font-bold text-[#5145A6] dark:text-[#58149c] hover:underline inline-flex items-center gap-1 truncate"
                  >
                    <span>{formatCoordinates(matchedSlot.latitude!, matchedSlot.longitude!)}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                ) : (
                  <span className="font-mono text-[11px] font-semibold text-[#8492A5] dark:text-[#7d7484]">
                    Koordinat GPS tidak terlampir
                  </span>
                )}
              </div>
              {metaLine && (
                <span className="font-mono text-[10.5px] text-[#52647A] dark:text-[#4b4452] tabular-nums">
                  {metaLine}
                </span>
              )}
            </div>

            {hasZoomGps && matchedSlot && (
              <GeoLocationMiniMap
                latitude={matchedSlot.latitude}
                longitude={matchedSlot.longitude}
                accuracyMeters={matchedSlot.gpsAccuracyMeters}
                geotagStatus={matchedSlot.geotagStatus}
                label={titleLabel}
                markerVariant={
                  matchedSlot.slotKey === 'customer_house'
                    ? 'house'
                    : matchedSlot.slotKey === 'fat_attenuation'
                    ? 'fat'
                    : 'photo'
                }
                heightClass="h-32"
                compact
              />
            )}
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="px-4 py-3 pb-[max(0.85rem,env(safe-area-inset-bottom))] border-t border-[#DDE6F0] dark:border-[#e8ddff] bg-white/95 dark:bg-white flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="mj-btn-installer-neutral min-h-[44px] flex-1 py-2.5 text-xs font-bold cursor-pointer"
          >
            Tutup
          </button>
          {matchedSlotDef && !ticketClosed && onDelete && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onDelete(matchedSlotDef);
              }}
              className="min-h-[44px] px-3 py-2.5 rounded-xl border border-[#F3C5CA] bg-[#FCE9EB] text-[#9B2C37] text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Hapus</span>
            </button>
          )}
          {matchedSlotDef && !ticketClosed && onRetake && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onRetake(matchedSlotDef);
              }}
              className="mj-btn-installer-primary min-h-[44px] flex-1 py-2.5 text-xs font-bold gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Foto Ulang</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(lightboxContent, document.body) : lightboxContent;
};
