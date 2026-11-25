import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { useApp } from '../../context/AppContext';
import { UserRole, User as UserType } from '../../types';
import {
  Users,
  UserPlus,
  Shield,
  Wrench,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Lock,
  Unlock,
  Trash2,
  ShieldAlert,
  Search,
  X,
  Edit2,
  ChevronDown,
  MapPin,
  Eye,
  EyeOff,
  LogOut,
  Check,
  Download,
  SlidersHorizontal,
  ShieldCheck,
  Database,
  Cpu,
  Radio,
  Mail,
  MessageCircle,
  Fingerprint,
  BadgeCheck,
  Building2,
  RotateCcw,
  ToggleRight
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { SortState, getNextSortDirection, sortDataArray } from '../../utils/tableSorting';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { useVisualViewportModal } from '../../hooks/useVisualViewportModal';
import { useModalLayer } from '../../hooks/useModalLayer';
import { SuperAdminDeleteModal } from '../common/SuperAdminDeleteModal';
import { DropdownActionItem } from '../common/ActionDropdownMenu';
import {
  adminCreateUser,
  adminResetPassword,
  adminUpdateUserStatus,
  adminRevokeSessions,
  adminUpdateUser,
  adminIssueSingleUseResetToken,
  ROLE_PERMISSIONS
} from '../../services/authService';
import { MAX_PASSWORD_LENGTH, validateStrongPasswordClient } from '../../utils/passwordPolicy';
import { MassPasswordResetPanel } from './MassPasswordResetPanel';

interface SearchableAreaDropdownProps {
  value: string;
  onChange: (areaName: string) => void;
  areas: { id?: string; name: string }[];
  placeholder?: string;
  required?: boolean;
}

export const SearchableAreaDropdown: React.FC<SearchableAreaDropdownProps> = ({
  value,
  onChange,
  areas,
  placeholder = 'Pilih atau cari area...',
  required = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredAreas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return areas;
    return areas.filter(a => String(a?.name || '').toLowerCase().includes(q));
  }, [areas, query]);

  const handleSelect = (areaName: string) => {
    onChange(areaName);
    setIsOpen(false);
    setQuery('');
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <div
        onClick={() => {
          setIsOpen(!isOpen);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className={`tactile-debossed-input w-full px-3 py-2 min-h-[40px] bg-[#F4F7FB] dark:bg-[#160d29] border rounded-xl text-[#26364A] dark:text-white cursor-pointer flex items-center justify-between transition-colors ${
          isOpen
            ? 'border-[#5145A6] ring-2 ring-[#6657C8]/25 dark:border-[#7135B5] dark:ring-[#7135B5]/25'
            : 'border-[#DDE6F0] dark:border-[#3b1d78] hover:border-[#9FAEE0] dark:hover:border-[#a78bfa]'
        }`}
      >
        <div className="flex items-center gap-2 truncate">
          <MapPin className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
          <span className={`text-xs truncate ${value ? 'font-semibold text-[#26364A] dark:text-white' : 'text-[#8492A5] dark:text-[#A79BC0]'}`}>
            {value || placeholder}
          </span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-[#8492A5] dark:text-[#A79BC0] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </div>

      {required && (
        <input
          type="text"
          value={value}
          onChange={() => {}}
          required
          className="opacity-0 absolute inset-0 pointer-events-none h-0 w-0"
          tabIndex={-1}
        />
      )}

      {isOpen && (
        <div className="absolute z-50 mt-1.5 w-full bg-white dark:bg-[#1e1238] border border-[#DDE6F0] dark:border-[#4b386b] rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2 border-b border-[#E2E8F0] dark:border-[#3b1d78] bg-[#F4F7FB] dark:bg-[#160d29] flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF] shrink-0 ml-1" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ketik untuk mencari area..."
              className="w-full bg-transparent border-none text-xs text-[#26364A] dark:text-white focus:outline-hidden placeholder:text-[#8492A5]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="p-1 text-[#8492A5] hover:text-[#26364A] dark:hover:text-white rounded cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto p-1 text-xs divide-y divide-[#E2E8F0] dark:divide-[#2e1859]">
            {filteredAreas.length === 0 ? (
              <div className="py-4 px-3 text-center text-xs text-[#BA1A1A] dark:text-rose-400 font-semibold">
                Area tidak ditemukan
              </div>
            ) : (
              filteredAreas.map(area => {
                const isSelected = value.toLowerCase() === area.name.toLowerCase();
                return (
                  <button
                    key={area.id || area.name}
                    type="button"
                    onClick={() => handleSelect(area.name)}
                    className={`w-full px-3 py-2 text-left rounded-lg transition-colors flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF] font-bold'
                        : 'hover:bg-[#EDF3F8] dark:hover:bg-[#2a174a] text-[#26364A] dark:text-[#e9d5ff]'
                    }`}
                  >
                    <span>{area.name}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface SearchableContractorDropdownProps {
  value: string;
  onChange: (contractorName: string) => void;
  contractors: { id?: string; name: string; code?: string }[];
  placeholder?: string;
  required?: boolean;
}

export const SearchableContractorDropdown: React.FC<SearchableContractorDropdownProps> = ({
  value,
  onChange,
  contractors,
  placeholder = 'Cari & pilih kontraktor / vendor...',
  required = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const uniqueContractors = useMemo(() => {
    const seen = new Set<string>();
    const list: { id?: string; name: string; code?: string }[] = [];
    (contractors || []).forEach(c => {
      const name = String(c?.name || '').trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ id: c.id, name, code: c.code });
    });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [contractors]);

  const filteredContractors = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return uniqueContractors;
    return uniqueContractors.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        String(c.code || '').toLowerCase().includes(q)
    );
  }, [uniqueContractors, query]);

  const handleSelect = (contractorName: string) => {
    onChange(contractorName);
    setIsOpen(false);
    setQuery('');
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <div
        onClick={() => {
          setIsOpen(!isOpen);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className={`tactile-debossed-input w-full px-3 py-2 min-h-[40px] bg-[#F4F7FB] dark:bg-[#160d29] border rounded-xl text-[#26364A] dark:text-white cursor-pointer flex items-center justify-between transition-colors ${
          isOpen
            ? 'border-[#5145A6] ring-2 ring-[#6657C8]/25 dark:border-[#7135B5] dark:ring-[#7135B5]/25'
            : 'border-[#DDE6F0] dark:border-[#3b1d78] hover:border-[#9FAEE0] dark:hover:border-[#a78bfa]'
        }`}
      >
        <div className="flex items-center gap-2 truncate">
          <Building2 className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
          <span className={`text-xs truncate ${value ? 'font-semibold text-[#26364A] dark:text-white' : 'text-[#8492A5] dark:text-[#A79BC0]'}`}>
            {value || placeholder}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {value && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                onChange('');
              }}
              aria-label="Hapus pilihan kontraktor"
              className="p-0.5 text-[#8492A5] hover:text-[#BA1A1A] rounded cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-[#8492A5] dark:text-[#A79BC0] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {required && (
        <input
          type="text"
          value={value}
          onChange={() => {}}
          required
          className="opacity-0 absolute inset-0 pointer-events-none h-0 w-0"
          tabIndex={-1}
        />
      )}

      {isOpen && (
        <div className="absolute z-50 mt-1.5 w-full bg-white dark:bg-[#1e1238] border border-[#DDE6F0] dark:border-[#4b386b] rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2 border-b border-[#E2E8F0] dark:border-[#3b1d78] bg-[#F4F7FB] dark:bg-[#160d29] flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF] shrink-0 ml-1" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ketik nama kontraktor..."
              className="w-full bg-transparent border-none text-xs text-[#26364A] dark:text-white focus:outline-hidden placeholder:text-[#8492A5]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="p-1 text-[#8492A5] hover:text-[#26364A] dark:hover:text-white rounded cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto p-1 text-xs divide-y divide-[#E2E8F0] dark:divide-[#2e1859]">
            {filteredContractors.length === 0 ? (
              <div className="py-4 px-3 text-center text-xs text-[#BA1A1A] dark:text-rose-400 font-semibold">
                Kontraktor tidak ditemukan
              </div>
            ) : (
              filteredContractors.map(contractor => {
                const isSelected = value.trim().toLowerCase() === contractor.name.toLowerCase();
                return (
                  <button
                    key={contractor.id || contractor.name}
                    type="button"
                    onClick={() => handleSelect(contractor.name)}
                    className={`w-full px-3 py-2 text-left rounded-lg transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                      isSelected
                        ? 'bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF] font-bold'
                        : 'hover:bg-[#EDF3F8] dark:hover:bg-[#2a174a] text-[#26364A] dark:text-[#e9d5ff]'
                    }`}
                  >
                    <span className="truncate">{contractor.name}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {contractor.code && (
                        <span className="font-mono text-[10px] text-[#8492A5] dark:text-[#A79BC0]">
                          {contractor.code}
                        </span>
                      )}
                      {isSelected && <Check className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const isCentralOpsRole = (role: UserRole): boolean => role === 'super_admin' || role === 'dispatch';

export interface UserManagementViewProps {
  onOpenRolesTab?: () => void;
}

function getUserInitials(name: string): string {
  const parts = String(name || 'MJ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'MJ';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function isUserLocked(user: UserType): boolean {
  return Boolean(
    user.accountStatus === 'locked' ||
      (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now())
  );
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({ onOpenRolesTab }) => {
  const {
    currentUser,
    users,
    contractors,
    coverageAreas,
    auditLogs,
    updateUser,
    refreshDatabaseData
  } = useApp();
  const { toast } = useToast();
  const { isCompactUI } = useResponsiveViewport();

  const tableContainerRef = useRef<HTMLDivElement>(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const createModalVv = useVisualViewportModal(isCreateModalOpen);
  const createModalLayer = useModalLayer(isCreateModalOpen, () => {
    if (!isCreatingUser) setIsCreateModalOpen(false);
  });
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [areaVendorFilter, setAreaVendorFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'inactive' | 'locked'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [contactSearchQuery, setContactSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);

  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserType | null>(null);
  const [revokeModalUser, setRevokeModalUser] = useState<UserType | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  // Edit User Modal State
  const [editingUser, setEditingUser] = useState<UserType | null>(null);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('installer');
  const [editContractor, setEditContractor] = useState('');
  const [editArea, setEditArea] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  // Reset Password Modal State (Super Admin Exclusive)
  const [resetModalUser, setResetModalUser] = useState<UserType | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetModalError, setResetModalError] = useState<string | null>(null);
  const [isMassResetOpen, setIsMassResetOpen] = useState(false);
  const [issuingOneTimeToken, setIssuingOneTimeToken] = useState(false);
  const [issuedTokenResult, setIssuedTokenResult] = useState<{ token: string; expiresAt: string } | null>(null);

  // Universal User Registration State (Super Admin Exclusive, 6 Roles)
  const [createName, setCreateName] = useState('');
  const [createUsername, setCreateUsername] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createAltEmail, setCreateAltEmail] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [createRole, setCreateRole] = useState<UserRole>('dispatch');
  const [createContractor, setCreateContractor] = useState('');
  const [createArea, setCreateArea] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createConfirmPassword, setCreateConfirmPassword] = useState('');
  const [createInitialStatus, setCreateInitialStatus] = useState<'active' | 'inactive'>('active');
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showCreateConfirmPassword, setShowCreateConfirmPassword] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (isCentralOpsRole(createRole)) {
      setCreateContractor('');
      setCreateArea('');
    }
  }, [createRole]);

  useEffect(() => {
    if (isCentralOpsRole(editRole)) {
      setEditContractor('');
      setEditArea('');
    }
  }, [editRole]);

  const triggerNotice = (type: 'success' | 'error', text: string) => {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), 5000);
  };

  // Real KPI & role metrics computed directly from live users
  const userStats = useMemo(() => {
    const total = users.length;
    let activeCount = 0;
    let lockedCount = 0;
    let inactiveCount = 0;
    const byRole: Record<UserRole, number> = {
      super_admin: 0,
      dispatch: 0,
      leader: 0,
      installer: 0
    };
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let recentNewCount = 0;

    users.forEach(u => {
      if (byRole[u.role] !== undefined) byRole[u.role] += 1;
      const locked = isUserLocked(u);
      if (locked) {
        lockedCount += 1;
      } else if (u.active) {
        activeCount += 1;
      } else {
        inactiveCount += 1;
      }
      if (u.createdAt) {
        const ts = new Date(u.createdAt).getTime();
        if (!Number.isNaN(ts) && ts >= sevenDaysAgo) {
          recentNewCount += 1;
        }
      }
    });

    const pct = (val: number) => (total > 0 ? `${((val / total) * 100).toFixed(1)}%` : '0.0%');

    // Compute dynamic SVG sparkline points from real role buckets
    const buckets = [
      byRole.super_admin,
      byRole.dispatch,
      byRole.leader,
      byRole.installer,
      activeCount
    ];
    const maxVal = Math.max(1, ...buckets);
    const sparklinePoints = buckets
      .map((val, i) => {
        const x = Math.round((i / Math.max(1, buckets.length - 1)) * 78) + 2;
        const y = Math.round(28 - (val / maxVal) * 22);
        return `${x},${y}`;
      })
      .join(' ');

    return {
      total,
      activeCount,
      lockedCount,
      inactiveCount,
      byRole,
      recentNewCount,
      pct,
      sparklinePoints
    };
  }, [users]);

  // Unique Area / Vendor options from real users, coverageAreas, and contractors
  const areaVendorOptions = useMemo(() => {
    const areas = new Set<string>();
    const vendors = new Set<string>();
    coverageAreas.forEach(a => {
      if (a?.name?.trim()) areas.add(a.name.trim());
    });
    contractors.forEach(c => {
      if (c?.name?.trim()) vendors.add(c.name.trim());
    });
    users.forEach(u => {
      if (u.area?.trim()) areas.add(u.area.trim());
      if (u.contractor?.trim()) vendors.add(u.contractor.trim());
    });
    return {
      areas: Array.from(areas).sort((a, b) => a.localeCompare(b)),
      vendors: Array.from(vendors).sort((a, b) => a.localeCompare(b))
    };
  }, [users, coverageAreas, contractors]);

  // Real Sidebar Insights for Stitch 8/4 Directory Layout
  const directoryInsights = useMemo(() => {
    const activeTopOperators = [...users]
      .filter(u => !u.isArchived && u.active)
      .sort((a, b) => {
        const ta = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
        const tb = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 4);

    const areaMap = new Map<string, { total: number; active: number }>();
    users
      .filter(u => !u.isArchived && !isCentralOpsRole(u.role))
      .forEach(u => {
        const areaName = (u.area || '').trim();
        if (!areaName) return;
        const cur = areaMap.get(areaName) || { total: 0, active: 0 };
        cur.total += 1;
        if (u.active && !isUserLocked(u)) cur.active += 1;
        areaMap.set(areaName, cur);
      });

    const topAreas = Array.from(areaMap.entries())
      .map(([name, counts]) => ({
        name,
        total: counts.total,
        active: counts.active,
        pct: counts.total > 0 ? Math.round((counts.active / counts.total) * 100) : 0
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 4);

    // Build 7-bucket real activity sparkline from lastLoginAt + auditLogs timestamps
    const nowMs = Date.now();
    const dayBuckets = [0, 0, 0, 0, 0, 0, 0];
    const collectTs = (iso?: string | null) => {
      if (!iso) return;
      const t = new Date(iso).getTime();
      if (!Number.isFinite(t)) return;
      const daysAgo = Math.floor((nowMs - t) / 86400000);
      if (daysAgo >= 0 && daysAgo < 7) {
        dayBuckets[6 - daysAgo] += 1;
      }
    };
    users.forEach(u => collectTs(u.lastLoginAt));
    (auditLogs || []).slice(0, 200).forEach(log => collectTs(log.timestamp));

    const maxBucket = Math.max(1, ...dayBuckets);
    const activitySparkline = dayBuckets
      .map((val, idx) => {
        const x = Math.round((idx / 6) * 116) + 2;
        const y = Math.round(30 - (val / maxBucket) * 24);
        return `${x},${y}`;
      })
      .join(' ');

    const activeLoginUsers = users.filter(u => u.active && Boolean(u.lastLoginAt)).length;

    return {
      activeTopOperators,
      topAreas,
      activitySparkline,
      activeLoginUsers,
      totalEvents7d: dayBuckets.reduce((acc, v) => acc + v, 0)
    };
  }, [users, auditLogs]);

  const handleOpenEdit = (user: UserType) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditUsername(user.username);
    setEditRole(user.role);
    setEditContractor(isCentralOpsRole(user.role) ? '' : user.contractor || '');
    setEditArea(isCentralOpsRole(user.role) ? '' : user.area || '');
    setEditPhone(user.phone || '');
    setEditEmail(user.email || '');
    setEditActive(user.active);
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    const trimmedName = editName.trim();
    const cleanUsername = editUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

    if (!trimmedName || !cleanUsername) {
      toast.error('Nama lengkap dan Username wajib diisi.', 'Validasi Gagal');
      return;
    }

    if ((editRole === 'leader' || editRole === 'installer') && !editContractor.trim()) {
      toast.error('Kontraktor / Vendor wajib dipilih untuk role Leader atau Installer.', 'Validasi Gagal');
      return;
    }

    const duplicateUser = users.find(
      u =>
        u.id !== editingUser.id &&
        (u.name.trim().toLowerCase() === trimmedName.toLowerCase() ||
          u.username.trim().toLowerCase() === cleanUsername)
    );

    if (duplicateUser) {
      const errMsg = 'AKUN SUDAH TERDAFTAR – Nama atau username sudah digunakan.';
      toast.error(errMsg, 'Duplikasi Terdeteksi');
      triggerNotice('error', errMsg);
      return;
    }

    const hideScopeFields = isCentralOpsRole(editRole);
    const nextContractor = hideScopeFields ? '' : editContractor.trim();
    const nextArea = hideScopeFields ? '' : editArea.trim();

    setIsUpdating(true);
    try {
      const apiRes = await adminUpdateUser(editingUser.id, {
        name: trimmedName,
        username: cleanUsername,
        role: editRole,
        contractor: nextContractor || undefined,
        area: nextArea || undefined,
        phone: editPhone.trim() || undefined,
        email: editEmail.trim() || undefined,
        active: editActive
      });

      await updateUser(editingUser.id, {
        name: trimmedName,
        username: cleanUsername,
        role: editRole,
        contractor: nextContractor || undefined,
        area: nextArea || undefined,
        phone: editPhone.trim() || undefined,
        email: editEmail.trim() || undefined,
        active: editActive
      });

      if (apiRes.ok || apiRes.status === 200) {
        toast.success(`Data akun ${trimmedName} berhasil diperbarui di Supabase PostgreSQL.`, 'Perubahan Tersimpan');
        triggerNotice('success', `Profil pengguna ${trimmedName} (@${cleanUsername}) berhasil diperbarui.`);
        setEditingUser(null);
        await refreshDatabaseData?.();
      } else {
        const msg = apiRes.data?.error || 'Gagal memperbarui profil pengguna.';
        toast.error(msg, 'Gagal Update');
        triggerNotice('error', msg);
      }
    } catch (err: any) {
      toast.error(err.message || 'Gagal update user', 'Error');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleOpenResetModal = (user: UserType) => {
    setResetModalUser(user);
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setResetModalError(null);
    setIssuedTokenResult(null);
  };

  const handleIssueOneTimeResetToken = async () => {
    if (!resetModalUser || issuingOneTimeToken) return;
    setIssuingOneTimeToken(true);
    setResetModalError(null);
    try {
      const res = await adminIssueSingleUseResetToken(resetModalUser.id, 24);
      if (res.ok && res.data?.success && res.data?.oneTimeToken) {
        setIssuedTokenResult({
          token: res.data.oneTimeToken,
          expiresAt: res.data.expiresAt
        });
        toast.success(
          `Token reset satu-kali diterbitkan untuk ${resetModalUser.name}. Sesi aktif dicabut & wajib ganti sandi diaktifkan.`,
          'Token Diterbitkan'
        );
        await refreshDatabaseData?.();
      } else {
        setResetModalError(res.data?.error || 'Gagal menerbitkan token pemulihan satu-kali.');
      }
    } catch (err: any) {
      setResetModalError(err?.message || 'Kesalahan jaringan saat menerbitkan token.');
    } finally {
      setIssuingOneTimeToken(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalUser) return;
    setResetModalError(null);

    const strength = validateStrongPasswordClient(newPassword, {
      username: resetModalUser.username,
      email: resetModalUser.email,
      name: resetModalUser.name
    });
    if (!strength.valid) {
      setResetModalError(strength.error || 'Kata sandi baru belum memenuhi kebijakan keamanan.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetModalError('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    setIsResetting(true);
    try {
      const res = await adminResetPassword(resetModalUser.id, newPassword, confirmPassword);
      if (res.ok && res.data?.success) {
        toast.success(`Kata sandi akun ${resetModalUser.name} berhasil diatur ulang. Seluruh sesi aktif dibatalkan.`, 'Reset Berhasil');
        triggerNotice('success', `Kata sandi untuk ${resetModalUser.name} (@${resetModalUser.username}) berhasil diatur ulang dengan aman.`);
        setResetModalUser(null);
        setNewPassword('');
        setConfirmPassword('');
        await refreshDatabaseData?.();
      } else {
        const msg = res.data?.error || 'Gagal mengatur ulang kata sandi.';
        setResetModalError(msg);
        toast.error(msg, 'Reset Gagal');
      }
    } catch (err: any) {
      setResetModalError(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setIsResetting(false);
    }
  };

  const handleConfirmRevokeSessions = async () => {
    if (!revokeModalUser || isRevoking) return;
    setIsRevoking(true);
    try {
      const res = await adminRevokeSessions(revokeModalUser.id);
      if (res.ok && res.data?.success) {
        toast.success(`Seluruh sesi aktif untuk ${revokeModalUser.name} berhasil diakhiri.`, 'Sesi Dicabut');
        triggerNotice('success', `Seluruh sesi aktif untuk pengguna ${revokeModalUser.name} (@${revokeModalUser.username}) telah dibatalkan.`);
        setRevokeModalUser(null);
        await refreshDatabaseData?.();
      } else {
        toast.error(res.data?.error || 'Gagal mengakhiri sesi pengguna.', 'Gagal');
      }
    } catch (err: any) {
      toast.error(err.message || 'Kesalahan jaringan.', 'Gagal');
    } finally {
      setIsRevoking(false);
    }
  };

  const handleToggleStatus = async (user: UserType, targetStatus?: 'active' | 'inactive' | 'unlocked') => {
    const nextStatus = targetStatus || (user.active ? 'inactive' : 'active');
    try {
      const res = await adminUpdateUserStatus(user.id, nextStatus, 'Diubah oleh Superadmin di Management User');
      if (res.ok && res.data?.success) {
        toast.success(`Status akun ${user.name} diubah menjadi "${nextStatus}".`, 'Status Diperbarui');
        triggerNotice('success', `Status akun ${user.name} berhasil diperbarui ke: ${nextStatus}`);
        await refreshDatabaseData?.();
      } else {
        toast.error(res.data?.error || 'Gagal memperbarui status akun.', 'Gagal');
      }
    } catch (err: any) {
      toast.error(err.message || 'Kesalahan jaringan.', 'Gagal');
    }
  };

  const resetCreateForm = () => {
    setCreateName('');
    setCreateUsername('');
    setCreateEmail('');
    setCreateAltEmail('');
    setCreatePhone('');
    setCreateRole('dispatch');
    setCreateContractor('');
    setCreateArea('');
    setCreatePassword('');
    setCreateConfirmPassword('');
    setCreateInitialStatus('active');
    setShowCreatePassword(false);
    setShowCreateConfirmPassword(false);
    setCreateError(null);
  };

  const handleOpenCreateModal = () => {
    setCreateError(null);
    setIsCreateModalOpen(true);
  };

  const handleAutoGenerateUsername = () => {
    const base = createName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const rolePrefix =
      createRole === 'super_admin'
        ? 'sa'
        : createRole === 'dispatch'
        ? 'dp'
        : createRole === 'leader'
        ? 'ld'
        : 'tk';
    let candidate = base || `mj_${rolePrefix}_${Math.floor(100 + Math.random() * 900)}`;
    if (users.some(u => u.username.toLowerCase() === candidate)) {
      candidate = `${candidate}_${Math.floor(10 + Math.random() * 90)}`;
    }
    setCreateUsername(candidate);
    if (!createEmail.trim()) {
      setCreateEmail(`${candidate.replace(/_/g, '.')}@morajaws.id`);
    }
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const cleanName = createName.trim();
    const cleanUsername = createUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const cleanEmail = createEmail.trim().toLowerCase();

    if (!cleanName || !cleanUsername || !cleanEmail) {
      setCreateError('Nama lengkap, username unik, dan alamat email resmi wajib diisi.');
      return;
    }
    const createPwdPolicy = validateStrongPasswordClient(createPassword, {
      username: cleanUsername,
      email: cleanEmail,
      name: cleanName
    });
    if (!createPwdPolicy.valid) {
      setCreateError(createPwdPolicy.error || 'Kata sandi awal belum memenuhi standar keamanan.');
      return;
    }
    if (createPassword !== createConfirmPassword) {
      setCreateError('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    const hideScopeFields = isCentralOpsRole(createRole);

    if ((createRole === 'leader' || createRole === 'installer') && !createContractor.trim()) {
      setCreateError('Vendor Mitra / Kontraktor wajib dipilih untuk role Leader Area atau Teknisi / Installer.');
      return;
    }

    const matchedContractor = !hideScopeFields
      ? contractors.find(
          c => c.name.trim().toLowerCase() === createContractor.trim().toLowerCase()
        )
      : undefined;

    if (
      (createRole === 'leader' || createRole === 'installer') &&
      contractors.length > 0 &&
      !matchedContractor
    ) {
      setCreateError('Pilih nama Kontraktor / Vendor yang terdaftar melalui kolom pencarian.');
      return;
    }

    setIsCreatingUser(true);
    try {
      const res = await adminCreateUser({
        name: cleanName,
        username: cleanUsername,
        email: cleanEmail,
        altEmail: createAltEmail.trim() || undefined,
        phone: createPhone.trim() || undefined,
        role: createRole,
        contractor: hideScopeFields ? undefined : createContractor.trim() || undefined,
        contractorId: matchedContractor?.id,
        area: hideScopeFields ? undefined : createArea.trim() || undefined,
        password: createPassword
      });

      if (res.ok && res.data?.success) {
        const createdUserId = res.data?.user?.id;
        if (createInitialStatus === 'inactive' && createdUserId) {
          await adminUpdateUserStatus(createdUserId, 'inactive', 'Status awal ditahan oleh Superadmin saat pendaftaran');
        }
        toast.success(
          `Akun ${cleanName} (${createRole}) berhasil dibuat di Supabase PostgreSQL!`,
          'Pendaftaran Sukses'
        );
        triggerNotice(
          'success',
          `Akun baru ${cleanName} (@${cleanUsername}) berhasil didaftarkan ke Supabase PostgreSQL (${
            createInitialStatus === 'inactive' ? 'Status: Nonaktif' : 'Status: Aktif'
          }).`
        );
        resetCreateForm();
        setIsCreateModalOpen(false);
        await refreshDatabaseData?.();
      } else {
        const msg = res.data?.error || 'Gagal membuat akun pengguna.';
        setCreateError(msg);
        toast.error(msg, 'Pendaftaran Gagal');
      }
    } catch (err: any) {
      setCreateError(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const [sortState, setSortState] = useState<SortState>({ column: null, direction: null });

  const handleSort = (colKey: string) => {
    setSortState(prev => {
      const nextDir = getNextSortDirection(prev.column, prev.direction, colKey);
      return { column: nextDir ? colKey : null, direction: nextDir };
    });
  };

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;

      if (statusFilter !== 'ALL') {
        const locked = isUserLocked(u);
        if (statusFilter === 'locked' && !locked) return false;
        if (statusFilter === 'active' && (locked || !u.active)) return false;
        if (statusFilter === 'inactive' && (locked || u.active)) return false;
      }

      if (areaVendorFilter !== 'ALL') {
        if (areaVendorFilter.startsWith('area:')) {
          const targetArea = areaVendorFilter.slice(5).toLowerCase();
          if (String(u.area || '').trim().toLowerCase() !== targetArea) return false;
        } else if (areaVendorFilter.startsWith('vendor:')) {
          const targetVendor = areaVendorFilter.slice(7).toLowerCase();
          if (String(u.contractor || '').trim().toLowerCase() !== targetVendor) return false;
        }
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = String(u.name || '').toLowerCase().includes(q);
        const matchesUser = String(u.username || '').toLowerCase().includes(q);
        const matchesUserId = String(u.userId || u.id || '').toLowerCase().includes(q);
        const matchesEmail = String(u.email || '').toLowerCase().includes(q);
        const matchesPhone = String(u.phone || '').toLowerCase().includes(q);
        const matchesContractor = String(u.contractor || '').toLowerCase().includes(q);
        const matchesArea = String(u.area || '').toLowerCase().includes(q);
        if (
          !matchesName &&
          !matchesUser &&
          !matchesUserId &&
          !matchesEmail &&
          !matchesPhone &&
          !matchesContractor &&
          !matchesArea
        ) {
          return false;
        }
      }

      if (contactSearchQuery.trim()) {
        const cq = contactSearchQuery.toLowerCase().trim();
        const mEmail = String(u.email || '').toLowerCase().includes(cq);
        const mPhone = String(u.phone || '').toLowerCase().includes(cq);
        if (!mEmail && !mPhone) return false;
      }
      return true;
    });
  }, [users, roleFilter, statusFilter, areaVendorFilter, searchQuery, contactSearchQuery]);

  const sortedUsers = useMemo(() => {
    return sortDataArray(filteredUsers, sortState, (u: UserType, col: string) => {
      if (col === 'name') return u.name;
      if (col === 'username') return u.email || u.username;
      if (col === 'role') return u.role;
      if (col === 'contractor') return `${u.area || ''} ${u.contractor || ''}`.trim() || null;
      if (col === 'phone') return u.phone || null;
      if (col === 'active') return isUserLocked(u) ? 2 : u.active ? 1 : 0;
      if (col === 'lastLogin') return u.lastLoginAt || null;
      return (u as any)[col];
    });
  }, [filteredUsers, sortState]);

  useEffect(() => {
    setCurrentPage(1);
  }, [roleFilter, statusFilter, areaVendorFilter, searchQuery, contactSearchQuery]);

  const effectivePageSize = pageSize === -1 ? Math.max(1, sortedUsers.length) : pageSize;
  const totalPages = Math.max(1, Math.ceil(sortedUsers.length / effectivePageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedUsers = useMemo(() => {
    if (pageSize === -1) return sortedUsers;
    const start = (safeCurrentPage - 1) * pageSize;
    return sortedUsers.slice(start, start + pageSize);
  }, [sortedUsers, safeCurrentPage, pageSize]);

  const handleExportUsersXlsx = () => {
    if (sortedUsers.length === 0) {
      toast.warning('Tidak ada daftar user yang sesuai filter untuk diekspor.', 'Data Kosong');
      return;
    }
    const rows = sortedUsers.map((u, idx) => ({
      'No': idx + 1,
      'ID User': u.userId || u.id,
      'Nama Lengkap': u.name,
      'Username': `@${u.username}`,
      'Email': u.email || '-',
      'No. WhatsApp': u.phone || '-',
      'Role': u.role,
      'Mitra / Kontraktor': u.contractor || '-',
      'Area / Basecamp': u.area || '-',
      'Status Akun': isUserLocked(u) ? 'Terkunci' : u.active ? 'Aktif' : 'Nonaktif',
      'Login Terakhir': u.lastLoginAt
        ? new Date(u.lastLoginAt).toLocaleString('id-ID')
        : 'Belum login',
      'IP Terakhir': u.lastLoginIp || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Daftar_User_MoraJaws');
    const fileName = `MoraJaws_Daftar_User_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast.success(`Berhasil mengekspor ${rows.length} akun pengguna ke ${fileName}.`, 'Export Daftar User');
  };

  const handleFocusFilters = () => {
    setIsCreateModalOpen(false);
    setTimeout(() => {
      tableContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'super_admin':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold text-[10.5px] bg-gradient-to-b from-[#6657C8] to-[#5145A6] dark:from-[#6d28d9] dark:to-[#58149C] text-white shadow-[0_1.5px_0_#3F3589] dark:shadow-[0_1.5px_0_#35105E] whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-white" />
            Superadmin
          </span>
        );
      case 'dispatch':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold text-[10.5px] bg-[#2E7D8B] text-white dark:bg-[#6A46C1] shadow-[0_1.5px_0_#1E5963] dark:shadow-[0_1.5px_0_#2c0051] whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#DDF4F4] dark:bg-[#DAB9FF]" />
            Dispatch
          </span>
        );
      case 'leader':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold text-[10.5px] bg-[#EAE8FF] text-[#5145A6] border border-[#C5BEEF] dark:bg-[#7b1eca] dark:text-white dark:border-transparent dark:shadow-[0_1.5px_0_#35105E] whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5145A6] dark:bg-[#EEDBFF]" />
            Leader Area
          </span>
        );
      case 'installer':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold text-[10.5px] bg-[#DDF4F4] text-[#2E7D8B] border border-[#BDE4E8] dark:bg-[#2a174a] dark:text-[#DAB9FF] dark:border-[#5B35B1] whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2E7D8B] dark:bg-[#DAB9FF]" />
            Installer
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold text-[10.5px] bg-[#EDF3F8] text-[#52647A] dark:bg-[#261942] dark:text-[#CABDE8] whitespace-nowrap">
            {role}
          </span>
        );
    }
  };

  if (currentUser.role !== 'super_admin') {
    return (
      <div className="card-3d-lavender rounded-2xl p-8 text-center max-w-lg mx-auto space-y-4 my-8">
        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/60 text-[#BA1A1A] dark:text-rose-300 rounded-2xl flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="font-display font-extrabold text-[#26364A] dark:text-white text-base">
          Akses Ditolak: Khusus Superadmin
        </h3>
        <p className="text-xs text-[#52647A] dark:text-[#CABDE8] leading-relaxed">
          Menu Manajemen User &amp; Hak Akses hanya dapat diakses oleh akun dengan peran <strong>Superadmin</strong>.
        </p>
        <div className="p-3 bg-[#F4F7FB] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] rounded-xl text-xs text-[#52647A] dark:text-[#CABDE8] font-medium">
          Akun Anda: <span className="font-bold capitalize text-[#26364A] dark:text-white">{currentUser.name} ({currentUser.role})</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Stitch Header Card */}
      <div className="card-3d-lavender rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2 min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-[#EAE8FF] text-[#5145A6] border border-[#C5BEEF] dark:bg-gradient-to-b dark:from-[#6b103b] dark:to-[#480123] dark:text-white dark:border-transparent dark:shadow-[0_2px_0_#260112] whitespace-nowrap">
                SUPERADMIN ONLY
              </span>
              <span className="font-mono text-[11px] font-bold tracking-wider uppercase text-[#52647A] dark:text-[#CABDE8]">
                MORAJAWS OPS COMMAND • RBAC DIRECTORY
              </span>
            </div>

            <h2 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-[#26364A] dark:text-white">
              Management User &amp; Hak Akses
            </h2>

            <p className="text-xs text-[#52647A] dark:text-[#CABDE8] max-w-2xl leading-relaxed">
              Kelola akun superadmin, dispatcher, leader area, dan teknisi lapangan FTTH beserta otorisasi akses sistem pada Supabase PostgreSQL.
            </p>
          </div>

          {/* 4 3D Tactile Command Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 shrink-0 lg:w-[400px]">
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="btn-3d-primary min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <UserPlus className="w-4 h-4 shrink-0" />
              <span>+ Tambah User Baru</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (onOpenRolesTab) {
                  onOpenRolesTab();
                } else {
                  toast.info('Buka tab Role & Permission di Setup Terpusat untuk mengatur matriks RBAC.', 'Navigasi RBAC');
                }
              }}
              className="btn-3d-darkpurple min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Shield className="w-4 h-4 shrink-0 text-[#DAB9FF]" />
              <span>Konfigurasi Role RBAC</span>
            </button>

            <button
              type="button"
              onClick={handleFocusFilters}
              className="btn-3d-lilac min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <SlidersHorizontal className="w-4 h-4 shrink-0" />
              <span>Filter Role &amp; Area</span>
            </button>

            <button
              type="button"
              onClick={handleExportUsersXlsx}
              className="btn-3d-primary min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>Export Daftar User</span>
            </button>

            <button
              type="button"
              onClick={() => setIsMassResetOpen(true)}
              className="sm:col-span-2 btn-3d-amber min-h-[42px] px-4 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer"
            >
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>Reset Sandi Massal (Batch Aman)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Notice Banner */}
      {notice && (
        <div
          className={`p-3.5 rounded-2xl border flex items-center gap-2.5 text-xs animate-in fade-in duration-200 ${
            notice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
          }`}
        >
          {notice.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span className="font-semibold">{notice.text}</span>
        </div>
      )}

      {/* 5-Card KPI Bento Row (Real Live Stats, Clickable Filters) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Card 1: Total User Aktif (Hero Aqua-Lavender in Light Mode, Deep Purple in Night Mode) */}
        <button
          type="button"
          onClick={() => {
            setRoleFilter('ALL');
            setStatusFilter('active');
          }}
          className="text-left rounded-2xl p-4 bg-gradient-to-br from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] text-[#26364A] border border-[#C5BEEF] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_4px_0_#D2DAEA,0_12px_24px_-6px_rgba(38,54,74,0.12)] dark:from-[#6d28d9] dark:via-[#58149C] dark:to-[#35105E] dark:text-white dark:border-[#8b5cf6]/40 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_5px_0_#240c45,0_14px_24px_-6px_rgba(53,16,94,0.35)] hover:brightness-105 active:translate-y-0.5 transition-all cursor-pointer flex flex-col justify-between min-h-[126px]"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#EEDBFF] leading-tight">
              TOTAL USER AKTIF
            </span>
            <span className="w-8 h-8 rounded-xl bg-white/75 border border-[#C5BEEF] dark:bg-white/15 dark:border-white/20 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4 text-[#5145A6] dark:text-white" />
            </span>
          </div>

          <div className="flex items-end justify-between gap-2 my-1">
            <span className="font-display text-3xl font-extrabold tabular-nums leading-none">
              {userStats.activeCount}
            </span>
            <svg viewBox="0 0 82 32" className="w-16 h-7 shrink-0 overflow-visible" aria-hidden="true">
              <polyline
                fill="none"
                stroke="currentColor"
                className="text-[#5145A6] dark:text-[#DAB9FF]"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={userStats.sparklinePoints}
              />
            </svg>
          </div>

          <div className="text-[11px] font-medium text-[#52647A] dark:text-[#EEDBFF]">
            {userStats.recentNewCount > 0
              ? `+${userStats.recentNewCount} akun baru minggu ini`
              : `${userStats.total} total akun terdaftar`}
          </div>
        </button>

        {/* Card 2: Superadmin */}
        <button
          type="button"
          onClick={() => {
            setRoleFilter(roleFilter === 'super_admin' ? 'ALL' : 'super_admin');
            setStatusFilter('ALL');
          }}
          className={`card-3d-lavender text-left rounded-2xl p-4 transition-all cursor-pointer flex flex-col justify-between min-h-[126px] ${
            roleFilter === 'super_admin' ? 'ring-2 ring-[#6657C8] dark:ring-[#DAB9FF]' : 'hover:border-[#9FAEE0] dark:hover:border-[#a78bfa]'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CABDE8]">
              SUPERADMIN
            </span>
            <span className="w-8 h-8 rounded-xl bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 my-1">
            <span className="font-display text-3xl font-extrabold tabular-nums text-[#26364A] dark:text-white leading-none">
              {userStats.byRole.super_admin}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold font-mono tabular-nums bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#DAB9FF]">
              {userStats.pct(userStats.byRole.super_admin)}
            </span>
          </div>

          <div className="text-[11px] text-[#52647A] dark:text-[#CABDE8]">
            Otoritas penuh sistem
          </div>
        </button>

        {/* Card 3: Dispatch */}
        <button
          type="button"
          onClick={() => {
            setRoleFilter(roleFilter === 'dispatch' ? 'ALL' : 'dispatch');
            setStatusFilter('ALL');
          }}
          className={`card-3d-lavender text-left rounded-2xl p-4 transition-all cursor-pointer flex flex-col justify-between min-h-[126px] ${
            roleFilter === 'dispatch' ? 'ring-2 ring-[#6657C8] dark:ring-[#DAB9FF]' : 'hover:border-[#9FAEE0] dark:hover:border-[#a78bfa]'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CABDE8]">
              DISPATCH
            </span>
            <span className="w-8 h-8 rounded-xl bg-[#DDF4F4] dark:bg-[#2e1459] text-[#2E7D8B] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
              <Radio className="w-4 h-4" />
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 my-1">
            <span className="font-display text-3xl font-extrabold tabular-nums text-[#26364A] dark:text-white leading-none">
              {userStats.byRole.dispatch}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold font-mono tabular-nums bg-[#DDF4F4] text-[#2E7D8B] dark:bg-[#35105E] dark:text-[#DAB9FF]">
              {userStats.pct(userStats.byRole.dispatch)}
            </span>
          </div>

          <div className="text-[11px] text-[#52647A] dark:text-[#CABDE8]">
            NOC &amp; Routing WO
          </div>
        </button>

        {/* Card 4: Leader Area */}
        <button
          type="button"
          onClick={() => {
            setRoleFilter(roleFilter === 'leader' ? 'ALL' : 'leader');
            setStatusFilter('ALL');
          }}
          className={`card-3d-lavender text-left rounded-2xl p-4 transition-all cursor-pointer flex flex-col justify-between min-h-[126px] ${
            roleFilter === 'leader' ? 'ring-2 ring-[#6657C8] dark:ring-[#DAB9FF]' : 'hover:border-[#9FAEE0] dark:hover:border-[#a78bfa]'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CABDE8]">
              LEADER AREA
            </span>
            <span className="w-8 h-8 rounded-xl bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 my-1">
            <span className="font-display text-3xl font-extrabold tabular-nums text-[#26364A] dark:text-white leading-none">
              {userStats.byRole.leader}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold font-mono tabular-nums bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#DAB9FF]">
              {userStats.pct(userStats.byRole.leader)}
            </span>
          </div>

          <div className="text-[11px] text-[#52647A] dark:text-[#CABDE8]">
            Koordinator Basecamp
          </div>
        </button>

        {/* Card 5: Teknisi / Installer */}
        <button
          type="button"
          onClick={() => {
            setRoleFilter(roleFilter === 'installer' ? 'ALL' : 'installer');
            setStatusFilter('ALL');
          }}
          className={`card-3d-lavender text-left rounded-2xl p-4 transition-all cursor-pointer flex flex-col justify-between min-h-[126px] ${
            roleFilter === 'installer' ? 'ring-2 ring-[#6657C8] dark:ring-[#DAB9FF]' : 'hover:border-[#9FAEE0] dark:hover:border-[#a78bfa]'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#CABDE8]">
              TEKNISI / INSTALLER
            </span>
            <span className="w-8 h-8 rounded-xl bg-[#DDF4F4] dark:bg-[#2e1459] text-[#2E7D8B] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
              <Wrench className="w-4 h-4" />
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 my-1">
            <span className="font-display text-3xl font-extrabold tabular-nums text-[#26364A] dark:text-white leading-none">
              {userStats.byRole.installer}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold font-mono tabular-nums bg-[#DDF4F4] text-[#2E7D8B] dark:bg-[#35105E] dark:text-[#DAB9FF]">
              {userStats.pct(userStats.byRole.installer)}
            </span>
          </div>

          <div className="text-[11px] text-[#52647A] dark:text-[#CABDE8]">
            Tim lapangan &amp; mitra
          </div>
        </button>
      </div>

      {/* Role & Tab Navigation Strip + Lock Filter Chip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="mj-tactile-tab-bar p-1.5 inline-flex items-center gap-1.5 self-start overflow-x-auto no-scrollbar max-w-full">
          <button
            type="button"
            onClick={() => setIsCreateModalOpen(false)}
            className="btn-3d-primary font-bold px-3.5 py-2 min-h-[38px] rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-all whitespace-nowrap"
          >
            <Users className="w-3.5 h-3.5" />
            <span>Direktori User ({users.length})</span>
          </button>

          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="text-[#52647A] dark:text-[#CABDE8] font-semibold hover:bg-white/70 dark:hover:bg-[#261942] px-3.5 py-2 min-h-[38px] rounded-lg text-xs flex items-center gap-1.5 cursor-pointer transition-all whitespace-nowrap"
          >
            <UserPlus className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
            <span>Tambah User Baru (4 Role)</span>
          </button>
        </div>

        {/* Lock Quick Filter Chip */}
        <div className="flex flex-wrap items-center gap-2 text-xs">

          <button
            type="button"
            onClick={() => {
              setStatusFilter(statusFilter === 'locked' ? 'ALL' : 'locked');
              setRoleFilter('ALL');
            }}
            className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer text-[11px] ${
              statusFilter === 'locked'
                ? 'btn-3d-amber'
                : 'tactile-chip text-[#52647A] dark:text-[#E9D5FF]'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Terkunci ({userStats.lockedCount})</span>
          </button>
        </div>
      </div>

      {/* USERS DIRECTORY LIST (Embedded Interactive Column Headers) */}
      <div className="space-y-4" ref={tableContainerRef}>
          {/* 8/4 Asymmetric Grid: User Directory Table (Left 8) + Live Operator & Area Insights (Right 4) */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            <div className="xl:col-span-8 card-3d-lavender rounded-2xl p-4 sm:p-5 space-y-4">
              <div className={`flex flex-col ${isCompactUI ? '' : 'sm:flex-row sm:items-center'} justify-between gap-2 pb-2 border-b border-[#E2E8F0] dark:border-[#3b1d78]`}>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  <h4 className="font-display font-bold text-[#26364A] dark:text-white text-sm">
                    Daftar User Terdaftar
                  </h4>
                </div>

              <span className="self-start sm:self-auto px-3 py-1 rounded-full text-[11px] font-bold font-mono tabular-nums bg-[#EDF3F8] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DDE6F0] dark:border-[#5b35b1]">
                Menampilkan {paginatedUsers.length} dari {sortedUsers.length} User
              </span>
            </div>

            <ResponsiveDataTable<UserType>
              data={paginatedUsers}
              getRowKey={u => u.id}
              sortKey={sortState.column}
              sortDirection={sortState.direction}
              onSort={handleSort}
              activeFilterCount={
                (searchQuery.trim() ? 1 : 0) +
                (contactSearchQuery.trim() ? 1 : 0) +
                (roleFilter !== 'ALL' ? 1 : 0) +
                (areaVendorFilter !== 'ALL' ? 1 : 0) +
                (statusFilter !== 'ALL' ? 1 : 0)
              }
              onResetFilters={() => {
                setRoleFilter('ALL');
                setStatusFilter('ALL');
                setAreaVendorFilter('ALL');
                setSearchQuery('');
                setContactSearchQuery('');
              }}
              mobileTitle={u => (
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[10.5px] font-extrabold shrink-0 ${
                      u.role === 'super_admin' || u.role === 'dispatch' || u.role === 'leader'
                        ? 'bg-[#6657C8] dark:bg-[#58149C] text-white'
                        : 'bg-[#DDF4F4] text-[#2E7D8B] dark:bg-[#35105E] dark:text-[#DAB9FF]'
                    }`}
                  >
                    {getUserInitials(u.name)}
                  </span>
                  <span>{u.name}</span>
                  {u.id === currentUser.id && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#DAB9FF] rounded font-bold">
                      Anda
                    </span>
                  )}
                </div>
              )}
              mobileSubtitle={u => `${u.userId || `@${u.username}`} · ${u.email || '-'}`}
              mobileStatus={u => {
                const locked = isUserLocked(u);
                return (
                  <>
                    {getRoleBadge(u.role)}
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        locked
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : u.active
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:border-transparent dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-rose-100 text-[#BA1A1A] dark:bg-rose-950 dark:text-rose-300'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          locked ? 'bg-amber-500' : u.active ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-[#BA1A1A]'
                        }`}
                      />
                      {locked ? 'Terkunci' : u.active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </>
                );
              }}
              columns={[
                {
                  key: 'name',
                  label: 'Nama & ID User',
                  priority: 'hidden_mobile',
                  sortable: true,
                  headerControl: {
                    kind: 'search',
                    value: searchQuery,
                    onChange: setSearchQuery,
                    placeholder: 'Cari Nama / Username / ID...'
                  },
                  render: u => {
                    const isDarkAvatar =
                      u.role === 'super_admin' || u.role === 'dispatch' || u.role === 'leader';
                    return (
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0 ${
                            isDarkAvatar
                              ? 'bg-gradient-to-b from-[#6657C8] to-[#5145A6] dark:from-[#7135B5] dark:to-[#58149C] text-white shadow-[0_2px_0_#3F3589] dark:shadow-[0_2px_0_#35105E]'
                              : 'bg-[#DDF4F4] text-[#2E7D8B] border border-[#BDE4E8] dark:bg-[#35105E] dark:text-[#DAB9FF] dark:border-[#5b35b1]'
                          }`}
                        >
                          {getUserInitials(u.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-[#26364A] dark:text-white flex items-center gap-1.5 flex-wrap">
                            <span>{u.name}</span>
                            {u.id === currentUser.id && (
                              <span className="text-[10px] px-1.5 py-0.2 bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#DAB9FF] rounded font-bold">
                                Anda
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-[#8492A5] dark:text-[#A79BC0]">
                            @{u.username}
                            {u.userId ? ` · ${u.userId}` : ''}
                          </div>
                        </div>
                      </div>
                    );
                  }
                },
                {
                  key: 'username',
                  label: 'Email & No. WhatsApp',
                  priority: 'hidden_mobile',
                  sortable: true,
                  headerControl: {
                    kind: 'search',
                    value: contactSearchQuery,
                    onChange: setContactSearchQuery,
                    placeholder: 'Cari Email / No. WA...'
                  },
                  render: u => (
                    <div className="space-y-0.5">
                      <div className="text-xs font-medium text-[#26364A] dark:text-[#F5EEFF]">
                        {u.email || '-'}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[#8492A5] dark:text-[#A79BC0]">
                        {u.phone || '-'}
                      </div>
                    </div>
                  )
                },
                {
                  key: 'role',
                  label: 'Role',
                  priority: 'hidden_mobile',
                  sortable: true,
                  headerControl: {
                    kind: 'select',
                    value: roleFilter,
                    defaultValue: 'ALL',
                    allLabel: `Semua Role (${users.length})`,
                    options: [
                      { value: 'super_admin', label: 'Superadmin', count: userStats.byRole.super_admin },
                      { value: 'dispatch', label: 'Dispatch', count: userStats.byRole.dispatch },
                      { value: 'leader', label: 'Leader Area', count: userStats.byRole.leader },
                      { value: 'installer', label: 'Installer / Teknisi', count: userStats.byRole.installer }
                    ],
                    onChange: setRoleFilter
                  },
                  render: u => getRoleBadge(u.role)
                },
                {
                  key: 'contractor',
                  label: 'Area / Basecamp Mitra',
                  priority: 'primary',
                  sortable: true,
                  headerControl: {
                    kind: 'select',
                    value: areaVendorFilter,
                    defaultValue: 'ALL',
                    allLabel: 'Semua Area / Vendor',
                    options: [
                      ...areaVendorOptions.areas.map(area => ({ value: `area:${area}`, label: `Area: ${area}` })),
                      ...areaVendorOptions.vendors.map(vendor => ({ value: `vendor:${vendor}`, label: `Mitra: ${vendor}` }))
                    ],
                    onChange: setAreaVendorFilter
                  },
                  render: u =>
                    isCentralOpsRole(u.role) ? (
                      <span className="text-[11px] font-semibold text-[#8492A5] dark:text-[#A79BC0]">
                        Akses Sistem Pusat
                      </span>
                    ) : (
                      <div>
                        <div className="font-bold text-[#26364A] dark:text-white text-xs">
                          {u.area || '-'}
                        </div>
                        <div className="text-[11px] text-[#8492A5] dark:text-[#A79BC0]">
                          {u.contractor || '-'}
                        </div>
                      </div>
                    )
                },
                {
                  key: 'active',
                  label: 'Status Akun',
                  priority: 'hidden_mobile',
                  sortable: true,
                  headerControl: {
                    kind: 'select',
                    value: statusFilter,
                    defaultValue: 'ALL',
                    allLabel: 'Semua Status Akun',
                    options: [
                      { value: 'active', label: 'Aktif', count: userStats.activeCount },
                      { value: 'inactive', label: 'Nonaktif', count: userStats.inactiveCount },
                      { value: 'locked', label: 'Terkunci', count: userStats.lockedCount }
                    ],
                    onChange: val => setStatusFilter(val as any)
                  },
                  render: u => {
                    const locked = isUserLocked(u);
                    return (
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold whitespace-nowrap ${
                          locked
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                            : u.active
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-rose-50 text-[#BA1A1A] dark:bg-rose-950/70 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            locked
                              ? 'bg-amber-500'
                              : u.active
                              ? 'bg-emerald-500 dark:bg-emerald-400'
                              : 'bg-[#BA1A1A]'
                          }`}
                        />
                        {locked ? 'Terkunci' : u.active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    );
                  }
                },
                {
                  key: 'lastLogin',
                  label: 'Login Terakhir',
                  priority: 'secondary',
                  sortable: true,
                  render: u =>
                    u.lastLoginAt ? (
                      <div>
                        <div className="text-[#52647A] dark:text-[#E9D5FF] font-mono tabular-nums text-[11px]">
                          {new Date(u.lastLoginAt).toLocaleString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}{' '}
                          WIB
                        </div>
                        {u.lastLoginIp && (
                          <div className="text-[10px] text-[#8492A5] dark:text-[#A79BC0] font-mono">
                            IP: {u.lastLoginIp}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-[#8492A5] dark:text-[#A79BC0] text-[11px]">Belum login</span>
                    )
                }
              ] as ResponsiveColumn<UserType>[]}
              getRowActions={u => {
                const locked = isUserLocked(u);
                const actions: DropdownActionItem[] = [
                  {
                    id: 'edit',
                    label: 'Edit Profil Pengguna',
                    icon: <Edit2 className="w-3.5 h-3.5" />,
                    onClick: () => handleOpenEdit(u)
                  },
                  {
                    id: 'reset',
                    label: 'Reset Password',
                    icon: <KeyRound className="w-3.5 h-3.5" />,
                    onClick: () => handleOpenResetModal(u)
                  }
                ];

                if (u.id !== currentUser.id) {
                  actions.push({
                    id: 'status',
                    label: locked ? 'Buka Kunci Akun' : u.active ? 'Nonaktifkan Akun' : 'Aktifkan Akun',
                    icon: locked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />,
                    onClick: () => handleToggleStatus(u, locked ? 'unlocked' : undefined)
                  });
                  actions.push({
                    id: 'revoke',
                    label: 'Akhiri Seluruh Sesi',
                    icon: <LogOut className="w-3.5 h-3.5" />,
                    onClick: () => setRevokeModalUser(u)
                  });
                  actions.push({
                    id: 'delete',
                    label: 'Hapus Akun',
                    icon: <Trash2 className="w-3.5 h-3.5" />,
                    tone: 'danger',
                    onClick: () => setUserToDelete(u)
                  });
                }

                return actions;
              }}
              desktopActionHeader="Aksi"
              renderDesktopActions={u => {
                const locked = isUserLocked(u);
                return (
                  <div className="flex items-center justify-end gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(u)}
                      className="btn-3d-lilac px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      title="Edit Profil Pengguna"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>Edit</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenResetModal(u)}
                      className="btn-3d-ceramic px-2.5 py-1 rounded-lg text-[11px] font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1 cursor-pointer"
                      title="Reset Password Akun (Superadmin Exclusive)"
                    >
                      <KeyRound className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                      <span>Reset</span>
                    </button>

                    {u.id !== currentUser.id && (
                      <>
                        {locked ? (
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(u, 'unlocked')}
                            className="btn-3d-amber px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                            title="Buka Kunci Akun"
                          >
                            <Unlock className="w-3 h-3" />
                            <span>Buka</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(u)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                              u.active
                                ? 'btn-3d-ceramic text-[#BA1A1A] dark:text-rose-300'
                                : 'btn-3d-emerald'
                            }`}
                            title={u.active ? 'Nonaktifkan Akun' : 'Aktifkan Akun'}
                          >
                            {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setRevokeModalUser(u)}
                          className="btn-3d-icon px-2 py-1 text-[11px] font-bold gap-1 cursor-pointer"
                          title="Akhiri Seluruh Sesi Aktif Pengguna"
                        >
                          <LogOut className="w-3 h-3 text-[#BA1A1A] dark:text-rose-400" />
                          <span>Sesi</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setUserToDelete(u)}
                          className="btn-3d-crimson px-2 py-1 rounded-lg text-[11px] flex items-center cursor-pointer"
                          title="Hapus Akun Pengguna"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                );
              }}
              emptyState={{
                title: 'Tidak ada pengguna sesuai filter',
                description: 'Ubah kata kunci pencarian atau pilih filter role/area/status lain.'
              }}
              pagination={{
                currentPage: safeCurrentPage,
                totalPages,
                totalItems: sortedUsers.length,
                pageSize: pageSize === -1 ? 'ALL' : pageSize,
                onPageChange: setCurrentPage,
                onPageSizeChange: nextSize => {
                  setPageSize(nextSize === 'ALL' ? -1 : nextSize);
                  setCurrentPage(1);
                },
                pageSizeOptions: [5, 10, 20, 50, 'ALL'],
                itemLabel: 'akun'
              }}
            />
            </div>

            {/* RIGHT 4-COLUMN COMMAND & COVERAGE INSIGHTS */}
            <div className="xl:col-span-4 space-y-4">
              {/* Card 1: Crystal Mist Active Operators in Light Mode, Dark Purple-to-Maroon in Night Mode */}
              <div className="rounded-2xl p-5 bg-gradient-to-br from-[#EAE8FF] via-[#F8FAFD] to-[#DDF4F4] text-[#26364A] border border-[#C5BEEF] shadow-[0_12px_28px_-8px_rgba(38,54,74,0.12)] dark:from-[#160D29] dark:via-[#27104A] dark:to-[#480123] dark:text-white dark:border-[#7135B5]/45 dark:shadow-[0_12px_28px_-8px_rgba(35,9,59,0.5)] space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                      AKTIVITAS OPERATOR TERKINI
                    </div>
                    <h5 className="font-display font-extrabold text-sm text-[#26364A] dark:text-white mt-0.5">
                      Operator &amp; Teknisi Aktif
                    </h5>
                  </div>
                  <BadgeCheck className="w-5 h-5 text-[#2E7D8B] dark:text-[#DAB9FF] shrink-0" />
                </div>

                <div className="space-y-2">
                  {directoryInsights.activeTopOperators.length === 0 ? (
                    <div className="p-3 rounded-xl bg-white/75 border border-[#DDE6F0] dark:border-transparent dark:bg-white/10 text-xs text-[#52647A] dark:text-[#EEDBFF]">
                      Belum ada akun aktif tercatat.
                    </div>
                  ) : (
                    directoryInsights.activeTopOperators.map((op, idx) => (
                      <div
                        key={`top-op-${op.id}`}
                        className="p-2.5 rounded-xl bg-white/80 border border-[#DDE6F0] dark:bg-white/10 dark:border-white/10 flex items-center justify-between gap-2.5"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-[10.5px] font-mono font-extrabold text-[#5145A6] dark:text-[#DAB9FF] shrink-0">
                            #{idx + 1}
                          </span>
                          <div className="w-8 h-8 rounded-full bg-[#6657C8] border border-[#C5BEEF] dark:bg-[#58149C] dark:border-[#DAB9FF]/40 flex items-center justify-center text-[11px] font-extrabold text-white shrink-0">
                            {getUserInitials(op.name)}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[#26364A] dark:text-white truncate">{op.name}</div>
                            <div className="text-[10.5px] text-[#52647A] dark:text-[#EEDBFF]/80 truncate">
                              {!isCentralOpsRole(op.role) && op.area ? `${op.area} · ` : ''}
                              {op.role.replace('_', ' ')}
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#EDF3F8] text-[#5145A6] dark:bg-white/15 dark:text-[#DAB9FF] shrink-0">
                          {op.lastLoginAt
                            ? new Date(op.lastLoginAt).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit'
                              })
                            : 'Aktif'}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {/* Live Role Composition */}
                <div className="pt-3 border-t border-[#DDE6F0] dark:border-white/15 space-y-2">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                    KOMPOSISI PERAN RBAC ({userStats.total} AKUN)
                  </div>
                  {[
                    { label: 'Installer', count: userStats.byRole.installer },
                    { label: 'Leader Area', count: userStats.byRole.leader },
                    { label: 'Dispatch', count: userStats.byRole.dispatch },
                    { label: 'Superadmin', count: userStats.byRole.super_admin }
                  ].map(item => {
                    const ratio = userStats.total > 0 ? Math.round((item.count / userStats.total) * 100) : 0;
                    return (
                      <div key={item.label} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[#52647A] dark:text-[#EEDBFF] font-medium">{item.label}</span>
                          <span className="font-mono font-bold text-[#26364A] dark:text-white tabular-nums">
                            {item.count} ({ratio}%)
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[#DDE6F0] dark:bg-white/15 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#5145A6] to-[#2E7D8B] dark:from-[#DAB9FF] dark:to-[#A855F7]"
                            style={{ width: `${ratio}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Card 2: Sebaran Sektor Aktif + SVG Sparkline */}
              <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#D8B4FE]">
                      SEBARAN SEKTOR AKTIF
                    </div>
                    <h5 className="font-display font-extrabold text-sm text-[#26364A] dark:text-white">
                      Cakupan Area &amp; Basecamp
                    </h5>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#DDF4F4] text-[#2E7D8B] dark:bg-[#2E1459] dark:text-[#DAB9FF]">
                    {areaVendorOptions.areas.length} Area
                  </span>
                </div>

                <div className="space-y-2.5">
                  {directoryInsights.topAreas.map(areaItem => (
                    <div key={areaItem.name} className="mj-tactile-well p-2.5 rounded-xl space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-[#26364A] dark:text-white truncate">{areaItem.name}</span>
                        <span className="font-mono text-[11px] font-bold text-[#5145A6] dark:text-[#DAB9FF] shrink-0 tabular-nums">
                          {areaItem.active}/{areaItem.total} Aktif
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-[#E2E8F0] dark:bg-[#2E1459] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#5145A6] to-[#2E7D8B] dark:from-[#58149C] dark:to-[#7135B5]"
                          style={{ width: `${areaItem.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Real Activity SVG Sparkline */}
                <div className="pt-3 border-t border-[#E2E8F0] dark:border-[#3B1D78] flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#8492A5] dark:text-[#A493C2]">
                      JEJAK AKTIVITAS (7 HARI)
                    </div>
                    <div className="font-display text-xl font-extrabold text-[#26364A] dark:text-white tabular-nums mt-0.5">
                      {directoryInsights.activeLoginUsers}{' '}
                      <span className="text-xs font-semibold text-[#5145A6] dark:text-[#D8B4FE]">Akun Login</span>
                    </div>
                    <div className="text-[10.5px] text-[#8492A5] dark:text-[#A493C2]">
                      {directoryInsights.totalEvents7d} event audit &amp; sesi tercatat
                    </div>
                  </div>
                  <svg viewBox="0 0 120 34" className="w-28 h-9 shrink-0 overflow-visible" aria-hidden="true">
                    <polyline
                      fill="none"
                      stroke="currentColor"
                      className="text-[#5145A6] dark:text-[#58149C]"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={directoryInsights.activitySparkline}
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>
      </div>

      {/* STITCH HIGH-PRECISION CENTERED MODAL: TAMBAH AKUN USER BARU (4 ROLES) */}
      {isCreateModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{
              zIndex: createModalLayer.zIndex,
              ...(createModalVv.keyboardInset > 0 ? { paddingBottom: `${createModalVv.keyboardInset}px` } : {})
            }}
            className="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/45 dark:bg-[#0D0518]/75 backdrop-blur-[6px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-modal-title"
            onClick={e => {
              if (e.target === e.currentTarget && !isCreatingUser) {
                setIsCreateModalOpen(false);
              }
            }}
          >
            <div
              ref={createModalVv.containerRef}
              style={createModalVv.isKeyboardOpen ? { maxHeight: `${Math.max(280, createModalVv.viewportHeight - 16)}px` } : undefined}
              className="mj-sheet-enter relative w-full max-w-[700px] sm:my-auto bg-white dark:bg-[#1E1238] rounded-t-2xl sm:rounded-2xl shadow-[0_25px_60px_-12px_rgba(38,54,74,0.22),0_0_0_1px_rgba(197,190,239,0.55)] dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.72),0_0_0_1px_rgba(167,139,250,0.3)] overflow-hidden flex flex-col max-h-[94dvh]"
            >
            {/* Top Crystal Specular Rim Line */}
            <div className="h-1.5 w-full bg-gradient-to-r from-[#5145A6] via-[#2E7D8B] to-[#6657C8] dark:from-[#58149C] dark:via-[#A380FE] dark:to-[#58149C] shrink-0" />

            {/* Modal Header */}
            <div className="px-5 sm:px-7 pt-5 pb-4 bg-white dark:bg-[#1E1238] border-b border-[#E2E8F0] dark:border-[#35105E] flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF] text-[10px] tracking-wider uppercase font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-none border border-[#C5BEEF] dark:border-[#5B35B1]/50">
                    <ShieldCheck className="w-3 h-3 text-[#5145A6] dark:text-[#DAB9FF]" />
                    SUPERADMIN ACCESS ONLY
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#CBD5E1] dark:bg-[#5B35B1]" />
                  <span className="font-mono text-[10.5px] font-bold text-[#8492A5] dark:text-[#C5B3DF]">
                    RBAC 4-ROLE • SUPABASE AUTH
                  </span>
                </div>
                <h2
                  id="create-user-modal-title"
                  className="font-display text-lg sm:text-xl font-extrabold text-[#26364A] dark:text-white tracking-tight"
                >
                  Tambah Akun User Baru
                </h2>
                <p className="text-xs text-[#52647A] dark:text-[#CABDE8] mt-0.5">
                  Daftarkan akun superadmin, dispatcher, leader area, atau teknisi lapangan FTTH ke Supabase PostgreSQL.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!isCreatingUser) setIsCreateModalOpen(false);
                }}
                title="Tutup Modal"
                aria-label="Tutup Modal"
                className="btn-3d-icon w-11 h-11 min-w-[44px] min-h-[44px] sm:w-9 sm:h-9 sm:min-w-0 sm:min-h-0 shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body (Scrollable Form Fields) */}
            <form
              id="addUserStitchForm"
              onSubmit={handleCreateUserSubmit}
              className="px-5 sm:px-7 py-5 space-y-5 overflow-y-auto overscroll-contain min-h-0 flex-1 text-xs"
            >
              {createError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-2 text-rose-800 dark:text-rose-200 text-xs">
                  <AlertCircle className="w-4 h-4 text-[#BA1A1A] shrink-0" />
                  <span className="font-semibold">{createError}</span>
                </div>
              )}

              {/* SECTION A: Informasi Identitas & Kredensial */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10.5px] text-[#5145A6] dark:text-[#DAB9FF] uppercase tracking-widest font-extrabold flex items-center gap-1.5">
                    <span className="w-1.5 h-3.5 rounded-full bg-[#6657C8] dark:bg-[#A380FE]" />
                    Bagian A: Informasi Identitas &amp; Kredensial
                  </span>
                  <span className="text-[10.5px] font-semibold text-[#8492A5] dark:text-[#C5B3DF]">
                    Wajib Diisi (*)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Nama Lengkap */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-[#26364A] dark:text-white font-bold" htmlFor="stitch-fullName">
                      Nama Lengkap <span className="text-[#BA1A1A]">*</span>
                    </label>
                    <div className="relative">
                      <input
                        id="stitch-fullName"
                        type="text"
                        required
                        placeholder="Contoh: Bayu Saputra"
                        value={createName}
                        onChange={e => setCreateName(e.target.value)}
                        className="tactile-debossed-input w-full pl-3.5 pr-9 py-2.5 min-h-[42px] rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
                      />
                      <BadgeCheck className="w-4 h-4 text-[#8492A5] dark:text-[#A79BC0] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>

                  {/* Username Unik + Auto-generate */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs text-[#26364A] dark:text-white font-bold" htmlFor="stitch-username">
                        Username Login <span className="text-[#BA1A1A]">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleAutoGenerateUsername}
                        className="text-[11px] font-bold text-[#5145A6] dark:text-[#DAB9FF] hover:underline cursor-pointer"
                      >
                        Auto-generate
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        id="stitch-username"
                        type="text"
                        required
                        placeholder="Contoh: bayu_saputra"
                        value={createUsername}
                        onChange={e => setCreateUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                        className="tactile-debossed-input w-full pl-3.5 pr-9 py-2.5 min-h-[42px] rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white font-mono placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
                      />
                      <Fingerprint className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>

                  {/* Email Resmi */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-[#26364A] dark:text-white font-bold" htmlFor="stitch-email">
                      Alamat Email Resmi <span className="text-[#BA1A1A]">*</span>
                    </label>
                    <div className="relative">
                      <input
                        id="stitch-email"
                        type="email"
                        required
                        placeholder="bayu.saputra@morajaws.id"
                        value={createEmail}
                        onChange={e => setCreateEmail(e.target.value)}
                        className="tactile-debossed-input w-full pl-3.5 pr-9 py-2.5 min-h-[42px] rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
                      />
                      <Mail className="w-4 h-4 text-[#8492A5] dark:text-[#A79BC0] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>

                  {/* Nomor WhatsApp Aktif */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs text-[#26364A] dark:text-white font-bold" htmlFor="stitch-phone">
                        Nomor WhatsApp Aktif
                      </label>
                      {createPhone.replace(/\D/g, '').length >= 8 && (
                        <span className="text-[10.5px] text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          WA Ready
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        id="stitch-phone"
                        type="tel"
                        placeholder="+62 812-8899-2311"
                        value={createPhone}
                        onChange={e => setCreatePhone(e.target.value)}
                        className="tactile-debossed-input w-full pl-3.5 pr-9 py-2.5 min-h-[42px] rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white font-mono placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
                      />
                      <MessageCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>

                  {/* Email Pemulihan */}
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className="text-xs text-[#26364A] dark:text-white font-bold" htmlFor="stitch-altEmail">
                      Email Pemulihan / Alternatif (Opsional)
                    </label>
                    <input
                      id="stitch-altEmail"
                      type="email"
                      placeholder="ops.backup@gmail.com"
                      value={createAltEmail}
                      onChange={e => setCreateAltEmail(e.target.value)}
                      className="tactile-debossed-input w-full px-3.5 py-2.5 min-h-[42px] rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
                    />
                  </div>

                  {/* Kata Sandi Awal */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-[#26364A] dark:text-white font-bold" htmlFor="stitch-password">
                        Kata Sandi Awal <span className="text-[#BA1A1A]">*</span>
                      </label>
                      <span className="font-mono text-[10px] font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                        {createPassword.length}/{MAX_PASSWORD_LENGTH}
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        id="stitch-password"
                        type={showCreatePassword ? 'text' : 'password'}
                        required
                        maxLength={MAX_PASSWORD_LENGTH}
                        placeholder={`Maksimal ${MAX_PASSWORD_LENGTH} karakter`}
                        value={createPassword}
                        onChange={e => setCreatePassword(e.target.value.slice(0, MAX_PASSWORD_LENGTH))}
                        className="tactile-debossed-input w-full pl-3.5 pr-10 py-2.5 min-h-[42px] rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCreatePassword(!showCreatePassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
                        tabIndex={-1}
                        aria-label={showCreatePassword ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
                      >
                        {showCreatePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Konfirmasi Kata Sandi Awal */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-[#26364A] dark:text-white font-bold" htmlFor="stitch-confirmPassword">
                      Konfirmasi Kata Sandi <span className="text-[#BA1A1A]">*</span>
                    </label>
                    <div className="relative">
                      <input
                        id="stitch-confirmPassword"
                        type={showCreateConfirmPassword ? 'text' : 'password'}
                        required
                        maxLength={MAX_PASSWORD_LENGTH}
                        placeholder="Ketik ulang kata sandi"
                        value={createConfirmPassword}
                        onChange={e => setCreateConfirmPassword(e.target.value.slice(0, MAX_PASSWORD_LENGTH))}
                        className="tactile-debossed-input w-full pl-3.5 pr-10 py-2.5 min-h-[42px] rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCreateConfirmPassword(!showCreateConfirmPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
                        tabIndex={-1}
                        aria-label={showCreateConfirmPassword ? 'Sembunyikan konfirmasi sandi' : 'Lihat konfirmasi sandi'}
                      >
                        {showCreateConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                {createPassword && (() => {
                  const createPolicy = validateStrongPasswordClient(createPassword, {
                    username: createUsername,
                    email: createEmail,
                    name: createName
                  });
                  return (
                    <div className="mj-tactile-well p-3 border border-[#DDE6F0] dark:border-[#35105E] space-y-1.5 text-[11px]">
                      <span className="font-bold text-[#26364A] dark:text-white block">Validitas Kata Sandi (Maks. {MAX_PASSWORD_LENGTH} Karakter):</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {createPolicy.rules.map(rule => (
                          <div key={rule.id} className={`flex items-center gap-1.5 ${rule.passed ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-[#8492A5]'}`}>
                            {rule.passed ? <Check className="w-3.5 h-3.5 shrink-0" /> : <X className="w-3.5 h-3.5 shrink-0" />}
                            <span>{rule.label}</span>
                          </div>
                        ))}
                        <div className={`flex items-center gap-1.5 ${createPassword === createConfirmPassword && createConfirmPassword ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-[#8492A5]'}`}>
                          {createPassword === createConfirmPassword && createConfirmPassword ? <Check className="w-3.5 h-3.5 shrink-0" /> : <X className="w-3.5 h-3.5 shrink-0" />}
                          <span>Konfirmasi cocok</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* SECTION B: Peran Otorisasi (RBAC Role - 4 Official MoraJaws Roles) */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10.5px] text-[#5145A6] dark:text-[#DAB9FF] uppercase tracking-widest font-extrabold flex items-center gap-1.5">
                    <span className="w-1.5 h-3.5 rounded-full bg-[#6657C8] dark:bg-[#A380FE]" />
                    Bagian B: Peran Otorisasi (RBAC Role)
                  </span>
                  <span className="text-[10.5px] font-bold text-[#5145A6] dark:text-[#DAB9FF]">
                    Tingkat Hak Akses
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    {
                      role: 'super_admin' as UserRole,
                      title: 'Superadmin',
                      tier: 'Tier 0 (Root Level)',
                      desc: 'Kontrol penuh sistem, manajemen akun, audit log, & konfigurasi master.',
                      summaryTitle: 'SUPERADMIN',
                      summaryDesc: 'Hak akses penuh mencakup manajemen user & RBAC, setup hub, database sync, monitoring maps, serta verifikasi seluruh Work Order.',
                      icon: <Shield className="w-4 h-4" />,
                      iconBg: 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#3d0066] dark:text-white'
                    },
                    {
                      role: 'dispatch' as UserRole,
                      title: 'Dispatcher',
                      tier: 'Tier 1 (NOC Desk)',
                      desc: 'Distribusi Work Order, antrean verifikasi QC, LiveChat, & penanganan SLA.',
                      summaryTitle: 'DISPATCHER',
                      summaryDesc: 'Hak akses mencakup monitoring maps real-time, verification desk, jadwal & form sameday, LiveChat NOC, serta pemantauan SLA vendor.',
                      icon: <Radio className="w-4 h-4" />,
                      iconBg: 'bg-[#DDF4F4] dark:bg-[#2E1459] text-[#2E7D8B] dark:text-[#DAB9FF]'
                    },
                    {
                      role: 'leader' as UserRole,
                      title: 'Leader Area',
                      tier: 'Tier 2 (Coordinator)',
                      desc: 'Assign WO teknisi, approval kendala lapangan, & monitoring basecamp.',
                      summaryTitle: 'LEADER AREA',
                      summaryDesc: 'Hak akses mencakup monitoring klaster area, pembagian tugas harian untuk teknisi mitra, pendaftaran teknisi, serta rekapitulasi performa area.',
                      icon: <Users className="w-4 h-4" />,
                      iconBg: 'bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF]'
                    },
                    {
                      role: 'installer' as UserRole,
                      title: 'Teknisi / Installer',
                      tier: 'Tier 3 (Field App)',
                      desc: 'Akses tugas lapangan, check-in GPS, upload foto eviden & redaman OPM.',
                      summaryTitle: 'INSTALLER / TEKNISI',
                      summaryDesc: 'Hak akses khusus portal teknisi lapangan untuk menerima tugas WO terassign, update progress teknis, bukti foto OPM, dan LiveChat WO.',
                      icon: <Wrench className="w-4 h-4" />,
                      iconBg: 'bg-[#DDF4F4] dark:bg-[#2E1459] text-[#2E7D8B] dark:text-[#DAB9FF]'
                    }
                  ].map(item => {
                    const isSelected = createRole === item.role;
                    return (
                      <button
                        key={item.role}
                        type="button"
                        onClick={() => setCreateRole(item.role)}
                        className={`text-left relative p-3 rounded-xl transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#F4F7FB] dark:bg-[#2A174A] shadow-[0_4px_14px_rgba(81,69,166,0.14),0_0_0_2px_rgba(102,87,200,0.9)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.45),0_0_0_2px_#DAB9FF]'
                            : 'bg-white dark:bg-[#160D29] shadow-[0_1px_3px_rgba(38,54,74,0.06),0_0_0_1px_rgba(221,230,240,1)] dark:shadow-[0_0_0_1px_#35105E] hover:bg-[#F8FAFD] dark:hover:bg-[#231242]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 shadow-xs ${
                                isSelected
                                  ? 'bg-[#6657C8] dark:bg-[#58149C] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]'
                                  : item.iconBg
                              }`}
                            >
                              {item.icon}
                            </div>
                            <div className="min-w-0">
                              <span
                                className={`text-xs font-extrabold block leading-tight truncate ${
                                  isSelected ? 'text-[#5145A6] dark:text-[#DAB9FF]' : 'text-[#26364A] dark:text-white'
                                }`}
                              >
                                {item.title}
                              </span>
                              <span
                                className={`text-[10px] font-semibold block truncate ${
                                  isSelected ? 'text-[#2E7D8B] dark:text-[#C5B3DF]' : 'text-[#8492A5] dark:text-[#A79BC0]'
                                }`}
                              >
                                {item.tier}
                              </span>
                            </div>
                          </div>

                          <div
                            className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                              isSelected
                                ? 'bg-[#6657C8] dark:bg-[#DAB9FF] shadow-xs'
                                : 'bg-white dark:bg-[#1E1238] border border-[#CBD5E1] dark:border-[#5B35B1]'
                            }`}
                          >
                            {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-[#160D29]" />}
                          </div>
                        </div>
                        <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] mt-2 leading-snug">
                          {item.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* Dynamic RBAC Preview Box */}
                {(() => {
                  const roleMeta: Record<UserRole, { title: string; summary: string }> = {
                    super_admin: {
                      title: 'SUPERADMIN',
                      summary: 'Hak akses penuh mencakup manajemen user & RBAC, setup terpusat, sinkronisasi database/Google Sheets, monitoring maps, serta kendali penuh seluruh Work Order.'
                    },
                    dispatch: {
                      title: 'DISPATCHER',
                      summary: 'Hak akses mencakup distribusi & monitoring Work Order real-time, verification desk QC, jadwal sameday, LiveChat NOC, serta evaluasi SLA kontraktor.'
                    },
                    leader: {
                      title: 'LEADER AREA',
                      summary: 'Hak akses mencakup monitoring klaster area, pembagian tugas harian untuk teknisi regional, pendaftaran installer mitra, serta rekapitulasi performa area.'
                    },
                    installer: {
                      title: 'TEKNISI / INSTALLER',
                      summary: 'Hak akses portal lapangan mencakup penerimaan tugas WO terassign, check-in GPS, unggah foto eviden & redaman OPM, serta komunikasi LiveChat WO.'
                    }
                  };
                  const activeMeta = roleMeta[createRole];
                  const permCount = ROLE_PERMISSIONS[createRole]?.length || 0;
                  return (
                    <div className="mj-tactile-well p-3 rounded-xl border border-[#DDE6F0] dark:border-[#35105E] flex items-start gap-2.5">
                      <KeyRound className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[10.5px] text-[#5145A6] dark:text-[#DAB9FF] uppercase font-extrabold tracking-wide">
                            Ringkasan Hak Akses: {activeMeta.title}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DDE6F0] dark:border-[#5B35B1]/50">
                            {permCount} Izin Aktif
                          </span>
                        </div>
                        <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] leading-snug mt-0.5">
                          {activeMeta.summary}
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* SECTION C: Penempatan Wilayah & Kemitraan (Disembunyikan untuk Superadmin & Dispatch) */}
              {!isCentralOpsRole(createRole) && (
                <div className="space-y-3 pt-1">
                  <span className="text-[10.5px] text-[#5145A6] dark:text-[#DAB9FF] uppercase tracking-widest font-extrabold flex items-center gap-1.5">
                    <span className="w-1.5 h-3.5 rounded-full bg-[#6657C8] dark:bg-[#A380FE]" />
                    Bagian C: Penempatan Wilayah &amp; Kemitraan
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-[#26364A] dark:text-white font-bold">
                        Area / Cluster Regional {(createRole === 'leader' || createRole === 'installer') && <span className="text-[#BA1A1A]">*</span>}
                      </label>
                      <SearchableAreaDropdown
                        value={createArea}
                        onChange={setCreateArea}
                        areas={coverageAreas}
                        placeholder="Pilih atau cari area..."
                        required={createRole === 'leader' || createRole === 'installer'}
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-[#26364A] dark:text-white font-bold">
                        Vendor Mitra / Contractor {(createRole === 'leader' || createRole === 'installer') && <span className="text-[#BA1A1A]">*</span>}
                      </label>
                      <SearchableContractorDropdown
                        value={createContractor}
                        onChange={setCreateContractor}
                        contractors={contractors}
                        placeholder={
                          createRole === 'leader' || createRole === 'installer'
                            ? 'Cari & pilih nama kontraktor...'
                            : 'Cari & pilih mitra (opsional)...'
                        }
                        required={createRole === 'leader' || createRole === 'installer'}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION D: Status Awal Akun & Keamanan PostgreSQL */}
              <div className="mj-tactile-well p-4 rounded-xl border border-[#DDE6F0] dark:border-[#35105E] space-y-3">
                <div className="flex items-start sm:items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ShieldCheck className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-[#26364A] dark:text-white leading-tight">
                        Enkripsi Bcrypt &amp; Sinkronisasi Supabase PostgreSQL
                      </p>
                      <p className="text-[11px] text-[#8492A5] dark:text-[#C5B3DF]">
                        Akun disimpan langsung ke tabel pengguna dengan audit trail Superadmin aktif.
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-extrabold tracking-wider border border-emerald-200 dark:border-emerald-800/60">
                    DB AUTH READY
                  </span>
                </div>

                <div className="h-[1px] bg-[#E2E8F0] dark:bg-[#35105E] w-full" />

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <ToggleRight className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF]" />
                    <span className="text-xs font-bold text-[#26364A] dark:text-white">Status Awal Akun:</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="createInitialStatus"
                        value="active"
                        checked={createInitialStatus === 'active'}
                        onChange={() => setCreateInitialStatus('active')}
                        className="accent-[#5145A6] dark:accent-[#58149C] cursor-pointer"
                      />
                      <span className="text-xs font-bold text-[#26364A] dark:text-white">Langsung Aktif</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="createInitialStatus"
                        value="inactive"
                        checked={createInitialStatus === 'inactive'}
                        onChange={() => setCreateInitialStatus('inactive')}
                        className="accent-[#5145A6] dark:accent-[#58149C] cursor-pointer"
                      />
                      <span className="text-xs font-semibold text-[#8492A5] dark:text-[#C5B3DF]">Tahan / Nonaktif</span>
                    </label>
                  </div>
                </div>
              </div>
            </form>

            {/* Modal Footer (MoraJaws 3D Mechanical Action Buttons) */}
            <div className="px-5 sm:px-7 py-3.5 pb-[max(0.85rem,env(safe-area-inset-bottom))] bg-[#F4F7FB] dark:bg-[#160D29] border-t border-[#E2E8F0] dark:border-[#35105E] flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                disabled={isCreatingUser}
                onClick={resetCreateForm}
                className="btn-3d-ceramic w-full sm:w-auto px-3.5 py-2 min-h-[44px] sm:min-h-[40px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Form</span>
              </button>

              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:ml-auto w-full sm:w-auto">
                <button
                  type="button"
                  disabled={isCreatingUser}
                  onClick={() => setIsCreateModalOpen(false)}
                  className="btn-3d-lilac w-full sm:w-auto px-4 py-2 min-h-[44px] sm:min-h-[40px] rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  form="addUserStitchForm"
                  disabled={isCreatingUser}
                  className="btn-3d-darkpurple w-full sm:w-auto px-5 py-2 min-h-[44px] sm:min-h-[40px] rounded-xl text-xs font-extrabold tracking-wide flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <UserPlus className="w-4 h-4 text-[#EAE8FF] dark:text-[#DAB9FF]" />
                  <span>
                    {isCreatingUser
                      ? 'Mendaftarkan Akun...'
                      : createInitialStatus === 'inactive'
                      ? '+ Buat User (Nonaktif)'
                      : '+ Buat & Aktifkan User'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* REVOKE SESSIONS CONFIRMATION MODAL (No window.confirm) */}
      <ResponsiveModal
        isOpen={Boolean(revokeModalUser)}
        onClose={() => {
          if (!isRevoking) setRevokeModalUser(null);
        }}
        title="Akhiri Seluruh Sesi Aktif"
        subtitle={revokeModalUser ? `${revokeModalUser.name} (@${revokeModalUser.username})` : ''}
        icon={<LogOut className="w-5 h-5 text-[#BA1A1A]" />}
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-50"
        footer={
          <div className="w-full flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={isRevoking}
              onClick={() => setRevokeModalUser(null)}
              className="btn-3d-lilac min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={isRevoking}
              onClick={handleConfirmRevokeSessions}
              className="btn-3d-crimson min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{isRevoking ? 'Mencabut Sesi...' : 'Ya, Akhiri Seluruh Sesi'}</span>
            </button>
          </div>
        }
      >
        {revokeModalUser && (
          <div className="space-y-3 text-xs text-[#52647A] dark:text-[#CABDE8]">
            <p className="leading-relaxed">
              Seluruh token sesi login aktif milik <strong className="text-[#26364A] dark:text-white">{revokeModalUser.name}</strong>{' '}
              (<span className="font-mono">@{revokeModalUser.username}</span>) di semua perangkat akan dibatalkan seketika.
            </p>
            <div className="p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] text-[11px]">
              Pengguna harus memasukkan ulang kata sandi pada login berikutnya.
            </div>
          </div>
        )}
      </ResponsiveModal>

      {/* RESET PASSWORD MODAL (Superadmin Exclusive) */}
      <ResponsiveModal
        isOpen={Boolean(resetModalUser)}
        onClose={() => setResetModalUser(null)}
        title="Reset Password Pengguna"
        subtitle={resetModalUser ? `${resetModalUser.name} (@${resetModalUser.username})` : ''}
        icon={<KeyRound className="w-5 h-5 text-amber-600" />}
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-50"
      >
        {resetModalUser && (
          <div className="space-y-4">
            <div className="p-3 bg-[#F4F7FB] dark:bg-[#160d29] rounded-xl border border-[#DDE6F0] dark:border-[#3b1d78] space-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-[#8492A5]">Peran Akun:</span>
                <span className="font-bold text-[#26364A] dark:text-white">{resetModalUser.role}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#8492A5]">Email Akun:</span>
                <span className="font-mono text-[#26364A] dark:text-[#E9D5FF] truncate">{resetModalUser.email || '-'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#8492A5]">Terakhir Direset:</span>
                <span className="font-mono text-[#26364A] dark:text-[#E9D5FF] text-right">
                  {resetModalUser.passwordChangedAt ? new Date(resetModalUser.passwordChangedAt).toLocaleString('id-ID') : 'Belum pernah diubah'}
                </span>
              </div>
            </div>

            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl text-amber-800 dark:text-amber-300 text-[11px] leading-relaxed flex items-start justify-between gap-2 flex-wrap">
              <div className="flex items-start gap-2 flex-1 min-w-[200px]">
                <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Reset sandi langsung <strong>mencabut seluruh sesi aktif</strong> &amp; mewajibkan ganti sandi saat login. Atau terbitkan <strong>Token Reset 1x</strong> tanpa menyimpan sandi plaintext.
                </span>
              </div>
              <button
                type="button"
                disabled={issuingOneTimeToken}
                onClick={() => void handleIssueOneTimeResetToken()}
                className="btn-3d-lilac px-3 py-1.5 rounded-lg text-[11px] font-bold shrink-0 cursor-pointer disabled:opacity-50"
              >
                {issuingOneTimeToken ? 'Menerbitkan...' : 'Terbitkan Token 1x'}
              </button>
            </div>

            {issuedTokenResult && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs space-y-1.5">
                <div className="font-bold text-emerald-800 dark:text-emerald-200">
                  Token Reset Satu-Kali (Tampil Sekali Saja · Berlaku s.d. {new Date(issuedTokenResult.expiresAt).toLocaleString('id-ID')})
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#160D29] border border-emerald-200 dark:border-emerald-700 font-mono text-[11px] break-all text-[#26364A] dark:text-white">
                    {issuedTokenResult.token}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(issuedTokenResult.token);
                      toast.success('Token pemulihan disalin ke clipboard.', 'Disalin');
                    }}
                    className="btn-3d-primary px-3 py-1.5 rounded-lg text-[11px] font-bold shrink-0 cursor-pointer"
                  >
                    Salin
                  </button>
                </div>
              </div>
            )}

            {resetModalError && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 rounded-xl text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#BA1A1A] shrink-0" />
                <span>{resetModalError}</span>
              </div>
            )}

            <form onSubmit={handleResetPasswordSubmit} className="space-y-3 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[#26364A] dark:text-white font-bold">
                    Kata Sandi Baru <span className="text-[#BA1A1A]">*</span>
                  </label>
                  <span className="font-mono text-[10px] font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                    {newPassword.length}/{MAX_PASSWORD_LENGTH}
                  </span>
                </div>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    maxLength={MAX_PASSWORD_LENGTH}
                    placeholder={`Maksimal ${MAX_PASSWORD_LENGTH} karakter`}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value.slice(0, MAX_PASSWORD_LENGTH))}
                    className="tactile-debossed-input w-full min-h-[40px] pl-3 pr-10 py-2 bg-[#F4F7FB] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] rounded-xl text-[#26364A] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
                    tabIndex={-1}
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[#26364A] dark:text-white font-bold mb-1">
                  Konfirmasi Kata Sandi Baru <span className="text-[#BA1A1A]">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    maxLength={MAX_PASSWORD_LENGTH}
                    placeholder="Ketik ulang kata sandi baru"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value.slice(0, MAX_PASSWORD_LENGTH))}
                    className="tactile-debossed-input w-full min-h-[40px] pl-3 pr-10 py-2 bg-[#F4F7FB] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] rounded-xl text-[#26364A] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {newPassword && (() => {
                const policy = validateStrongPasswordClient(newPassword, {
                  username: resetModalUser.username,
                  email: resetModalUser.email,
                  name: resetModalUser.name
                });
                return (
                  <div className="p-2.5 bg-[#F4F7FB] dark:bg-[#160d29] rounded-xl border border-[#DDE6F0] dark:border-[#3b1d78] space-y-1 text-[11px]">
                    {policy.rules.map(rule => (
                      <div key={rule.id} className={`flex items-center gap-1.5 ${rule.passed ? 'text-emerald-600 font-medium' : 'text-[#8492A5]'}`}>
                        {rule.passed ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                        <span>{rule.label}</span>
                      </div>
                    ))}
                    <div className={`flex items-center gap-1.5 ${newPassword === confirmPassword && confirmPassword ? 'text-emerald-600 font-medium' : 'text-[#8492A5]'}`}>
                      {newPassword === confirmPassword && confirmPassword ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                      <span>Konfirmasi cocok</span>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0] dark:border-[#3b1d78]">
                <button
                  type="button"
                  onClick={() => setResetModalUser(null)}
                  className="btn-3d-lilac min-h-[40px] sm:min-h-[36px] px-4 py-2 rounded-xl font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isResetting}
                  className="btn-3d-amber min-h-[40px] sm:min-h-[36px] px-5 py-2 disabled:opacity-50 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>{isResetting ? 'Mereset...' : 'Simpan Kata Sandi Baru'}</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </ResponsiveModal>

      {/* EDIT USER MODAL */}
      <ResponsiveModal
        isOpen={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        title="Edit Profil Pengguna"
        subtitle="Ubah data staf dan peran hak akses di Supabase PostgreSQL."
        icon={<Edit2 className="w-5 h-5 text-[#5145A6] dark:text-[#DAB9FF]" />}
        size="md"
        mobileVariant="sheet"
        zIndexClass="z-50"
      >
        {editingUser && (
          <form onSubmit={handleSaveEditUser} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[#26364A] dark:text-white font-bold mb-1">
                  Nama Lengkap <span className="text-[#BA1A1A]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="tactile-debossed-input w-full min-h-[40px] px-3 py-2 bg-[#F4F7FB] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] rounded-xl text-[#26364A] dark:text-white"
                />
              </div>

              <div>
                <label className="block text-[#26364A] dark:text-white font-bold mb-1">
                  Username Unik <span className="text-[#BA1A1A]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editUsername}
                  onChange={e => setEditUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  className="tactile-debossed-input w-full min-h-[40px] px-3 py-2 bg-[#F4F7FB] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] rounded-xl text-[#26364A] dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-[#26364A] dark:text-white font-bold mb-1">
                  Peran / Role Pengguna
                </label>
                <select
                  value={editRole}
                  onChange={e => setEditRole(e.target.value as UserRole)}
                  disabled={editingUser.id === currentUser.id}
                  className="tactile-debossed-input w-full min-h-[40px] px-3 py-2 bg-[#F4F7FB] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] rounded-xl text-[#26364A] dark:text-white font-bold"
                >
                  <option value="super_admin">1. Superadmin</option>
                  <option value="dispatch">2. Dispatch</option>
                  <option value="leader">3. Leader Area</option>
                  <option value="installer">4. Installer</option>
                </select>
              </div>

              {!isCentralOpsRole(editRole) && (
                <>
                  <div>
                    <label className="block text-[#26364A] dark:text-white font-bold mb-1">
                      Mitra Kontraktor {(editRole === 'leader' || editRole === 'installer') && <span className="text-[#BA1A1A]">*</span>}
                    </label>
                    <SearchableContractorDropdown
                      value={editContractor}
                      onChange={setEditContractor}
                      contractors={contractors}
                      placeholder="Cari & pilih kontraktor..."
                      required={editRole === 'leader' || editRole === 'installer'}
                    />
                  </div>

                  <div>
                    <label className="block text-[#26364A] dark:text-white font-bold mb-1">
                      Coverage Area
                    </label>
                    <SearchableAreaDropdown
                      value={editArea}
                      onChange={setEditArea}
                      areas={coverageAreas}
                      placeholder="Pilih atau cari area..."
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-[#26364A] dark:text-white font-bold mb-1">
                  Nomor WhatsApp / Kontak
                </label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={e => setEditPhone(e.target.value)}
                  placeholder="0812xxxxxxxx"
                  className="tactile-debossed-input w-full min-h-[40px] px-3 py-2 bg-[#F4F7FB] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] rounded-xl text-[#26364A] dark:text-white font-mono"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[#26364A] dark:text-white font-bold mb-1">
                  Email Pengguna
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  placeholder="user@morajaws.id"
                  className="tactile-debossed-input w-full min-h-[40px] px-3 py-2 bg-[#F4F7FB] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] rounded-xl text-[#26364A] dark:text-white"
                />
              </div>

              <div className="sm:col-span-2 flex items-center justify-between p-3 bg-[#F4F7FB] dark:bg-[#160d29] rounded-xl border border-[#DDE6F0] dark:border-[#3b1d78]">
                <div className="pr-3">
                  <span className="font-bold text-[#26364A] dark:text-white">Status Akun Aktif</span>
                  <p className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0]">
                    Jika dinonaktifkan, seluruh sesi login akan dibatalkan dan pengguna tidak dapat login kembali.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={e => setEditActive(e.target.checked)}
                    disabled={editingUser.id === currentUser.id}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#CBD5E1] peer-focus:outline-hidden rounded-full peer dark:bg-[#342b4e] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#CBD5E1] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#6657C8] dark:peer-checked:bg-[#58149C]"></div>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0] dark:border-[#3b1d78]">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="btn-3d-lilac min-h-[40px] sm:min-h-[36px] px-4 py-2 rounded-xl font-bold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isUpdating}
                className="btn-3d-primary min-h-[40px] sm:min-h-[36px] px-5 py-2 disabled:opacity-50 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>{isUpdating ? 'Menyimpan...' : 'Simpan Perubahan'}</span>
              </button>
            </div>
          </form>
        )}
      </ResponsiveModal>

      {/* DELETE CONFIRMATION MODAL */}
      {userToDelete && (
        <SuperAdminDeleteModal
          isOpen={Boolean(userToDelete)}
          onClose={() => setUserToDelete(null)}
          targetType="user"
          targetId={userToDelete.id}
          targetLabel={`${userToDelete.name} (@${userToDelete.username})`}
          targetDetails={[
            { label: 'Role', value: userToDelete.role },
            { label: 'Kontraktor', value: userToDelete.contractor || '-' },
            { label: 'Telepon', value: userToDelete.phone || '-' },
            { label: 'Status Saat Ini', value: userToDelete.active ? 'Aktif' : 'Nonaktif' }
          ]}
          onSuccess={() => {
            triggerNotice('success', `Akun pengguna ${userToDelete.name} berhasil dihapus/diarsipkan.`);
            setUserToDelete(null);
          }}
        />
      )}
      {/* MASS PASSWORD RESET MODAL (SUPERADMIN ONLY) */}
      <MassPasswordResetPanel
        isOpen={isMassResetOpen}
        onClose={() => setIsMassResetOpen(false)}
        users={users}
        currentUser={currentUser}
        onCompleted={refreshDatabaseData}
      />
    </div>
  );
};
