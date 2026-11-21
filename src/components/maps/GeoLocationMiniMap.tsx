import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Copy,
  Check,
  ExternalLink,
  Plus,
  Minus,
  Crosshair,
  MapPin
} from 'lucide-react';
import {
  buildGoogleMapsCoordinateUrl,
  formatCoordinates,
  isValidCoordinatePair
} from '../../services/mapsService.ts';
import { GeotagStatus } from '../../types/index.ts';

export interface GeoLocationMiniMapProps {
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  geotagStatus?: GeotagStatus;
  label?: string;
  markerVariant?: 'house' | 'fat' | 'photo';
  heightClass?: string;
  compact?: boolean;
  showActions?: boolean;
  interactive?: boolean;
}

export const GeoLocationMiniMap: React.FC<GeoLocationMiniMapProps> = ({
  latitude,
  longitude,
  accuracyMeters,
  geotagStatus,
  label,
  markerVariant = 'photo',
  heightClass = 'h-36',
  compact = false,
  showActions = true,
  interactive = true
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [copied, setCopied] = useState(false);
  const [tileWarning, setTileWarning] = useState(false);

  const isValid = isValidCoordinatePair(latitude, longitude);
  const latNum = isValid ? Number(latitude) : 0;
  const lngNum = isValid ? Number(longitude) : 0;

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !isValid) return;

    // Clean up previous instance cleanly before re-initializing
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(container, {
      center: [latNum, lngNum],
      zoom: compact ? 16 : 17,
      zoomControl: false,
      attributionControl: false,
      dragging: interactive,
      scrollWheelZoom: false,
      doubleClickZoom: interactive,
      touchZoom: interactive
    });

    const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true
    });

    tileLayer.on('tileerror', () => {
      setTileWarning(true);
    });
    tileLayer.on('tileload', () => {
      setTileWarning(false);
    });
    tileLayer.addTo(map);

    const pinColor =
      markerVariant === 'house'
        ? '#059669'
        : markerVariant === 'fat'
        ? '#D97706'
        : '#58149C';

    const markerIcon = L.divIcon({
      className: 'morajaws-custom-map-pin',
      html: `<div style="width:28px;height:28px;border-radius:9999px;background:${pinColor};border:3px solid #ffffff;box-shadow:0 4px 10px rgba(11,18,34,0.45);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:11px;">●</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const marker = L.marker([latNum, lngNum], { icon: markerIcon }).addTo(map);
    if (label) {
      marker.bindTooltip(label, { direction: 'top', offset: [0, -14] });
    }

    if (typeof accuracyMeters === 'number' && accuracyMeters > 0 && accuracyMeters <= 2500) {
      L.circle([latNum, lngNum], {
        radius: accuracyMeters,
        color: pinColor,
        fillColor: pinColor,
        fillOpacity: 0.14,
        weight: 1.5,
        dashArray: '4 4'
      }).addTo(map);
    }

    mapInstanceRef.current = map;

    const timer = setTimeout(() => {
      try {
        map.invalidateSize();
      } catch {}
    }, 120);

    return () => {
      clearTimeout(timer);
      try {
        map.remove();
      } catch {}
      mapInstanceRef.current = null;
    };
  }, [isValid, latNum, lngNum, accuracyMeters, markerVariant, compact, interactive, label]);

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    mapInstanceRef.current?.zoomIn();
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    mapInstanceRef.current?.zoomOut();
  };

  const handleRecenter = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!mapInstanceRef.current || !isValid) return;
    mapInstanceRef.current.setView([latNum, lngNum], compact ? 16 : 17, { animate: true });
  };

  const handleCopyCoords = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isValid) return;
    const text = formatCoordinates(latNum, lngNum);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  if (!isValid) {
    return (
      <div className="mj-tactile-well border border-dashed border-[#CEC3D4] dark:border-[#4B386B] p-3 flex items-center gap-2.5 text-[11px] text-[#7D7484] dark:text-[#C5B3DF]">
        <MapPin className="w-4 h-4 shrink-0 text-[#7135B5] dark:text-[#D8B4FE]" />
        <span>Koordinat GPS belum tersedia untuk peta lokasi ini.</span>
      </div>
    );
  }

  const googleMapsUrl = buildGoogleMapsCoordinateUrl(latNum, lngNum);
  const isWeak = geotagStatus === 'weak' || (typeof accuracyMeters === 'number' && accuracyMeters > 50);

  return (
    <div className="card-3d-lavender rounded-xl overflow-hidden">
      {/* Interactive Leaflet Map Viewport (bounded z-index so it never overlays modals) */}
      <div className={`relative w-full ${heightClass} bg-[#F3EAFF] dark:bg-[#160D29] isolate z-0`}>
        <div ref={mapContainerRef} className="w-full h-full z-0" />

        {tileWarning && (
          <div className="absolute inset-x-2 top-2 z-[450] px-2 py-1 rounded-md bg-[#160D29]/90 text-white text-[10px] font-mono text-center pointer-events-none">
            Pin aktif di {formatCoordinates(latNum, lngNum)} (Layer peta offline)
          </div>
        )}

        {/* Map Zoom & Center Controls */}
        <div className="absolute top-2 right-2 z-[450] flex flex-col gap-1">
          <button
            type="button"
            onClick={handleZoomIn}
            title="Zoom In"
            className="btn-3d-icon w-7 h-7 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            title="Zoom Out"
            className="btn-3d-icon w-7 h-7 cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRecenter}
            title="Pusatkan Pin"
            className="btn-3d-icon w-7 h-7 !text-[#58149C] dark:!text-[#D8B4FE] cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Accuracy Pill */}
        {typeof accuracyMeters === 'number' && (
          <span
            className={`absolute bottom-2 left-2 z-[450] px-2 py-0.5 rounded-md font-mono text-[10px] font-bold shadow-xs border backdrop-blur-xs ${
              isWeak
                ? 'bg-amber-950/90 text-amber-200 border-amber-500/40'
                : 'bg-[#160D29]/90 text-emerald-300 border-emerald-500/40'
            }`}
          >
            GPS ±{Math.round(accuracyMeters)}m
          </span>
        )}
      </div>

      {/* Coordinate & Google Maps Action Bar */}
      {showActions && (
        <div className="px-2.5 py-2 flex flex-wrap items-center justify-between gap-2 bg-[#F8F1FF] dark:bg-[#1E1238] border-t border-[#E8DDFF] dark:border-[#35105E] text-[11px]">
          <div className="min-w-0 flex items-center gap-1.5 font-mono text-[#1F1638] dark:text-[#E8DDFF] truncate">
            <MapPin className="w-3.5 h-3.5 text-[#58149C] dark:text-[#D8B4FE] shrink-0" />
            <span className="truncate font-semibold tabular-nums">{formatCoordinates(latNum, lngNum)}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleCopyCoords}
              className="btn-3d-lilac px-2 py-1 rounded-md font-semibold text-[10px] flex items-center gap-1 cursor-pointer"
              title="Salin Koordinat"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Disalin' : 'Salin'}</span>
            </button>
            {googleMapsUrl && (
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="btn-3d-primary px-2 py-1 rounded-md font-bold text-[10px] flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Google Maps</span>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
