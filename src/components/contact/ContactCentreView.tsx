import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { Ticket, TicketMessage, ChatAttachment, UserRole, ChatCategoryConfig } from '../../types';
import {
  MessageSquare,
  Search,
  Send,
  Image as ImageIcon,
  Camera,
  Shield,
  Wrench,
  Building2,
  CheckCheck,
  Check,
  Phone,
  Maximize2,
  X,
  AlertCircle,
  CheckCircle2,
  Tag,
  Settings,
  Trash2,
  Edit2,
  MapPin,
  Clock,
  Headphones,
  PanelRightOpen,
  PanelRightClose,
  RefreshCw,
  Zap,
  Bot,
  ShieldCheck,
  ArrowLeft,
  FileText,
  Radio,
  WifiOff,
  Loader2
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { formatIndonesianWODate } from '../../services/woDateFilterEngine';
import { buildGoogleMapsSearchUrl } from '../../services/mapsService';
import { getSafePreviewUrl, formatFileSize } from '../../services/storageCompatibility';
import { formatJakartaTimeOnly } from '../../services/workSessionService';
import { ContactTicketDetailDrawer } from './ContactTicketDetailDrawer';
import { MessageStatusReceipt } from '../chat/MessageStatusReceipt';

interface ContactCentreViewProps {
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
  initialTicketId?: string;
}

const getInitials = (name?: string): string => {
  if (!name) return 'MJ';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('');
};

const formatWibTime = (isoOrDate?: string): string => {
  if (!isoOrDate) return '-';
  try {
    return (
      new Date(isoOrDate).toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit'
      }) + ' WIB'
    );
  } catch {
    return '-';
  }
};

export const ContactCentreView: React.FC<ContactCentreViewProps> = ({
  onSelectTicket,
  onOpenWhatsApp,
  initialTicketId
}) => {
  const { isMobileView } = useUIConfig();
  const {
    scopedTickets,
    tickets,
    currentUser,
    todayWIB,
    ticketMessages,
    totalLiveChatUnreadCount,
    sendTicketMessage,
    markTicketMessagesAsRead,
    getMessagesForTicket,
    getTicketUnreadCount,
    chatCategories,
    addChatCategory,
    updateChatCategory,
    deleteChatCategory,
    toggleChatCategoryActive,
    setTicketChatCategory,
    databaseStatus,
    syncStatus,
    refreshDatabaseData
  } = useApp();
  const { isOnline } = useOfflineSync();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>(() =>
    !initialTicketId && totalLiveChatUnreadCount > 0 ? 'all_unread' : 'all'
  ); // 'all', 'all_unread', or categoryId
  const [selectedTicketId, setSelectedTicketId] = useState<string>(initialTicketId || '');
  const [inputText, setInputText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [brokenImageIds, setBrokenImageIds] = useState<Record<string, boolean>>({});

  // Full Chat Mode: Detail Drawer collapsed by default for maximum chat canvas
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);
  // Mobile view switch between queue list & chat thread
  const [mobilePane, setMobilePane] = useState<'queue' | 'chat'>('queue');

  // Quick template popover state for Dispatch/Super Admin
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);

  // Settings Modal State for Super Admin / Dispatch
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ChatCategoryConfig | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#5B35B1');
  const [newCatDesc, setNewCatDesc] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const userRole = currentUser?.role || 'installer';
  const isLeader = userRole === 'leader';
  const isInstaller = userRole === 'installer';
  const canManageCategories = userRole === 'super_admin' || userRole === 'dispatch';

  // Sync initialTicketId if passed externally
  useEffect(() => {
    if (initialTicketId) {
      setSelectedTicketId(initialTicketId);
      setMobilePane('chat');
    }
  }, [initialTicketId]);

  // 1A. Available tickets for current user role - Strict RBAC scopedTickets + todayWIB (or active unread chat)
  const availableTickets = useMemo(() => {
    return (scopedTickets || []).filter(t => {
      if (!t || t.isArchived || t.isDeleted) return false;
      const unread = getTicketUnreadCount(t.id);
      const isToday = getTicketAppointmentDate(t) === todayWIB;
      if (!isToday && unread === 0 && t.id !== initialTicketId && t.id !== selectedTicketId) {
        return false;
      }

      if (userRole === 'installer') {
        return true; // scopedTickets already restricts installer strictly to their assigned WOs
      }

      const hasInstallerAssignment = Boolean(
        (t.installerName && t.installerName.trim() && t.installerName.toLowerCase() !== 'unassigned') ||
          (t.installerId && t.installerId.trim()) ||
          (t.assignedToUid && t.assignedToUid.trim())
      );
      return hasInstallerAssignment || unread > 0;
    });
  }, [scopedTickets, todayWIB, userRole, getTicketUnreadCount, initialTicketId, selectedTicketId]);

  // Unique active technicians count for left panel footer
  const activeTechnicianCount = useMemo(() => {
    const set = new Set<string>();
    availableTickets.forEach(t => {
      if (t.installerName && t.installerName.trim()) {
        set.add(t.installerName.trim().toLowerCase());
      }
    });
    return set.size;
  }, [availableTickets]);

  // Search filter across customer name, WO, ID, phone, technician, and chat messages
  const searchFilteredTickets = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return availableTickets;

    return availableTickets.filter(t => {
      const matchWo = (t.woNumber ? String(t.woNumber).toLowerCase() : '').includes(q);
      const matchCust = (t.customerName ? String(t.customerName).toLowerCase() : '').includes(q);
      const matchCid = (t.idCustomer || t.customerId || '').toLowerCase().includes(q);
      const matchPhone = (t.customerPhone || '').includes(q);
      const matchInst = (t.installerName || '').toLowerCase().includes(q);

      const messages = getMessagesForTicket(t.id);
      const matchMessage = messages.some(m => (m.text || '').toLowerCase().includes(q));

      return matchWo || matchCust || matchCid || matchPhone || matchInst || matchMessage;
    });
  }, [availableTickets, searchQuery, getMessagesForTicket, ticketMessages]);

  // Group tickets by Chat Category
  const groupedTickets = useMemo(() => {
    const activeCats = (chatCategories || []).filter(c => c.isActive !== false && (c as any).active !== false);
    const groups: {
      category: ChatCategoryConfig;
      tickets: Ticket[];
      unreadCount: number;
    }[] = [];

    activeCats.forEach(cat => {
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

    const activeCatKeys = new Set(activeCats.flatMap(c => [c.id.toUpperCase(), c.name.toUpperCase()]));
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
  }, [chatCategories, searchFilteredTickets, getTicketUnreadCount]);

  // Overall unread count across all assigned tickets
  const totalUnreadCount = useMemo(() => {
    return availableTickets.reduce((acc, t) => acc + getTicketUnreadCount(t.id), 0);
  }, [availableTickets, getTicketUnreadCount, ticketMessages]);

  const allUnreadTickets = useMemo(() => {
    return searchFilteredTickets.filter(t => getTicketUnreadCount(t.id) > 0);
  }, [searchFilteredTickets, getTicketUnreadCount, ticketMessages]);

  // Sorted conversation list (unread/latest activity first)
  const conversationList = useMemo(() => {
    let base: Ticket[];
    if (activeCategoryFilter === 'all_unread') {
      base = allUnreadTickets;
    } else if (activeCategoryFilter !== 'all') {
      const group = groupedTickets.find(g => g.category.id === activeCategoryFilter);
      base = group ? group.tickets : [];
    } else {
      base = searchFilteredTickets;
    }

    return [...base].sort((a, b) => {
      const unreadA = getTicketUnreadCount(a.id);
      const unreadB = getTicketUnreadCount(b.id);
      if (unreadA !== unreadB) return unreadB - unreadA;
      const timeA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const timeB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      if (timeA !== timeB) return timeB - timeA;
      return String(a.woNumber || '').localeCompare(String(b.woNumber || ''));
    });
  }, [activeCategoryFilter, allUnreadTickets, groupedTickets, searchFilteredTickets, getTicketUnreadCount]);

  // Auto-select first ticket if current selection is missing or invalid
  useEffect(() => {
    if (!selectedTicketId && conversationList.length > 0) {
      setSelectedTicketId(conversationList[0].id);
    } else if (
      selectedTicketId &&
      !availableTickets.some(t => t.id === selectedTicketId) &&
      conversationList.length > 0
    ) {
      setSelectedTicketId(conversationList[0].id);
    }
  }, [conversationList, selectedTicketId, availableTickets]);

  const activeTicket = useMemo(() => {
    return availableTickets.find(t => t.id === selectedTicketId) || conversationList[0] || null;
  }, [availableTickets, selectedTicketId, conversationList]);

  const activeMessages = useMemo(() => {
    if (!activeTicket) return [];
    return getMessagesForTicket(activeTicket.id);
  }, [activeTicket, getMessagesForTicket, ticketMessages]);

  // Installer category selection state
  const [installerCategory, setInstallerCategory] = useState<string>('');
  useEffect(() => {
    if (!activeTicket) {
      setInstallerCategory('');
      return;
    }
    const existing = activeTicket.chatCategory?.trim();
    if (existing && existing.toUpperCase() !== 'UNCLASSIFIED') {
      setInstallerCategory(existing);
    } else {
      setInstallerCategory('');
    }
  }, [activeTicket?.id, activeTicket?.chatCategory]);

  const activeCategories = useMemo(() => {
    const seen = new Set<string>();
    return (chatCategories || []).filter(c => {
      if (c.isActive === false || (c as any).active === false) return false;
      const upper = String(c.name || '').trim().toUpperCase();
      if (!upper || upper === 'UNCLASSIFIED' || seen.has(upper)) return false;
      seen.add(upper);
      return true;
    });
  }, [chatCategories]);

  // Auto mark read ONLY when conversation is genuinely visible to user
  // (desktop pane or mobile chat pane open, AND browser tab visible)
  useEffect(() => {
    const tryMarkRead = () => {
      if (!activeTicket) return;
      if (isMobileView && mobilePane !== 'chat') return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (getTicketUnreadCount(activeTicket.id) > 0) {
        markTicketMessagesAsRead(activeTicket.id);
      }
    };

    tryMarkRead();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        tryMarkRead();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [activeTicket?.id, activeMessages.length, isMobileView, mobilePane, getTicketUnreadCount, markTicketMessagesAsRead]);

  // Auto scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, activeTicket?.id]);

  // Keyboard shortcut Shift + D to toggle Ticket Detail Drawer (safely ignored inside text inputs)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!activeTicket) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setIsDetailDrawerOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTicket]);

  const handleRefreshQueue = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshDatabaseData();
      toast.success('Antrean LiveChat disinkronkan dengan server.');
    } catch {
      toast.error('Gagal menyegarkan data LiveChat.');
    } finally {
      setIsRefreshing(false);
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

    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleSendMessage = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!activeTicket || isSubmitting) return;

      if (isLeader) {
        toast.error(
          'Akses Ditolak: Role Leader hanya berfungsi sebagai pemantauan percakapan (Read-Only).',
          'Akses Dibatasi'
        );
        return;
      }

      if (isInstaller && (!installerCategory || installerCategory.toUpperCase() === 'UNCLASSIFIED')) {
        const msg = 'Pilih kategori chat terlebih dahulu (mis. PROGRESS) sebelum mengirim pesan.';
        setErrorMessage(msg);
        toast.error(msg, 'Kategori Wajib Dipilih');
        return;
      }

      if (!inputText.trim() && pendingAttachments.length === 0) return;

      setIsSubmitting(true);
      try {
        // Role rule:
        // - Installer: wajib menyertakan kategori terpilih dari master DB
        // - Dispatch & Superadmin: kategori opsional / bebas, tidak menyuntikkan fallback kategori
        const chosenCategory = isInstaller ? installerCategory : undefined;

        const res = await sendTicketMessage(activeTicket.id, inputText.trim(), pendingAttachments, chosenCategory);

        if (res.success) {
          setInputText('');
          setPendingAttachments([]);
          setErrorMessage(null);
          setShowTemplateMenu(false);
        } else {
          setErrorMessage(res.error || 'Gagal mengirim pesan.');
          toast.error(res.error || 'Gagal mengirim pesan.', 'Error');
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeTicket, isSubmitting, isLeader, isInstaller, installerCategory, inputText, pendingAttachments, sendTicketMessage, toast]
  );

  const handleCategoryChangeForActiveTicket = (categoryName: string) => {
    if (!activeTicket || isLeader) return;
    setTicketChatCategory(activeTicket.id, categoryName);
    if (isInstaller) {
      setInstallerCategory(categoryName);
    }
    toast.success(`Kategori chat diperbarui menjadi "${categoryName}".`, 'Kategori Diperbarui');
  };

  const insertQuickReply = (text: string) => {
    setInputText(prev => (prev.trim() ? `${prev.trim()} ${text}` : text));
    setShowTemplateMenu(false);
    setTimeout(() => {
      composerRef.current?.focus();
    }, 30);
  };

  const quickReplyChips = useMemo(() => {
    if (isInstaller) {
      return [
        'Teknisi sudah tiba di lokasi pelanggan (Check-in On Site).',
        'Pengecekan redaman FAT: normal (di bawah -20 dBm).',
        'Kendala redaman drop / tiang jauh, mohon arahan.',
        'Pemasangan ONT selesai, internet aktif & stabil.',
        'Mohon verifikasi approval laporan dari Dispatch.'
      ];
    }
    return [
      'Mohon cek redaman OPM di FAT terlebih dahulu (< -20 dBm).',
      'Kirim ulang foto barcode MAC & SN ONT saat unboxing.',
      'Koordinasi Korlap segera terkait kendala di lapangan.',
      'Lanjutkan tarikan dropcore & konfigurasi ONT pelanggan.',
      'Laporan diterima, tim Dispatch segera lakukan verifikasi.'
    ];
  }, [isInstaller]);

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'dispatch':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#E8DDFF] text-[#40208D] dark:bg-[#35105E] dark:text-[#D8B4FE] font-mono text-[10px] font-bold uppercase whitespace-nowrap">
            Dispatch Lead
          </span>
        );
      case 'installer':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#ECFDF5] text-[#16A36A] dark:bg-emerald-950/70 dark:text-emerald-300 font-mono text-[10px] font-bold uppercase whitespace-nowrap">
            Teknisi
          </span>
        );
      case 'leader':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#B45309] dark:bg-amber-950/70 dark:text-amber-300 font-mono text-[10px] font-bold uppercase whitespace-nowrap">
            Korlap
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#F0E3FF] text-[#431599] dark:bg-purple-950 dark:text-purple-300 font-mono text-[10px] font-bold uppercase whitespace-nowrap">
            Super Admin
          </span>
        );
    }
  };

  // Active ticket maps & whatsapp links
  const activeTicketMapsUrl = useMemo(() => {
    if (!activeTicket) return '';
    if (activeTicket.latitude && activeTicket.longitude) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${activeTicket.latitude},${activeTicket.longitude}`
      )}`;
    }
    return buildGoogleMapsSearchUrl(activeTicket).url;
  }, [activeTicket]);

  const activeTicketPhone = activeTicket?.customerPhone || activeTicket?.installerContact || '';
  const cleanWaPhone = activeTicketPhone.replace(/[^0-9]/g, '').replace(/^0/, '62');
  const isStreamLive = databaseStatus === 'connected' && isOnline;
  const formattedTodayLabel = formatIndonesianWODate(todayWIB);

  const renderQueueCard = (t: Ticket) => {
    const isSelected = t.id === activeTicket?.id;
    const unread = getTicketUnreadCount(t.id);
    const msgs = getMessagesForTicket(t.id);
    const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    const catConfig = (chatCategories || []).find(
      c =>
        c.name.toUpperCase() === (t.chatCategory || '').toUpperCase() ||
        c.id.toUpperCase() === (t.chatCategory || '').toUpperCase()
    );
    const categoryLabel = catConfig?.name || (t.chatCategory && t.chatCategory.toUpperCase() !== 'UNCLASSIFIED' ? t.chatCategory : 'UMUM');
    const lastTime = lastMsg?.timestamp || t.lastMessageAt;
    const isUrgent =
      (t.ticketCategory || '').toUpperCase().includes('SAMEDAY') ||
      (t.ticketCategory || '').toUpperCase().includes('EXPRESS') ||
      (t.appointmentType || '').toUpperCase().includes('SAMEDAY');

    return (
      <button
        key={t.id}
        type="button"
        onClick={() => {
          setSelectedTicketId(t.id);
          setMobilePane('chat');
        }}
        className={`w-full text-left p-3.5 transition-colors flex flex-col gap-1.5 cursor-pointer border-b border-[#E9E5F0] dark:border-[#35105E]/60 ${
          isSelected
            ? 'bg-[#F5F1FF] dark:bg-[#2B1554] ring-1 ring-inset ring-[#7135B5]/35'
            : 'bg-white dark:bg-[#1A0E2E] hover:bg-[#F7F6FA] dark:hover:bg-[#22123F]'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs font-bold text-[#35105E] dark:text-[#D8B4FE] truncate tabular-nums">
            {t.woNumber}
          </span>
          <span className="font-mono text-[11px] text-[#8B8495] dark:text-[#A78BFA] shrink-0 tabular-nums">
            {lastTime ? formatWibTime(lastTime) : t.slotTime || '-'}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-[13px] font-bold text-[#211A2E] dark:text-white truncate">
            {t.customerName}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {isUrgent && (
              <span className="px-1.5 py-0.5 rounded bg-[#DC4C5A] text-white text-[9px] font-extrabold uppercase tracking-wider">
                EXPRESS
              </span>
            )}
            {unread > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-[#DC4C5A] text-white text-[9.5px] font-mono font-bold tabular-nums">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-[#766B83] dark:text-[#CEC0E8] truncate">
          {lastMsg ? (
            <>
              <span className="font-semibold text-[#7135B5] dark:text-[#D8B4FE]">
                {lastMsg.senderName?.split(' ')[0]}:
              </span>{' '}
              {lastMsg.text || (lastMsg.attachments?.length ? `[${lastMsg.attachments.length} Foto Bukti]` : '')}
            </>
          ) : (
            <>
              <span className="font-semibold text-[#16A36A] dark:text-emerald-400">
                {t.installerName || 'Teknisi'}:
              </span>{' '}
              {t.lastMessageSnippet || 'Channel siap koordinasi lapangan'}
            </>
          )}
        </p>

        <div className="flex items-center justify-between gap-2 pt-1 text-[10.5px]">
          {t.chatCategory && t.chatCategory.toUpperCase() !== 'UNCLASSIFIED' ? (
            <span
              className="font-mono font-bold truncate"
              style={{ color: catConfig?.color || '#7135B5' }}
            >
              #{categoryLabel}
            </span>
          ) : (
            <span className="font-mono text-[#8B8495] truncate">
              {t.area || t.serviceType || 'LiveChat'}
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-[#F4EAFF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] font-bold uppercase text-[9.5px] tracking-wide shrink-0">
            {t.statusWOInstaller || 'Assigned'}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col w-full h-full min-h-0 flex-1 overflow-hidden bg-[#F7F6FA] dark:bg-[#160D29]">
      {/* 1. Top Operational Telemetry & Breadcrumb Strip */}
      <div className="hidden sm:flex px-4 sm:px-5 py-2 bg-white dark:bg-[#1A0E2E] border-b border-[#E9E5F0] dark:border-[#35105E] flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-[#8B8495] dark:text-[#CEC0E8] truncate">
            <span className="font-medium">MoraJaws</span>
            <span aria-hidden="true">/</span>
            <span className="font-medium">Contact Centre</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#7135B5] dark:text-[#D8B4FE] font-bold flex items-center gap-1.5 truncate">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isStreamLive ? 'bg-[#16A36A] animate-pulse' : 'bg-[#E59A27]'
                }`}
              />
              <span>LiveChat (Full Chat Mode)</span>
            </span>
          </div>

          {activeTicket?.ticketCategory && (
            <span className="hidden md:inline-flex px-2.5 py-0.5 rounded-full bg-[#F4EAFF] dark:bg-[#35105E] font-mono text-[10.5px] text-[#40208D] dark:text-[#D8B4FE] font-bold uppercase tracking-tight whitespace-nowrap">
              {activeTicket.ticketCategory}
            </span>
          )}
        </div>

        {/* Real Operational Status Indicators */}
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wide whitespace-nowrap ${
              isStreamLive
                ? 'bg-[#F0E3FF] dark:bg-[#35105E] text-[#35105E] dark:text-[#D8B4FE]'
                : 'bg-[#FEF3C7] dark:bg-amber-950/60 text-[#B45309] dark:text-amber-300'
            }`}
          >
            {isStreamLive ? (
              <>
                <Radio className="w-3 h-3 text-[#16A36A]" />
                <span>SSE Stream Active</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3" />
                <span>Mode Lokal / Offline</span>
              </>
            )}
          </div>

          <div
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap ${
              databaseStatus === 'connected'
                ? 'bg-[#ECFDF5] dark:bg-emerald-950/50 text-[#16A36A] dark:text-emerald-300'
                : 'bg-[#F7F6FA] dark:bg-[#22123F] text-[#766B83] dark:text-[#CEC0E8]'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            <span>
              {databaseStatus === 'connected'
                ? `Supabase Cluster Live · ${syncStatus}`
                : `Status DB: ${syncStatus}`}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Persistent Expanded LiveChat Header (Selected Ticket) */}
      {activeTicket && (
        <div className="px-4 sm:px-5 py-3 bg-white dark:bg-[#1A0E2E] border-b border-[#E9E5F0] dark:border-[#35105E] shadow-2xs flex flex-col xl:flex-row xl:items-center justify-between gap-3 shrink-0">
          {/* Work Order Primary Identity */}
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#35105E] to-[#5B35B1] text-white flex items-center justify-center shadow-sm shrink-0">
              <Headphones className="w-5 h-5" />
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-base sm:text-lg font-extrabold text-[#35105E] dark:text-[#D8B4FE] tracking-tight tabular-nums">
                  {activeTicket.woNumber}
                </span>
                {(activeTicket.ticketCategory || activeTicket.appointmentType) && (
                  <span className="px-2 py-0.5 rounded-full bg-[#DC4C5A] text-white text-[10px] font-extrabold uppercase tracking-wider whitespace-nowrap">
                    {activeTicket.ticketCategory || activeTicket.appointmentType}
                  </span>
                )}
                <span className="text-[#CBC3D5] dark:text-[#5B35B1] hidden sm:inline">|</span>
                <span className="font-display text-sm sm:text-base font-bold text-[#211A2E] dark:text-white truncate max-w-[260px]">
                  {activeTicket.customerName}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-[#F4EAFF] dark:bg-[#35105E] font-mono text-[11px] font-semibold text-[#494453] dark:text-[#D8B4FE] whitespace-nowrap">
                  ID: {activeTicket.idCustomer || activeTicket.customerId || '-'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#766B83] dark:text-[#CEC0E8]">
                <span className="inline-flex items-center gap-1.5 font-semibold text-[#211A2E] dark:text-white">
                  <Wrench className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#A78BFA] shrink-0" />
                  <span>{activeTicket.installerName || 'Belum Ditugaskan'}</span>
                  {(activeTicket.contactorName || activeTicket.contractorName) && (
                    <span className="font-normal text-[#766B83] dark:text-[#A78BFA]">
                      ({activeTicket.contactorName || activeTicket.contractorName})
                    </span>
                  )}
                </span>

                {activeTicket.slotTime && (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>{activeTicket.slotTime}</span>
                  </span>
                )}

                {(activeTicket.address || activeTicket.streetName || activeTicket.area) && (
                  <span className="inline-flex items-center gap-1 truncate max-w-md">
                    <MapPin className="w-3.5 h-3.5 shrink-0 text-[#DC4C5A]" />
                    <span className="truncate">
                      {[activeTicket.clusterName, activeTicket.address || activeTicket.streetName, activeTicket.area]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 4-Dimension Operational Matrix & Quick Action Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-2.5 shrink-0">
            {/* 4-Dimension Badges Grid */}
            <div className="hidden sm:grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1.5 bg-[#F5F1FF] dark:bg-[#22123F] rounded-xl border border-[#E9E5F0] dark:border-[#35105E]">
              <div className="px-2.5 py-1 bg-white dark:bg-[#160D29] rounded-lg">
                <div className="text-[9.5px] font-bold uppercase tracking-wider text-[#8B8495] whitespace-nowrap">
                  Agent Workflow
                </div>
                <div className="text-[11px] font-extrabold text-[#40208D] dark:text-[#D8B4FE] flex items-center gap-1 whitespace-nowrap mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7135B5] shrink-0" />
                  <span className="uppercase">{activeTicket.statusWOAgent || 'Pending'}</span>
                </div>
              </div>

              <div className="px-2.5 py-1 bg-white dark:bg-[#160D29] rounded-lg">
                <div className="text-[9.5px] font-bold uppercase tracking-wider text-[#8B8495] whitespace-nowrap">
                  Installer Stage
                </div>
                <div className="text-[11px] font-extrabold text-[#3977C9] dark:text-sky-300 flex items-center gap-1 whitespace-nowrap mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3977C9] shrink-0" />
                  <span className="uppercase">{activeTicket.statusWOInstaller || 'Assigned'}</span>
                </div>
              </div>

              <div className="px-2.5 py-1 bg-white dark:bg-[#160D29] rounded-lg">
                <div className="text-[9.5px] font-bold uppercase tracking-wider text-[#8B8495] whitespace-nowrap">
                  WA Status
                </div>
                <div className="text-[11px] font-extrabold text-[#16A36A] dark:text-emerald-300 flex items-center gap-1 whitespace-nowrap mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#16A36A] shrink-0" />
                  <span className="uppercase">
                    {(activeTicket.statusWhatsApp || 'not_prepared').replace(/_/g, ' ')}
                  </span>
                </div>
              </div>

              <div
                className={`px-2.5 py-1 rounded-lg border ${
                  activeTicket.approvalStatus === 'BUTUH APPROVAL'
                    ? 'bg-[#E59A27]/12 border-[#E59A27]/35'
                    : activeTicket.approvalStatus === 'APPROVED'
                    ? 'bg-[#ECFDF5] dark:bg-emerald-950/40 border-[#16A36A]/30'
                    : activeTicket.approvalStatus === 'REJECTED'
                    ? 'bg-[#FEF2F2] dark:bg-rose-950/40 border-[#DC4C5A]/30'
                    : 'bg-white dark:bg-[#160D29] border-transparent'
                }`}
              >
                <div
                  className={`text-[9.5px] font-bold uppercase tracking-wider whitespace-nowrap ${
                    activeTicket.approvalStatus === 'BUTUH APPROVAL'
                      ? 'text-[#B45309] dark:text-amber-300'
                      : 'text-[#8B8495]'
                  }`}
                >
                  Approval Gov
                </div>
                <div
                  className={`text-[11px] font-extrabold whitespace-nowrap mt-0.5 ${
                    activeTicket.approvalStatus === 'BUTUH APPROVAL'
                      ? 'text-[#B45309] dark:text-amber-200'
                      : activeTicket.approvalStatus === 'APPROVED'
                      ? 'text-[#16A36A] dark:text-emerald-300'
                      : activeTicket.approvalStatus === 'REJECTED'
                      ? 'text-[#DC4C5A] dark:text-rose-300'
                      : 'text-[#766B83] dark:text-[#CEC0E8]'
                  }`}
                >
                  {activeTicket.approvalStatus || 'NONE'}
                </div>
              </div>
            </div>

            {/* Quick Action Controls + Drawer Toggle */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeTicketPhone ? (
                <a
                  href={`tel:${activeTicketPhone}`}
                  className="px-2.5 py-2 rounded-lg bg-[#F7F6FA] dark:bg-[#22123F] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] text-[#211A2E] dark:text-white border border-[#E9E5F0] dark:border-[#35105E] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  title={`Hubungi ${activeTicketPhone}`}
                >
                  <Phone className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#A78BFA]" />
                  <span className="hidden sm:inline">Hubungi</span>
                </a>
              ) : null}

              {onOpenWhatsApp ? (
                <button
                  type="button"
                  onClick={() => onOpenWhatsApp(activeTicket)}
                  className="px-2.5 py-2 rounded-lg bg-[#16A36A] hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  title="Buka WhatsApp Pelanggan"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>wa.me</span>
                </button>
              ) : (
                cleanWaPhone && (
                  <a
                    href={`https://wa.me/${cleanWaPhone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-2 rounded-lg bg-[#16A36A] hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition-colors whitespace-nowrap shrink-0"
                    title="Buka Sesi WhatsApp"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>wa.me</span>
                  </a>
                )
              )}

              {activeTicketMapsUrl && (
                <a
                  href={activeTicketMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-2 rounded-lg bg-[#F7F6FA] dark:bg-[#22123F] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] text-[#211A2E] dark:text-white border border-[#E9E5F0] dark:border-[#35105E] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  title="Buka Lokasi di Google Maps"
                >
                  <MapPin className="w-3.5 h-3.5 text-[#3977C9]" />
                  <span className="hidden sm:inline">Peta</span>
                </a>
              )}

              {/* Prominent Toggle for Collapsible Right Ticket Detail Drawer */}
              <button
                type="button"
                onClick={() => setIsDetailDrawerOpen(prev => !prev)}
                aria-expanded={isDetailDrawerOpen}
                data-testid="toggle-ticket-detail-drawer"
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#35105E] hover:bg-[#7135B5] text-white shadow-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {isDetailDrawerOpen ? (
                  <PanelRightClose className="w-4 h-4 text-[#D8B4FE] shrink-0" />
                ) : (
                  <PanelRightOpen className="w-4 h-4 text-[#D8B4FE] shrink-0" />
                )}
                <div className="flex flex-col text-left leading-tight">
                  <span className="text-[11px] font-bold">
                    {isDetailDrawerOpen ? 'Tutup Detail' : 'Buka Detail Tiket'}
                  </span>
                  <span className="text-[9.5px] text-[#A78BFA] font-mono">Shift + D</span>
                </div>
                <span className="ml-0.5 px-1.5 py-0.5 rounded text-[9.5px] font-mono bg-white/10 border border-white/20">
                  {isDetailDrawerOpen ? 'Open' : 'Collapsed'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Main Multi-Panel Operational Canvas */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* LEFT PANEL: Conversation Queues & Categories */}
        <aside
          className={`${
            isMobileView || mobilePane === 'chat'
              ? isMobileView
                ? mobilePane === 'queue'
                  ? 'flex w-full'
                  : 'hidden'
                : 'hidden lg:flex lg:w-72 xl:w-80'
              : 'flex w-full lg:w-72 xl:w-80'
          } bg-white dark:bg-[#1A0E2E] border-r border-[#E9E5F0] dark:border-[#35105E] flex-col shrink-0 min-h-0 overflow-hidden`}
        >
          {/* Sticky Search & Filter Header */}
          <div className="sticky top-0 z-10 p-3 border-b border-[#E9E5F0] dark:border-[#35105E] space-y-2.5 bg-[#F7F6FA] dark:bg-[#201138] shrink-0">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-[#8B8495] absolute left-2.5 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari WO, Pelanggan, Teknisi..."
                className="w-full pl-8 pr-8 py-1.5 bg-white dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-xs text-[#211A2E] dark:text-white placeholder:text-[#8B8495] focus:outline-none focus:border-[#7135B5] focus:ring-1 focus:ring-[#D8B4FE]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 text-[#8B8495] hover:text-[#211A2E] dark:hover:text-white cursor-pointer"
                  aria-label="Hapus pencarian"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Segmented Quick Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-xs">
              <button
                type="button"
                onClick={() => setActiveCategoryFilter('all_unread')}
                className={`px-2.5 py-1 rounded-full font-semibold whitespace-nowrap transition-colors cursor-pointer tabular-nums flex items-center gap-1 ${
                  activeCategoryFilter === 'all_unread'
                    ? 'bg-[#DC4C5A] text-white shadow-2xs'
                    : 'bg-[#FEF2F2] dark:bg-rose-950/50 text-[#DC4C5A] dark:text-rose-300 hover:bg-rose-100'
                }`}
              >
                <span>Chat Baru / Unread</span>
                <span className="font-mono">({allUnreadTickets.length} WO · {totalUnreadCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveCategoryFilter('all')}
                className={`px-2.5 py-1 rounded-full font-semibold whitespace-nowrap transition-colors cursor-pointer tabular-nums ${
                  activeCategoryFilter === 'all'
                    ? 'bg-[#35105E] text-white shadow-2xs'
                    : 'bg-[#F4EAFF] dark:bg-[#22123F] text-[#35105E] dark:text-[#D8B4FE] hover:bg-[#EADDFA]'
                }`}
              >
                Semua WO ({searchFilteredTickets.length})
              </button>

              {groupedTickets.slice(0, 2).map(g => {
                const isSelected = activeCategoryFilter === g.category.id;
                return (
                  <button
                    key={g.category.id}
                    type="button"
                    onClick={() => setActiveCategoryFilter(isSelected ? 'all' : g.category.id)}
                    className={`px-2.5 py-1 rounded-full font-semibold whitespace-nowrap transition-colors cursor-pointer tabular-nums ${
                      isSelected
                        ? 'bg-[#7135B5] text-white shadow-2xs'
                        : 'bg-[#F4EAFF] dark:bg-[#22123F] text-[#431599] dark:text-[#D8B4FE] hover:bg-[#EADDFA]'
                    }`}
                  >
                    #{g.category.name} ({g.tickets.length})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Operational Topic Category Header & Tags */}
          <div className="px-3.5 py-2 border-b border-[#E9E5F0] dark:border-[#35105E] bg-[#F9F0FF] dark:bg-[#1E1035] flex items-center justify-between text-[11px] shrink-0">
            <span className="font-bold uppercase tracking-wider text-[#8B8495] dark:text-[#A78BFA]">
              Topik Operasional
            </span>
            {canManageCategories && (
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="font-mono font-bold text-[#7135B5] dark:text-[#D8B4FE] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Settings className="w-3 h-3" />
                <span>Kelola Tag</span>
              </button>
            )}
          </div>

          <div className="px-3 py-2 flex flex-wrap gap-1.5 border-b border-[#E9E5F0] dark:border-[#35105E] shrink-0 bg-white dark:bg-[#1A0E2E]">
            {groupedTickets.map(g => {
              const isSelected = activeCategoryFilter === g.category.id;
              return (
                <button
                  key={`tag-${g.category.id}`}
                  type="button"
                  onClick={() => setActiveCategoryFilter(isSelected ? 'all' : g.category.id)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10.5px] font-bold transition-colors cursor-pointer tabular-nums ${
                    isSelected
                      ? 'bg-[#35105E] text-white'
                      : 'bg-[#F7F6FA] dark:bg-[#22123F] text-[#494453] dark:text-[#CEC0E8] hover:bg-[#F4EAFF]'
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: g.category.color || '#7135B5' }}
                  />
                  <span>#{g.category.name}</span>
                  <span className="opacity-75">({g.tickets.length})</span>
                </button>
              );
            })}
          </div>

          {/* Live Queue List (Independent Scroll) */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {conversationList.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#766B83] dark:text-[#CEC0E8] space-y-2.5">
                {activeCategoryFilter === 'all_unread' ? (
                  <>
                    <CheckCircle2 className="w-8 h-8 text-[#16A36A] mx-auto" />
                    <div className="font-bold text-[#211A2E] dark:text-white">
                      Semua Pesan Baru Telah Dibaca
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Tidak ada WO dengan chat masuk belum dibaca. Riwayat chat tetap tersimpan pada tab Semua WO & Detail Tiket.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveCategoryFilter('all')}
                      className="px-3 py-1.5 rounded-lg bg-[#35105E] text-white text-[11px] font-bold hover:bg-[#5B35B1] transition-colors cursor-pointer"
                    >
                      Lihat Semua WO ({searchFilteredTickets.length})
                    </button>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-7 h-7 text-[#A78BFA] mx-auto" />
                    <div className="font-bold text-[#211A2E] dark:text-white">
                      Tidak Ada Tiket di Antrean
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      {searchQuery
                        ? 'Tidak ada Work Order yang cocok dengan kata kunci pencarian Anda.'
                        : 'Belum ada Work Order ter-assign teknisi untuk tanggal appointment hari ini (todayWIB).'}
                    </p>
                  </>
                )}
              </div>
            ) : (
              conversationList.map(t => renderQueueCard(t))
            )}
          </div>

          {/* Left Panel Footer */}
          <div className="px-3.5 py-2.5 border-t border-[#E9E5F0] dark:border-[#35105E] bg-white dark:bg-[#1A0E2E] flex items-center justify-between text-xs text-[#766B83] dark:text-[#CEC0E8] shrink-0">
            <span className="tabular-nums font-medium">
              Aktif: <strong className="text-[#211A2E] dark:text-white">{activeTechnicianCount} Teknisi</strong> ·{' '}
              {availableTickets.length} WO
            </span>
            <button
              type="button"
              onClick={handleRefreshQueue}
              disabled={isRefreshing}
              className="text-[#7135B5] dark:text-[#D8B4FE] hover:underline font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </aside>

        {/* CENTER PANEL: Massive Full Chat Stage */}
        <section
          className={`${
            isMobileView && mobilePane === 'queue' ? 'hidden' : 'flex'
          } flex-1 flex-col bg-[#F7F6FA] dark:bg-[#160D29] min-w-0 min-h-0 overflow-hidden relative`}
        >
          {activeTicket ? (
            <>
              {/* Fullscreen / Drawer Notice Strip */}
              <div className="px-4 sm:px-5 py-2 bg-gradient-to-r from-[#35105E] via-[#5B35B1] to-[#7135B5] text-white flex items-center justify-between gap-2 shadow-xs shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  {isMobileView && (
                    <button
                      type="button"
                      onClick={() => setMobilePane('queue')}
                      className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white shrink-0 cursor-pointer"
                      aria-label="Kembali ke daftar antrean"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                  )}
                  <p className="text-xs truncate">
                    <strong className="font-bold">
                      {isDetailDrawerOpen ? 'Panel Detail Tiket Terbuka' : 'Mode Percakapan Maksimal Aktif'}
                    </strong>{' '}
                    <span className="hidden md:inline text-white/90">
                      — {isDetailDrawerOpen
                        ? 'Tekan Shift + D untuk menyembunyikan drawer dan memperluas area chat.'
                        : 'Detail Tiket disembunyikan untuk visibilitas komunikasi lapangan. Tekan Shift + D untuk membuka.'}
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="hidden sm:inline font-mono text-[11px] text-[#E9D5FF]">
                    Panel Detail: {isDetailDrawerOpen ? 'OPEN' : 'CLOSED'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsDetailDrawerOpen(prev => !prev)}
                    className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {isDetailDrawerOpen ? (
                      <>
                        <PanelRightClose className="w-3.5 h-3.5" />
                        <span>Tutup Drawer</span>
                      </>
                    ) : (
                      <>
                        <PanelRightOpen className="w-3.5 h-3.5" />
                        <span>Buka Drawer</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Message History Stream (Independent Scroll) */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-5">
                {/* Date Separator */}
                <div className="flex items-center justify-center">
                  <div className="h-[1px] bg-[#E9E5F0] dark:bg-[#35105E] flex-1" />
                  <div className="px-3 py-1 rounded-full bg-[#F4EAFF] dark:bg-[#22123F] text-[10.5px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#D8B4FE] mx-3 whitespace-nowrap">
                    Hari Ini — {formattedTodayLabel} (WIB)
                  </div>
                  <div className="h-[1px] bg-[#E9E5F0] dark:bg-[#35105E] flex-1" />
                </div>

                {/* Real System Telemetry Event: Assignment / Distribution */}
                {(activeTicket.assignedAt || activeTicket.dateAssignTechnician || activeTicket.installerName) && (
                  <div className="flex items-start gap-2.5 max-w-3xl mx-auto w-full">
                    <div className="w-8 h-8 rounded-full bg-[#F4EAFF] dark:bg-[#22123F] flex items-center justify-center text-[#7135B5] dark:text-[#D8B4FE] shrink-0 mt-0.5">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="flex-1 bg-white dark:bg-[#1E1236] rounded-xl p-3.5 border border-[#E9E5F0] dark:border-[#35105E] shadow-2xs">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10.5px] font-bold text-[#7135B5] dark:text-[#D8B4FE] uppercase tracking-wider">
                          Telemetri Penugasan Work Order
                        </span>
                        <span className="font-mono text-[11px] text-[#8B8495] tabular-nums">
                          {activeTicket.assignedAt
                            ? formatWibTime(activeTicket.assignedAt)
                            : activeTicket.dateAssignTechnician || activeTicket.slotTime || '-'}
                        </span>
                      </div>
                      <p className="text-xs sm:text-[13px] text-[#211A2E] dark:text-[#F5F1FF] leading-relaxed">
                        <span className="font-mono font-bold text-[#35105E] dark:text-[#D8B4FE]">[SYSTEM]</span>{' '}
                        {activeTicket.woNumber} terdistribusi ke mitra{' '}
                        <strong>{activeTicket.contactorName || activeTicket.contractorName || '-'}</strong>. Teknisi{' '}
                        <strong>{activeTicket.installerName || 'Unassigned'}</strong> ditugaskan pada{' '}
                        {activeTicket.slotTime || 'slot aktif'}.
                        {activeTicket.serviceType && (
                          <span>
                            {' '}
                            Layanan: <em>{activeTicket.serviceType}</em>.
                          </span>
                        )}
                      </p>
                      {(activeTicket.fatCode || activeTicket.fatPort || activeTicket.area) && (
                        <div className="mt-2 pt-2 border-t border-[#E9E5F0] dark:border-[#35105E] flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#766B83] dark:text-[#CEC0E8] font-mono">
                          {activeTicket.area && <span>Area: {activeTicket.area}</span>}
                          {activeTicket.fatCode && (
                            <span>
                              FAT: {activeTicket.fatCode}
                              {activeTicket.fatPort ? ` (${activeTicket.fatPort})` : ''}
                            </span>
                          )}
                          {activeTicket.distributionStatus && (
                            <span className="text-[#16A36A] dark:text-emerald-400 font-semibold uppercase">
                              {activeTicket.distributionStatus.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Chat Message Stream */}
                {activeMessages.length === 0 ? (
                  <div className="max-w-xl mx-auto my-8 p-6 rounded-2xl bg-white dark:bg-[#1E1236] border border-[#E9E5F0] dark:border-[#35105E] text-center space-y-2.5">
                    <MessageSquare className="w-9 h-9 text-[#A78BFA] mx-auto" />
                    <div className="font-display font-bold text-sm text-[#211A2E] dark:text-white">
                      Belum Ada Pesan pada Channel {activeTicket.woNumber}
                    </div>
                    <p className="text-xs text-[#766B83] dark:text-[#CEC0E8] leading-relaxed">
                      {isLeader
                        ? 'Menunggu komunikasi antara Dispatch dan Teknisi Lapangan. Anda berada dalam mode pemantauan (Read-Only).'
                        : 'Mulai koordinasi lapangan antara Dispatch dan Teknisi. Unggah foto redaman OPM, perangkat ONT, atau kendala fisik.'}
                    </p>
                  </div>
                ) : (
                  activeMessages.map(msg => {
                    const isMe = msg.senderId === currentUser?.id || msg.senderRole === currentUser?.role;
                    const readByOthers =
                      Array.isArray(msg.readBy) &&
                      msg.readBy.some(readerId => readerId !== msg.senderId);

                    return (
                      <div
                        key={msg.id}
                        className={`flex items-start gap-2.5 max-w-3xl w-full ${
                          isMe ? 'ml-auto justify-end' : ''
                        }`}
                      >
                        {!isMe && (
                          <div className="w-9 h-9 rounded-full bg-[#7135B5] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                            {getInitials(msg.senderName)}
                          </div>
                        )}

                        <div className={`flex flex-col gap-1 min-w-0 ${isMe ? 'items-end' : 'items-start'}`}>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {isMe && (
                              <span className="font-mono text-[11px] text-[#8B8495] tabular-nums">
                                {formatWibTime(msg.timestamp)}
                              </span>
                            )}
                            <span className="font-display font-bold text-[#211A2E] dark:text-white">
                              {msg.senderName}
                            </span>
                            {getRoleBadge(msg.senderRole)}
                            {msg.category && (
                              <span className="px-1.5 py-0.5 rounded bg-[#7135B5]/10 text-[#7135B5] dark:text-[#D8B4FE] font-mono text-[10px] font-bold">
                                #{msg.category}
                                {msg.isCheckIn ? ' Check-in' : ''}
                              </span>
                            )}
                            {!isMe && (
                              <span className="font-mono text-[11px] text-[#8B8495] tabular-nums">
                                {formatWibTime(msg.timestamp)}
                              </span>
                            )}
                          </div>

                          <div
                            className={`max-w-2xl p-3.5 rounded-2xl shadow-2xs space-y-2.5 leading-relaxed text-[13px] ${
                              isMe
                                ? 'bg-[#35105E] text-white rounded-tr-none'
                                : 'bg-white dark:bg-[#1E1236] text-[#211A2E] dark:text-[#F5F1FF] border border-[#E9E5F0] dark:border-[#35105E] rounded-tl-none'
                            }`}
                          >
                            {msg.text && (
                              <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                            )}

                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                                {msg.attachments.map(att => {
                                  const previewUrl = getSafePreviewUrl(att.url);
                                  const isBroken = Boolean(brokenImageIds[att.id]);
                                  return (
                                    <div
                                      key={att.id}
                                      className={`rounded-xl overflow-hidden border p-1.5 ${
                                        isMe
                                          ? 'bg-[#22123F] border-white/15'
                                          : 'bg-[#F7F6FA] dark:bg-[#160D29] border-[#E9E5F0] dark:border-[#35105E]'
                                      }`}
                                    >
                                      {isBroken || !previewUrl ? (
                                        <div className="h-36 rounded-lg bg-[#F4EAFF] dark:bg-[#22123F] flex flex-col items-center justify-center p-3 text-center gap-1">
                                          <ImageIcon className="w-6 h-6 text-[#7135B5]" />
                                          <span className="text-[11px] font-semibold truncate max-w-full">
                                            {att.fileName}
                                          </span>
                                        </div>
                                      ) : (
                                        <div
                                          onClick={() => setZoomImage(previewUrl)}
                                          className="relative rounded-lg overflow-hidden bg-[#160D29] group cursor-pointer"
                                        >
                                          <img
                                            src={previewUrl}
                                            alt={att.fileName}
                                            referrerPolicy="no-referrer"
                                            onError={() =>
                                              setBrokenImageIds(prev => ({ ...prev, [att.id]: true }))
                                            }
                                            className="w-full h-44 object-cover group-hover:scale-105 transition-transform duration-200"
                                          />
                                          <div className="absolute bottom-2 right-2">
                                            <span className="px-2 py-1 rounded-lg bg-white/90 text-[#211A2E] text-[10.5px] font-bold shadow-sm inline-flex items-center gap-1">
                                              <Maximize2 className="w-3 h-3" />
                                              <span>Perbesar Foto</span>
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                      <div
                                        className={`mt-1.5 px-1 flex items-center justify-between text-[10.5px] font-mono ${
                                          isMe ? 'text-[#D8B4FE]' : 'text-[#766B83] dark:text-[#CEC0E8]'
                                        }`}
                                      >
                                        <span className="truncate">{att.fileName}</span>
                                        {att.fileSize > 0 && (
                                          <span className="shrink-0 ml-2">{formatFileSize(att.fileSize)}</span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {isMe && (
                            <div className="flex items-center gap-1.5 text-[11px] text-[#8B8495]">
                              <MessageStatusReceipt
                                message={msg}
                                senderId={currentUser?.id}
                                variant="onLight"
                                showLabel={true}
                              />
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">{formatWibTime(msg.timestamp)}</span>
                            </div>
                          )}
                        </div>

                        {isMe && (
                          <div className="w-9 h-9 rounded-full bg-[#40208D] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                            {getInitials(msg.senderName)}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}

                {/* Real Audit Telemetry Card when Check-in is Verified */}
                {activeTicket.checkInAt && (
                  <div className="flex items-start gap-2.5 max-w-3xl mx-auto w-full">
                    <div className="w-8 h-8 rounded-full bg-[#16A36A]/15 flex items-center justify-center text-[#16A36A] shrink-0 mt-0.5">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <div className="flex-1 bg-white dark:bg-[#1E1236] rounded-xl p-3.5 border border-[#16A36A]/25 shadow-2xs">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10.5px] font-bold text-[#16A36A] uppercase tracking-wider flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Audit Telemetry System Verification</span>
                        </span>
                        <span className="font-mono text-[11px] text-[#8B8495] tabular-nums">
                          {formatJakartaTimeOnly(activeTicket.checkInAt)} WIB
                        </span>
                      </div>
                      <p className="text-xs sm:text-[13px] text-[#211A2E] dark:text-[#F5F1FF]">
                        <span className="font-mono font-bold text-[#35105E] dark:text-[#D8B4FE]">
                          [AUDIT TELEMETRY]
                        </span>{' '}
                        Check-in LiveChat kategori <strong>#PROGRESS</strong> terverifikasi pada{' '}
                        <span className="font-mono font-semibold">
                          {formatJakartaTimeOnly(activeTicket.checkInAt)} WIB
                        </span>
                        . Stage installer saat ini:{' '}
                        <span className="px-1.5 py-0.5 rounded bg-[#F4EAFF] dark:bg-[#35105E] font-mono font-bold text-[#3977C9] dark:text-sky-300 uppercase">
                          {activeTicket.statusWOInstaller}
                        </span>
                      </p>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Error Banner */}
              {errorMessage && (
                <div className="mx-4 mb-2 p-2.5 rounded-xl bg-[#FEF2F2] dark:bg-rose-950/60 border border-[#DC4C5A]/30 text-[#DC4C5A] dark:text-rose-300 text-xs flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMessage}</span>
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

              {/* Pending Attachments Strip */}
              {pendingAttachments.length > 0 && (
                <div className="px-4 py-2 bg-[#F5F1FF] dark:bg-[#22123F] border-t border-[#D8CCF3] dark:border-[#35105E] flex items-center gap-2.5 overflow-x-auto shrink-0">
                  {pendingAttachments.map(att => (
                    <div
                      key={att.id}
                      className="relative w-16 h-16 rounded-xl overflow-hidden border-2 border-[#7135B5] shrink-0"
                    >
                      <img src={att.url} alt={att.fileName} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setPendingAttachments(prev => prev.filter(a => a.id !== att.id))}
                        className="absolute top-1 right-1 p-0.5 bg-[#DC4C5A] text-white rounded-full cursor-pointer"
                        aria-label="Hapus lampiran"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <span className="text-xs font-semibold text-[#35105E] dark:text-[#D8B4FE]">
                    {pendingAttachments.length} foto siap dikirim
                  </span>
                </div>
              )}

              {/* Bottom Area: Read-Only Leader Banner OR Full Composer */}
              {isLeader ? (
                <div className="p-4 bg-gradient-to-r from-[#F5F1FF] to-[#E9D5FF]/40 dark:from-[#22123F] dark:to-[#1A0E2E] border-t border-[#D8CCF3] dark:border-[#35105E] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[#35105E] text-white flex items-center justify-center shrink-0">
                      <Shield className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-xs text-[#35105E] dark:text-[#D8B4FE] flex items-center gap-2 flex-wrap">
                        <span>Mode Pantau: Leader / Korlap (Read-Only)</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FEF3C7] text-[#B45309] dark:bg-amber-950 dark:text-amber-300">
                          Hanya Pantau Percakapan
                        </span>
                      </div>
                      <p className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] mt-0.5 truncate">
                        Korlap memantau percakapan area {currentUser?.area || activeTicket.area || '-'} ·{' '}
                        {currentUser?.contractor || activeTicket.contactorName || activeTicket.contractorName || '-'}.
                        Pengiriman pesan dibatasi untuk Dispatch & Teknisi Lapangan.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px] font-bold text-[#16A36A]">
                    <span className="w-2 h-2 rounded-full bg-[#16A36A] animate-pulse" />
                    <span>Live Monitor</span>
                  </div>
                </div>
              ) : (
                <>
                  {/* Ergonomic Quick Replies Toolbar */}
                  <div className="px-4 py-2 bg-white dark:bg-[#1A0E2E] border-t border-[#E9E5F0] dark:border-[#35105E] flex items-center gap-1.5 overflow-x-auto shrink-0">
                    <span className="text-[10.5px] font-bold uppercase text-[#8B8495] whitespace-nowrap flex items-center gap-1 shrink-0 mr-1">
                      <Zap className="w-3.5 h-3.5 text-[#7135B5]" />
                      <span>Quick Action:</span>
                    </span>
                    {quickReplyChips.map((chip, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => insertQuickReply(chip)}
                        className="px-3 py-1 rounded-full bg-[#F7F6FA] dark:bg-[#22123F] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] text-[#211A2E] dark:text-[#E9D5FF] text-xs font-medium whitespace-nowrap border border-[#E9E5F0] dark:border-[#35105E] transition-colors cursor-pointer"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>

                  {/* Installer Mandatory Category Warning & Selector */}
                  {isInstaller && (!installerCategory || installerCategory.toUpperCase() === 'UNCLASSIFIED') && (
                    <div className="px-4 py-2 bg-[#FEF3C7] dark:bg-amber-950/60 border-t border-[#E59A27]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs shrink-0">
                      <div className="flex items-center gap-2 text-[#92400E] dark:text-amber-200 font-semibold">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>
                          Pilih kategori chat terlebih dahulu sebelum mengirim pesan (pilih PROGRESS untuk Check-in).
                        </span>
                      </div>
                      <select
                        value={installerCategory}
                        onChange={e => handleCategoryChangeForActiveTicket(e.target.value)}
                        className="px-3 py-1.5 bg-white dark:bg-[#160D29] border border-[#E59A27] rounded-lg font-bold text-xs text-[#211A2E] dark:text-white cursor-pointer"
                      >
                        <option value="">-- Pilih Kategori Wajib --</option>
                        {activeCategories.map(cat => (
                          <option key={cat.id} value={cat.name}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Comprehensive Chat Composer */}
                  <form
                    onSubmit={handleSendMessage}
                    className="p-3 sm:p-4 bg-white dark:bg-[#1A0E2E] border-t border-[#E9E5F0] dark:border-[#35105E] flex flex-col gap-2.5 shrink-0"
                  >
                    {/* Helper Bar: Role Mode + Mandatory Category ONLY for Installer (Removed for Dispatch & Super Admin) */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#8B8495]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-[#F5F1FF] dark:bg-[#22123F] text-[#35105E] dark:text-[#D8B4FE] font-mono text-[11px] font-semibold border border-[#E9E5F0] dark:border-[#35105E]">
                          {isInstaller
                            ? 'Mode Teknisi Lapangan (Kategori Wajib)'
                            : userRole === 'super_admin'
                            ? 'Mode Super Admin · Pesan Langsung (Tanpa Kategori Wajib)'
                            : 'Mode Dispatch Lead · Pesan Langsung (Tanpa Kategori Wajib)'}
                        </span>

                        {isInstaller && (
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                            <Tag className="w-3 h-3 text-[#7135B5]" />
                            <select
                              value={installerCategory || ''}
                              onChange={e => handleCategoryChangeForActiveTicket(e.target.value)}
                              className="bg-transparent text-[11px] font-bold text-[#211A2E] dark:text-white focus:outline-none cursor-pointer"
                              title="Pilih Kategori Chat Wajib"
                            >
                              <option value="">-- Pilih Kategori Wajib --</option>
                              {activeCategories.map(cat => (
                                <option key={cat.id} value={cat.name}>
                                  {cat.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="hidden sm:flex items-center gap-2 font-mono text-[11px]">
                        <span>Shift + Enter: Baris baru</span>
                        <span aria-hidden="true">·</span>
                        <span>Enter: Kirim</span>
                      </div>
                    </div>

                    {/* Hidden File Inputs */}
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/jpg"
                      capture="environment"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/jpg"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                    />

                    {/* 3-Section Composer Row */}
                    <div className="flex items-end gap-2 w-full relative">
                      {/* Left Actions */}
                      <div className="flex items-center gap-1.5 pb-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => cameraInputRef.current?.click()}
                          className="p-2.5 rounded-xl bg-[#F7F6FA] dark:bg-[#22123F] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] text-[#7135B5] dark:text-[#D8B4FE] border border-[#E9E5F0] dark:border-[#35105E] transition-colors cursor-pointer"
                          title="Ambil Foto Kamera / Bukti Lapangan"
                          aria-label="Ambil Foto"
                        >
                          <Camera className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="p-2.5 rounded-xl bg-[#F7F6FA] dark:bg-[#22123F] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] text-[#494453] dark:text-[#CEC0E8] border border-[#E9E5F0] dark:border-[#35105E] transition-colors cursor-pointer"
                          title="Lampirkan Berkas Foto"
                          aria-label="Lampirkan Foto"
                        >
                          <ImageIcon className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowTemplateMenu(prev => !prev)}
                          className="hidden sm:flex p-2.5 rounded-xl bg-[#F7F6FA] dark:bg-[#22123F] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] text-[#494453] dark:text-[#CEC0E8] border border-[#E9E5F0] dark:border-[#35105E] transition-colors cursor-pointer"
                          title="Sisipkan Template SOP"
                          aria-label="Template SOP"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Quick Template Popover */}
                      {showTemplateMenu && (
                        <div className="absolute bottom-full left-0 mb-2 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-[#1A0E2E] rounded-xl border border-[#D8CCF3] dark:border-[#35105E] shadow-xl p-2 z-30 space-y-1">
                          <div className="px-2 py-1 flex items-center justify-between text-[11px] font-bold text-[#35105E] dark:text-[#D8B4FE] border-b border-[#E9E5F0] dark:border-[#35105E]">
                            <span>Template Cepat SOP</span>
                            <button
                              type="button"
                              onClick={() => setShowTemplateMenu(false)}
                              className="cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {quickReplyChips.map((tpl, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => insertQuickReply(tpl)}
                              className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-[#211A2E] dark:text-[#E9D5FF] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] transition-colors cursor-pointer"
                            >
                              {tpl}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Center Expansive Textarea */}
                      <div className="flex-1 min-w-0">
                        <textarea
                          ref={composerRef}
                          rows={2}
                          value={inputText}
                          onChange={e => setInputText(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                          placeholder={`Ketik pesan untuk ${activeTicket.woNumber} (${activeTicket.installerName || activeTicket.customerName})...`}
                          className="w-full px-3.5 py-2.5 bg-[#F5F1FF] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] rounded-xl text-xs sm:text-sm text-[#211A2E] dark:text-white placeholder:text-[#8B8495] focus:outline-none focus:bg-white dark:focus:bg-[#1E1236] focus:border-[#7135B5] focus:ring-2 focus:ring-[#D8B4FE]/50 transition-all resize-none"
                        />
                      </div>

                      {/* Right Send Button */}
                      <button
                        type="submit"
                        disabled={
                          isSubmitting ||
                          (!inputText.trim() && pendingAttachments.length === 0)
                        }
                        className="px-4 sm:px-5 py-3 rounded-xl bg-gradient-to-r from-[#35105E] to-[#7135B5] hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed text-white font-display text-xs sm:text-sm font-bold shadow-sm transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer whitespace-nowrap"
                      >
                        {isSubmitting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <span>Kirim</span>
                            <Send className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#766B83] dark:text-[#CEC0E8] space-y-3">
              {isMobileView && (
                <button
                  type="button"
                  onClick={() => setMobilePane('queue')}
                  className="px-4 py-2 rounded-xl bg-[#35105E] text-white text-xs font-bold cursor-pointer"
                >
                  Lihat Daftar Antrean WO
                </button>
              )}
              <MessageSquare className="w-12 h-12 text-[#A78BFA]" />
              <div className="font-display font-bold text-base text-[#211A2E] dark:text-white">
                Pilih Work Order untuk Memulai LiveChat
              </div>
              <p className="text-xs max-w-md leading-relaxed">
                Pilih salah satu tiket Work Order yang telah ditugaskan ke teknisi di panel kiri untuk melihat riwayat komunikasi dan telemetri lapangan.
              </p>
            </div>
          )}
        </section>

        {/* RIGHT PANEL: Collapsible Ticket Detail Drawer (Shift + D) */}
        {activeTicket && (
          <ContactTicketDetailDrawer
            ticket={activeTicket}
            isOpen={isDetailDrawerOpen}
            onClose={() => setIsDetailDrawerOpen(false)}
            onOpenFullModal={onSelectTicket}
            onOpenWhatsApp={onOpenWhatsApp}
          />
        )}
      </div>

      {/* Lightbox Zoom Modal */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-70 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setZoomImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setZoomImage(null)}
              className="absolute top-3 right-3 p-2 bg-black/70 text-white rounded-full hover:bg-[#DC4C5A] transition-colors cursor-pointer"
              aria-label="Tutup foto"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={zoomImage}
              alt="Bukti Foto Zoom"
              referrerPolicy="no-referrer"
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
            />
          </div>
        </div>
      )}

      {/* Admin Chat Category Management Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1A0E2E] border-2 border-[#D8CCF3] dark:border-[#35105E] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#5B35B1] text-white flex items-center justify-center font-bold">
                  <Tag className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#35105E] dark:text-purple-200">
                    Pengaturan Kategori Chat (Contact Center)
                  </h3>
                  <p className="text-[11px] text-[#766B83] dark:text-[#CEC0E8]">
                    Kelola kategori percakapan untuk pengelompokan unread chat dan alur komunikasi operasional.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsSettingsOpen(false);
                  setEditingCategory(null);
                }}
                className="p-1.5 rounded-lg text-[#766B83] hover:bg-[#F7F6FA] dark:hover:bg-[#35105E] cursor-pointer"
                aria-label="Tutup pengaturan"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* Create / Edit Category Form */}
              <div className="p-4 rounded-xl bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-[10.5px] font-semibold text-[#494453] dark:text-[#CEC0E8] block mb-1">
                      Nama Kategori (Wajib)
                    </label>
                    <input
                      type="text"
                      placeholder="Mis. PROGRESS, KENDALA_REDAMAN..."
                      value={newCatName}
                      onChange={e => setNewCatName(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white dark:bg-[#1E1236] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-xs text-[#211A2E] dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10.5px] font-semibold text-[#494453] dark:text-[#CEC0E8] block mb-1">
                      Warna Tag
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
                  <label className="text-[10.5px] font-semibold text-[#494453] dark:text-[#CEC0E8] block mb-1">
                    Deskripsi Operasional (Opsional)
                  </label>
                  <input
                    type="text"
                    placeholder="Keterangan alur penanganan tiket..."
                    value={newCatDesc}
                    onChange={e => setNewCatDesc(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white dark:bg-[#1E1236] border border-[#E9E5F0] dark:border-[#35105E] rounded-lg text-xs text-[#211A2E] dark:text-white"
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
                      className="px-3 py-1.5 text-xs text-[#494453] dark:text-[#CEC0E8] hover:bg-[#E9E5F0] dark:hover:bg-[#35105E] rounded-lg cursor-pointer"
                    >
                      Batal Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newCatName.trim()) {
                        toast.error('Nama kategori tidak boleh kosong', 'Validasi Gagal');
                        return;
                      }
                      const res = editingCategory
                        ? await updateChatCategory(editingCategory.id, {
                            name: newCatName.trim().toUpperCase(),
                            color: newCatColor,
                            description: newCatDesc.trim()
                          })
                        : await addChatCategory({
                            name: newCatName.trim().toUpperCase(),
                            color: newCatColor,
                            description: newCatDesc.trim(),
                            order: (chatCategories?.length || 0) + 1,
                            active: true,
                            isActive: true
                          });
                      if (!res.success) return;
                      setEditingCategory(null);
                      setNewCatName('');
                      setNewCatDesc('');
                      setNewCatColor('#5B35B1');
                    }}
                    className="px-4 py-1.5 bg-[#5B35B1] hover:bg-[#35105E] text-white text-xs font-bold rounded-lg shadow-2xs cursor-pointer"
                  >
                    {editingCategory ? 'Simpan Perubahan' : 'Tambahkan Kategori'}
                  </button>
                </div>
              </div>

              {/* Category List Table */}
              <div className="border border-[#E9E5F0] dark:border-[#35105E] rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F7F6FA] dark:bg-[#22123F] text-[#494453] dark:text-[#CEC0E8]">
                    <tr>
                      <th className="p-3 w-12">Warna</th>
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
                            <div className="font-bold text-[#211A2E] dark:text-white">{cat.name}</div>
                            {cat.description && (
                              <div className="text-[10.5px] text-[#766B83] dark:text-[#CEC0E8]">{cat.description}</div>
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
                                cat.isActive
                                  ? 'bg-[#ECFDF5] text-[#16A36A] dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-[#F7F6FA] text-[#766B83] dark:bg-slate-800 dark:text-slate-400'
                              }`}
                            >
                              {cat.isActive ? 'Aktif' : 'Nonaktif'}
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
                              className="p-1 text-[#5B35B1] dark:text-[#D8B4FE] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] rounded cursor-pointer"
                              title="Edit Kategori"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                deleteChatCategory(cat.id);
                                toast.info(
                                  `Kategori ${cat.name} dihapus. Tiket terkait dipindahkan ke UNCLASSIFIED.`,
                                  'Dihapus'
                                );
                              }}
                              className="p-1 text-[#DC4C5A] hover:bg-[#FEF2F2] dark:hover:bg-rose-950 rounded cursor-pointer"
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
