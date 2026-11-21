import React, { useEffect } from 'react';
import { ExternalLink, RefreshCw, Satellite, X } from 'lucide-react';
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

interface PhotoLightboxModalProps {
  imageUrl: string | null;
  matchedSlot?: TechnicalPhotoSlot;
  matchedSlotDef?: PhotoSlotDefinition;
  ticketClosed: boolean;
  onClose: () => void;
  onRetake?: (slotDef: PhotoSlotDefinition) => void;
}

export const PhotoLightboxModal: React.FC<PhotoLightboxModalProps> = ({
  imageUrl,
  matchedSlot,
  matchedSlotDef,
  ticketClosed,
  onClose,
  onRetake
}) => {
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titleLabel}
      className="fixed inset-0 z-70 bg-slate-900/55 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white rounded-2xl border border-[#e8ddff] shadow-xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="px-4 py-3 border-b border-[#e8ddff] bg-[#fdf7ff] flex items-center justify-between gap-3 shrink-0">
          <div className="flex flex-col min-w-0">
            <span className="font-mono text-[10px] text-[#7135b5] font-bold tracking-wider uppercase">
              {stepLabel}
            </span>
            <h4 className="font-display text-base text-[#1f1638] font-bold truncate">
              {titleLabel}
            </h4>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup Pratinjau"
            className="mj-btn-icon-3d-installer w-9 h-9 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preview Image Area */}
        <div className="p-3 sm:p-4 overflow-y-auto space-y-3">
          <div className="relative w-full aspect-[4/3] max-h-[48vh] bg-[#f8f1ff] rounded-xl overflow-hidden border border-[#e8ddff] flex items-center justify-center">
            <img
              src={getSafePreviewUrl(imageUrl)}
              alt={titleLabel}
              className="w-full h-full object-contain"
            />
          </div>

          {/* GPS & Telemetry Card */}
          <div className="bg-[#f8f1ff] rounded-xl p-3 space-y-2.5 border border-[#e8ddff]">
            <div className="flex items-center justify-between gap-2 flex-wrap text-[#1f1638]">
              <div className="flex items-center gap-1.5 min-w-0">
                <Satellite className="w-4 h-4 text-[#58149c] shrink-0" />
                {hasZoomGps && matchedSlot ? (
                  <a
                    href={buildGoogleMapsCoordinateUrl(matchedSlot.latitude!, matchedSlot.longitude!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[11px] font-bold text-[#58149c] hover:underline inline-flex items-center gap-1 truncate"
                  >
                    <span>{formatCoordinates(matchedSlot.latitude!, matchedSlot.longitude!)}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                ) : (
                  <span className="font-mono text-[11px] font-semibold text-[#7d7484]">
                    Koordinat GPS tidak terlampir
                  </span>
                )}
              </div>
              {metaLine && (
                <span className="font-mono text-[10.5px] text-[#4b4452] tabular-nums">
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
        <div className="px-4 py-3 border-t border-[#e8ddff] bg-white flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="mj-btn-installer-neutral flex-1 py-2.5 text-xs font-bold cursor-pointer"
          >
            Tutup
          </button>
          {matchedSlotDef && !ticketClosed && onRetake && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onRetake(matchedSlotDef);
              }}
              className="mj-btn-installer-primary flex-1 py-2.5 text-xs font-bold gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Foto Ulang</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
