import { Ticket } from '../types/index.ts';
import { formatWorkOrderAddress } from '../utils/addressFormatter.ts';

/**
 * Validates that latitude/longitude represent a real non-null-island geographic point.
 */
export function isValidCoordinatePair(lat?: number | null, lng?: number | null): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // Reject Null Island (0, 0) fabricated fallback
  if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return false;
  return true;
}

/**
 * Formats coordinate pair to crisp 6-decimal GPS display string.
 */
export function formatCoordinates(lat?: number | null, lng?: number | null): string {
  if (!isValidCoordinatePair(lat, lng)) return '-';
  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
}

/**
 * Builds a Google Maps URL for exact GPS coordinates.
 */
export function buildGoogleMapsCoordinateUrl(lat?: number | null, lng?: number | null): string {
  if (!isValidCoordinatePair(lat, lng)) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`)}`;
}

function openExternalUrl(url: string): void {
  if (typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Opens exact GPS coordinates in Google Maps (new tab or native Google Maps app on mobile).
 */
export function openCoordinatesInGoogleMaps(lat?: number | null, lng?: number | null): boolean {
  const url = buildGoogleMapsCoordinateUrl(lat, lng);
  if (!url) return false;
  openExternalUrl(url);
  return true;
}

/**
 * Builds a standardized Google Maps search query URL using actual customer address fields.
 * Format: https://www.google.com/maps/search/?api=1&query=ALAMAT_PELANGGAN
 */
export function buildGoogleMapsSearchUrl(ticket: Partial<Ticket>): { url: string; address: string } {
  if (!ticket) return { url: '', address: '' };

  const formatted = formatWorkOrderAddress(ticket);
  const address = formatted.mapsQueryText || formatted.formattedSingleLine || '';

  if (!address) {
    return { url: '', address: '' };
  }

  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return { url, address };
}

/**
 * Parses a "lat, lng" string into a validated coordinate pair.
 */
export function parseCoordinateString(raw?: string | null): { latitude: number; longitude: number } | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[()]/g, '');
  const parts = cleaned.split(/[,;\s]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!isValidCoordinatePair(lat, lng)) return null;
  return { latitude: Number(lat.toFixed(7)), longitude: Number(lng.toFixed(7)) };
}

/**
 * Resolves registered customer/order coordinates from a Ticket record.
 */
export function getTicketRegisteredCoordinates(
  ticket?: Partial<Ticket> | null
): { latitude: number; longitude: number; source: 'ticket_coords' | 'customer_coordinates' } | null {
  if (!ticket) return null;
  if (isValidCoordinatePair(ticket.latitude, ticket.longitude)) {
    return {
      latitude: Number(ticket.latitude),
      longitude: Number(ticket.longitude),
      source: 'ticket_coords'
    };
  }
  const parsed = parseCoordinateString(ticket.customerCoordinates);
  if (parsed) {
    return {
      ...parsed,
      source: 'customer_coordinates'
    };
  }
  return null;
}

/**
 * Calculates geodesic distance between two WGS84 coordinate pairs in meters (rounded integer).
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (!isValidCoordinatePair(lat1, lng1) || !isValidCoordinatePair(lat2, lng2)) {
    return 0;
  }
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Formats a distance in meters cleanly for GIS telemetry labels.
 */
export function formatDistanceMetersLabel(meters?: number | null): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return '-';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Opens Google Maps search directly in a new window/tab or launches the native Google Maps app on Android.
 */
export function openCustomerAddressInGoogleMaps(ticket: Partial<Ticket>, onEmpty?: () => void): boolean {
  const { url, address } = buildGoogleMapsSearchUrl(ticket);
  if (!url || !address) {
    if (onEmpty) {
      onEmpty();
    }
    return false;
  }

  openExternalUrl(url);
  return true;
}
