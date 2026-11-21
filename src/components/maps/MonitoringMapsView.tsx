import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  Compass,
  Crosshair,
  ExternalLink,
  FileText,
  Filter,
  Layers,
  Lock,
  MapPin,
  Maximize2,
  MessageSquare,
  Minus,
  Navigation,
  Phone,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Satellite,
  Search,
  Shield,
  ShieldCheck,
  UserCheck,
  Users2,
  Wrench,
  X
} from 'lucide-react';
import { Ticket, User } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { useToast } from '../../context/ToastContext';
import { getTicketAppointmentDate, formatAppointmentDateDisplay } from '../../services/appointmentDateParser';
import {
  getTicketCanonicalApprovalStatus,
  isTicketClosed
} from '../../services/woLifecycleService';
import {
  buildGoogleMapsCoordinateUrl,
  calculateHaversineDistanceMeters,
  formatCoordinates,
  formatDistanceMetersLabel,
  getTicketRegisteredCoordinates,
  isValidCoordinatePair,
  openCoordinatesInGoogleMaps,
  openCustomerAddressInGoogleMaps
} from '../../services/mapsService.ts';
import { getSafePreviewUrl } from '../../services/storageCompatibility.ts';
import { formatJakartaTimeOnly } from '../../services/workSessionService.ts';
import { buildWhatsAppClickToChatUrl } from '../../services/whatsappService.ts';

interface MonitoringMapsViewProps {
  onSelectTicket: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
  onNavigate?: (tab: string) => void;
}

type MapStatusBucket =
  | 'unassigned'
  | 'assigned'
  | 'checkin'
  | 'in_progress'
  | 'qc_pending'
  | 'completed'
  | 'problem';

const STATUS_META: Record<
  MapStatusBucket,
  { label: string; color: string; bgCls: string; textCls: string }
> = {
  unassigned: {
    label: 'Belum Assigned',
    color: '#64748B',
    bgCls: 'bg-slate-100 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700',
    textCls: 'text-slate-700 dark:text-slate-200'
  },
  assigned: {
    label: 'Assigned',
    color: '#4F46E5',
    bgCls: 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800',
    textCls: 'text-indigo-700 dark:text-indigo-300'
  },
  checkin: {
    label: 'Check-In Foto',
    color: '#7C3AED',
    bgCls: 'bg-purple-50 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800',
    textCls: 'text-purple-700 dark:text-purple-300'
  },
  in_progress: {
    label: 'On Progress',
    color: '#2563EB',
    bgCls: 'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800',
    textCls: 'text-blue-700 dark:text-blue-300'
  },
  qc_pending: {
    label: 'QC Validasi',
    color: '#D97706',
    bgCls: 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800',
    textCls: 'text-amber-700 dark:text-amber-300'
  },
  completed: {
    label: 'Completed',
    color: '#10B981',
    bgCls: 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800',
    textCls: 'text-emerald-700 dark:text-emerald-300'
  },
  problem: {
    label: 'Kendala Lapangan',
    color: '#DC2626',
    bgCls: 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800',
    textCls: 'text-rose-700 dark:text-rose-300'
  }
};

function isScopeTextMatch(a?: string | null, b?: string | null): boolean {
  const cleanA = String(a || '').toLowerCase().trim();
  const cleanB = String(b || '').toLowerCase().trim();
  if (!cleanA || !cleanB) return false;
  return cleanA === cleanB || cleanA.includes(cleanB) || cleanB.includes(cleanA);
}

function getHousePhotoUrl(ticket: Ticket): string {
  if (ticket.houseLocation?.photoUrl) return ticket.houseLocation.photoUrl;
  const slot = ticket.technicalReport?.photoSlots?.find(s => s.slotKey === 'customer_house');
  return slot?.url || '';
}

function hasVerifiedHouseCheckIn(ticket: Ticket): boolean {
  const hasHouseCoords = Boolean(
    ticket.houseLocation &&
      isValidCoordinatePair(ticket.houseLocation.latitude, ticket.houseLocation.longitude)
  );
  const hasHousePhoto = Boolean(getHousePhotoUrl(ticket));
  return Boolean(hasHouseCoords || hasHousePhoto);
}

function classifyMapStatus(ticket: Ticket): MapStatusBucket {
  const approval = getTicketCanonicalApprovalStatus(ticket);
  if (
    isTicketClosed(ticket) ||
    approval === 'APPROVED' ||
    ticket.statusWOInstaller === 'Completed' ||
    ticket.statusWOInstaller === 'Installed'
  ) {
    return 'completed';
  }
  if (
    ticket.statusWOInstaller === 'Pending Technical' ||
    ticket.statusWOInstaller === 'Failed / Cancelled' ||
    ticket.statusWOAgent === 'Cancelled' ||
    ticket.approvalStatus === 'REJECTED' ||
    approval === 'REVISION'
  ) {
    return 'problem';
  }
  if (approval === 'BUTUH APPROVAL') {
    return 'qc_pending';
  }
  if (!ticket.installerName && !ticket.assignedTo) {
    return 'unassigned';
  }
  if (
    ticket.statusWOInstaller === 'On Site' ||
    ticket.statusWOInstaller === 'In Progress' ||
    ticket.statusWOInstaller === 'PROGRESS' ||
    ticket.workSessionStatus === 'Sedang Dikerjakan'
  ) {
    return 'in_progress';
  }
  if (hasVerifiedHouseCheckIn(ticket) || Boolean(ticket.checkInAt)) {
    return 'checkin';
  }
  return 'assigned';
}

function getTicketMapPosition(
  ticket: Ticket
): { latitude: number; longitude: number; source: 'house_checkin' | 'registered_order' | 'fat_fallback' } | null {
  if (
    ticket.houseLocation &&
    isValidCoordinatePair(ticket.houseLocation.latitude, ticket.houseLocation.longitude)
  ) {
    return {
      latitude: ticket.houseLocation.latitude,
      longitude: ticket.houseLocation.longitude,
      source: 'house_checkin'
    };
  }
  const reg = getTicketRegisteredCoordinates(ticket);
  if (reg) {
    return {
      latitude: reg.latitude,
      longitude: reg.longitude,
      source: 'registered_order'
    };
  }
  if (
    ticket.fatLocation &&
    isValidCoordinatePair(ticket.fatLocation.latitude, ticket.fatLocation.longitude)
  ) {
    return {
      latitude: ticket.fatLocation.latitude,
      longitude: ticket.fatLocation.longitude,
      source: 'fat_fallback'
    };
  }
  return null;
}

/**
 * Simple Monotone Chain Convex Hull for clean operational area polygon visualization.
 */
function buildBoundingPolygon(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return [];
  const sorted = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const MonitoringMapsView: React.FC<MonitoringMapsViewProps> = ({
  onSelectTicket,
  onNavigate
}) => {
  const {
    currentUser,
    tickets,
    scopedTickets,
    users,
    todayWIB,
    ticketActivities,
    refreshActiveTickets,
    lastSyncTime
  } = useApp();
  const { isCompactUI } = useResponsiveViewport();
  const { toast } = useToast();

  const isLeaderMode = currentUser.role === 'leader';
  const leaderContractor = currentUser.contractor || '';
  const leaderArea = currentUser.area || '';

  // Filters State
  const [dateFilter, setDateFilter] = useState<string>(() => todayWIB);
  const [showAllDates, setShowAllDates] = useState<boolean>(false);
  const [vendorFilter, setVendorFilter] = useState<string>('ALL');
  const [areaFilter, setAreaFilter] = useState<string>('ALL');
  const [leaderFilter, setLeaderFilter] = useState<string>('ALL');
  const [techFilter, setTechFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MapStatusBucket>('ALL');
  const [checkInFilter, setCheckInFilter] = useState<'ALL' | 'VERIFIED' | 'MISSING'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Map Layer & UI State
  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street');
  const [showOpticalLayer, setShowOpticalLayer] = useState<boolean>(true);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [showNoGpsDrawer, setShowNoGpsDrawer] = useState<boolean>(false);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; title: string } | null>(null);
  const [isSyncingMap, setIsSyncingMap] = useState<boolean>(false);
  const [tileOfflineWarning, setTileOfflineWarning] = useState<boolean>(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const featureLayerRef = useRef<L.LayerGroup | null>(null);
  const hasAutoFittedRef = useRef<boolean>(false);

  // Authoritative Base Tickets Pool (Enforcing strict Leader Scope Isolation)
  const roleBaseTickets = useMemo(() => {
    const source = isLeaderMode ? scopedTickets : tickets;
    return (source || []).filter(t => {
      if (t.isArchived || t.isDeleted) return false;
      if (!isLeaderMode) return true;
      const tContractor = t.contactorName || t.contractorName || '';
      if (leaderContractor && !isScopeTextMatch(tContractor, leaderContractor)) return false;
      if (leaderArea && t.area) {
        const directLeaderMatch =
          (t.leaderId && t.leaderId === currentUser.id) ||
          (t.leaderName && isScopeTextMatch(t.leaderName, currentUser.name));
        if (!isScopeTextMatch(t.area, leaderArea) && !directLeaderMatch) return false;
      }
      return true;
    });
  }, [isLeaderMode, scopedTickets, tickets, leaderContractor, leaderArea, currentUser.id, currentUser.name]);

  // Scoped Installers Pool
  const scopedInstallers = useMemo(() => {
    return (users || []).filter(u => {
      if (u.isDeleted || u.isArchived || u.role !== 'installer' || u.active === false) return false;
      if (!isLeaderMode) return true;
      if (leaderContractor && !isScopeTextMatch(u.contractor, leaderContractor)) return false;
      if (leaderArea && u.area && !isScopeTextMatch(u.area, leaderArea)) return false;
      return true;
    });
  }, [users, isLeaderMode, leaderContractor, leaderArea]);

  // Date-scoped tickets for filter options & KPIs
  const dateScopedTickets = useMemo(() => {
    if (showAllDates || !dateFilter) return roleBaseTickets;
    return roleBaseTickets.filter(t => getTicketAppointmentDate(t) === dateFilter);
  }, [roleBaseTickets, showAllDates, dateFilter]);

  // Dynamic Filter Options derived strictly from real records
  const filterOptions = useMemo(() => {
    const vendors = new Set<string>();
    const areas = new Set<string>();
    const leaders = new Set<string>();
    const techs = new Set<string>();

    dateScopedTickets.forEach(t => {
      const v = (t.contactorName || t.contractorName || '').trim();
      if (v) vendors.add(v);
      if (t.area?.trim()) areas.add(t.area.trim());
      const l = (t.leaderName || t.corlapName || '').trim();
      if (l) leaders.add(l);
      if (t.installerName?.trim()) techs.add(t.installerName.trim());
    });
    scopedInstallers.forEach(u => {
      if (u.name?.trim()) techs.add(u.name.trim());
    });

    return {
      vendors: Array.from(vendors).sort(),
      areas: Array.from(areas).sort(),
      leaders: Array.from(leaders).sort(),
      techs: Array.from(techs).sort()
    };
  }, [dateScopedTickets, scopedInstallers]);

  // Pre-status filtered list for accurate KPI summary bar
  const preStatusTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return dateScopedTickets.filter(t => {
      if (!isLeaderMode) {
        if (vendorFilter !== 'ALL' && !isScopeTextMatch(t.contactorName || t.contractorName, vendorFilter)) {
          return false;
        }
        if (areaFilter !== 'ALL' && !isScopeTextMatch(t.area, areaFilter)) {
          return false;
        }
        if (leaderFilter !== 'ALL' && !isScopeTextMatch(t.leaderName || t.corlapName, leaderFilter)) {
          return false;
        }
      }
      if (techFilter !== 'ALL' && !isScopeTextMatch(t.installerName, techFilter)) {
        return false;
      }
      if (checkInFilter === 'VERIFIED' && !hasVerifiedHouseCheckIn(t)) return false;
      if (checkInFilter === 'MISSING' && hasVerifiedHouseCheckIn(t)) return false;

      if (q) {
        const hay = [
          t.woNumber,
          t.idCustomer,
          t.customerName,
          t.installerName,
          t.fatCode,
          t.fdtCode,
          t.clusterName,
          t.area,
          t.streetName
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    dateScopedTickets,
    isLeaderMode,
    vendorFilter,
    areaFilter,
    leaderFilter,
    techFilter,
    checkInFilter,
    searchQuery
  ]);

  // KPI Metrics (100% computed from real data)
  const kpiStats = useMemo(() => {
    let assigned = 0;
    let unassigned = 0;
    let checkin = 0;
    let inProgress = 0;
    let qcPending = 0;
    let completed = 0;
    let problem = 0;
    let withHouseCheckIn = 0;
    const activeTechNames = new Set<string>();

    preStatusTickets.forEach(t => {
      const bucket = classifyMapStatus(t);
      if (bucket === 'unassigned') unassigned++;
      else assigned++;

      if (bucket === 'checkin') checkin++;
      if (bucket === 'in_progress') inProgress++;
      if (bucket === 'qc_pending') qcPending++;
      if (bucket === 'completed') completed++;
      if (bucket === 'problem') problem++;
      if (hasVerifiedHouseCheckIn(t)) withHouseCheckIn++;

      if (t.installerName && ['checkin', 'in_progress', 'qc_pending', 'completed'].includes(bucket)) {
        activeTechNames.add(t.installerName.toLowerCase().trim());
      }
    });

    return {
      total: preStatusTickets.length,
      assigned,
      unassigned,
      checkin,
      inProgress,
      qcPending,
      completed,
      problem,
      withHouseCheckIn,
      withoutHouseCheckIn: Math.max(0, preStatusTickets.length - withHouseCheckIn),
      activeTechCount: activeTechNames.size,
      totalTechCount: scopedInstallers.length
    };
  }, [preStatusTickets, scopedInstallers.length]);

  // Final filtered list after Status Pill filter
  const visibleTickets = useMemo(() => {
    if (statusFilter === 'ALL') return preStatusTickets;
    return preStatusTickets.filter(t => classifyMapStatus(t) === statusFilter);
  }, [preStatusTickets, statusFilter]);

  // Partition into Geotagged (Plottable on Map) vs Without GPS
  const { mappedEntries, unmappedTickets, clusterSummaries } = useMemo(() => {
    const mapped: Array<{
      ticket: Ticket;
      pos: { latitude: number; longitude: number; source: 'house_checkin' | 'registered_order' | 'fat_fallback' };
      bucket: MapStatusBucket;
    }> = [];
    const unmapped: Ticket[] = [];
    const clusterMap = new Map<
      string,
      { name: string; count: number; latSum: number; lngSum: number; coordCount: number }
    >();

    visibleTickets.forEach(t => {
      const bucket = classifyMapStatus(t);
      const pos = getTicketMapPosition(t);
      const clusterKey = (t.clusterName || t.area || 'Area Umum').trim();
      const prevCluster = clusterMap.get(clusterKey) || {
        name: clusterKey,
        count: 0,
        latSum: 0,
        lngSum: 0,
        coordCount: 0
      };
      prevCluster.count += 1;

      if (pos) {
        mapped.push({ ticket: t, pos, bucket });
        prevCluster.latSum += pos.latitude;
        prevCluster.lngSum += pos.longitude;
        prevCluster.coordCount += 1;
      } else {
        unmapped.push(t);
      }
      clusterMap.set(clusterKey, prevCluster);
    });

    const clusters = Array.from(clusterMap.values())
      .filter(c => c.coordCount > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    return {
      mappedEntries: mapped,
      unmappedTickets: unmapped,
      clusterSummaries: clusters
    };
  }, [visibleTickets]);

  // Active Selected Ticket (kept live from tickets state)
  const selectedTicket = useMemo(() => {
    if (selectedTicketId) {
      const found = visibleTickets.find(t => t.id === selectedTicketId) || roleBaseTickets.find(t => t.id === selectedTicketId);
      if (found) return found;
    }
    return mappedEntries[0]?.ticket || visibleTickets[0] || null;
  }, [selectedTicketId, visibleTickets, roleBaseTickets, mappedEntries]);

  // Scoped Activity Feed (Leader mode & quick monitor)
  const scopedRecentActivities = useMemo(() => {
    const visibleIds = new Set(roleBaseTickets.map(t => t.id));
    const visibleWo = new Set(roleBaseTickets.map(t => String(t.woNumber || '').toUpperCase()));
    return (ticketActivities || [])
      .filter(
        act =>
          visibleIds.has(act.ticketId) ||
          (act.woNumber && visibleWo.has(String(act.woNumber).toUpperCase()))
      )
      .slice(0, 8);
  }, [ticketActivities, roleBaseTickets]);

  // Initialize Leaflet Map Once
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(container, {
      center: [-6.9175, 107.6191],
      zoom: 12,
      zoomControl: false,
      attributionControl: false
    });

    const featureGroup = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;
    featureLayerRef.current = featureGroup;
    hasAutoFittedRef.current = false;

    const timer = window.setTimeout(() => {
      try {
        map.invalidateSize();
      } catch {}
    }, 150);

    return () => {
      window.clearTimeout(timer);
      try {
        map.remove();
      } catch {}
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
      featureLayerRef.current = null;
    };
  }, [isCompactUI]);

  // Swap Street vs Satellite Tile Layer cleanly
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    const url =
      mapStyle === 'satellite'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

    const layer = L.tileLayer(url, {
      maxZoom: 19,
      crossOrigin: true
    });
    layer.on('tileerror', () => setTileOfflineWarning(true));
    layer.on('tileload', () => setTileOfflineWarning(false));
    layer.addTo(map);
    tileLayerRef.current = layer;
  }, [mapStyle, isCompactUI]);

  // Render Markers, Optical Links, Perimeter Polygon & Selected Geofence
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layer = featureLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    // 1. Leader Operational Perimeter Polygon
    if (isLeaderMode && mappedEntries.length >= 3) {
      const hull = buildBoundingPolygon(mappedEntries.map(e => [e.pos.latitude, e.pos.longitude]));
      if (hull.length >= 3) {
        L.polygon(hull, {
          color: '#7C3AED',
          weight: 2,
          dashArray: '8 6',
          fillColor: '#7C3AED',
          fillOpacity: 0.08
        }).addTo(layer);
      }
    }

    // 2. Optical FAT Links & Registered-vs-CheckIn Verification Lines
    mappedEntries.forEach(({ ticket, pos }) => {
      const isSelected = selectedTicket?.id === ticket.id;

      // FAT to House optical path when FAT coords exist
      if (
        showOpticalLayer &&
        ticket.fatLocation &&
        isValidCoordinatePair(ticket.fatLocation.latitude, ticket.fatLocation.longitude)
      ) {
        const fatLat = ticket.fatLocation.latitude;
        const fatLng = ticket.fatLocation.longitude;

        L.polyline(
          [
            [fatLat, fatLng],
            [pos.latitude, pos.longitude]
          ],
          {
            color: isSelected ? '#F59E0B' : '#9333EA',
            weight: isSelected ? 3 : 1.75,
            dashArray: '5 5',
            opacity: isSelected ? 0.95 : 0.6
          }
        ).addTo(layer);

        const fatIcon = L.divIcon({
          className: 'mj-fat-pin',
          html: `<div style="padding:2px 6px;border-radius:6px;background:#1E1238;color:#FCD34D;border:1.5px solid #F59E0B;font-family:monospace;font-size:9.5px;font-weight:800;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.35);">FAT ${escapeHtml(
            ticket.fatCode || '-'
          )}</div>`,
          iconSize: [74, 22],
          iconAnchor: [37, 11]
        });

        L.marker([fatLat, fatLng], { icon: fatIcon })
          .on('click', () => setSelectedTicketId(ticket.id))
          .addTo(layer);
      }

      // If selected WO has BOTH Registered Order Coords AND House Check-in Coords, highlight delta!
      if (isSelected) {
        const reg = getTicketRegisteredCoordinates(ticket);
        if (
          reg &&
          ticket.houseLocation &&
          isValidCoordinatePair(ticket.houseLocation.latitude, ticket.houseLocation.longitude)
        ) {
          L.polyline(
            [
              [reg.latitude, reg.longitude],
              [ticket.houseLocation.latitude, ticket.houseLocation.longitude]
            ],
            {
              color: '#10B981',
              weight: 2.5,
              dashArray: '4 4'
            }
          ).addTo(layer);

          const regIcon = L.divIcon({
            className: 'mj-reg-pin',
            html: `<div style="width:14px;height:14px;border-radius:9999px;background:#58149C;border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(22,13,41,0.45);"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
          });
          L.marker([reg.latitude, reg.longitude], { icon: regIcon })
            .bindTooltip('Titik Order Terdaftar', { direction: 'top', offset: [0, -8] })
            .addTo(layer);
        }

        // 50m SOP Geofence Circle
        L.circle([pos.latitude, pos.longitude], {
          radius: 50,
          color: '#7C3AED',
          fillColor: '#7C3AED',
          fillOpacity: 0.12,
          weight: 1.5,
          dashArray: '4 4'
        }).addTo(layer);
      }
    });

    // 3. Plot WO House / Customer Pins
    mappedEntries.forEach(({ ticket, pos, bucket }) => {
      const meta = STATUS_META[bucket];
      const isSelected = selectedTicket?.id === ticket.id;
      const pinSize = isSelected ? 36 : 28;
      const ringShadow = isSelected
        ? 'box-shadow:0 0 0 4px rgba(124,58,237,0.35),0 6px 14px rgba(0,0,0,0.45);transform:scale(1.06);'
        : 'box-shadow:0 3px 10px rgba(0,0,0,0.38);';
      const labelHtml = isSelected
        ? `<div style="position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);background:#3B0764;color:#fff;padding:3px 8px;border-radius:8px;font-size:10px;font-weight:800;white-space:nowrap;border:1px solid rgba(255,255,255,0.28);box-shadow:0 4px 12px rgba(0,0,0,0.35);">#${escapeHtml(
            ticket.woNumber
          )} · ${escapeHtml((ticket.customerName || '').slice(0, 18))}</div>`
        : '';

      const icon = L.divIcon({
        className: 'mj-wo-pin',
        html: `<div style="position:relative;width:${pinSize}px;height:${pinSize}px;border-radius:9999px;background:${meta.color};border:3px solid #ffffff;${ringShadow}display:flex;align-items:center;justify-content:center;color:#ffffff;font-weight:800;font-size:11px;cursor:pointer;">${labelHtml}${
          bucket === 'completed'
            ? '✓'
            : bucket === 'problem'
            ? '!'
            : bucket === 'checkin'
            ? '★'
            : '•'
        }</div>`,
        iconSize: [pinSize, pinSize],
        iconAnchor: [pinSize / 2, pinSize / 2]
      });

      const marker = L.marker([pos.latitude, pos.longitude], { icon, zIndexOffset: isSelected ? 1000 : 0 });
      marker.bindTooltip(
        `<div style="font-family:sans-serif;font-size:11px;"><strong>${escapeHtml(
          ticket.woNumber
        )}</strong><br/>${escapeHtml(ticket.customerName || '-')}<br/><span>${escapeHtml(
          ticket.installerName || 'Belum Di-Assign'
        )} · ${escapeHtml(meta.label)}</span></div>`,
        { direction: 'top', offset: [0, -14] }
      );
      marker.on('click', () => {
        setSelectedTicketId(ticket.id);
      });
      marker.addTo(layer);
    });

    // Auto-fit bounds when initial coordinates load or dataset shrinks dramatically
    if (!hasAutoFittedRef.current && mappedEntries.length > 0) {
      const bounds = L.latLngBounds(mappedEntries.map(e => [e.pos.latitude, e.pos.longitude]));
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
        hasAutoFittedRef.current = true;
      }
    }
  }, [mappedEntries, selectedTicket?.id, isLeaderMode, showOpticalLayer]);

  const handleRecenterBounds = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (mappedEntries.length === 0) {
      toast.info('Belum ada WO dengan koordinat GPS pada filter saat ini.', 'Monitoring Maps');
      return;
    }
    const bounds = L.latLngBounds(mappedEntries.map(e => [e.pos.latitude, e.pos.longitude]));
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15, animate: true });
    }
  }, [mappedEntries, toast]);

  const handlePanToCluster = (lat: number, lng: number) => {
    mapInstanceRef.current?.setView([lat, lng], 15, { animate: true });
  };

  const handlePanToTicket = (t: Ticket) => {
    setSelectedTicketId(t.id);
    const pos = getTicketMapPosition(t);
    if (pos) {
      mapInstanceRef.current?.setView([pos.latitude, pos.longitude], 16, { animate: true });
    }
  };

  const handleSyncLive = async () => {
    setIsSyncingMap(true);
    try {
      await refreshActiveTickets();
      toast.success('Data peta & status Work Order diperbarui dari server.', 'Sinkronisasi Peta');
    } catch {
      toast.error('Gagal memuat data terbaru dari server.', 'Sinkronisasi Gagal');
    } finally {
      setIsSyncingMap(false);
    }
  };

  const handleResetFilters = () => {
    setVendorFilter('ALL');
    setAreaFilter('ALL');
    setLeaderFilter('ALL');
    setTechFilter('ALL');
    setStatusFilter('ALL');
    setCheckInFilter('ALL');
    setSearchQuery('');
    setDateFilter(todayWIB);
    setShowAllDates(false);
    hasAutoFittedRef.current = false;
  };

  // Lookup Leader / Installer user objects for WhatsApp contact action
  const findContactPhone = (ticket: Ticket | null, kind: 'leader' | 'installer'): string => {
    if (!ticket) return '';
    if (kind === 'leader') {
      if (ticket.leaderContact) return ticket.leaderContact;
      if (ticket.corlapContact) return ticket.corlapContact;
      const leaderObj = users.find(
        u =>
          u.role === 'leader' &&
          ((ticket.leaderId && u.id === ticket.leaderId) ||
            (ticket.leaderName && isScopeTextMatch(u.name, ticket.leaderName)) ||
            (ticket.contactorName && isScopeTextMatch(u.contractor, ticket.contactorName)))
      );
      return leaderObj?.phone || '';
    }
    if (ticket.installerContact) return ticket.installerContact;
    const instObj = users.find(
      u =>
        u.role === 'installer' &&
        ((ticket.installerId && u.id === ticket.installerId) ||
          (ticket.installerName && isScopeTextMatch(u.name, ticket.installerName)))
    );
    return instObj?.phone || '';
  };

  const handleOpenWhatsAppContact = (ticket: Ticket, kind: 'leader' | 'installer') => {
    const phone = findContactPhone(ticket, kind);
    const label = kind === 'leader' ? 'Team Leader / Korlap' : 'Teknisi';
    if (!phone) {
      toast.warning(`Nomor WhatsApp ${label} untuk WO ${ticket.woNumber} belum tercatat.`, 'Kontak Tidak Tersedia');
      return;
    }
    const greeting =
      kind === 'leader'
        ? `Halo Korlap, mohon koordinasi tindak lanjut untuk WO ${ticket.woNumber} (${ticket.customerName}).`
        : `Halo ${ticket.installerName || 'Teknisi'}, mohon update progres lapangan untuk WO ${ticket.woNumber} (${ticket.customerName}).`;
    const waRes = buildWhatsAppClickToChatUrl(phone, greeting);
    if (waRes.url) {
      const link = document.createElement('a');
      link.href = waRes.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } else {
      toast.warning(waRes.error || `Format nomor telepon ${label} tidak valid (${phone}).`, 'Kontak');
    }
  };

  const handleNavigateRoute = (ticket: Ticket) => {
    const pos = getTicketMapPosition(ticket);
    if (pos) {
      openCoordinatesInGoogleMaps(pos.latitude, pos.longitude);
      return;
    }
    openCustomerAddressInGoogleMaps(ticket, () => {
      toast.warning('Alamat & koordinat GPS pelanggan belum tersedia.', 'Google Maps');
    });
  };

  // Dual GPS Verification Metrics for Selected Ticket
  const selectedVerification = useMemo(() => {
    if (!selectedTicket) return null;
    const regCoords = getTicketRegisteredCoordinates(selectedTicket);
    const houseLoc = selectedTicket.houseLocation;
    const hasHouseCoords = Boolean(
      houseLoc && isValidCoordinatePair(houseLoc.latitude, houseLoc.longitude)
    );
    const housePhotoUrl = getHousePhotoUrl(selectedTicket);
    const deltaMeters =
      regCoords && hasHouseCoords && houseLoc
        ? calculateHaversineDistanceMeters(
            regCoords.latitude,
            regCoords.longitude,
            houseLoc.latitude,
            houseLoc.longitude
          )
        : null;
    const isSopMatch = deltaMeters !== null ? deltaMeters <= 50 : null;
    const bucket = classifyMapStatus(selectedTicket);
    return {
      regCoords,
      houseLoc,
      hasHouseCoords,
      housePhotoUrl,
      deltaMeters,
      isSopMatch,
      bucket,
      meta: STATUS_META[bucket]
    };
  }, [selectedTicket]);

  // Helper Card Renderer for Selected WO Side Panel (reused in both Global & Leader modes)
  const renderSelectedDetailCard = () => {
    if (!selectedTicket || !selectedVerification) {
      return (
        <div className="mj-tactile-card p-6 text-center space-y-2.5 border border-[#e8ddff] dark:border-[#3b1d78]">
          <MapPin className="w-8 h-8 text-[#7C3AED] mx-auto opacity-70" />
          <div className="font-display font-bold text-sm text-[#1f1638] dark:text-white">
            Pilih Pin atau WO di Peta
          </div>
          <p className="text-xs text-[#4b4452] dark:text-[#cabde8]">
            Klik salah satu pin pelanggan/FAT pada peta untuk melihat verifikasi Dual GPS dan Foto Rumah.
          </p>
        </div>
      );
    }

    const { regCoords, houseLoc, hasHouseCoords, housePhotoUrl, deltaMeters, isSopMatch, meta } =
      selectedVerification;
    const houseSlotMeta = selectedTicket.technicalReport?.photoSlots?.find(
      s => s.slotKey === 'customer_house'
    );

    return (
      <div className="mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] p-4 space-y-3.5">
        {/* Header Badges & WO Title */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-2 py-0.5 rounded-md bg-[#35105E] text-white font-mono text-[10px] font-extrabold uppercase tracking-wider">
                {selectedTicket.ticketCategory || 'FTTH SERVICE'}
              </span>
              <span
                className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${meta.bgCls} ${meta.textCls}`}
              >
                {meta.label}
              </span>
            </div>
            {selectedTicket.slotTime && (
              <span className="font-mono text-[10.5px] font-bold text-[#4b4452] dark:text-[#cabde8]">
                {selectedTicket.slotTime}
              </span>
            )}
          </div>

          <h3 className="font-display font-extrabold text-base text-[#1f1638] dark:text-white leading-snug">
            #{selectedTicket.woNumber} — {selectedTicket.customerName || 'Pelanggan'}
          </h3>

          <div className="flex items-start gap-1.5 text-xs text-[#4b4452] dark:text-[#cabde8]">
            <MapPin className="w-3.5 h-3.5 text-[#7C3AED] shrink-0 mt-0.5" />
            <span className="leading-snug">
              {[
                selectedTicket.streetName || selectedTicket.address,
                selectedTicket.clusterName,
                selectedTicket.area
              ]
                .filter(Boolean)
                .join(', ') || 'Alamat belum tersedia'}
            </span>
          </div>
        </div>

        {/* Vendor, Area & Assigned Technician */}
        <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-[#f8f1ff] dark:bg-[#160d29] border border-[#e8ddff] dark:border-[#35105E] text-xs">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#7d7484] dark:text-[#cabde8]/70">
              Vendor Mitra
            </div>
            <div className="font-bold text-[#1f1638] dark:text-white truncate">
              {selectedTicket.contactorName || selectedTicket.contractorName || '-'}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#7d7484] dark:text-[#cabde8]/70">
              Area / Leader
            </div>
            <div className="font-bold text-[#1f1638] dark:text-white truncate">
              {selectedTicket.area || '-'}
              {selectedTicket.leaderName ? ` · ${selectedTicket.leaderName}` : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-[#1e1135] border border-[#e8ddff] dark:border-[#35105E]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#eedbff] dark:bg-[#35105E] text-[#58149c] dark:text-[#dab9ff] font-display font-extrabold text-xs flex items-center justify-center shrink-0">
              {(selectedTicket.installerName || 'NA').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-xs text-[#1f1638] dark:text-white truncate">
                {selectedTicket.installerName || 'Belum Di-Assign Teknisi'}
              </div>
              <div className="font-mono text-[10.5px] text-[#7d7484] dark:text-[#cabde8] truncate">
                Status: {selectedTicket.statusWOInstaller || 'Unassigned'}
                {selectedTicket.checkInAt
                  ? ` · Check-In ${formatJakartaTimeOnly(selectedTicket.checkInAt)} WIB`
                  : ''}
              </div>
            </div>
          </div>
          {selectedTicket.fatCode && (
            <span className="px-2 py-1 rounded-md bg-[#f3eaff] dark:bg-[#261942] font-mono text-[10px] font-bold text-[#58149c] dark:text-[#dab9ff] shrink-0">
              FAT {selectedTicket.fatCode}
            </span>
          )}
        </div>

        {/* DUAL GPS VERIFICATION */}
        <div className="rounded-xl border border-[#e8ddff] dark:border-[#35105E] bg-[#f8f1ff]/80 dark:bg-[#160d29] p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-[#1f1638] dark:text-white">
              <Satellite className="w-3.5 h-3.5 text-[#7C3AED]" />
              <span>Dual GPS Verification</span>
            </div>
            {deltaMeters !== null ? (
              <span
                className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-extrabold ${
                  isSopMatch
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                }`}
              >
                {isSopMatch ? `MATCH (${formatDistanceMetersLabel(deltaMeters)})` : `DEVIASI (${formatDistanceMetersLabel(deltaMeters)})`}
              </span>
            ) : hasHouseCoords ? (
              <span className="px-2 py-0.5 rounded-md font-mono text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300">
                CHECK-IN LOCKED
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md font-mono text-[10px] font-bold bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                MENUNGGU CHECK-IN
              </span>
            )}
          </div>

          <div className="space-y-1.5 text-[11px]">
            <div className="p-2 rounded-lg bg-white dark:bg-[#1e1135] border border-[#e8ddff] dark:border-[#35105E]">
              <div className="text-[10px] text-[#7d7484] dark:text-[#cabde8]/80">
                Titik Rumah Terdaftar (Order)
              </div>
              <div className="font-mono font-bold text-[#1f1638] dark:text-white tabular-nums mt-0.5">
                {regCoords
                  ? formatCoordinates(regCoords.latitude, regCoords.longitude)
                  : 'Koordinat order belum terdata'}
              </div>
            </div>

            <div className="p-2 rounded-lg bg-white dark:bg-[#1e1135] border border-[#e8ddff] dark:border-[#35105E]">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-[#7d7484] dark:text-[#cabde8]/80">
                  Lokasi Check-In Geotag (Teknisi)
                </span>
                {typeof houseLoc?.accuracyMeters === 'number' && (
                  <span className="font-mono text-[9.5px] font-bold text-emerald-700 dark:text-emerald-300">
                    ±{Math.round(houseLoc.accuracyMeters)}m Acc
                  </span>
                )}
              </div>
              <div className="font-mono font-bold text-[#1f1638] dark:text-white tabular-nums mt-0.5">
                {hasHouseCoords && houseLoc
                  ? formatCoordinates(houseLoc.latitude, houseLoc.longitude)
                  : 'Belum ada check-in foto rumah GPS'}
              </div>
            </div>
          </div>

          {deltaMeters !== null && (
            <div className="space-y-1 pt-0.5">
              <div className="flex items-center justify-between text-[10.5px]">
                <span className="text-[#4b4452] dark:text-[#cabde8]">
                  Delta Deviasi: <strong>{formatDistanceMetersLabel(deltaMeters)}</strong>
                </span>
                <span
                  className={`font-bold ${
                    isSopMatch ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {isSopMatch ? 'Dalam Toleransi SOP (< 50m)' : 'Di Luar Radius 50m'}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${isSopMatch ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(100, Math.max(12, isSopMatch ? 100 - deltaMeters : 100))}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* HOUSE CHECK-IN PHOTO PREVIEW */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[10.5px]">
            <span className="font-extrabold uppercase tracking-wider text-[#1f1638] dark:text-white flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-[#7C3AED]" />
              <span>Foto Bukti Check-In Lapangan</span>
            </span>
            {housePhotoUrl && (
              <button
                type="button"
                onClick={() =>
                  setLightboxImage({
                    url: getSafePreviewUrl(housePhotoUrl),
                    title: `Foto Rumah Check-In • #${selectedTicket.woNumber}`
                  })
                }
                className="text-[#7C3AED] dark:text-[#DAB9FF] font-bold inline-flex items-center gap-1 hover:underline cursor-pointer"
              >
                <Maximize2 className="w-3 h-3" />
                <span>Full Res</span>
              </button>
            )}
          </div>

          {housePhotoUrl ? (
            <div
              onClick={() =>
                setLightboxImage({
                  url: getSafePreviewUrl(housePhotoUrl),
                  title: `Foto Rumah Check-In • #${selectedTicket.woNumber}`
                })
              }
              className="relative h-36 rounded-xl overflow-hidden border border-[#e8ddff] dark:border-[#35105E] bg-slate-900 cursor-pointer group"
            >
              <img
                src={getSafePreviewUrl(housePhotoUrl)}
                alt={`Foto Rumah ${selectedTicket.woNumber}`}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-2.5 text-white flex items-end justify-between gap-2 text-[10px]">
                <div className="font-mono">
                  <div className="font-bold text-emerald-300">
                    {houseLoc?.capturedAt
                      ? `${formatJakartaTimeOnly(houseLoc.capturedAt)} WIB`
                      : houseSlotMeta?.capturedAt || 'Terunggah'}
                  </div>
                  {(houseLoc?.fieldNotes || houseSlotMeta?.fieldNotes) && (
                    <div className="text-white/90 truncate max-w-[200px]">
                      {houseLoc?.fieldNotes || houseSlotMeta?.fieldNotes}
                    </div>
                  )}
                </div>
                <span className="px-1.5 py-0.5 rounded bg-black/70 border border-white/20 font-mono text-[9px] font-bold shrink-0">
                  {houseSlotMeta?.captureMethod === 'gallery' ? 'GALERI' : 'LIVE GEOTAG'}
                </span>
              </div>
            </div>
          ) : (
            <div className="h-24 rounded-xl border border-dashed border-[#cec3d4] dark:border-[#4b386b] bg-[#f8f1ff]/60 dark:bg-[#160d29] flex flex-col items-center justify-center p-3 text-center gap-1 text-[11px] text-[#7d7484] dark:text-[#cabde8]">
              <Camera className="w-4 h-4 opacity-70" />
              <span>Teknisi belum mengambil foto rumah check-in GPS</span>
            </div>
          )}
        </div>

        {/* WIRED ACTION BUTTONS */}
        <div className="space-y-2 pt-1">
          {isLeaderMode ? (
            <button
              type="button"
              onClick={() => {
                if (onNavigate) {
                  onNavigate(selectedTicket.installerName ? 'reassign_wo' : 'wo_assignment');
                } else {
                  onSelectTicket(selectedTicket, 'overview');
                }
              }}
              className="mj-tactile-btn-primary w-full min-h-[42px] px-3.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer"
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span>
                {selectedTicket.installerName ? 'Reassign / Kelola Penugasan' : 'Assign Teknisi Sekarang'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSelectTicket(selectedTicket, 'overview')}
              className="mj-tactile-btn-primary w-full min-h-[42px] px-3.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>Buka Detail WO Lengkap</span>
            </button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleNavigateRoute(selectedTicket)}
              className="mj-tactile-btn-secondary min-h-[38px] px-2.5 rounded-xl border border-[#cec3d4] dark:border-[#4b386b] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Navigation className="w-3.5 h-3.5 text-[#7C3AED]" />
              <span>{isLeaderMode ? 'Pandu Rute GIS' : 'Lacak Rute'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (isLeaderMode) {
                  handleOpenWhatsAppContact(selectedTicket, 'installer');
                } else {
                  handleOpenWhatsAppContact(selectedTicket, 'leader');
                }
              }}
              className="mj-tactile-btn-secondary min-h-[38px] px-2.5 rounded-xl border border-[#cec3d4] dark:border-[#4b386b] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Phone className="w-3.5 h-3.5 text-emerald-600" />
              <span>{isLeaderMode ? 'Hubungi Teknisi' : 'Hubungi TL'}</span>
            </button>
          </div>

          {isLeaderMode && (
            <button
              type="button"
              onClick={() => onSelectTicket(selectedTicket, 'overview')}
              className="w-full py-1.5 text-[11px] font-bold text-[#7C3AED] dark:text-[#DAB9FF] hover:underline flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>Buka Detail 17-Section WO</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 pb-8">
      {/* ================================================================= */}
      {/* LEADER RBAC AUTHORIZATION BANNER & HEADER                          */}
      {/* ================================================================= */}
      {isLeaderMode ? (
        <div className="space-y-3">
          <div className="rounded-2xl bg-[#f3eaff] dark:bg-[#22123F] border border-[#dab9ff] dark:border-[#5b35b1] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[#7C3AED] text-white flex items-center justify-center shrink-0">
                <Shield className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-[#1f1638] dark:text-white truncate">
                  SCOPE TERBATAS: Vendor{' '}
                  <span className="text-[#7C3AED] dark:text-[#DAB9FF]">
                    {leaderContractor || 'Sesuai Penugasan'}
                  </span>{' '}
                  | Area{' '}
                  <span className="text-[#7C3AED] dark:text-[#DAB9FF]">
                    {leaderArea || 'Multi-Cluster'}
                  </span>
                </div>
                <div className="text-[10.5px] text-[#4b4452] dark:text-[#cabde8] flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    RBAC Auth: Leader {currentUser.name}
                  </span>
                  <span>• {scopedInstallers.length} Teknisi Aktif dalam Scope</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={() => setShowOpticalLayer(v => !v)}
                className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                  showOpticalLayer
                    ? 'bg-[#7C3AED] border-[#6D28D9] text-white'
                    : 'bg-white dark:bg-[#1e1135] border-[#cec3d4] dark:border-[#4b386b] text-[#1f1638] dark:text-white'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span>ODP/FAT Overlay</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.('wo_assignment')}
                className="mj-tactile-btn-primary px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Disposisi Cepat</span>
              </button>
            </div>
          </div>

          {/* Leader 5 Scoped KPI Cards */}
          <div className={`grid ${isCompactUI ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-5'} gap-3`}>
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`mj-tactile-card p-3.5 text-left border transition-all cursor-pointer ${
                statusFilter === 'ALL'
                  ? 'border-[#7C3AED] ring-2 ring-[#7C3AED]/20'
                  : 'border-[#e8ddff] dark:border-[#3b1d78]'
              }`}
            >
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#7d7484] dark:text-[#cabde8]">
                Total WO Area
              </div>
              <div className="font-display text-2xl font-extrabold text-[#1f1638] dark:text-white mt-1 tabular-nums">
                {kpiStats.total} <span className="text-xs font-semibold text-[#7d7484]">Tiket</span>
              </div>
              <div className="text-[10.5px] text-[#7C3AED] dark:text-[#DAB9FF] font-semibold mt-1">
                {mappedEntries.length} terpetakan di GIS
              </div>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('assigned')}
              className={`mj-tactile-card p-3.5 text-left border transition-all cursor-pointer ${
                statusFilter === 'assigned'
                  ? 'border-[#7C3AED] ring-2 ring-[#7C3AED]/20'
                  : 'border-[#e8ddff] dark:border-[#3b1d78]'
              }`}
            >
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#7d7484] dark:text-[#cabde8]">
                WO Ter-Assign
              </div>
              <div className="font-display text-2xl font-extrabold text-[#7C3AED] dark:text-[#DAB9FF] mt-1 tabular-nums">
                {kpiStats.assigned} <span className="text-xs font-semibold text-[#7d7484]">Tiket</span>
              </div>
              <div className="text-[10.5px] text-emerald-600 dark:text-emerald-300 font-semibold mt-1">
                {kpiStats.total > 0 ? Math.round((kpiStats.assigned / kpiStats.total) * 100) : 0}% Terdistribusi
              </div>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('unassigned')}
              className={`mj-tactile-card p-3.5 text-left border transition-all cursor-pointer ${
                statusFilter === 'unassigned'
                  ? 'border-rose-500 ring-2 ring-rose-500/20'
                  : 'border-rose-200 dark:border-rose-900/60'
              }`}
            >
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-300">
                Belum Assigned
              </div>
              <div className="font-display text-2xl font-extrabold text-rose-600 dark:text-rose-300 mt-1 tabular-nums">
                {kpiStats.unassigned} <span className="text-xs font-semibold">Tiket</span>
              </div>
              <div className="text-[10.5px] text-rose-600 dark:text-rose-300 font-semibold mt-1">
                {kpiStats.unassigned > 0 ? 'Perlu Tindakan Leader' : 'Semua ter-assign'}
              </div>
            </button>

            <div className="mj-tactile-card p-3.5 border border-[#e8ddff] dark:border-[#3b1d78]">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#7d7484] dark:text-[#cabde8]">
                Teknisi Tim Bertugas
              </div>
              <div className="font-display text-2xl font-extrabold text-[#1f1638] dark:text-white mt-1 tabular-nums">
                {kpiStats.activeTechCount}
                <span className="text-sm font-semibold text-[#7d7484]">/{kpiStats.totalTechCount}</span>
              </div>
              <div className="text-[10.5px] text-emerald-600 dark:text-emerald-300 font-semibold mt-1">
                {kpiStats.withHouseCheckIn} Check-In Foto Rumah
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStatusFilter('completed')}
              className={`mj-tactile-card p-3.5 text-left border transition-all cursor-pointer ${
                isCompactUI ? 'col-span-2' : ''
              } ${
                statusFilter === 'completed'
                  ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                  : 'border-[#e8ddff] dark:border-[#3b1d78]'
              }`}
            >
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#7d7484] dark:text-[#cabde8]">
                Selesai vs Kendala
              </div>
              <div className="flex items-baseline gap-2 mt-1 tabular-nums">
                <span className="font-display text-2xl font-extrabold text-emerald-600 dark:text-emerald-300">
                  {kpiStats.completed}
                </span>
                <span className="text-xs text-[#7d7484]">Done</span>
                <span className="font-display text-xl font-extrabold text-rose-600 dark:text-rose-300">
                  {kpiStats.problem}
                </span>
                <span className="text-xs text-[#7d7484]">Kendala</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden mt-2 flex">
                <div
                  className="h-full bg-emerald-500"
                  style={{
                    width: `${
                      kpiStats.completed + kpiStats.problem > 0
                        ? Math.round((kpiStats.completed / (kpiStats.completed + kpiStats.problem)) * 100)
                        : 0
                    }%`
                  }}
                />
                <div
                  className="h-full bg-rose-500"
                  style={{
                    width: `${
                      kpiStats.completed + kpiStats.problem > 0
                        ? Math.round((kpiStats.problem / (kpiStats.completed + kpiStats.problem)) * 100)
                        : 0
                    }%`
                  }}
                />
              </div>
            </button>
          </div>
        </div>
      ) : (
        /* =============================================================== */
        /* GLOBAL COMMAND CENTER FLOATING KPI SUMMARY BAR                  */
        /* =============================================================== */
        <div className="mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                statusFilter === 'ALL'
                  ? 'bg-[#58149c] text-white border-[#58149c]'
                  : 'bg-[#f8f1ff] dark:bg-[#1e1135] border-[#e8ddff] dark:border-[#35105E] text-[#1f1638] dark:text-white'
              }`}
            >
              Total WO Aktif: <strong className="font-mono">{kpiStats.total}</strong>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'assigned' ? 'ALL' : 'assigned')}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                statusFilter === 'assigned'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-[#1e1135] border-[#e8ddff] dark:border-[#35105E] text-indigo-700 dark:text-indigo-300'
              }`}
            >
              Assigned: <strong className="font-mono">{kpiStats.assigned}</strong>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'unassigned' ? 'ALL' : 'unassigned')}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                statusFilter === 'unassigned'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
              }`}
            >
              Belum Assigned: <strong className="font-mono">{kpiStats.unassigned}</strong>
            </button>
            <span className="px-2.5 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-bold inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>
                Teknisi Bertugas:{' '}
                <strong className="font-mono">
                  {kpiStats.activeTechCount}/{kpiStats.totalTechCount}
                </strong>
              </span>
            </span>
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'in_progress' ? 'ALL' : 'in_progress')}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                statusFilter === 'in_progress'
                  ? 'bg-[#5B289B] text-white border-[#5B289B]'
                  : 'bg-white dark:bg-[#1e1135] border-[#e8ddff] dark:border-[#35105E] text-[#5B289B] dark:text-[#D8B4FE]'
              }`}
            >
              Bertugas: <strong className="font-mono">{kpiStats.inProgress + kpiStats.checkin}</strong>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'completed' ? 'ALL' : 'completed')}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                statusFilter === 'completed'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white dark:bg-[#1e1135] border-[#e8ddff] dark:border-[#35105E] text-emerald-700 dark:text-emerald-300'
              }`}
            >
              Selesai: <strong className="font-mono">{kpiStats.completed}</strong>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'problem' ? 'ALL' : 'problem')}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                statusFilter === 'problem'
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
              }`}
            >
              Kendala: <strong className="font-mono">{kpiStats.problem}</strong>
            </button>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono text-[#4b4452] dark:text-[#cabde8]">
            <span>
              Check-In Foto: <strong className="text-[#7C3AED]">{kpiStats.withHouseCheckIn}</strong>/{kpiStats.total}
            </span>
            <button
              type="button"
              onClick={handleSyncLive}
              disabled={isSyncingMap}
              className="px-2.5 py-1.5 rounded-xl bg-[#f3eaff] dark:bg-[#261942] border border-[#dab9ff] dark:border-[#4b386b] text-[#58149c] dark:text-[#dab9ff] font-sans font-bold flex items-center gap-1 cursor-pointer hover:bg-[#e8ddff]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingMap ? 'animate-spin' : ''}`} />
              <span>Sync Live</span>
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MULTI-LEVEL FILTER TOOLBAR                                        */}
      {/* ================================================================= */}
      <div className="mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-[#7d7484] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cari WO#, Pelanggan, Teknisi, FAT..."
              className="w-full pl-8 pr-3 py-2 rounded-xl bg-[#f8f1ff] dark:bg-[#160d29] border border-[#e8ddff] dark:border-[#35105E] text-xs text-[#1f1638] dark:text-white placeholder:text-[#7d7484] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
            />
          </div>

          {!isLeaderMode && (
            <>
              <select
                value={vendorFilter}
                onChange={e => setVendorFilter(e.target.value)}
                aria-label="Filter Vendor"
                className="px-2.5 py-2 rounded-xl bg-white dark:bg-[#1e1135] border border-[#e8ddff] dark:border-[#35105E] text-xs font-semibold text-[#1f1638] dark:text-white"
              >
                <option value="ALL">Vendor: Semua ({filterOptions.vendors.length})</option>
                {filterOptions.vendors.map(v => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>

              <select
                value={areaFilter}
                onChange={e => setAreaFilter(e.target.value)}
                aria-label="Filter Area"
                className="px-2.5 py-2 rounded-xl bg-white dark:bg-[#1e1135] border border-[#e8ddff] dark:border-[#35105E] text-xs font-semibold text-[#1f1638] dark:text-white"
              >
                <option value="ALL">Area: Semua ({filterOptions.areas.length})</option>
                {filterOptions.areas.map(a => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>

              <select
                value={leaderFilter}
                onChange={e => setLeaderFilter(e.target.value)}
                aria-label="Filter Leader"
                className="px-2.5 py-2 rounded-xl bg-white dark:bg-[#1e1135] border border-[#e8ddff] dark:border-[#35105E] text-xs font-semibold text-[#1f1638] dark:text-white"
              >
                <option value="ALL">Leader: Semua ({filterOptions.leaders.length})</option>
                {filterOptions.leaders.map(l => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </>
          )}

          <select
            value={techFilter}
            onChange={e => setTechFilter(e.target.value)}
            aria-label="Filter Teknisi"
            className="px-2.5 py-2 rounded-xl bg-white dark:bg-[#1e1135] border border-[#e8ddff] dark:border-[#35105E] text-xs font-semibold text-[#1f1638] dark:text-white"
          >
            <option value="ALL">Teknisi: Semua ({filterOptions.techs.length})</option>
            {filterOptions.techs.map(t => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as 'ALL' | MapStatusBucket)}
            aria-label="Filter Status WO"
            className="px-2.5 py-2 rounded-xl bg-white dark:bg-[#1e1135] border border-[#e8ddff] dark:border-[#35105E] text-xs font-semibold text-[#1f1638] dark:text-white"
          >
            <option value="ALL">Status: Semua Status</option>
            {Object.entries(STATUS_META).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </select>

          <select
            value={checkInFilter}
            onChange={e => setCheckInFilter(e.target.value as 'ALL' | 'VERIFIED' | 'MISSING')}
            aria-label="Filter Status Check-In Foto"
            className="px-2.5 py-2 rounded-xl bg-white dark:bg-[#1e1135] border border-[#e8ddff] dark:border-[#35105E] text-xs font-semibold text-[#1f1638] dark:text-white"
          >
            <option value="ALL">Check-in Foto: Semua</option>
            <option value="VERIFIED">Sudah Check-in Foto Rumah</option>
            <option value="MISSING">Belum Check-in Foto</option>
          </select>

          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dateFilter}
              disabled={showAllDates}
              onChange={e => {
                setDateFilter(e.target.value);
                setShowAllDates(false);
                hasAutoFittedRef.current = false;
              }}
              aria-label="Tanggal Appointment"
              className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#1e1135] border border-[#e8ddff] dark:border-[#35105E] text-xs font-semibold text-[#1f1638] dark:text-white disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => {
                setShowAllDates(v => !v);
                hasAutoFittedRef.current = false;
              }}
              className={`px-2.5 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                showAllDates
                  ? 'bg-[#7C3AED] border-[#7C3AED] text-white'
                  : 'bg-white dark:bg-[#1e1135] border-[#e8ddff] dark:border-[#35105E] text-[#4b4452] dark:text-[#cabde8]'
              }`}
              title="Tampilkan seluruh tanggal atau khusus tanggal dipilih"
            >
              {showAllDates ? 'Semua Tgl' : formatAppointmentDateDisplay(dateFilter)}
            </button>
          </div>

          <button
            type="button"
            onClick={handleResetFilters}
            className="p-2 rounded-xl bg-[#f3eaff] dark:bg-[#261942] border border-[#dab9ff] dark:border-[#4b386b] text-[#58149c] dark:text-[#dab9ff] hover:bg-[#e8ddff] cursor-pointer"
            title="Reset Semua Filter"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Cluster Quick-Jump Chips & Unmapped GPS Drawer Toggle */}
        {(clusterSummaries.length > 0 || unmappedTickets.length > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-[#e8ddff] dark:border-[#35105E] text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-[#7d7484] dark:text-[#cabde8] mr-1">Cluster Aktif:</span>
              {clusterSummaries.map(c => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => handlePanToCluster(c.latSum / c.coordCount, c.lngSum / c.coordCount)}
                  className="px-2 py-0.5 rounded-md bg-white dark:bg-[#1e1135] border border-[#e8ddff] dark:border-[#35105E] hover:border-[#7C3AED] text-[#1f1638] dark:text-white font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="w-2 h-2 rounded-full bg-[#7C3AED]" />
                  <span>{c.name}</span>
                  <span className="px-1 rounded bg-[#f3eaff] dark:bg-[#35105E] font-mono text-[10px] font-bold text-[#58149c] dark:text-[#dab9ff]">
                    {c.count} WO
                  </span>
                </button>
              ))}
            </div>

            {unmappedTickets.length > 0 && (
              <button
                type="button"
                onClick={() => setShowNoGpsDrawer(v => !v)}
                className="px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 font-bold flex items-center gap-1 cursor-pointer"
              >
                <AlertTriangle className="w-3 h-3" />
                <span>{unmappedTickets.length} WO Belum Memiliki Koordinat GPS</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Collapsible List of WOs Without GPS Coordinates */}
      {showNoGpsDrawer && unmappedTickets.length > 0 && (
        <div className="mj-tactile-card border border-amber-300 dark:border-amber-800 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-extrabold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Daftar WO Belum Memiliki Titik GPS ({unmappedTickets.length})</span>
            </div>
            <button
              type="button"
              onClick={() => setShowNoGpsDrawer(false)}
              className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[11px] text-[#4b4452] dark:text-[#cabde8]">
            Pin akan otomatis muncul di peta setelah teknisi melakukan Check-In Foto Rumah GPS atau jika koordinat pelanggan tersedia.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
            {unmappedTickets.slice(0, 18).map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setSelectedTicketId(t.id);
                  setShowNoGpsDrawer(false);
                }}
                className="p-2.5 rounded-xl bg-[#f8f1ff] dark:bg-[#160d29] border border-[#e8ddff] dark:border-[#35105E] hover:border-[#7C3AED] text-left space-y-0.5 cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-bold text-[#7C3AED] dark:text-[#DAB9FF]">
                    {t.woNumber}
                  </span>
                  <span className="text-[10px] font-semibold text-[#7d7484]">{t.statusWOInstaller}</span>
                </div>
                <div className="text-xs font-bold text-[#1f1638] dark:text-white truncate">
                  {t.customerName}
                </div>
                <div className="text-[10.5px] text-[#4b4452] dark:text-[#cabde8] truncate">
                  {t.installerName || 'Belum Assigned'} • {t.clusterName || t.area || '-'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MAIN GIS VIEWPORT + DETAIL DRAWER                                 */}
      {/* ================================================================= */}
      <div className={`grid grid-cols-1 ${isCompactUI ? '' : 'lg:grid-cols-12'} gap-4 items-start`}>
        {/* LEFT: INTERACTIVE LEAFLET MAP */}
        <div className={`${isCompactUI ? '' : 'lg:col-span-8'} space-y-3`}>
          <div className="relative rounded-2xl overflow-hidden border border-[#e8ddff] dark:border-[#3b1d78] bg-[#e8ddff] dark:bg-[#0B1222] shadow-sm isolate z-0">
            <div
              ref={mapContainerRef}
              className={`w-full ${isCompactUI ? 'h-[380px]' : 'h-[540px]'} z-0`}
            />

            {/* Empty / Offline Map Banner */}
            {mappedEntries.length === 0 && (
              <div className="absolute inset-x-4 top-4 z-[450] pointer-events-none flex justify-center">
                <div className="px-3.5 py-2 rounded-xl bg-[#160D29]/95 text-white text-xs font-semibold shadow-lg border border-[#D8B4FE]/25 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    {visibleTickets.length === 0
                      ? 'Tidak ada Work Order yang cocok dengan filter aktif.'
                      : `${visibleTickets.length} Work Order aktif belum memiliki koordinat GPS (menunggu Check-In Foto Rumah teknisi).`}
                  </span>
                </div>
              </div>
            )}

            {tileOfflineWarning && (
              <div className="absolute top-3 left-3 z-[450] px-2.5 py-1 rounded-lg bg-[#160D29]/90 text-amber-300 font-mono text-[10px] pointer-events-none border border-[#D8B4FE]/20">
                Layer tile sedang memuat / offline — pin GPS tetap aktif
              </div>
            )}

            {/* Top-Right GIS Layer Switch */}
            <div className="absolute top-3 right-3 z-[450] flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMapStyle(prev => (prev === 'street' ? 'satellite' : 'street'))}
                className="btn-3d-lilac px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                title="Ganti Layer Peta Jalan / Satelit"
              >
                <Layers className="w-3.5 h-3.5 text-[#7C3AED] dark:text-[#D8B4FE]" />
                <span>{mapStyle === 'satellite' ? 'Satelit' : 'Peta Jalan'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowOpticalLayer(v => !v)}
                className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold shadow-md flex items-center gap-1.5 cursor-pointer ${
                  showOpticalLayer
                    ? 'btn-3d-primary border-[#6D28D9]'
                    : 'btn-3d-lilac'
                }`}
                title="Tampilkan / Sembunyikan Garis & Node FAT"
              >
                <Radio className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">FAT Layer</span>
              </button>
            </div>

            {/* Bottom-Left Floating Map Zoom & Recenter */}
            <div className="absolute bottom-3 right-3 z-[450] flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => mapInstanceRef.current?.zoomIn()}
                aria-label="Zoom In"
                className="btn-3d-icon w-9 h-9 rounded-xl cursor-pointer"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => mapInstanceRef.current?.zoomOut()}
                aria-label="Zoom Out"
                className="btn-3d-icon w-9 h-9 rounded-xl cursor-pointer"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleRecenterBounds}
                aria-label="Pusatkan Peta"
                title="Pusatkan Semua Pin WO"
                className="btn-3d-icon w-9 h-9 rounded-xl !text-[#7C3AED] dark:!text-[#DAB9FF] cursor-pointer"
              >
                <Crosshair className="w-4 h-4" />
              </button>
            </div>

            {/* Status Legend Floating Card */}
            <div className="hidden sm:block absolute bottom-3 left-3 z-[450] rounded-xl bg-white/95 dark:bg-[#1A0E2E]/95 backdrop-blur-md border border-[#e8ddff] dark:border-[#35105E] p-2.5 shadow-lg max-w-[290px]">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#1f1638] dark:text-white">
                  Status Legend
                </span>
                <span className="text-[9.5px] font-mono text-[#7d7484] dark:text-[#cabde8]">
                  {lastSyncTime ? `Sync ${formatJakartaTimeOnly(lastSyncTime)}` : 'Live GIS'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-semibold text-[#4b4452] dark:text-[#cabde8]">
                {Object.entries(STATUS_META).map(([key, item]) => (
                  <div key={key} className="flex items-center gap-1.5 truncate">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="truncate">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Horizontal Plotted WO Quick-Pick Strip */}
          {mappedEntries.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
              {mappedEntries.slice(0, 14).map(({ ticket, bucket }) => {
                const isActive = selectedTicket?.id === ticket.id;
                const meta = STATUS_META[bucket];
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => handlePanToTicket(ticket)}
                    className={`shrink-0 px-3 py-2 rounded-xl border text-left transition-all cursor-pointer ${
                      isActive
                        ? 'bg-[#58149c] border-[#58149c] text-white shadow-sm'
                        : 'bg-white dark:bg-[#1e1135] border-[#e8ddff] dark:border-[#35105E] text-[#1f1638] dark:text-white hover:border-[#7C3AED]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: isActive ? '#ffffff' : meta.color }}
                      />
                      <span className="font-mono text-[11px] font-extrabold">{ticket.woNumber}</span>
                    </div>
                    <div
                      className={`text-[10.5px] truncate max-w-[140px] mt-0.5 ${
                        isActive ? 'text-purple-100' : 'text-[#4b4452] dark:text-[#cabde8]'
                      }`}
                    >
                      {ticket.customerName}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT: TACTICAL DETAIL DRAWER & TEAM ACTIVITY LOG */}
        <div className={`${isCompactUI ? '' : 'lg:col-span-4'} space-y-4`}>
          {renderSelectedDetailCard()}

          {/* Real Activity Timeline for Scoped Team / Selected Filter */}
          <div className="mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-[#1f1638] dark:text-white">
                <Activity className="w-3.5 h-3.5 text-[#7C3AED]" />
                <span>
                  {isLeaderMode ? `Log Aktivitas ${leaderContractor || 'Tim'}` : 'Log Aktivitas Lapangan'}
                </span>
              </div>
              <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-300 font-bold">
                Real-time sync
              </span>
            </div>

            {scopedRecentActivities.length === 0 ? (
              <p className="text-xs text-[#7d7484] dark:text-[#cabde8] py-2">
                Belum ada log aktivitas lapangan terbaru pada scope ini.
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {scopedRecentActivities.map(act => (
                  <div
                    key={act.id}
                    className="p-2.5 rounded-xl bg-[#f8f1ff] dark:bg-[#160d29] border border-[#e8ddff] dark:border-[#35105E] text-xs space-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#1f1638] dark:text-white truncate">
                        {act.performedBy || 'Sistem'} • {act.woNumber || ''}
                      </span>
                      <span className="font-mono text-[10px] text-[#7d7484] shrink-0">
                        {formatJakartaTimeOnly(act.timestamp)}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#4b4452] dark:text-[#cabde8] leading-snug line-clamp-2">
                      {act.description}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FULLSCREEN PHOTO LIGHTBOX */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[130] bg-[#160D29]/90 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-3xl max-h-[88vh]" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              className="absolute -top-3 -right-3 p-2 rounded-full bg-[#27104A] text-white border border-[#D8B4FE]/30 hover:bg-rose-600 cursor-pointer"
              aria-label="Tutup Lightbox"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.title}
              className="max-w-full max-h-[80vh] object-contain rounded-xl border border-[#D8B4FE]/25 shadow-2xl"
            />
            <div className="mt-2 text-center text-xs font-bold text-white">{lightboxImage.title}</div>
          </div>
        </div>
      )}
    </div>
  );
};
