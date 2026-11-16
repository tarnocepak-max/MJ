import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Ticket, TicketMessage, ChatAttachment, UserRole, ChatCategoryConfig } from '../../types';
import {
  MessageSquare,
  Search,
  Send,
  Shield,
  Wrench,
  CheckCheck,
  Check,
  Maximize2,
  X,
  AlertCircle,
  Settings,
  Plus,
  Trash2,
  Edit2,
  Inbox,
  Copy,
  ExternalLink,
  MoreVertical,
  MapPin,
  Router,
  Activity,
  User as UserIcon,
  Zap,
  Cloud,
  WifiOff,
  ArrowLeft,
  Camera,
  Paperclip,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  ShieldCheck,
  FileText,
  History,
  Phone,
  Flame,
  PanelRightClose,
  PanelRightOpen,
  Download,
  Info,
  ClipboardList
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { getSafePreviewUrl, formatFileSize } from '../../services/storageCompatibility';
import { buildGoogleMapsSearchUrl } from '../../services/mapsService';

export interface ContactCentreViewProps {
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
}

type TriageFilterMode = 'all' | 'unread' | 'urgent';

const QUICK_REPLIES_STAFF = [
  'Acc Redaman Normal',
  'Kirim Ulang Foto MAC/SN ONT',
  'Konfirmasi Pelanggan On-site',
  'Mohon Tunggu Sync OLT',
  'Pastikan kabel dropcore melewati clamp dengan rapi.'
];

const QUICK_REPLIES_INSTALLER = [
  'Teknisi sudah tiba di lokasi pelanggan.',
  'Pengecekan redaman OPM di FAT normal.',
  'Sedang proses penarikan dropcore & splicing roset.',
  'Pemasangan ONT selesai, siap verifikasi Dispatch.',
  'Kendala redaman tinggi / butuh koordinasi korlap.'
];

function formatWibTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return (
    d.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta'
    }) + ' WIB'
  );
}

function isTicketUrgent(t: Ticket): boolean {
  if (t.approvalStatus === 'BUTUH APPROVAL' || t.approvalStatus === 'REJECTED') return true;
  if (t.statusWhatsApp === 'reschedule_requested' || t.statusWhatsApp === 'unreachable') return true;
  if (t.appointmentType?.toLowerCase() === 'sameday') return true;
  const cat = (t.chatCategory || '').toUpperCase();
  if (
    cat.includes('KENDALA') ||
    cat.includes('ISSUE') ||
    cat.includes('RESCHEDULE') ||
    cat.includes('ESCALAT') ||
    cat.includes('ALAMAT')
  ) {
    return true;
  }
  return false;
}

export const ContactCentreView: React.FC<ContactCentreViewProps> = ({
  onSelectTicket,
  onOpenWhatsApp
}) => {
  const { isMobileView } = useUIConfig();
  const { isOnline, pendingCount } = useOfflineSync();
  const {
    tickets,
    currentUser,
    todayWIB,
    databaseStatus,
    syncStatus,
    contractorsList,
    ticketMessages,
    sendTicketMessage,
    markTicketMessagesAsRead,
    getMessagesForTicket,
    getTicketUnreadCount,
    chatCategories,
    addChatCategory,
    updateChatCategory,
    deleteChatCategory,
    toggleChatCategoryActive,
    setTicketChatCategory
  } = useApp();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [triageMode, setTriageMode] = useState<TriageFilterMode>('all');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('all');
  const [selectedContractorFilter, setSelectedContractorFilter] = useState<string>('all');
  const [selectedTicketId, setSelectedTicketId] = useState<string>('');
  const [mobilePane, setMobilePane] = useState<'queue' | 'chat'>('queue');
  const [isMobileCategoryDrawerOpen, setIsMobileCategoryDrawerOpen] = useState(false);

  const [inputText, setInputText] = useState('');
  const [composerCategory, setComposerCategory] = useState<string>('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedWo, setCopiedWo] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [isDetailPanelOpen, setIsDetailPanelOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1536 : false
  );

  // Settings Modal State for Super Admin / Dispatch
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ChatCategoryConfig | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#5B35B1');
  const [newCatDesc, setNewCatDesc] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isLeader = currentUser?.role === 'leader';
  const isInstaller = currentUser?.role === 'installer';
  const canManageCategories = currentUser?.role === 'super_admin' || currentUser?.role === 'dispatch';
  const canFilterContractor = currentUser?.role === 'super_admin' || currentUser?.role === 'dispatch';

  const activeCategories = useMemo(
    () => (chatCategories || []).filter(c => c.isActive !== false && (c as any).active !== false),
    [chatCategories]
  );

  // 1. Available tickets for current user role - STRICT TODAY WIB & INSTALLER ASSIGNMENT FILTER
  const availableTickets = useMemo(() => {
    return (tickets || []).filter(t => {
      if (!t || t.isArchived || t.isDeleted) return false;
      if (getTicketAppointmentDate(t) !== todayWIB) return false;

      // Strictly only tickets that have an assignment to an installer
      const hasInstallerAssignment = Boolean(
        (t.installerName && t.installerName.trim() && t.installerName.toLowerCase() !== 'unassigned') ||
          (t.installerId && t.installerId.trim()) ||
          (t.assignedToUid && t.assignedToUid.trim())
      );
      if (!hasInstallerAssignment) return false;

      // Role scoped access rules
      if (currentUser?.role === 'leader') {
        const cName = (t.contactorName || t.contractorName || '').toLowerCase().trim();
        const leaderContr = (currentUser.contractor || '').toLowerCase().trim();
        const matchContr =
          !leaderContr || cName === leaderContr || cName.includes(leaderContr) || leaderContr.includes(cName);

        const aName = (t.area || '').toLowerCase().trim();
        const leaderArea = (currentUser.area || '').toLowerCase().trim();
        const matchArea =
          !leaderArea || aName === leaderArea || aName.includes(leaderArea) || leaderArea.includes(aName);

        return matchContr && matchArea;
      }

      if (currentUser?.role === 'installer') {
        const myUid = currentUser?.id || '';
        const myUsername = (currentUser?.username || '').toLowerCase().trim();
        const myName = (currentUser?.name || '').toLowerCase().trim();
        const cleanMyName = myName.replace(/\(.*?\)/g, '').trim();

        if (myUid && (t.assignedToUid === myUid || t.installerId === myUid || t.assignedTo === myUid)) {
          return true;
        }
        if (
          myUsername &&
          ((t.assignedTo && t.assignedTo.toLowerCase().trim() === myUsername) ||
            (t.installerId && t.installerId.toLowerCase().trim() === myUsername))
        ) {
          return true;
        }
        const ticketInst = (t.installerName || '').toLowerCase().trim();
        return Boolean(
          ticketInst === myName ||
            ticketInst === cleanMyName ||
            (cleanMyName && ticketInst.includes(cleanMyName)) ||
            (cleanMyName && cleanMyName.includes(ticketInst))
        );
      }

      return true;
    });
  }, [tickets, currentUser, todayWIB]);

  // Unique contractor options for Super Admin / Dispatch partner filter
  const availableContractors = useMemo(() => {
    const names = new Set<string>();
    (contractorsList || []).forEach(c => {
      const trimmed = typeof c === 'string' ? c.trim() : '';
      if (trimmed) names.add(trimmed);
    });
    availableTickets.forEach(t => {
      const c = (t.contactorName || t.contractorName || '').trim();
      if (c) names.add(c);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [contractorsList, availableTickets]);

  // Contractor-scoped tickets
  const partnerScopedTickets = useMemo(() => {
    if (!canFilterContractor || selectedContractorFilter === 'all') return availableTickets;
    const target = selectedContractorFilter.toLowerCase().trim();
    return availableTickets.filter(t => {
      const c = (t.contactorName || t.contractorName || '').toLowerCase().trim();
      return c === target || c.includes(target);
    });
  }, [availableTickets, canFilterContractor, selectedContractorFilter]);

  // Search filter across customer name, WO, ID, installer, phone, AND chat message text
  const searchFilteredTickets = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return partnerScopedTickets;

    return partnerScopedTickets.filter(t => {
      const matchWo = (t.woNumber ? String(t.woNumber).toLowerCase() : '').includes(q);
      const matchCust = (t.customerName ? String(t.customerName).toLowerCase() : '').includes(q);
      const matchCid = (t.idCustomer || t.customerId || '').toLowerCase().includes(q);
      const matchInst = (t.installerName || '').toLowerCase().includes(q);
      const matchArea = (t.area || '').toLowerCase().includes(q);
      const matchPhone = (t.customerPhone || '').includes(q);
      const messages = getMessagesForTicket(t.id);
      const matchMessage = messages.some(m => (m.text || '').toLowerCase().includes(q));
      return matchWo || matchCust || matchCid || matchInst || matchArea || matchPhone || matchMessage;
    });
  }, [partnerScopedTickets, searchQuery, getMessagesForTicket, ticketMessages]);

  // Group tickets by Chat Category
  const groupedTickets = useMemo(() => {
    const groups: {
      category: ChatCategoryConfig;
      tickets: Ticket[];
      unreadCount: number;
    }[] = [];

    activeCategories.forEach(cat => {
      const catTickets = searchFilteredTickets.filter(t => {
        const tCat = (t.chatCategory || '').trim().toUpperCase();
        return tCat === cat.id.toUpperCase() || tCat === cat.name.toUpperCase();
      });
      const unreadTotal = catTickets.reduce((acc, t) => acc + getTicketUnreadCount(t.id), 0);
      groups.push({
        category: cat,
        tickets: catTickets,
        unreadCount: unreadTotal
      });
    });

    const activeCatKeys = new Set(activeCategories.flatMap(c => [c.id.toUpperCase(), c.name.toUpperCase()]));
    const unclassifiedTickets = searchFilteredTickets.filter(t => {
      const tCat = (t.chatCategory || '').trim().toUpperCase();
      return !tCat || !activeCatKeys.has(tCat);
    });
    const unclassifiedUnread = unclassifiedTickets.reduce((acc, t) => acc + getTicketUnreadCount(t.id), 0);

    if (unclassifiedTickets.length > 0 || groups.length === 0) {
      groups.push({
        category: {
          id: 'UNCLASSIFIED',
          name: 'UNCLASSIFIED',
          description: 'Chat tanpa kategori yang ditentukan',
          color: '#64748B',
          order: 999,
          active: true,
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z'
        },
        tickets: unclassifiedTickets,
        unreadCount: unclassifiedUnread
      });
    }

    return groups;
  }, [activeCategories, searchFilteredTickets, getTicketUnreadCount, ticketMessages]);

  // Triage counts across partnerScopedTickets
  const unreadTicketList = useMemo(
    () => searchFilteredTickets.filter(t => getTicketUnreadCount(t.id) > 0),
    [searchFilteredTickets, getTicketUnreadCount, ticketMessages]
  );

  const totalUnreadMessagesCount = useMemo(
    () => partnerScopedTickets.reduce((acc, t) => acc + getTicketUnreadCount(t.id), 0),
    [partnerScopedTickets, getTicketUnreadCount, ticketMessages]
  );

  const urgentTicketList = useMemo(
    () => searchFilteredTickets.filter(t => isTicketUrgent(t)),
    [searchFilteredTickets]
  );

  // Final filtered & sorted conversation feed for Panel 2
  const conversationList = useMemo(() => {
    let base = searchFilteredTickets;

    if (triageMode === 'unread') {
      base = unreadTicketList;
    } else if (triageMode === 'urgent') {
      base = urgentTicketList;
    }

    if (activeCategoryFilter !== 'all') {
      const group = groupedTickets.find(g => g.category.id === activeCategoryFilter);
      const ids = new Set((group ? group.tickets : []).map(t => t.id));
      base = base.filter(t => ids.has(t.id));
    }

    // Sort: unread first, then urgent, then latest message timestamp descending
    return [...base].sort((a, b) => {
      const unreadA = getTicketUnreadCount(a.id);
      const unreadB = getTicketUnreadCount(b.id);
      if (unreadA > 0 && unreadB === 0) return -1;
      if (unreadB > 0 && unreadA === 0) return 1;
      const tsA = new Date(a.lastMessageAt || a.updatedAt || a.createdAt || 0).getTime();
      const tsB = new Date(b.lastMessageAt || b.updatedAt || b.createdAt || 0).getTime();
      return tsB - tsA;
    });
  }, [
    searchFilteredTickets,
    triageMode,
    unreadTicketList,
    urgentTicketList,
    activeCategoryFilter,
    groupedTickets,
    getTicketUnreadCount,
    ticketMessages
  ]);

  // Auto-select first ticket if selection invalid
  useEffect(() => {
    if (!selectedTicketId && conversationList.length > 0) {
      setSelectedTicketId(conversationList[0].id);
    } else if (
      selectedTicketId &&
      !partnerScopedTickets.some(t => t.id === selectedTicketId) &&
      conversationList.length > 0
    ) {
      setSelectedTicketId(conversationList[0].id);
    }
  }, [conversationList, selectedTicketId, partnerScopedTickets]);

  const activeTicket = useMemo(() => {
    return (
      partnerScopedTickets.find(t => t.id === selectedTicketId) ||
      conversationList[0] ||
      null
    );
  }, [partnerScopedTickets, selectedTicketId, conversationList]);

  const activeMessages = useMemo(() => {
    if (!activeTicket) return [];
    return getMessagesForTicket(activeTicket.id);
  }, [activeTicket, getMessagesForTicket, ticketMessages]);

  // Sync composerCategory with activeTicket
  useEffect(() => {
    if (!activeTicket) {
      setComposerCategory('');
      return;
    }
    const existing = (activeTicket.chatCategory || '').trim();
    if (existing && existing.toUpperCase() !== 'UNCLASSIFIED') {
      setComposerCategory(existing);
    } else if (!isInstaller && activeCategories.length > 0) {
      const general = activeCategories.find(c => /GENERAL|PROGRESS/i.test(c.name));
      setComposerCategory(general ? general.name : activeCategories[0].name);
    } else {
      setComposerCategory('');
    }
    setErrorMessage(null);
  }, [activeTicket?.id, activeTicket?.chatCategory, isInstaller, activeCategories]);

  // Auto mark read when opening an active ticket
  useEffect(() => {
    if (activeTicket) {
      markTicketMessagesAsRead(activeTicket.id);
    }
  }, [activeTicket?.id, activeMessages.length, markTicketMessagesAsRead]);

  // Auto scroll to bottom of chatThread
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, activeTicket?.id]);

  const handleSelectTicketCard = (t: Ticket) => {
    setSelectedTicketId(t.id);
    setMoreMenuOpen(false);
    setMobilePane('chat');
  };

  const handleCopyWo = async (woNumber: string) => {
    try {
      await navigator.clipboard.writeText(woNumber);
      setCopiedWo(true);
      toast.success(`Nomor WO ${woNumber} disalin ke clipboard.`);
      setTimeout(() => setCopiedWo(false), 1800);
    } catch {
      toast.error('Gagal menyalin nomor WO.');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach(file => {
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
      if (!validTypes.includes(file.type)) {
        toast.error('Format lampiran harus JPG, PNG, atau WebP.', 'Format Ditolak');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`Ukuran file "${file.name}" melebihi batas 5MB.`, 'Ukuran File Terlalu Besar');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const attachment: ChatAttachment = {
          id: 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          url: dataUrl,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type
        };
        setPendingAttachments(prev => [...prev, attachment]);
        toast.info(`Foto "${file.name}" siap dilampirkan.`, 'Foto Dipilih');
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeTicket || isSubmitting) return;

    if (isLeader) {
      toast.error(
        'Akses Ditolak: Role Leader hanya berfungsi sebagai pemantauan percakapan (Read-Only).',
        'Akses Dibatasi'
      );
      return;
    }

    const effectiveCategory = (composerCategory || activeTicket.chatCategory || '').trim();
    if (isInstaller && (!effectiveCategory || effectiveCategory.toUpperCase() === 'UNCLASSIFIED')) {
      const msg = 'Pilih kategori chat terlebih dahulu sebelum mengirim pesan.';
      setErrorMessage(msg);
      toast.error(msg, 'Kategori Wajib Dipilih');
      return;
    }

    if (!inputText.trim() && pendingAttachments.length === 0) return;

    setIsSubmitting(true);
    try {
      const res = await sendTicketMessage(
        activeTicket.id,
        inputText.trim(),
        pendingAttachments,
        effectiveCategory || undefined
      );

      if (res.success) {
        setInputText('');
        setPendingAttachments([]);
        setErrorMessage(null);
      } else {
        setErrorMessage(res.error || 'Gagal mengirim pesan.');
        toast.error(res.error || 'Gagal mengirim pesan.', 'Error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCategoryChange = (categoryName: string) => {
    setComposerCategory(categoryName);
    setErrorMessage(null);
    if (activeTicket && !isLeader && categoryName && categoryName !== 'UNCLASSIFIED') {
      setTicketChatCategory(activeTicket.id, categoryName);
      toast.success(`Kategori chat diperbarui menjadi "${categoryName}".`, 'Kategori Diperbarui');
    }
  };

  const handleQuickReplyClick = (reply: string) => {
    setInputText(prev => (prev.trim() ? `${prev.trim()} ${reply}` : reply));
    textareaRef.current?.focus();
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'dispatch':
        return (
          <span className="px-1.5 py-0.5 rounded bg-[#35105E]/10 dark:bg-[#35105E] text-[#35105E] dark:text-[#D8B4FE] text-[10px] font-bold uppercase tracking-wide">
            DISPATCH
          </span>
        );
      case 'installer':
        return (
          <span className="px-1.5 py-0.5 rounded bg-[#ECFDF5] dark:bg-emerald-950/70 text-[#16A36A] dark:text-emerald-300 text-[10px] font-bold uppercase tracking-wide">
            TEKNISI
          </span>
        );
      case 'leader':
        return (
          <span className="px-1.5 py-0.5 rounded bg-[#FEF3C7] dark:bg-amber-950/70 text-[#B45309] dark:text-amber-300 text-[10px] font-bold uppercase tracking-wide">
            KORLAP
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded bg-[#F4EAFF] dark:bg-[#5B35B1]/40 text-[#431599] dark:text-[#E9D5FF] text-[10px] font-bold uppercase tracking-wide">
            ADMIN
          </span>
        );
    }
  };

  // Determine OPM attenuation display for active ticket
  const activeOpmValue = useMemo(() => {
    if (!activeTicket) return null;
    const raw =
      activeTicket.rosetRedamanDbm ??
      activeTicket.fatRedamanDbm ??
      activeTicket.technicalReport?.opticalPowerDbm ??
      activeTicket.technicalReport?.opticalPowerRx;
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const numeric = parseFloat(String(raw).replace(/[^\d.-]/g, ''));
    const isOptimal = !Number.isNaN(numeric) ? numeric >= -24 && numeric <= -10 : true;
    return {
      display: String(raw).toLowerCase().includes('dbm') ? String(raw) : `${raw} dBm`,
      isOptimal
    };
  }, [activeTicket]);

  const activeMapsInfo = useMemo(
    () => (activeTicket ? buildGoogleMapsSearchUrl(activeTicket) : { url: '', address: '' }),
    [activeTicket]
  );

  // Reusable Panel 1 Content (Desktop Rail & Mobile Drawer)
  const renderCategoryRailContent = (inDrawer = false) => (
    <div className="flex flex-col h-full bg-white dark:bg-[#1A0E2E]">
      {/* Section Header */}
      <div className="p-3.5 bg-[#F5F1FF]/70 dark:bg-[#22123F] border-b border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 text-[#7135B5] dark:text-[#A78BFA] shrink-0" />
          <h2 className="font-display font-bold text-[15px] text-[#160D29] dark:text-white truncate">
            Kategori Chat
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {canManageCategories && (
            <button
              type="button"
              onClick={() => {
                setIsSettingsOpen(true);
                if (inDrawer) setIsMobileCategoryDrawerOpen(false);
              }}
              className="p-1.5 rounded-lg text-[#766B83] hover:bg-[#E9DDFF] hover:text-[#35105E] dark:text-[#CEC0E8] dark:hover:bg-[#35105E] transition-colors cursor-pointer"
              title="Kelola Kategori SOP"
              aria-label="Kelola Kategori SOP"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
          {inDrawer && (
            <button
              type="button"
              onClick={() => setIsMobileCategoryDrawerOpen(false)}
              className="p-1.5 rounded-lg text-[#766B83] hover:bg-[#E9DDFF] dark:text-[#CEC0E8] cursor-pointer"
              aria-label="Tutup Panel Kategori"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Triage Queue */}
      <div className="p-2.5 space-y-1">
        <div className="px-2.5 pt-1 pb-1 text-[10.5px] font-bold text-[#8B8495] dark:text-[#A78BFA] uppercase tracking-wider">
          Triage Queue
        </div>

        <button
          type="button"
          onClick={() => {
            setTriageMode('all');
            setActiveCategoryFilter('all');
            if (inDrawer) setIsMobileCategoryDrawerOpen(false);
          }}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-all cursor-pointer ${
            triageMode === 'all' && activeCategoryFilter === 'all'
              ? 'bg-[#5B35B1] text-white shadow-xs'
              : 'text-[#211A2E] dark:text-[#CEC0E8] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E]/60'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Inbox className="w-4 h-4 shrink-0" />
            <span className="text-xs font-bold truncate">Semua Percakapan</span>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-bold tabular-nums shrink-0 ${
              triageMode === 'all' && activeCategoryFilter === 'all'
                ? 'bg-white/20 text-white'
                : 'bg-[#F4EAFF] dark:bg-[#35105E] text-[#35105E] dark:text-[#D8B4FE]'
            }`}
          >
            {searchFilteredTickets.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setTriageMode('unread');
            setActiveCategoryFilter('all');
            if (inDrawer) setIsMobileCategoryDrawerOpen(false);
          }}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-all cursor-pointer ${
            triageMode === 'unread'
              ? 'bg-[#5B35B1] text-white shadow-xs'
              : 'text-[#211A2E] dark:text-[#CEC0E8] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E]/60'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <MessageSquare
              className={`w-4 h-4 shrink-0 ${
                triageMode === 'unread' ? 'text-white' : 'text-[#7135B5] dark:text-[#A78BFA]'
              }`}
            />
            <span className="text-xs font-semibold truncate">Belum Terbaca</span>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-bold tabular-nums shrink-0 ${
              unreadTicketList.length > 0
                ? 'bg-[#E59A27] text-white'
                : 'bg-[#F7F6FA] dark:bg-[#22123F] text-[#8B8495]'
            }`}
          >
            {unreadTicketList.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setTriageMode('urgent');
            setActiveCategoryFilter('all');
            if (inDrawer) setIsMobileCategoryDrawerOpen(false);
          }}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-all cursor-pointer ${
            triageMode === 'urgent'
              ? 'bg-[#5B35B1] text-white shadow-xs'
              : 'text-[#211A2E] dark:text-[#CEC0E8] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E]/60'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Flame
              className={`w-4 h-4 shrink-0 ${
                triageMode === 'urgent' ? 'text-white' : 'text-[#DC4C5A]'
              }`}
            />
            <span className="text-xs font-semibold truncate">Butuh Respon Cepat</span>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-bold tabular-nums shrink-0 ${
              triageMode === 'urgent'
                ? 'bg-white/20 text-white'
                : 'bg-[#DC4C5A]/10 text-[#DC4C5A] dark:bg-rose-950/60 dark:text-rose-300'
            }`}
          >
            {urgentTicketList.length}
          </span>
        </button>
      </div>

      {/* SOP Channels */}
      <div className="flex-1 overflow-y-auto px-2.5 py-2 space-y-1 border-t border-[#E9E5F0]/70 dark:border-[#35105E]/70">
        <div className="flex items-center justify-between px-2.5 pt-1 pb-1">
          <span className="text-[10.5px] font-bold text-[#8B8495] dark:text-[#A78BFA] uppercase tracking-wider">
            SOP Channels
          </span>
          <span className="font-mono text-[11px] text-[#8B8495] dark:text-[#CEC0E8]/70 tabular-nums">
            {groupedTickets.length} Active
          </span>
        </div>

        {groupedTickets.map(group => {
          const isSelected = activeCategoryFilter === group.category.id;
          return (
            <button
              key={group.category.id}
              type="button"
              onClick={() => {
                setTriageMode('all');
                setActiveCategoryFilter(isSelected ? 'all' : group.category.id);
                if (inDrawer) setIsMobileCategoryDrawerOpen(false);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left transition-all group cursor-pointer ${
                isSelected
                  ? 'bg-[#F0E3FF] dark:bg-[#35105E] text-[#35105E] dark:text-white font-bold'
                  : 'text-[#211A2E] dark:text-[#CEC0E8] hover:bg-[#F9F0FF] dark:hover:bg-[#35105E]/50'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: group.category.color || '#7135B5' }}
                />
                <span className="text-xs font-semibold truncate group-hover:text-[#7135B5] dark:group-hover:text-[#D8B4FE]">
                  #{group.category.name}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="font-mono text-[11px] text-[#8B8495] dark:text-[#CEC0E8]/70 tabular-nums">
                  {group.tickets.length}
                </span>
                {group.unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-[#DC4C5A] text-white font-mono text-[10px] font-bold tabular-nums leading-none">
                    {group.unreadCount > 99 ? '99+' : group.unreadCount}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Bottom Area Partner Card */}
      <div className="p-2.5 mt-auto bg-[#F7F6FA] dark:bg-[#160D29] border-t border-[#E9E5F0] dark:border-[#35105E] shrink-0">
        <div className="p-3 rounded-xl bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-[#766B83] dark:text-[#A78BFA] uppercase tracking-wider">
              Area Partner
            </span>
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />
          </div>

          {canFilterContractor ? (
            <select
              value={selectedContractorFilter}
              onChange={e => setSelectedContractorFilter(e.target.value)}
              aria-label="Filter Mitra / Kontraktor"
              className="w-full text-xs font-bold text-[#35105E] dark:text-white bg-[#F5F1FF] dark:bg-[#2A194D] border border-[#D8CCF3] dark:border-[#5B35B1] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#7135B5] cursor-pointer"
            >
              <option value="all">Semua Mitra ({availableTickets.length} WO)</option>
              {availableContractors.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-xs font-bold text-[#35105E] dark:text-white truncate">
              {currentUser?.contractor || activeTicket?.contactorName || activeTicket?.contractorName || 'Mitra Terdaftar'}
            </div>
          )}

          <div className="flex items-center gap-1 text-[10.5px] font-semibold text-[#766B83] dark:text-[#CEC0E8]">
            <MapPin className="w-3 h-3 text-[#16A36A] shrink-0" />
            <span className="truncate">
              Cluster: {currentUser?.area || activeTicket?.area || 'Seluruh Area WIB'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  // Determine container height for full-bleed desktop vs mobile / bottom-nav roles
  const wrapperClass = isMobileView
    ? 'flex flex-col w-full bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#E9E5F0] dark:border-[#35105E] overflow-hidden shadow-xs h-[calc(100dvh-13rem)] min-h-[460px]'
    : isInstaller || isLeader
    ? 'flex flex-col w-full bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#E9E5F0] dark:border-[#35105E] overflow-hidden shadow-xs h-[calc(100dvh-11.5rem)] min-h-[520px]'
    : 'flex flex-col w-full h-[calc(100dvh-4rem)] overflow-hidden bg-[#F7F6FA] dark:bg-[#140827]';

  return (
    <div className={wrapperClass}>
      {/* Top Live Sync Bar (Operational Status Strip) */}
      <div className="h-10 bg-white dark:bg-[#160D29] border-b border-[#E9E5F0] dark:border-[#35105E] px-3 sm:px-5 flex items-center justify-between gap-3 shrink-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide whitespace-nowrap">
            <span
              className={`inline-flex h-2 w-2 rounded-full ${
                !isOnline
                  ? 'bg-[#E59A27]'
                  : databaseStatus === 'connected'
                  ? 'bg-[#16A36A] animate-pulse'
                  : 'bg-[#3977C9]'
              }`}
            />
            <span className="text-[#211A2E] dark:text-white uppercase">
              {!isOnline
                ? 'OFFLINE QUEUE'
                : databaseStatus === 'connected'
                ? 'SSE STREAM ACTIVE'
                : 'LOCAL SYNC'}
            </span>
            <span className="text-[#8B8495]">·</span>
            <span className="font-mono text-[#7135B5] dark:text-[#D8B4FE] uppercase tabular-nums">
              {syncStatus}
            </span>
          </div>

          <div className="hidden md:block h-3.5 w-px bg-[#E9E5F0] dark:bg-[#35105E]" />

          <div className="hidden md:flex items-center gap-1.5 text-xs text-[#766B83] dark:text-[#CEC0E8] truncate">
            {isOnline ? (
              <Cloud className="w-3.5 h-3.5 text-[#16A36A] shrink-0" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-[#E59A27] shrink-0" />
            )}
            <span className="truncate tabular-nums">
              {databaseStatus === 'connected'
                ? `Supabase PostgreSQL Live · ${pendingCount} Unsynced Mutations`
                : `Mode Terisolasi · ${pendingCount} Antrean Lokal`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {urgentTicketList.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setTriageMode('urgent');
                setActiveCategoryFilter('all');
                setMobilePane('queue');
              }}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F5F1FF] dark:bg-[#35105E] text-[#35105E] dark:text-[#E9D5FF] text-[11px] font-bold hover:bg-[#E9DDFF] transition-colors cursor-pointer whitespace-nowrap tabular-nums"
            >
              <Zap className="w-3 h-3 text-[#7135B5] dark:text-[#D8B4FE]" />
              <span>Prioritas &amp; Approval: {urgentTicketList.length} WO</span>
            </button>
          )}
          <span className="hidden xl:inline font-mono text-[11px] text-[#8B8495] dark:text-[#CEC0E8]/70 whitespace-nowrap tabular-nums">
            Scope: {selectedContractorFilter !== 'all' ? selectedContractorFilter : currentUser?.area || 'ALL-AREA'} · {todayWIB}
          </span>
        </div>
      </div>

      {/* Main 3-Panel Communication Stage */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* PANEL 1: Desktop Left Navigation Rail */}
        {!isMobileView && (
          <aside className="hidden lg:flex w-56 xl:w-60 flex-col shrink-0 border-r border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#1A0E2E]">
            {renderCategoryRailContent(false)}
          </aside>
        )}

        {/* Mobile / Tablet Category Drawer */}
        {isMobileCategoryDrawerOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
              onClick={() => setIsMobileCategoryDrawerOpen(false)}
            />
            <div className="relative z-10 w-72 max-w-[85vw] h-full shadow-2xl">
              {renderCategoryRailContent(true)}
            </div>
          </div>
        )}

        {/* PANEL 2: Ticket Queue Stream */}
        <section
          className={`${
            isMobileView || mobilePane === 'chat'
              ? isMobileView
                ? mobilePane === 'queue'
                  ? 'flex w-full'
                  : 'hidden'
                : 'hidden md:flex md:w-72 xl:w-80 2xl:w-96'
              : 'flex w-full md:w-72 xl:w-80 2xl:w-96'
          } bg-[#F7F6FA] dark:bg-[#160D29] border-r border-[#E9E5F0] dark:border-[#35105E] flex-col shrink-0 min-h-0`}
        >
          {/* Sticky Search & Filter Bar */}
          <div className="p-3 bg-white dark:bg-[#1A0E2E] border-b border-[#E9E5F0] dark:border-[#35105E] space-y-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsMobileCategoryDrawerOpen(true)}
                className={`${
                  isMobileView ? 'inline-flex' : 'lg:hidden inline-flex'
                } p-2 rounded-lg bg-[#F5F1FF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] hover:bg-[#E9DDFF] transition-colors shrink-0 cursor-pointer`}
                title="Buka Filter Kategori"
                aria-label="Buka Filter Kategori"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>

              <div className="relative flex-1 flex items-center">
                <Search className="w-3.5 h-3.5 text-[#8B8495] absolute left-3 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape' && searchQuery) setSearchQuery('');
                  }}
                  placeholder="Cari WO, ID Cust, teknisi, keyword..."
                  className="w-full pl-8 pr-12 py-1.5 bg-[#F7F6FA] dark:bg-[#22123F] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-xs text-[#211A2E] dark:text-white placeholder:text-[#8B8495] focus:outline-none focus:bg-white dark:focus:bg-[#1A0E2E] focus:border-[#A78BFA] focus:ring-1 focus:ring-[#A78BFA]/40 transition-all"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 p-0.5 text-[#8B8495] hover:text-[#211A2E] dark:hover:text-white cursor-pointer"
                    aria-label="Bersihkan pencarian"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  canManageCategories && (
                    <span className="hidden sm:inline-block absolute right-2 px-1.5 py-0.5 rounded bg-[#F4EAFF] dark:bg-[#35105E] font-mono text-[10px] font-semibold text-[#766B83] dark:text-[#D8B4FE] pointer-events-none">
                      Cari
                    </span>
                  )
                )}
              </div>
            </div>

            {/* Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
              <button
                type="button"
                onClick={() => {
                  setTriageMode('all');
                  setActiveCategoryFilter('all');
                }}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer tabular-nums ${
                  triageMode === 'all' && activeCategoryFilter === 'all'
                    ? 'bg-[#35105E] text-white'
                    : 'bg-[#F4EAFF] dark:bg-[#2A194D] text-[#766B83] dark:text-[#CEC0E8] hover:text-[#211A2E] dark:hover:text-white'
                }`}
              >
                Semua ({searchFilteredTickets.length})
              </button>

              <button
                type="button"
                onClick={() => {
                  setTriageMode(triageMode === 'unread' ? 'all' : 'unread');
                  setActiveCategoryFilter('all');
                }}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer tabular-nums ${
                  triageMode === 'unread'
                    ? 'bg-[#E59A27] text-white'
                    : 'bg-[#F4EAFF] dark:bg-[#2A194D] text-[#766B83] dark:text-[#CEC0E8] hover:text-[#211A2E] dark:hover:text-white'
                }`}
              >
                Unread ({unreadTicketList.length})
              </button>

              {groupedTickets
                .filter(g => g.tickets.length > 0)
                .slice(0, 4)
                .map(group => {
                  const active = activeCategoryFilter === group.category.id;
                  return (
                    <button
                      key={`chip-${group.category.id}`}
                      type="button"
                      onClick={() => {
                        setTriageMode('all');
                        setActiveCategoryFilter(active ? 'all' : group.category.id);
                      }}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer tabular-nums ${
                        active
                          ? 'bg-[#7135B5] text-white'
                          : 'bg-[#F4EAFF] dark:bg-[#2A194D] text-[#766B83] dark:text-[#CEC0E8] hover:text-[#211A2E] dark:hover:text-white'
                      }`}
                    >
                      #{group.category.name} ({group.tickets.length})
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Ticket Cards Scrollable Feed */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {conversationList.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#8B8495] space-y-2 bg-white dark:bg-[#1A0E2E] rounded-xl border border-[#E9E5F0] dark:border-[#35105E]">
                <AlertCircle className="w-7 h-7 text-[#A78BFA] mx-auto" />
                <div className="font-bold text-[#211A2E] dark:text-white">
                  Tidak Ada Tiket Percakapan
                </div>
                <p className="text-[11px] leading-relaxed">
                  Tidak ada Work Order ber-teknisi hari ini ({todayWIB}) yang cocok dengan filter atau pencarian Anda.
                </p>
                {(searchQuery || triageMode !== 'all' || activeCategoryFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setTriageMode('all');
                      setActiveCategoryFilter('all');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#5B35B1] text-white text-[11px] font-bold cursor-pointer"
                  >
                    Reset Filter
                  </button>
                )}
              </div>
            ) : (
              conversationList.map(t => {
                const isSelected = t.id === activeTicket?.id;
                const unread = getTicketUnreadCount(t.id);
                const msgs = getMessagesForTicket(t.id);
                const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
                const hasLastPhoto = Boolean(lastMsg?.attachments && lastMsg.attachments.length > 0);
                const isExpress =
                  t.appointmentType?.toLowerCase() === 'sameday' ||
                  (t.ticketCategory || '').toLowerCase().includes('express');
                const urgent = isTicketUrgent(t);
                const catName = t.chatCategory && t.chatCategory !== 'UNCLASSIFIED' ? t.chatCategory : 'UNCLASSIFIED';
                const catObj = activeCategories.find(
                  c => c.name.toUpperCase() === catName.toUpperCase() || c.id.toUpperCase() === catName.toUpperCase()
                );
                const displayTime = formatWibTime(lastMsg?.timestamp || t.lastMessageAt || t.updatedAt);

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleSelectTicketCard(t)}
                    className={`w-full text-left relative p-3.5 rounded-xl transition-all cursor-pointer block ${
                      isSelected
                        ? 'bg-white dark:bg-[#231440] shadow-md ring-2 ring-[#7135B5]/70'
                        : 'bg-white dark:bg-[#1A0E2E] border border-[#E9E5F0] dark:border-[#35105E] hover:border-[#D8CCF3] dark:hover:border-[#5B35B1] shadow-2xs'
                    }`}
                  >
                    {/* Top Row: WO Number + Express/Alert + Time */}
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-xs font-bold text-[#35105E] dark:text-[#D8B4FE] truncate">
                          {t.woNumber}
                        </span>
                        {isExpress && (
                          <span className="px-1.5 py-0.5 rounded bg-[#7135B5] text-white text-[9.5px] font-bold uppercase tracking-wide shrink-0">
                            EXPRESS
                          </span>
                        )}
                        {urgent && !isExpress && (
                          <span className="w-2 h-2 rounded-full bg-[#DC4C5A] shrink-0" title="Butuh Perhatian" />
                        )}
                      </div>
                      <span className="font-mono text-[11px] text-[#8B8495] dark:text-[#CEC0E8]/70 shrink-0 tabular-nums">
                        {displayTime}
                      </span>
                    </div>

                    {/* Customer Name + ID */}
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-sm font-bold text-[#211A2E] dark:text-white truncate">
                        {t.customerName}
                      </span>
                      <span className="font-mono text-[11px] text-[#8B8495] shrink-0 tabular-nums">
                        ID: {t.idCustomer || t.customerId || '-'}
                      </span>
                    </div>

                    {/* Technician & Slot */}
                    <div className="flex items-center gap-1.5 text-xs text-[#766B83] dark:text-[#CEC0E8] mb-2">
                      <Wrench className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#A78BFA] shrink-0" />
                      <span className="font-semibold text-[#160D29] dark:text-[#E9D5FF] truncate">
                        {t.installerName || 'Unassigned'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate text-[#8B8495]">{t.slotTime || t.area || '-'}</span>
                    </div>

                    {/* Snippet Preview */}
                    <div className="p-2 rounded-lg bg-[#F5F1FF] dark:bg-[#2A194D]/70 mb-2.5 flex items-start gap-1.5">
                      {hasLastPhoto && (
                        <Camera className="w-3.5 h-3.5 text-[#16A36A] shrink-0 mt-0.5" />
                      )}
                      <p className="text-[11.5px] text-[#494453] dark:text-[#CEC0E8] line-clamp-2 leading-snug">
                        {lastMsg ? (
                          <>
                            {lastMsg.category && (
                              <span className="font-bold text-[#35105E] dark:text-[#D8B4FE] mr-1">
                                [{lastMsg.category}]
                              </span>
                            )}
                            {lastMsg.text || (hasLastPhoto ? 'Foto bukti dilampirkan.' : 'Pesan baru')}
                          </>
                        ) : (
                          <span className="italic text-[#8B8495]">
                            {t.lastMessageSnippet || 'Belum ada pesan percakapan di thread ini.'}
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Footer: Category + Status + Unread Badge */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide truncate max-w-[130px]"
                          style={{
                            backgroundColor: catObj?.color ? `${catObj.color}1A` : '#F4EAFF',
                            color: catObj?.color || '#35105E'
                          }}
                        >
                          #{catName}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#3977C9]/10 text-[#3977C9] dark:bg-blue-950/60 dark:text-blue-300 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
                          {t.statusWOInstaller || t.statusWOAgent || 'ASSIGNED'}
                        </span>
                      </div>

                      {unread > 0 && (
                        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#7135B5] text-white font-mono text-[10px] font-bold flex items-center justify-center tabular-nums shrink-0">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* PANEL 3 + PANEL 4: Active Chat Workspace & Collapsible Detail Tiket WO Stage */}
        <div
          className={`${
            isMobileView && mobilePane === 'queue' ? 'hidden' : 'flex'
          } flex-1 bg-white dark:bg-[#1A0E2E] min-w-0 min-h-0 overflow-hidden relative`}
        >
          <section className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-white dark:bg-[#1A0E2E]">
          {activeTicket ? (
            <>
              {/* Stage Top Bar: Ticket Coordinates & 4-Dimension Matrix Status */}
              <div className="px-4 py-3 bg-white dark:bg-[#1A0E2E] border-b border-[#E9E5F0] dark:border-[#35105E] flex flex-col gap-2.5 shrink-0 z-10">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* Left: Mobile Back + Customer Initials + Ticket Identity */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => setMobilePane('queue')}
                      className={`${
                        isMobileView ? 'inline-flex' : 'md:hidden inline-flex'
                      } items-center gap-1 px-2 py-1.5 rounded-lg bg-[#F5F1FF] dark:bg-[#35105E] text-[#35105E] dark:text-white text-xs font-bold shrink-0 cursor-pointer`}
                      aria-label="Kembali ke antrean tiket"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Antrean</span>
                    </button>

                    <div className="hidden sm:flex w-10 h-10 rounded-xl bg-[#5B35B1]/10 dark:bg-[#35105E] items-center justify-center text-[#7135B5] dark:text-[#D8B4FE] font-display font-bold text-sm shrink-0">
                      {(activeTicket.customerName || 'WO')
                        .split(' ')
                        .filter(Boolean)
                        .slice(0, 2)
                        .map(w => w[0].toUpperCase())
                        .join('')}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-xs sm:text-sm font-bold text-[#35105E] dark:text-[#D8B4FE]">
                          {activeTicket.woNumber}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyWo(activeTicket.woNumber)}
                          className="p-1 rounded text-[#8B8495] hover:text-[#7135B5] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] transition-colors cursor-pointer"
                          title="Salin Nomor WO"
                          aria-label="Salin Nomor WO"
                        >
                          {copiedWo ? (
                            <Check className="w-3.5 h-3.5 text-[#16A36A]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <span className="px-2 py-0.5 rounded-full bg-[#F5F1FF] dark:bg-[#35105E] text-[#35105E] dark:text-[#E9D5FF] text-[10.5px] font-bold whitespace-nowrap">
                          {activeTicket.installationType || activeTicket.serviceType || activeTicket.ticketCategory || 'FTTH'}
                        </span>
                        {(activeTicket.appointmentType?.toLowerCase() === 'sameday' ||
                          (activeTicket.ticketCategory || '').toLowerCase().includes('express')) && (
                          <span className="px-1.5 py-0.5 rounded bg-[#7135B5] text-white text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
                            EXPRESS
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-xs">
                        <span className="font-display font-bold text-base text-[#211A2E] dark:text-white truncate">
                          {activeTicket.customerName}
                        </span>
                        <span className="font-mono text-[#8B8495] tabular-nums">
                          (ID: {activeTicket.idCustomer || activeTicket.customerId || '-'})
                        </span>
                        <span className="text-[#8B8495]" aria-hidden="true">·</span>
                        <span className="text-[#766B83] dark:text-[#CEC0E8] whitespace-nowrap">
                          {activeTicket.slotTime || 'Slot Tidak Ditentukan'}
                        </span>
                        {activeTicket.checkInAt && !activeTicket.checkOutAt && (
                          <>
                            <span className="text-[#8B8495]" aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-[#16A36A] font-semibold whitespace-nowrap">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#16A36A] animate-pulse" />
                              Sedang Dikerjakan
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Fast Action Buttons */}
                  <div className="flex items-center gap-2 shrink-0 relative">
                    {onOpenWhatsApp && (
                      <button
                        type="button"
                        onClick={() => onOpenWhatsApp(activeTicket)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#16A36A] hover:bg-[#15803D] text-white text-xs font-bold shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">WhatsApp Cust</span>
                        <span className="sm:hidden">WA</span>
                      </button>
                    )}

                    {!isMobileView && (
                      <button
                        type="button"
                        onClick={() => setIsDetailPanelOpen(prev => !prev)}
                        className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F4EAFF] hover:bg-[#E9DDFF] dark:bg-[#35105E] dark:hover:bg-[#5B35B1] text-[#35105E] dark:text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                        title={isDetailPanelOpen ? 'Sembunyikan Panel Detail' : 'Tampilkan Panel Detail'}
                      >
                        {isDetailPanelOpen ? (
                          <PanelRightClose className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />
                        ) : (
                          <PanelRightOpen className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />
                        )}
                        <span className="hidden lg:inline">
                          {isDetailPanelOpen ? 'Sembunyikan Panel' : 'Detail Panel'}
                        </span>
                      </button>
                    )}

                    {onSelectTicket && (
                      <button
                        type="button"
                        onClick={() => onSelectTicket(activeTicket, 'overview')}
                        className={`${
                          isMobileView ? 'inline-flex' : 'inline-flex md:hidden'
                        } items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F4EAFF] hover:bg-[#E9DDFF] dark:bg-[#35105E] dark:hover:bg-[#5B35B1] text-[#35105E] dark:text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap`}
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />
                        <span>Detail Tiket</span>
                      </button>
                    )}

                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setMoreMenuOpen(prev => !prev)}
                        className="p-2 rounded-lg bg-[#F7F6FA] hover:bg-[#F4EAFF] dark:bg-[#22123F] dark:hover:bg-[#35105E] text-[#766B83] dark:text-[#CEC0E8] transition-colors cursor-pointer"
                        title="Opsi Tindakan Lainnya"
                        aria-label="Opsi Tindakan Lainnya"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {moreMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setMoreMenuOpen(false)} />
                          <div className="absolute right-0 mt-1.5 w-56 bg-white dark:bg-[#1A0E2E] border border-[#E9E5F0] dark:border-[#35105E] rounded-xl shadow-xl py-1.5 z-40 text-xs">
                            {onSelectTicket && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMoreMenuOpen(false);
                                    onSelectTicket(activeTicket, 'report');
                                  }}
                                  className="w-full text-left px-3.5 py-2 hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] text-[#211A2E] dark:text-white flex items-center gap-2 font-semibold cursor-pointer"
                                >
                                  <FileText className="w-3.5 h-3.5 text-[#7135B5]" />
                                  <span>Buka Tab Report Teknis</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMoreMenuOpen(false);
                                    onSelectTicket(activeTicket, 'history');
                                  }}
                                  className="w-full text-left px-3.5 py-2 hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] text-[#211A2E] dark:text-white flex items-center gap-2 font-semibold cursor-pointer"
                                >
                                  <History className="w-3.5 h-3.5 text-[#7135B5]" />
                                  <span>Riwayat &amp; Timeline WO</span>
                                </button>
                              </>
                            )}
                            {activeTicket.customerPhone && (
                              <button
                                type="button"
                                onClick={async () => {
                                  setMoreMenuOpen(false);
                                  try {
                                    await navigator.clipboard.writeText(activeTicket.customerPhone);
                                    toast.success(`Nomor HP ${activeTicket.customerPhone} disalin.`);
                                  } catch {
                                    toast.error('Gagal menyalin nomor HP.');
                                  }
                                }}
                                className="w-full text-left px-3.5 py-2 hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] text-[#211A2E] dark:text-white flex items-center gap-2 font-semibold cursor-pointer"
                              >
                                <Phone className="w-3.5 h-3.5 text-[#16A36A]" />
                                <span>Salin No. HP ({activeTicket.customerPhone})</span>
                              </button>
                            )}
                            {activeMapsInfo.url && (
                              <a
                                href={activeMapsInfo.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setMoreMenuOpen(false)}
                                className="w-full text-left px-3.5 py-2 hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] text-[#211A2E] dark:text-white flex items-center gap-2 font-semibold"
                              >
                                <MapPin className="w-3.5 h-3.5 text-[#DC4C5A]" />
                                <span>Buka Lokasi di Google Maps</span>
                              </a>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* 4-Dimension Status Matrix Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#E9E5F0]/70 dark:border-[#35105E]/70">
                  <div className="flex items-center gap-1.5 flex-wrap text-[10.5px] font-bold uppercase tracking-wide">
                    <span className="text-[#8B8495] mr-1">Matrix Status:</span>

                    {/* Dimension 1: Agent */}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#3977C9]/10 text-[#3977C9] dark:bg-blue-950/60 dark:text-blue-300 whitespace-nowrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3977C9]" />
                      AGENT: {activeTicket.statusWOAgent || 'Pending'}
                    </span>

                    {/* Dimension 2: Installer */}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#7135B5]/10 text-[#7135B5] dark:bg-[#35105E] dark:text-[#D8B4FE] whitespace-nowrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#7135B5] dark:bg-[#D8B4FE]" />
                      INSTALLER: {activeTicket.statusWOInstaller || 'Unassigned'}
                    </span>

                    {/* Dimension 3: WhatsApp */}
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded whitespace-nowrap ${
                        activeTicket.statusWhatsApp === 'confirmed'
                          ? 'bg-[#16A36A]/10 text-[#16A36A] dark:bg-emerald-950/60 dark:text-emerald-300'
                          : activeTicket.statusWhatsApp === 'reschedule_requested' ||
                            activeTicket.statusWhatsApp === 'unreachable'
                          ? 'bg-[#DC4C5A]/10 text-[#DC4C5A] dark:bg-rose-950/60 dark:text-rose-300'
                          : 'bg-[#F7F6FA] text-[#766B83] dark:bg-[#22123F] dark:text-[#CEC0E8]'
                      }`}
                    >
                      <CheckCheck className="w-3 h-3" />
                      WA: {(activeTicket.statusWhatsApp || 'not_prepared').replace(/_/g, ' ')}
                    </span>

                    {/* Dimension 4: Governance / Approval */}
                    {activeTicket.approvalStatus && activeTicket.approvalStatus !== 'NONE' && (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded whitespace-nowrap ${
                          activeTicket.approvalStatus === 'BUTUH APPROVAL'
                            ? 'bg-[#E59A27]/15 text-[#B45309] dark:bg-amber-950/60 dark:text-amber-300 animate-pulse'
                            : activeTicket.approvalStatus === 'APPROVED'
                            ? 'bg-[#16A36A]/15 text-[#16A36A] dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-[#DC4C5A]/15 text-[#DC4C5A] dark:bg-rose-950/60 dark:text-rose-300'
                        }`}
                      >
                        <ShieldCheck className="w-3 h-3" />
                        {activeTicket.approvalStatus}
                      </span>
                    )}
                  </div>

                  {activeMapsInfo.address && (
                    <a
                      href={activeMapsInfo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-[#766B83] hover:text-[#431599] dark:text-[#CEC0E8] dark:hover:text-[#D8B4FE] transition-colors min-w-0 max-w-xs"
                      title={`Buka lokasi: ${activeMapsInfo.address}`}
                    >
                      <MapPin className="w-3.5 h-3.5 text-[#8B8495] shrink-0" />
                      <span className="truncate">{activeTicket.streetName || activeTicket.address || activeMapsInfo.address}</span>
                    </a>
                  )}
                </div>
              </div>

              {/* Telemetry Strip (Sub-header) */}
              <div className="px-4 py-1.5 bg-[#F5F1FF] dark:bg-[#22123F] border-b border-[#E9E5F0] dark:border-[#35105E] flex flex-wrap items-center justify-between gap-x-5 gap-y-1 text-xs shrink-0">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  <div className="flex items-center gap-1.5">
                    <Activity
                      className={`w-3.5 h-3.5 ${
                        activeOpmValue
                          ? activeOpmValue.isOptimal
                            ? 'text-[#16A36A]'
                            : 'text-[#DC4C5A]'
                          : 'text-[#8B8495]'
                      }`}
                    />
                    <span className="text-[#766B83] dark:text-[#CEC0E8]">Redaman OPM:</span>
                    <span
                      className={`font-mono font-bold tabular-nums ${
                        activeOpmValue
                          ? activeOpmValue.isOptimal
                            ? 'text-[#16A36A]'
                            : 'text-[#DC4C5A]'
                          : 'text-[#8B8495]'
                      }`}
                    >
                      {activeOpmValue
                        ? `${activeOpmValue.display} (${activeOpmValue.isOptimal ? 'Optimal' : 'Perlu Cek'})`
                        : 'Belum Terukur'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Router className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#A78BFA]" />
                    <span className="text-[#766B83] dark:text-[#CEC0E8]">FAT:</span>
                    <span className="font-mono font-bold text-[#160D29] dark:text-white">
                      {activeTicket.fatCode || activeTicket.fat || '-'}
                      {activeTicket.fatPort ? ` · Port ${activeTicket.fatPort}` : ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <UserIcon className="w-3.5 h-3.5 text-[#8B8495]" />
                    <span className="text-[#766B83] dark:text-[#CEC0E8]">Teknisi:</span>
                    <span className="font-bold text-[#211A2E] dark:text-white">
                      {activeTicket.installerName || 'Unassigned'}
                      {activeTicket.installerContact ? ` (${activeTicket.installerContact})` : ''}
                    </span>
                  </div>
                </div>

                <div className="text-[10.5px] font-bold text-[#766B83] dark:text-[#A78BFA] uppercase tracking-wide">
                  KORLAP: {activeTicket.leaderName || activeTicket.corlapName || activeTicket.contactorName || '-'}
                </div>
              </div>

              {/* Live Chat Thread History */}
              <div
                id="chatThread"
                className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-[#F7F6FA]/60 dark:bg-[#140827]/60"
              >
                {/* System Event Check-in Banner if Check-in or Work Started recorded */}
                {(activeTicket.checkInAt || activeTicket.workStartedAt) && (
                  <div className="flex items-center justify-center my-1">
                    <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-[#F4EAFF] dark:bg-[#2A194D] text-[#494453] dark:text-[#D8B4FE] text-[11px] font-semibold">
                      <MapPin className="w-3.5 h-3.5 text-[#16A36A] shrink-0" />
                      <span>
                        {activeTicket.checkInAt
                          ? `Check-in Lapangan Pukul ${formatWibTime(activeTicket.checkInAt)} — Teknisi ${activeTicket.installerName || '-'}`
                          : `Mulai Pengerjaan Pukul ${formatWibTime(activeTicket.workStartedAt)} — Teknisi ${activeTicket.installerName || '-'}`}
                      </span>
                    </div>
                  </div>
                )}

                {activeMessages.length === 0 ? (
                  <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center p-8 text-[#8B8495] space-y-2.5">
                    <div className="w-12 h-12 rounded-2xl bg-[#F4EAFF] dark:bg-[#2A194D] text-[#7135B5] dark:text-[#D8B4FE] flex items-center justify-center">
                      <MessageSquare className="w-6 h-6" />
                    </div>
                    <div className="font-display font-bold text-sm text-[#211A2E] dark:text-white">
                      Belum Ada Pesan di Channel WO Ini
                    </div>
                    <p className="text-xs text-[#766B83] dark:text-[#CEC0E8] max-w-md leading-relaxed">
                      Mulai koordinasi antara Dispatch, Leader, dan Teknisi Lapangan untuk Work Order{' '}
                      <span className="font-mono font-bold text-[#35105E] dark:text-[#D8B4FE]">
                        {activeTicket.woNumber}
                      </span>
                      . Unggah foto redaman OPM atau update progres lapangan.
                    </p>
                  </div>
                ) : (
                  activeMessages.map((msg: TicketMessage) => {
                    const isMe =
                      msg.senderId === currentUser?.id || msg.senderRole === currentUser?.role;
                    const msgCategory = msg.category || activeTicket.chatCategory;
                    const hasReaders = Array.isArray(msg.readBy) && msg.readBy.length > 1;

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isMe ? 'items-end ml-auto' : 'items-start'} max-w-xl`}
                      >
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {!isMe && (
                            <>
                              <div className="w-6 h-6 rounded-full bg-[#35105E] text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                                {(msg.senderName || 'U')
                                  .split(' ')
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .map(s => s[0].toUpperCase())
                                  .join('')}
                              </div>
                              <span className="text-xs font-bold text-[#211A2E] dark:text-white">
                                {msg.senderName}
                              </span>
                            </>
                          )}
                          {getRoleBadge(msg.senderRole)}
                          {msgCategory && msgCategory !== 'UNCLASSIFIED' && (
                            <span className="px-1.5 py-0.5 rounded bg-[#F4EAFF] dark:bg-[#2A194D] text-[#35105E] dark:text-[#D8B4FE] text-[10px] font-bold uppercase">
                              #{msgCategory}
                            </span>
                          )}
                          {isMe && (
                            <span className="text-xs font-bold text-[#35105E] dark:text-[#D8B4FE]">
                              {msg.senderName}
                            </span>
                          )}
                          <span className="font-mono text-[11px] text-[#8B8495] tabular-nums">
                            {formatWibTime(msg.timestamp)}
                          </span>
                        </div>

                        <div
                          className={`p-3.5 rounded-2xl shadow-2xs space-y-2.5 ${
                            isMe
                              ? 'rounded-tr-xs bg-[#5B35B1] text-white'
                              : 'rounded-tl-xs bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] text-[#211A2E] dark:text-white'
                          }`}
                        >
                          {msg.text && (
                            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">
                              {msg.text}
                            </p>
                          )}

                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="space-y-2 pt-0.5">
                              {msg.attachments.map(att => {
                                const previewSrc = getSafePreviewUrl(att.url);
                                const sizeLabel = formatFileSize(att.fileSize);
                                return (
                                  <div
                                    key={att.id}
                                    className={`p-2 rounded-xl flex items-center justify-between gap-3 ${
                                      isMe
                                        ? 'bg-white/15 border border-white/20'
                                        : 'bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <button
                                        type="button"
                                        onClick={() => setZoomImage(att.url)}
                                        className="w-12 h-12 rounded-lg overflow-hidden bg-[#F4EAFF] dark:bg-[#2A194D] shrink-0 cursor-pointer relative group"
                                        title="Perbesar Foto"
                                      >
                                        <img
                                          src={previewSrc}
                                          alt={att.fileName}
                                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                        />
                                      </button>
                                      <div className="flex flex-col min-w-0">
                                        <span
                                          className={`text-xs font-bold truncate ${
                                            isMe ? 'text-white' : 'text-[#211A2E] dark:text-white'
                                          }`}
                                        >
                                          {att.fileName}
                                        </span>
                                        <span
                                          className={`font-mono text-[10.5px] truncate ${
                                            isMe ? 'text-white/75' : 'text-[#8B8495]'
                                          }`}
                                        >
                                          {sizeLabel || 'Lampiran Gambar'} · {att.mimeType || 'image'}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => setZoomImage(att.url)}
                                        className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 ${
                                          isMe
                                            ? 'bg-white text-[#35105E] hover:bg-[#F4EAFF]'
                                            : 'bg-[#35105E] hover:bg-[#7135B5] text-white'
                                        }`}
                                      >
                                        <Maximize2 className="w-3 h-3" />
                                        <span>Perbesar Foto</span>
                                      </button>
                                      {previewSrc && (
                                        <a
                                          href={previewSrc}
                                          download={att.fileName || 'attachment.jpg'}
                                          className={`p-1.5 rounded-lg transition-colors ${
                                            isMe
                                              ? 'bg-white/20 hover:bg-white/30 text-white'
                                              : 'bg-white dark:bg-[#2A194D] hover:bg-[#F4EAFF] text-[#7135B5] dark:text-[#D8B4FE] border border-[#E9E5F0] dark:border-[#35105E]'
                                          }`}
                                          title="Download Foto"
                                          aria-label="Download Foto"
                                        >
                                          <Download className="w-3.5 h-3.5" />
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {isMe && (
                            <div className="flex items-center justify-end gap-1 text-white/75 font-mono text-[10.5px]">
                              <span>{hasReaders ? 'Dibaca' : 'Terkirim'}</span>
                              {hasReaders ? (
                                <CheckCheck className="w-3.5 h-3.5 text-[#D8B4FE]" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Error Alert Banner */}
              {errorMessage && (
                <div className="mx-4 my-2 p-2.5 rounded-xl bg-[#FEF2F2] dark:bg-rose-950/60 border border-[#DC4C5A]/30 text-[#DC4C5A] dark:text-rose-300 text-xs flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="font-semibold">{errorMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setErrorMessage(null)}
                    className="p-0.5 hover:opacity-75 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Pending Attachments Preview Strip */}
              {pendingAttachments.length > 0 && (
                <div className="px-4 py-2 bg-[#F5F1FF] dark:bg-[#22123F] border-t border-[#D8CCF3] dark:border-[#35105E] flex items-center gap-2.5 overflow-x-auto shrink-0">
                  {pendingAttachments.map(att => (
                    <div
                      key={att.id}
                      className="relative w-14 h-14 rounded-lg overflow-hidden border-2 border-[#7135B5] shrink-0"
                    >
                      <img src={att.url} alt={att.fileName} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() =>
                          setPendingAttachments(prev => prev.filter(a => a.id !== att.id))
                        }
                        className="absolute top-0.5 right-0.5 p-0.5 bg-[#DC4C5A] text-white rounded-full cursor-pointer"
                        aria-label="Hapus lampiran"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <span className="text-xs font-bold text-[#35105E] dark:text-[#D8B4FE] whitespace-nowrap">
                    {pendingAttachments.length} foto siap dikirim
                  </span>
                </div>
              )}

              {/* Quick Canned Response Chips (Staff & Installer; hidden for Read-Only Leader) */}
              {!isLeader && (
                <div className="px-4 py-1.5 bg-[#F7F6FA] dark:bg-[#160D29] border-t border-[#E9E5F0] dark:border-[#35105E] flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                  <span className="text-[10px] font-bold text-[#8B8495] uppercase tracking-wider whitespace-nowrap shrink-0 mr-1">
                    Balas Cepat:
                  </span>
                  {(isInstaller ? QUICK_REPLIES_INSTALLER : QUICK_REPLIES_STAFF).map(chip => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleQuickReplyClick(chip)}
                      className="px-2.5 py-1 rounded-full bg-white dark:bg-[#1E1238] border border-[#E9E5F0] dark:border-[#35105E] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] text-[#35105E] dark:text-[#E9D5FF] text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer shrink-0"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              )}

              {/* Composer OR Leader Read-Only Monitoring Banner */}
              {isLeader ? (
                <div className="p-3.5 bg-gradient-to-r from-[#F5F1FF] to-[#F4EAFF] dark:from-[#22123F] dark:to-[#160D29] border-t border-[#D8CCF3] dark:border-[#35105E] flex items-center justify-between gap-3 text-xs shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#5B35B1]/15 text-[#5B35B1] dark:text-[#D8B4FE] flex items-center justify-center shrink-0">
                      <Shield className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[#35105E] dark:text-white flex items-center gap-2 flex-wrap">
                        <span>Mode Pantau: Leader (Read-Only)</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FEF3C7] text-[#B45309] dark:bg-amber-950 dark:text-amber-300">
                          Hanya Pantau Percakapan
                        </span>
                      </div>
                      <p className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] mt-0.5 truncate max-w-xl">
                        Leader memantau percakapan untuk area {currentUser?.area || activeTicket.area || '-'} &amp; mitra{' '}
                        {currentUser?.contractor || activeTicket.contactorName || activeTicket.contractorName || '-'}. Pengiriman pesan dibatasi untuk Dispatch dan Teknisi Lapangan.
                      </p>
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                    <span className="w-2 h-2 rounded-full bg-[#16A36A] animate-pulse" />
                    <span className="text-[11px] font-mono text-[#16A36A] dark:text-emerald-300 font-bold">
                      Live Monitor
                    </span>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={handleSendMessage}
                  className="p-3 sm:px-4 sm:py-3 bg-white dark:bg-[#1A0E2E] border-t border-[#E9E5F0] dark:border-[#35105E] shrink-0 space-y-2"
                >
                  {/* Hidden file & camera inputs */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept="image/jpeg,image/png,image/webp,image/jpg"
                    multiple
                    className="hidden"
                  />
                  <input
                    type="file"
                    ref={cameraInputRef}
                    onChange={handleFileSelect}
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                  />

                  {/* Category Dropdown & Action Ribbon */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <select
                          value={composerCategory}
                          onChange={e => handleCategoryChange(e.target.value)}
                          aria-label="Pilih Kategori Pesan"
                          className={`pl-2.5 pr-7 py-1 rounded-lg text-[11px] font-bold appearance-none cursor-pointer focus:outline-none border ${
                            isInstaller && !composerCategory
                              ? 'bg-[#FEF3C7] border-[#E59A27] text-[#B45309]'
                              : 'bg-[#F5F1FF] dark:bg-[#2A194D] border-[#D8CCF3] dark:border-[#5B35B1] text-[#35105E] dark:text-[#E9D5FF]'
                          }`}
                        >
                          {isInstaller && !composerCategory && (
                            <option value="">-- Pilih Kategori Wajib --</option>
                          )}
                          {activeCategories.map(cat => (
                            <option key={cat.id} value={cat.name}>
                              #{cat.name}
                            </option>
                          ))}
                          {activeCategories.length === 0 && (
                            <option value="PROGRESS">#PROGRESS</option>
                          )}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>

                      <div className="h-4 w-px bg-[#E9E5F0] dark:bg-[#35105E]" />

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="p-1.5 rounded-lg text-[#766B83] hover:bg-[#F4EAFF] hover:text-[#7135B5] dark:text-[#CEC0E8] dark:hover:bg-[#35105E] transition-colors cursor-pointer"
                        title="Lampirkan File / Foto Bukti"
                        aria-label="Lampirkan File atau Foto"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="p-1.5 rounded-lg text-[#766B83] hover:bg-[#F4EAFF] hover:text-[#7135B5] dark:text-[#CEC0E8] dark:hover:bg-[#35105E] transition-colors cursor-pointer"
                        title="Ambil Foto Kamera / OPM"
                        aria-label="Ambil Foto Kamera"
                      >
                        <Camera className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] text-[#8B8495]">
                      <span>Tekan</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-[#F4EAFF] dark:bg-[#2A194D] text-[#35105E] dark:text-[#E9D5FF] font-semibold">
                        Ctrl + Enter
                      </kbd>
                      <span>untuk kirim</span>
                    </div>
                  </div>

                  {/* Input Box & Send Button */}
                  <div className="flex items-end gap-2.5">
                    <div className="flex-1">
                      <textarea
                        ref={textareaRef}
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        onKeyDown={e => {
                          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        rows={2}
                        placeholder={
                          isInstaller && !composerCategory
                            ? 'Pilih kategori chat terlebih dahulu (misal #PROGRESS untuk Check-in)...'
                            : `Ketik pesan balasan untuk ${activeTicket.woNumber} (${activeTicket.installerName || 'Tim'})...`
                        }
                        className="w-full p-2.5 bg-[#F7F6FA] dark:bg-[#22123F] border border-[#E9E5F0] dark:border-[#35105E] rounded-xl text-xs sm:text-sm text-[#211A2E] dark:text-white placeholder:text-[#8B8495] focus:outline-none focus:bg-white dark:focus:bg-[#1A0E2E] focus:border-[#A78BFA] focus:ring-1 focus:ring-[#A78BFA]/40 resize-none transition-all"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={
                        isSubmitting ||
                        (isInstaller && !composerCategory) ||
                        (!inputText.trim() && pendingAttachments.length === 0)
                      }
                      className="h-12 px-5 rounded-xl bg-gradient-to-r from-[#5B35B1] to-[#7135B5] hover:brightness-105 disabled:opacity-45 disabled:cursor-not-allowed text-white font-display font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer shrink-0"
                    >
                      <span>{isSubmitting ? 'Mengirim...' : 'Kirim'}</span>
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#8B8495] space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-[#F4EAFF] dark:bg-[#2A194D] text-[#7135B5] dark:text-[#D8B4FE] flex items-center justify-center">
                <MessageSquare className="w-7 h-7" />
              </div>
              <div className="font-display font-bold text-base text-[#211A2E] dark:text-white">
                Pilih Work Order untuk Membuka Percakapan
              </div>
              <p className="text-xs max-w-sm text-[#766B83] dark:text-[#CEC0E8]">
                Pilih salah satu tiket pada panel antrean di sebelah kiri untuk memantau atau mengirim pesan koordinasi lapangan.
              </p>
            </div>
          )}
          </section>

          {/* PANEL 4: Collapsible Detail Tiket WO Right Drawer & Vertical Collapsed Bar */}
          {!isMobileView && activeTicket && (
            isDetailPanelOpen ? (
              <aside
                id="ticketDetailPanel"
                className="hidden md:flex 2xl:static absolute right-0 inset-y-0 z-30 w-72 xl:w-80 bg-white dark:bg-[#1A0E2E] flex-col shrink-0 border-l border-[#E9E5F0] dark:border-[#35105E] shadow-2xl 2xl:shadow-none overflow-y-auto"
              >
                <div className="px-4 py-3 bg-[#F5F1FF]/70 dark:bg-[#22123F] border-b border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Info className="w-4 h-4 text-[#7135B5] dark:text-[#D8B4FE] shrink-0" />
                    <span className="font-display font-bold text-sm text-[#160D29] dark:text-white truncate">
                      Detail Tiket WO
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDetailPanelOpen(false)}
                    className="p-1.5 rounded-lg text-[#766B83] hover:bg-[#E9DDFF] hover:text-[#35105E] dark:text-[#CEC0E8] dark:hover:bg-[#35105E] transition-colors cursor-pointer"
                    title="Lipat Panel Detail"
                    aria-label="Lipat Panel Detail"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  {/* Identity Summary Card */}
                  <div className="p-3.5 rounded-xl bg-[#F5F1FF] dark:bg-[#22123F] border border-[#D8CCF3] dark:border-[#35105E] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-[#35105E] dark:text-[#D8B4FE]">
                        {activeTicket.woNumber}
                      </span>
                      {(activeTicket.appointmentType?.toLowerCase() === 'sameday' ||
                        (activeTicket.ticketCategory || '').toLowerCase().includes('express')) && (
                        <span className="px-2 py-0.5 rounded bg-[#7135B5] text-white text-[10px] font-bold uppercase">
                          EXPRESS
                        </span>
                      )}
                    </div>
                    <div className="font-display font-bold text-base text-[#211A2E] dark:text-white leading-snug">
                      {activeTicket.customerName}
                    </div>
                    {activeTicket.customerPhone && (
                      <div className="flex items-center gap-1.5 text-xs text-[#494453] dark:text-[#CEC0E8]">
                        <Phone className="w-3.5 h-3.5 text-[#766B83] shrink-0" />
                        <span className="font-mono">{activeTicket.customerPhone}</span>
                      </div>
                    )}
                    <div className="flex items-start gap-1.5 text-xs text-[#494453] dark:text-[#CEC0E8]">
                      <MapPin className="w-3.5 h-3.5 text-[#766B83] shrink-0 mt-0.5" />
                      {activeMapsInfo.url ? (
                        <a
                          href={activeMapsInfo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="leading-snug hover:text-[#431599] dark:hover:text-[#D8B4FE] underline-offset-2 hover:underline"
                        >
                          {activeTicket.streetName || activeTicket.address || activeMapsInfo.address || '-'}
                        </a>
                      ) : (
                        <span className="leading-snug">
                          {activeTicket.streetName || activeTicket.address || '-'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Teknis Jaringan & ODP */}
                  <div className="space-y-1.5">
                    <div className="text-[10.5px] font-bold text-[#8B8495] dark:text-[#A78BFA] uppercase tracking-wider">
                      Teknis Jaringan &amp; ODP
                    </div>
                    <div className="p-3 rounded-xl bg-white dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#8B8495]">Kode FAT:</span>
                        <span className="font-mono font-bold text-[#35105E] dark:text-[#D8B4FE]">
                          {activeTicket.fatCode || activeTicket.fat || '-'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#8B8495]">Port FAT:</span>
                        <span className="font-mono font-bold text-[#7135B5] dark:text-[#E9D5FF]">
                          {activeTicket.fatPort || '-'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#8B8495]">Kode FDT:</span>
                        <span className="font-mono text-[#494453] dark:text-[#CEC0E8]">
                          {activeTicket.fdtCode || activeTicket.fdt || '-'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#8B8495]">Redaman OPM:</span>
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            activeOpmValue
                              ? activeOpmValue.isOptimal
                                ? 'text-[#16A36A]'
                                : 'text-[#DC4C5A]'
                              : 'text-[#8B8495]'
                          }`}
                        >
                          {activeOpmValue ? activeOpmValue.display : 'Belum Terukur'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#8B8495]">OLT Uplink:</span>
                        <span className="font-mono text-[#494453] dark:text-[#CEC0E8] truncate max-w-[140px]">
                          {activeTicket.oltCode || '-'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#8B8495]">Estimasi Dropcore:</span>
                        <span className="font-semibold text-[#211A2E] dark:text-white">
                          {activeTicket.dropcoreLengthMeter
                            ? `${activeTicket.dropcoreLengthMeter} Meter`
                            : activeTicket.dropcoreLength || '-'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Informasi Lapangan */}
                  <div className="space-y-1.5">
                    <div className="text-[10.5px] font-bold text-[#8B8495] dark:text-[#A78BFA] uppercase tracking-wider">
                      Informasi Lapangan
                    </div>
                    <div className="p-3 rounded-xl bg-white dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#8B8495]">Teknisi:</span>
                        <span className="font-bold text-[#211A2E] dark:text-white truncate max-w-[150px]">
                          {activeTicket.installerName || 'Unassigned'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#8B8495]">Area Partner:</span>
                        <span className="font-semibold text-[#35105E] dark:text-[#D8B4FE] truncate max-w-[150px]">
                          {activeTicket.contactorName || activeTicket.contractorName || '-'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#8B8495]">Korlap / Leader:</span>
                        <span className="text-[#211A2E] dark:text-white truncate max-w-[150px]">
                          {activeTicket.leaderName || activeTicket.corlapName || '-'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#8B8495]">Area:</span>
                        <span className="text-[#494453] dark:text-[#CEC0E8] truncate max-w-[150px]">
                          {activeTicket.area || '-'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#8B8495]">Slot Waktu:</span>
                        <span className="px-2 py-0.5 rounded bg-[#F4EAFF] dark:bg-[#35105E] text-[10.5px] text-[#35105E] dark:text-[#E9D5FF] font-bold whitespace-nowrap">
                          {activeTicket.slotTime || '-'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Quick Modal Actions */}
                  {onSelectTicket && (
                    <div className="pt-1 space-y-2">
                      <button
                        type="button"
                        onClick={() => onSelectTicket(activeTicket, 'overview')}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#35105E] hover:bg-[#7135B5] text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                      >
                        <ClipboardList className="w-4 h-4" />
                        <span>Buka Tiket Lengkap</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectTicket(activeTicket, 'history')}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#F4EAFF] hover:bg-[#E9DDFF] dark:bg-[#2A194D] dark:hover:bg-[#35105E] text-[#35105E] dark:text-[#E9D5FF] text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <History className="w-4 h-4" />
                        <span>Riwayat Log Aktivitas</span>
                      </button>
                    </div>
                  )}
                </div>
              </aside>
            ) : (
              <div
                id="ticketCollapsedBar"
                onClick={() => setIsDetailPanelOpen(true)}
                className="hidden md:flex w-11 bg-white dark:bg-[#1A0E2E] hover:bg-[#F5F1FF] dark:hover:bg-[#22123F] border-l border-[#E9E5F0] dark:border-[#35105E] flex-col items-center py-3 gap-3 cursor-pointer shrink-0 transition-colors select-none"
                title="Buka Panel Detail Tiket"
              >
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setIsDetailPanelOpen(true);
                  }}
                  className="p-1.5 rounded-lg text-[#35105E] dark:text-[#D8B4FE] hover:bg-[#E9DDFF] dark:hover:bg-[#35105E] transition-colors cursor-pointer"
                  aria-label="Buka Panel Detail Tiket"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="w-6 h-px bg-[#E9E5F0] dark:bg-[#35105E]" />
                <div
                  className="flex items-center justify-center"
                  title={`Redaman OPM: ${activeOpmValue ? activeOpmValue.display : 'Belum Terukur'}`}
                >
                  <Activity
                    className={`w-4 h-4 ${
                      activeOpmValue
                        ? activeOpmValue.isOptimal
                          ? 'text-[#16A36A]'
                          : 'text-[#DC4C5A]'
                        : 'text-[#8B8495]'
                    }`}
                  />
                </div>
                <div
                  className="flex items-center justify-center text-[#7135B5] dark:text-[#A78BFA]"
                  title={`FAT: ${activeTicket.fatCode || activeTicket.fat || '-'}${
                    activeTicket.fatPort ? ` · Port ${activeTicket.fatPort}` : ''
                  }`}
                >
                  <Router className="w-4 h-4" />
                </div>
                <div className="w-6 h-px bg-[#E9E5F0] dark:bg-[#35105E]" />
                <div
                  className="text-[11px] font-bold text-[#35105E] dark:text-[#D8B4FE] tracking-wider uppercase truncate max-h-64"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                >
                  {activeTicket.woNumber} · {activeTicket.customerName}
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* Lightbox Zoom Modal */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-70 bg-black/90 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setZoomImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setZoomImage(null)}
              className="absolute top-3 right-3 p-2 bg-black/70 text-white rounded-full hover:bg-[#DC4C5A] transition-colors cursor-pointer z-10"
              aria-label="Tutup Zoom Foto"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={getSafePreviewUrl(zoomImage)}
              alt="Bukti Foto Zoom"
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
            />
          </div>
        </div>
      )}

      {/* Admin Chat Category Management Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1A0E2E] border border-[#D8CCF3] dark:border-[#35105E] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#5B35B1] text-white flex items-center justify-center font-bold">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-display font-bold text-[#35105E] dark:text-white">
                    Pengaturan Kategori Chat SOP (Contact Centre)
                  </h3>
                  <p className="text-[11px] text-[#766B83] dark:text-[#CEC0E8]">
                    Kelola channel SOP untuk pengelompokan antrean chat dan validasi Check-in teknisi.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsSettingsOpen(false);
                  setEditingCategory(null);
                }}
                className="p-1.5 rounded-lg text-[#8B8495] hover:text-[#211A2E] hover:bg-[#F7F6FA] dark:hover:bg-[#35105E] cursor-pointer"
                aria-label="Tutup Pengaturan Kategori"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
              {/* Add / Edit Form */}
              <div className="bg-[#F5F1FF] dark:bg-[#22123F] p-4 rounded-xl border border-[#D8CCF3] dark:border-[#35105E] space-y-3">
                <div className="text-xs font-bold text-[#35105E] dark:text-white flex items-center gap-2">
                  <Plus className="w-3.5 h-3.5" />
                  <span>{editingCategory ? 'Edit Kategori Chat' : 'Tambah Kategori Baru'}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="text-[10.5px] font-semibold text-[#766B83] dark:text-[#CEC0E8] block mb-1">
                      Nama Kategori
                    </label>
                    <input
                      type="text"
                      placeholder="Contoh: KENDALA_REDAMAN, RESCHEDULE_REQ..."
                      value={newCatName}
                      onChange={e => setNewCatName(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-xs text-[#211A2E] dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10.5px] font-semibold text-[#766B83] dark:text-[#CEC0E8] block mb-1">
                      Warna Indikator
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={newCatColor}
                        onChange={e => setNewCatColor(e.target.value)}
                        className="w-8 h-8 rounded border border-[#E9E5F0] cursor-pointer"
                      />
                      <span className="text-xs font-mono text-[#211A2E] dark:text-white">{newCatColor}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[10.5px] font-semibold text-[#766B83] dark:text-[#CEC0E8] block mb-1">
                    Deskripsi Operasional (Opsional)
                  </label>
                  <input
                    type="text"
                    placeholder="Keterangan alur penanganan tiket..."
                    value={newCatDesc}
                    onChange={e => setNewCatDesc(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-xs text-[#211A2E] dark:text-white"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  {editingCategory && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCategory(null);
                        setNewCatName('');
                        setNewCatDesc('');
                        setNewCatColor('#5B35B1');
                      }}
                      className="px-3 py-1.5 text-xs text-[#766B83] hover:bg-[#E9E5F0] dark:text-[#CEC0E8] dark:hover:bg-[#35105E] rounded-lg cursor-pointer"
                    >
                      Batal Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!newCatName.trim()) {
                        toast.error('Nama kategori tidak boleh kosong', 'Validasi Gagal');
                        return;
                      }
                      if (editingCategory) {
                        updateChatCategory(editingCategory.id, {
                          name: newCatName.trim().toUpperCase(),
                          color: newCatColor,
                          description: newCatDesc.trim()
                        });
                        setEditingCategory(null);
                      } else {
                        addChatCategory({
                          name: newCatName.trim().toUpperCase(),
                          color: newCatColor,
                          description: newCatDesc.trim(),
                          order: (chatCategories?.length || 0) + 1,
                          active: true,
                          isActive: true
                        });
                      }
                      setNewCatName('');
                      setNewCatDesc('');
                      setNewCatColor('#5B35B1');
                    }}
                    className="px-4 py-1.5 bg-[#5B35B1] hover:bg-[#35105E] text-white text-xs font-bold rounded-lg shadow-xs cursor-pointer"
                  >
                    {editingCategory ? 'Simpan Perubahan' : 'Tambahkan Kategori'}
                  </button>
                </div>
              </div>

              {/* Category List Table */}
              <div className="border border-[#E9E5F0] dark:border-[#35105E] rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F7F6FA] dark:bg-[#22123F] text-[#766B83] dark:text-[#CEC0E8]">
                    <tr>
                      <th className="p-3 w-10">Warna</th>
                      <th className="p-3">Nama Kategori</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E9E5F0] dark:divide-[#35105E]">
                    {(chatCategories || []).map(cat => {
                      const usageCount = tickets.filter(
                        t => (t.chatCategory || '').toUpperCase() === cat.name.toUpperCase()
                      ).length;

                      return (
                        <tr key={cat.id} className="hover:bg-[#F7F6FA] dark:hover:bg-[#22123F]/50">
                          <td className="p-3">
                            <span
                              className="inline-block w-4 h-4 rounded-full shadow-2xs"
                              style={{ backgroundColor: cat.color }}
                            />
                          </td>
                          <td className="p-3">
                            <div className="font-bold text-[#211A2E] dark:text-white">#{cat.name}</div>
                            {cat.description && (
                              <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8]">
                                {cat.description}
                              </div>
                            )}
                            <div className="text-[10px] text-[#8B8495] font-mono mt-0.5 tabular-nums">
                              Digunakan pada {usageCount} tiket
                            </div>
                          </td>
                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => toggleChatCategoryActive(cat.id)}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer ${
                                cat.isActive !== false && cat.active !== false
                                  ? 'bg-[#ECFDF5] text-[#16A36A] dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-[#F7F6FA] text-[#766B83] dark:bg-slate-800 dark:text-slate-400'
                              }`}
                            >
                              {cat.isActive !== false && cat.active !== false ? 'Aktif' : 'Nonaktif'}
                            </button>
                          </td>
                          <td className="p-3 text-right space-x-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCategory(cat);
                                setNewCatName(cat.name);
                                setNewCatColor(cat.color);
                                setNewCatDesc(cat.description || '');
                              }}
                              className="p-1.5 text-[#5B35B1] hover:bg-[#F4EAFF] dark:text-[#D8B4FE] dark:hover:bg-[#35105E] rounded cursor-pointer"
                              title="Edit Kategori"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteChatCategory(cat.id)}
                              className="p-1.5 text-[#DC4C5A] hover:bg-[#FEF2F2] dark:hover:bg-rose-950 rounded cursor-pointer"
                              title="Hapus Kategori"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 border-t border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#160D29] flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsSettingsOpen(false);
                  setEditingCategory(null);
                }}
                className="px-4 py-2 bg-[#5B35B1] text-white text-xs font-bold rounded-xl hover:bg-[#35105E] cursor-pointer"
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
