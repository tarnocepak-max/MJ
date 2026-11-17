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
  Building2,
  Maximize2,
  X,
  AlertCircle,
  CheckCircle2,
  Tag,
  Settings,
  Trash2,
  Edit2,
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
  Loader2,
  SlidersHorizontal,
  Headphones,
  Clock,
  MapPin,
  ExternalLink,
  PhoneCall,
  MoreVertical,
  Paperclip,
  Calendar,
  Router,
  Copy,
  Check
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { formatIndonesianWODate } from '../../services/woDateFilterEngine';
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
    users,
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
  ); // 'all', 'all_unread', 'approval', 'field', or categoryId
  const [selectedTicketId, setSelectedTicketId] = useState<string>(initialTicketId || '');
  const [inputText, setInputText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [brokenImageIds, setBrokenImageIds] = useState<Record<string, boolean>>({});
  const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [copiedWoId, setCopiedWoId] = useState<string | null>(null);

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

  const approvalTickets = useMemo(() => {
    return searchFilteredTickets.filter(t => t.approvalStatus === 'BUTUH APPROVAL');
  }, [searchFilteredTickets]);

  const fieldTickets = useMemo(() => {
    return searchFilteredTickets.filter(t => {
      const stage = String(t.statusWOInstaller || '').toUpperCase();
      return (
        stage.includes('PROGRESS') ||
        stage.includes('ON SITE') ||
        stage.includes('ON THE WAY') ||
        stage.includes('EN ROUTE') ||
        stage === 'ASSIGNED'
      );
    });
  }, [searchFilteredTickets]);

  // Sorted conversation list (unread/latest activity first)
  const conversationList = useMemo(() => {
    let base: Ticket[];
    if (activeCategoryFilter === 'all_unread') {
      base = allUnreadTickets;
    } else if (activeCategoryFilter === 'approval') {
      base = approvalTickets;
    } else if (activeCategoryFilter === 'field') {
      base = fieldTickets;
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
  }, [
    activeCategoryFilter,
    allUnreadTickets,
    approvalTickets,
    fieldTickets,
    groupedTickets,
    searchFilteredTickets,
    getTicketUnreadCount
  ]);

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
        {
          id: 'checkin',
          label: 'Check-in Lokasi (#PROGRESS)',
          tone: 'emerald' as const,
          text: `Teknisi sudah check-in di lokasi ${activeTicket?.fatCode || 'FAT'} (${activeTicket?.woNumber || ''}). Sedang pengecekan redaman awal.`
        },
        {
          id: 'opm_ok',
          label: 'Redaman FAT Normal',
          tone: 'lilac' as const,
          text: `Pengecekan redaman OPM di ${activeTicket?.fatCode || 'FAT'} normal (< -24.00 dBm). Lanjut tarik dropcore.`
        },
        {
          id: 'kendala',
          label: 'Kendala Lapangan',
          tone: 'lilac' as const,
          text: 'Terdapat kendala teknis di lapangan (redaman / jalur tiang), mohon arahan Dispatch & Korlap.'
        },
        {
          id: 'ready_acc',
          label: 'ONT Online & Siap ACC',
          tone: 'violet' as const,
          text: `Pemasangan ONT ${activeTicket?.ontSerialNumber || ''} selesai, PON aktif stabil & speedtest normal. Siap verifikasi Berita Acara.`
        }
      ];
    }

    const opmSnippet =
      activeTicket?.rosetRedamanDbm !== undefined && activeTicket?.rosetRedamanDbm !== null
        ? `${activeTicket.rosetRedamanDbm} dBm`
        : '< -24.00 dBm';
    const leaderFirst = activeTicket?.leaderName ? ` ${activeTicket.leaderName.split(' ')[0]}` : '';

    return [
      {
        id: 'acc_redaman',
        label: 'Acc Redaman Normal',
        tone: 'emerald' as const,
        text: `Redaman ${activeTicket?.fatCode || 'FAT'} (${opmSnippet}) APPROVED. Silakan lanjut selesaikan BA.`
      },
      {
        id: 'resend_mac',
        label: 'Kirim Ulang Foto MAC/SN',
        tone: 'lilac' as const,
        text: 'Mohon kirim ulang foto barcode MAC Address dan SN ONT yang lebih tajam.'
      },
      {
        id: 'korlap',
        label: `Koordinasi Korlap${leaderFirst}`,
        tone: 'lilac' as const,
        text: `Sedang saya koordinasikan dengan Korlap${leaderFirst || ' terkait'} mengenai kondisi lapangan.`
      },
      {
        id: 'verify_ba',
        label: 'Verifikasi Berita Acara Digital',
        tone: 'violet' as const,
        text: `Status Berita Acara Digital untuk ${activeTicket?.woNumber || 'WO ini'} sudah dicek, pastikan tanda tangan pelanggan tersimpan.`
      }
    ];
  }, [isInstaller, activeTicket]);

  const korlapContact = useMemo(() => {
    if (!activeTicket) return null;
    const leaderNameLower = (activeTicket.leaderName || '').trim().toLowerCase();
    const contractorLower = (activeTicket.contactorName || activeTicket.contractorName || '').trim().toLowerCase();
    const matchedLeader = (users || []).find(u => {
      if (u.role !== 'leader') return false;
      if (leaderNameLower && u.name.trim().toLowerCase() === leaderNameLower) return true;
      if (contractorLower && (u.contractor || '').trim().toLowerCase() === contractorLower) return true;
      return false;
    });
    if (matchedLeader?.phone) {
      return {
        label: `Korlap ${matchedLeader.name}`,
        phone: matchedLeader.phone
      };
    }
    if (activeTicket.installerContact) {
      return {
        label: `Teknisi ${activeTicket.installerName || 'Lapangan'}`,
        phone: activeTicket.installerContact
      };
    }
    return null;
  }, [activeTicket, users]);

  const handleCallKorlap = () => {
    if (!activeTicket) return;
    if (!korlapContact?.phone) {
      toast.info(
        `Nomor telepon Korlap ${activeTicket.leaderName || ''} belum terdaftar pada data user.`,
        'Nomor Kontak Kosong'
      );
      return;
    }
    const sanitized = korlapContact.phone.replace(/[^\d+]/g, '');
    if (typeof window !== 'undefined') {
      window.location.href = `tel:${sanitized}`;
    }
    toast.success(`Menghubungi ${korlapContact.label} (${korlapContact.phone})`, 'Panggilan Lapangan');
  };

  const handleCopyWoSummary = async () => {
    if (!activeTicket) return;
    const text = `${activeTicket.woNumber} | ${activeTicket.customerName} (ID: ${
      activeTicket.idCustomer || activeTicket.customerId || '-'
    }) | FAT: ${activeTicket.fatCode || '-'} | Teknisi: ${activeTicket.installerName || '-'}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedWoId(activeTicket.id);
      toast.success(`Ringkasan ${activeTicket.woNumber} disalin.`, 'Disalin');
      setTimeout(() => setCopiedWoId(null), 1800);
    } catch {
      toast.error('Gagal menyalin ringkasan WO.');
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'dispatch':
        return (
          <span className="px-1.5 py-0.5 rounded bg-[#F0E3FF] dark:bg-[#35105E] text-[#58149C] dark:text-[#D8B4FE] font-sans text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
            DISPATCH
          </span>
        );
      case 'installer':
        return (
          <span className="px-1.5 py-0.5 rounded bg-[#E9DDFF] dark:bg-[#22123F] text-[#22005C] dark:text-[#E9DDFF] font-sans text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
            TEKNISI FIELD
          </span>
        );
      case 'leader':
        return (
          <span className="px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#B45309] dark:bg-amber-950/70 dark:text-amber-300 font-sans text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
            KORLAP
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded bg-[#F0E3FF] text-[#431599] dark:bg-purple-950 dark:text-purple-300 font-sans text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
            SUPER ADMIN
          </span>
        );
    }
  };

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
    const categoryLabel = catConfig?.name || (t.chatCategory && t.chatCategory.toUpperCase() !== 'UNCLASSIFIED' ? t.chatCategory : '');
    const lastTime = lastMsg?.timestamp || t.lastMessageAt;
    const isUrgent =
      (t.ticketCategory || '').toUpperCase().includes('SAMEDAY') ||
      (t.ticketCategory || '').toUpperCase().includes('EXPRESS') ||
      (t.appointmentType || '').toUpperCase().includes('SAMEDAY');
    const isB2B =
      (t.ticketCategory || '').toUpperCase().includes('B2B') ||
      (t.serviceType || '').toUpperCase().includes('B2B') ||
      (t.customerName || '').toUpperCase().startsWith('PT ');

    const approvalBadgeText =
      t.approvalStatus === 'BUTUH APPROVAL'
        ? 'BUTUH ACC'
        : t.approvalStatus === 'REVISI'
        ? 'REVISI'
        : null;

    return (
      <button
        key={t.id}
        type="button"
        onClick={() => {
          setSelectedTicketId(t.id);
          setMobilePane('chat');
        }}
        className={`relative w-full text-left p-3 rounded-xl transition-all duration-100 cursor-pointer active:translate-y-0.5 ${
          isSelected
            ? 'bg-[#F0E3FF] dark:bg-[#2B1554] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_3px_0_#dab9ff,0_6px_14px_-3px_rgba(88,20,156,0.15)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_3px_0_#35105E]'
            : 'bg-white dark:bg-[#1E1236] hover:bg-[#F9F0FF] dark:hover:bg-[#251644] shadow-[0_2px_0_#e8ddff,0_4px_8px_-2px_rgba(31,22,56,0.05)] dark:shadow-[0_2px_0_#241345]'
        }`}
      >
        {isSelected && (
          <span
            aria-hidden="true"
            className="absolute left-1.5 top-3 bottom-3 w-1.5 rounded-full bg-[#7135B5] dark:bg-[#A78BFA]"
          />
        )}
        <div className={`${isSelected ? 'pl-3.5' : ''} flex flex-col gap-1`}>
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-[11px] font-mono font-bold tracking-wider truncate tabular-nums ${
                isSelected ? 'text-[#58149C] dark:text-[#D8B4FE]' : 'text-[#4B4452] dark:text-[#CEC0E8]'
              }`}
            >
              {t.woNumber}
            </span>
            <span className="text-[11px] font-mono text-[#7D7484] dark:text-[#A78BFA] shrink-0 tabular-nums">
              {lastTime ? formatWibTime(lastTime) : t.slotTime || '-'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <h4 className="font-display text-[13.5px] font-bold text-[#1F182C] dark:text-white truncate">
              {t.customerName}
            </h4>
            <div className="flex items-center gap-1.5 shrink-0">
              {isUrgent && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#DC4C5A] text-white text-[9px] font-extrabold uppercase tracking-wider">
                  EXPRESS
                </span>
              )}
              {!isUrgent && isB2B && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#E9DDFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#D8B4FE] text-[9.5px] font-bold">
                  B2B
                </span>
              )}
              {unread > 0 ? (
                <span className="min-w-[20px] h-5 px-1 rounded-full bg-[#7135B5] text-white font-mono text-[10px] font-bold flex items-center justify-center shadow-xs tabular-nums">
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-[#CBC3D5] dark:bg-[#4B386B]" />
              )}
            </div>
          </div>

          <p className="text-xs text-[#494453] dark:text-[#CEC0E8] truncate">
            {lastMsg ? (
              <>
                <span className={`font-semibold ${isSelected ? 'text-[#58149C] dark:text-[#D8B4FE]' : 'text-[#4B4452] dark:text-[#E9D5FF]'}`}>
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

          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {t.slotTime && (
              <span className="px-1.5 py-0.5 rounded bg-[#F7F6FA] dark:bg-[#160D29] text-[#494453] dark:text-[#CEC0E8] text-[10px] font-medium tracking-wide truncate max-w-[110px]">
                {t.slotTime}
              </span>
            )}
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                isSelected
                  ? 'bg-[#E9DDFF] text-[#431599] dark:bg-[#35105E] dark:text-[#E9D5FF]'
                  : 'bg-[#F4EAFF] text-[#4B4452] dark:bg-[#22123F] dark:text-[#CEC0E8]'
              }`}
            >
              {t.statusWOInstaller || 'ASSIGNED'}
            </span>
            {approvalBadgeText && (
              <span className="px-1.5 py-0.5 rounded bg-[#FFDAD6] text-[#93000A] dark:bg-rose-950/70 dark:text-rose-200 text-[10px] font-bold uppercase">
                {approvalBadgeText}
              </span>
            )}
            {categoryLabel && (
              <span
                className="font-mono text-[10px] font-bold truncate"
                style={{ color: catConfig?.color || '#7135B5' }}
              >
                #{categoryLabel}
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col w-full h-full min-h-0 flex-1 overflow-hidden bg-[#F8F1FF] dark:bg-[#140827]">
      {/* Main Fullscreen Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative bg-[#F8F1FF] dark:bg-[#140827]">
        {/* LEFT PANEL: Live Feeds Queue Strip */}
        <aside
          className={`${
            isMobileView
              ? mobilePane === 'queue'
                ? 'flex w-full'
                : 'hidden'
              : 'hidden lg:flex lg:w-80 xl:w-96'
          } flex-shrink-0 flex-col bg-white dark:bg-[#1A0E2E] shadow-md z-10 min-h-0 overflow-hidden border-r border-[#E9E5F0] dark:border-[#35105E]`}
        >
          {/* Panel Header: Search, Live Counts & Filter Chips */}
          <div className="p-3 bg-[#F9F0FF]/80 dark:bg-[#201138] flex flex-col gap-2.5 border-b border-[#E9E5F0] dark:border-[#35105E] shrink-0 relative">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-xs ${
                    isStreamLive ? 'bg-[#7135B5] animate-pulse' : 'bg-[#E59A27]'
                  }`}
                  title={isStreamLive ? 'SSE Stream & Supabase Terhubung' : 'Mode Lokal / Offline'}
                />
                <span className="font-display text-sm font-bold text-[#1F182C] dark:text-white truncate">
                  Live Feeds
                </span>
                <span className="px-2 py-0.5 rounded-full bg-[#E9DDFF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] text-[11px] font-bold tabular-nums shrink-0">
                  {availableTickets.length} Aktif
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsFilterPopoverOpen(prev => !prev)}
                  className={`btn-3d-icon w-8 h-8 cursor-pointer ${
                    isFilterPopoverOpen || !['all', 'all_unread', 'approval', 'field'].includes(activeCategoryFilter)
                      ? 'text-[#58149C] dark:text-[#D8B4FE] border-[#A78BFA]'
                      : ''
                  }`}
                  title="Filter Lanjutan & Kategori Chat"
                  aria-label="Filter Lanjutan"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Category Popover Menu */}
            {isFilterPopoverOpen && (
              <div className="absolute right-3 top-12 z-30 w-64 rounded-xl bg-white dark:bg-[#1E1236] border border-[#D8CCF3] dark:border-[#35105E] shadow-xl p-2.5 space-y-1.5">
                <div className="flex items-center justify-between px-1 pb-1 border-b border-[#E9E5F0] dark:border-[#35105E]">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A78BFA]">
                    Topik Operasional
                  </span>
                  {canManageCategories && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsFilterPopoverOpen(false);
                        setIsSettingsOpen(true);
                      }}
                      className="text-[11px] font-mono font-bold text-[#7135B5] dark:text-[#D8B4FE] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Settings className="w-3 h-3" />
                      <span>Kelola Tag</span>
                    </button>
                  )}
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {groupedTickets.map(g => {
                    const isCatSelected = activeCategoryFilter === g.category.id;
                    return (
                      <button
                        key={g.category.id}
                        type="button"
                        onClick={() => {
                          setActiveCategoryFilter(isCatSelected ? 'all' : g.category.id);
                          setIsFilterPopoverOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                          isCatSelected
                            ? 'bg-[#58149C] text-white'
                            : 'text-[#211A2E] dark:text-[#E9D5FF] hover:bg-[#F4EAFF] dark:hover:bg-[#35105E]'
                        }`}
                      >
                        <span className="truncate">#{g.category.name}</span>
                        <span className="font-mono text-[11px] opacity-80 tabular-nums">
                          {g.tickets.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Debossed Search Well */}
            <div className="relative w-full flex items-center">
              <Search className="w-4 h-4 text-[#7A7484] absolute left-3 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari WO, ID Pelanggan, Teknisi..."
                className="tactile-debossed-input w-full pl-9 pr-8 py-2 bg-[#F8F1FF] dark:bg-[#160D29] rounded-xl text-xs text-[#1F182C] dark:text-white placeholder:text-[#7A7484] focus:outline-none focus:bg-white dark:focus:bg-[#1E1236] transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 text-[#7A7484] hover:text-[#1F182C] dark:hover:text-white cursor-pointer"
                  aria-label="Hapus pencarian"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Tactile Filter Segment Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
              <button
                type="button"
                onClick={() => setActiveCategoryFilter('all')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer tabular-nums transition-all ${
                  activeCategoryFilter === 'all'
                    ? 'tactile-chip-active'
                    : 'tactile-chip text-[#494453] dark:text-[#CEC0E8]'
                }`}
              >
                Semua ({searchFilteredTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveCategoryFilter('all_unread')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer tabular-nums transition-all ${
                  activeCategoryFilter === 'all_unread'
                    ? 'tactile-chip-active'
                    : 'tactile-chip text-[#494453] dark:text-[#CEC0E8]'
                }`}
              >
                Unread ({allUnreadTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveCategoryFilter('approval')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer tabular-nums transition-all ${
                  activeCategoryFilter === 'approval'
                    ? 'tactile-chip-active'
                    : 'px-2.5 py-1 rounded-full bg-[#FFDAD6] dark:bg-rose-950/60 text-[#93000A] dark:text-rose-200 border border-[#DC4C5A]/20 active:translate-y-0.5'
                }`}
              >
                Approval ({approvalTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveCategoryFilter('field')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer tabular-nums transition-all ${
                  activeCategoryFilter === 'field'
                    ? 'tactile-chip-active'
                    : 'px-2.5 py-1 rounded-full bg-[#E9DDFF] dark:bg-[#2B1554] text-[#1F1634] dark:text-[#E9D5FF] border border-[#D8CCF3]/60 dark:border-[#35105E] active:translate-y-0.5'
                }`}
              >
                Lapangan ({fieldTickets.length})
              </button>
            </div>
          </div>

          {/* Scrollable Ticket List */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5 space-y-2.5 bg-[#FDF7FF] dark:bg-[#160D29]">
            {conversationList.length === 0 ? (
              <div className="p-7 text-center text-xs text-[#766B83] dark:text-[#CEC0E8] space-y-2.5">
                {activeCategoryFilter === 'all_unread' ? (
                  <>
                    <CheckCircle2 className="w-8 h-8 text-[#16A36A] mx-auto" />
                    <div className="font-bold text-[#211A2E] dark:text-white">
                      Semua Pesan Baru Telah Dibaca
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Tidak ada WO dengan chat masuk belum dibaca. Riwayat chat tetap tersimpan pada tab Semua & Detail Tiket.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveCategoryFilter('all')}
                      className="btn-3d-primary px-3.5 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer"
                    >
                      Lihat Semua ({searchFilteredTickets.length})
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
                        : 'Belum ada Work Order sesuai filter yang aktif untuk hari ini (todayWIB).'}
                    </p>
                    {activeCategoryFilter !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setActiveCategoryFilter('all')}
                        className="btn-3d-secondary px-3 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer"
                      >
                        Reset Filter
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : (
              conversationList.map(t => renderQueueCard(t))
            )}
          </div>

          {/* Quick Operator Footprint */}
          <div className="px-3.5 py-2.5 bg-[#F9F0FF] dark:bg-[#1A0E2E] border-t border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between text-[11px] text-[#494453] dark:text-[#CEC0E8] shrink-0 gap-2">
            <span className="flex items-center gap-1.5 min-w-0 truncate">
              <Headphones className="w-4 h-4 text-[#58149C] dark:text-[#D8B4FE] shrink-0" />
              <span className="truncate font-medium">
                {currentUser?.role === 'installer' ? 'Teknisi' : currentUser?.role === 'leader' ? 'Korlap' : 'Dispatcher'}:{' '}
                <strong className="text-[#1F182C] dark:text-white">{currentUser?.name || '-'}</strong>
              </span>
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[10.5px] text-[#7A7484] dark:text-[#A78BFA] uppercase">
                {currentUser?.area || activeTicket?.area || `${activeTechnicianCount} TECH`}
              </span>
              <button
                type="button"
                onClick={handleRefreshQueue}
                disabled={isRefreshing}
                className="text-[#7135B5] dark:text-[#D8B4FE] hover:underline font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                title="Sinkronkan antrean chat"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </aside>

        {/* CENTER/MAIN: 100% Fullscreen Chat Workspace */}
        <section
          className={`${
            isMobileView && mobilePane === 'queue' ? 'hidden' : 'flex'
          } flex-1 flex-col h-full bg-[#F8F1FF] dark:bg-[#140827] min-w-0 relative overflow-hidden`}
        >
          {activeTicket ? (
            <>
              {/* TOP CONVERSATION BAR / TELEMETRY CONSOLE */}
              <header className="min-h-[76px] bg-white dark:bg-[#1A0E2E] px-3.5 sm:px-4 lg:px-6 py-2.5 flex items-center justify-between gap-3 shadow-sm z-20 flex-shrink-0 border-b border-[#E9E5F0] dark:border-[#35105E]">
                {/* Left: Ticket Identity & Telemetry Tags */}
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                  {isMobileView && (
                    <button
                      type="button"
                      onClick={() => setMobilePane('queue')}
                      className="btn-3d-icon w-9 h-9 shrink-0 cursor-pointer"
                      aria-label="Kembali ke daftar antrean"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                  )}

                  {/* Tactile Expand / Ticket Detail Drawer Trigger */}
                  <button
                    type="button"
                    onClick={() => setIsDetailDrawerOpen(prev => !prev)}
                    className={`btn-3d-icon w-10 h-10 rounded-xl shrink-0 cursor-pointer ${
                      isDetailDrawerOpen ? 'text-[#58149C] dark:text-[#D8B4FE] border-[#A78BFA]' : ''
                    }`}
                    title="Buka / Tutup Ringkasan WO (Shift + D)"
                    aria-label="Toggle Ringkasan WO"
                  >
                    {isDetailDrawerOpen ? (
                      <PanelRightClose className="w-5 h-5" />
                    ) : (
                      <PanelRightOpen className="w-5 h-5" />
                    )}
                  </button>

                  {/* Customer & Ticket Telemetry */}
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-sm sm:text-base font-bold text-[#1F182C] dark:text-white truncate">
                        {activeTicket.customerName}
                      </span>
                      <span className="font-mono text-xs font-bold text-[#431599] dark:text-[#D8B4FE] px-2 py-0.5 rounded bg-[#E9DDFF] dark:bg-[#35105E] tabular-nums">
                        {activeTicket.woNumber}
                      </span>
                      <span className="text-xs text-[#7A7484] dark:text-[#A78BFA] font-medium hidden sm:inline tabular-nums">
                        (ID: {activeTicket.idCustomer || activeTicket.customerId || '-'})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[#494453] dark:text-[#CEC0E8] text-xs flex-wrap">
                      <span className="flex items-center gap-1 font-medium tabular-nums">
                        <Clock className="w-3.5 h-3.5 text-[#63597B] dark:text-[#A78BFA] shrink-0" />
                        <span>{activeTicket.slotTime || 'Slot Aktif'}</span>
                      </span>
                      <span className="text-[#7A7484] font-bold" aria-hidden="true">•</span>
                      <span className="flex items-center gap-1 font-medium truncate max-w-[200px] sm:max-w-sm">
                        <MapPin className="w-3.5 h-3.5 text-[#63597B] dark:text-[#A78BFA] shrink-0" />
                        <span className="truncate">
                          {activeTicket.clusterName || activeTicket.address || activeTicket.area || '-'}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: 4-Dimension Semantic Badges & 3D Action Matrix */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Semantic Badges Deck (Desktop 2XL Expanded) */}
                  <div className="hidden 2xl:flex items-center gap-1.5 mr-1">
                    <span className="px-2 py-1 rounded-lg bg-[#F4EAFF] dark:bg-[#22123F] text-[10.5px] font-bold text-[#1F182C] dark:text-[#E9D5FF] whitespace-nowrap">
                      AGENT:{' '}
                      <span className="text-[#431599] dark:text-[#D8B4FE] font-extrabold uppercase">
                        {activeTicket.statusWOAgent || 'ASSIGNED'}
                      </span>
                    </span>
                    <span className="px-2 py-1 rounded-lg bg-[#E9DDFF] dark:bg-[#2B1554] text-[10.5px] font-bold text-[#1F1634] dark:text-[#E9D5FF] whitespace-nowrap">
                      TEKNISI:{' '}
                      <span className="text-[#431599] dark:text-[#D8B4FE] font-extrabold uppercase">
                        {activeTicket.statusWOInstaller || 'ASSIGNED'}
                      </span>
                    </span>
                    <span className="px-2 py-1 rounded-lg bg-[#F0E3FF] dark:bg-[#261942] text-[10.5px] font-bold text-[#494453] dark:text-[#CEC0E8] whitespace-nowrap">
                      WA:{' '}
                      <span className="text-[#1F182C] dark:text-white font-extrabold uppercase">
                        {activeTicket.statusWhatsApp || '-'}
                      </span>
                    </span>
                    <span
                      className={`px-2 py-1 rounded-lg text-[10.5px] font-bold whitespace-nowrap ${
                        activeTicket.approvalStatus === 'BUTUH APPROVAL'
                          ? 'bg-[#FFDAD6] text-[#93000A] dark:bg-rose-950/80 dark:text-rose-200 animate-pulse'
                          : activeTicket.approvalStatus === 'APPROVED'
                          ? 'bg-[#ECFDF5] text-[#047857] dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-[#F7F6FA] text-[#494453] dark:bg-[#22123F] dark:text-[#CEC0E8]'
                      }`}
                    >
                      APPROVAL:{' '}
                      <span className="font-extrabold uppercase">
                        {activeTicket.approvalStatus === 'BUTUH APPROVAL'
                          ? 'BUTUH ACC'
                          : activeTicket.approvalStatus || 'PENDING'}
                      </span>
                    </span>
                  </div>

                  {/* 3D Tactile Action Buttons */}
                  <div className="flex items-center gap-2 relative">
                    {onSelectTicket && (
                      <button
                        type="button"
                        onClick={() => onSelectTicket(activeTicket, 'overview')}
                        className="btn-3d-secondary hidden md:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap"
                      >
                        <ExternalLink className="w-4 h-4 text-[#63597B] dark:text-[#D8B4FE]" />
                        <span>Buka Detail Tiket</span>
                      </button>
                    )}

                    {onOpenWhatsApp ? (
                      <button
                        type="button"
                        onClick={() => onOpenWhatsApp(activeTicket)}
                        className="btn-3d-emerald flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap"
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span className="hidden sm:inline">WhatsApp (Pelanggan)</span>
                      </button>
                    ) : activeTicket.customerPhone ? (
                      <a
                        href={`https://wa.me/${activeTicket.customerPhone.replace(/\D/g, '').replace(/^0/, '62')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-3d-emerald flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span className="hidden sm:inline">WhatsApp (Pelanggan)</span>
                      </a>
                    ) : null}

                    <button
                      type="button"
                      onClick={handleCallKorlap}
                      className="btn-3d-secondary hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap"
                      title={korlapContact ? `Hubungi ${korlapContact.label}: ${korlapContact.phone}` : 'Nomor Korlap belum tersedia'}
                    >
                      <PhoneCall className="w-4 h-4 text-[#431599] dark:text-[#D8B4FE]" />
                      <span>Panggilan Korlap</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsMoreMenuOpen(prev => !prev)}
                      className="btn-3d-icon w-10 h-10 rounded-xl cursor-pointer"
                      aria-label="Opsi lainnya"
                      title="Opsi Lainnya"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {isMoreMenuOpen && (
                      <div className="absolute right-0 top-12 z-30 w-56 rounded-xl bg-white dark:bg-[#1E1236] border border-[#D8CCF3] dark:border-[#35105E] shadow-xl p-1.5 space-y-1 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            setIsDetailDrawerOpen(prev => !prev);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left font-semibold text-[#1F182C] dark:text-white hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] cursor-pointer"
                        >
                          <PanelRightOpen className="w-3.5 h-3.5 text-[#7135B5]" />
                          <span>{isDetailDrawerOpen ? 'Tutup Ringkasan WO' : 'Buka Ringkasan WO'}</span>
                        </button>
                        {onSelectTicket && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsMoreMenuOpen(false);
                              onSelectTicket(activeTicket, 'report');
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left font-semibold text-[#1F182C] dark:text-white hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5 text-[#7135B5]" />
                            <span>Buka Tab Laporan Teknisi</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            handleCopyWoSummary();
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left font-semibold text-[#1F182C] dark:text-white hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] cursor-pointer"
                        >
                          {copiedWoId === activeTicket.id ? (
                            <Check className="w-3.5 h-3.5 text-[#16A36A]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-[#7135B5]" />
                          )}
                          <span>Salin Ringkasan WO</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            handleCallKorlap();
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left font-semibold text-[#1F182C] dark:text-white hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] cursor-pointer lg:hidden"
                        >
                          <PhoneCall className="w-3.5 h-3.5 text-[#7135B5]" />
                          <span>Panggilan Korlap</span>
                        </button>
                        {canManageCategories && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsMoreMenuOpen(false);
                              setIsSettingsOpen(true);
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left font-semibold text-[#1F182C] dark:text-white hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] cursor-pointer"
                          >
                            <Settings className="w-3.5 h-3.5 text-[#7135B5]" />
                            <span>Kelola Kategori Chat</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            handleRefreshQueue();
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left font-semibold text-[#1F182C] dark:text-white hover:bg-[#F4EAFF] dark:hover:bg-[#35105E] cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-[#7135B5]" />
                          <span>Sinkronkan LiveChat</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </header>

              {/* EXPANDED CHAT STREAM */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 lg:px-8 py-4 space-y-4">
                {/* Timeline Separator (3D Inset Badge) */}
                <div className="flex items-center justify-center my-1">
                  <div className="px-4 py-1.5 rounded-full bg-[#F4EAFF] dark:bg-[#22123F] text-[#494453] dark:text-[#D8B4FE] text-[11px] font-bold flex items-center gap-1.5 shadow-[inset_0_1px_2px_rgba(31,22,56,0.06),0_1px_0_rgba(255,255,255,0.9)] dark:shadow-none">
                    <Calendar className="w-3.5 h-3.5 text-[#63597B] dark:text-[#A78BFA]" />
                    <span>Hari Ini — {formattedTodayLabel}</span>
                  </div>
                </div>

                {/* Real System Telemetry Event: Assignment / Distribution */}
                {(activeTicket.assignedAt || activeTicket.dateAssignTechnician || activeTicket.installerName) && (
                  <div className="flex items-start gap-2.5 max-w-3xl mx-auto w-full">
                    <div className="w-9 h-9 rounded-xl bg-[#F4EAFF] dark:bg-[#22123F] flex items-center justify-center text-[#7135B5] dark:text-[#D8B4FE] shrink-0 shadow-[0_2px_0_#dab9ff] dark:shadow-none">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="flex-1 bg-white dark:bg-[#1E1236] rounded-2xl p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_3px_0_#e8ddff,0_6px_14px_-2px_rgba(31,22,56,0.06)] dark:shadow-[0_3px_0_#241345]">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10.5px] font-bold text-[#7135B5] dark:text-[#D8B4FE] uppercase tracking-wider">
                          Telemetri Penugasan Work Order
                        </span>
                        <span className="font-mono text-[11px] text-[#7A7484] dark:text-[#A78BFA] tabular-nums">
                          {activeTicket.assignedAt
                            ? formatWibTime(activeTicket.assignedAt)
                            : activeTicket.dateAssignTechnician || activeTicket.slotTime || '-'}
                        </span>
                      </div>
                      <p className="text-xs sm:text-[13px] text-[#1F182C] dark:text-[#F5F1FF] leading-relaxed">
                        <span className="font-mono font-bold text-[#431599] dark:text-[#D8B4FE]">[SYSTEM]</span>{' '}
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
                        <div className="mt-2 pt-2 border-t border-[#E9E5F0] dark:border-[#35105E] flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#494453] dark:text-[#CEC0E8] font-mono">
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
                  <div className="max-w-xl mx-auto my-8 p-6 rounded-2xl bg-white dark:bg-[#1E1236] shadow-[0_3px_0_#e8ddff,0_8px_18px_-4px_rgba(31,22,56,0.06)] dark:shadow-[0_3px_0_#241345] text-center space-y-2.5">
                    <MessageSquare className="w-9 h-9 text-[#A78BFA] mx-auto" />
                    <div className="font-display font-bold text-sm text-[#1F182C] dark:text-white">
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
                    const isTechBubble = msg.senderRole === 'installer';

                    return (
                      <div
                        key={msg.id}
                        className={`flex items-start gap-2.5 max-w-3xl w-full ${
                          isMe ? 'ml-auto flex-row-reverse' : ''
                        }`}
                      >
                        {/* 3D Square-Rounded Avatar */}
                        <div className="relative flex-shrink-0">
                          <div
                            className={`w-9 h-9 rounded-xl font-display text-xs font-bold flex items-center justify-center shadow-sm ${
                              isTechBubble
                                ? 'bg-[#63597B] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_2px_0_#2a0053]'
                                : 'bg-[#7135B5] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_2px_0_#35105e]'
                            }`}
                          >
                            {getInitials(msg.senderName)}
                          </div>
                          <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-white dark:bg-[#1A0E2E] rounded-full flex items-center justify-center shadow-xs">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                isTechBubble ? 'bg-[#10B981]' : 'bg-[#7135B5]'
                              }`}
                            />
                          </span>
                        </div>

                        <div
                          className={`flex flex-col gap-1 min-w-0 ${
                            isMe ? 'items-end' : 'items-start'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {isMe && (
                              <span className="font-mono text-[11px] text-[#7A7484] dark:text-[#A78BFA] tabular-nums">
                                {formatWibTime(msg.timestamp)}
                              </span>
                            )}
                            {!isMe && (
                              <span className="font-display font-bold text-[#1F182C] dark:text-white">
                                {msg.senderName}
                              </span>
                            )}
                            {getRoleBadge(msg.senderRole)}
                            {isMe && (
                              <span className="font-display font-bold text-[#1F182C] dark:text-white">
                                {msg.senderName}
                              </span>
                            )}
                            {!isMe && (
                              <span className="font-mono text-[11px] text-[#7A7484] dark:text-[#A78BFA] tabular-nums">
                                {formatWibTime(msg.timestamp)}
                              </span>
                            )}
                          </div>

                          {/* Tactile Extruded Speech Bubble */}
                          <div
                            className={`max-w-xl p-3.5 rounded-2xl text-[13.5px] leading-relaxed space-y-2.5 ${
                              isMe
                                ? 'rounded-tr-sm bg-[#F0E3FF] dark:bg-[#2B1554] text-[#1F182C] dark:text-[#F5F1FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_3px_0_#dab9ff,0_8px_16px_-4px_rgba(88,20,156,0.12)] dark:shadow-[0_3px_0_#35105E]'
                                : 'rounded-tl-sm bg-white dark:bg-[#1E1236] text-[#1F182C] dark:text-[#F5F1FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_3px_0_#e8ddff,0_6px_14px_-2px_rgba(31,22,56,0.06)] dark:shadow-[0_3px_0_#241345]'
                            }`}
                          >
                            {msg.category && (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-2 py-0.5 rounded-full bg-[#E4D6FF] dark:bg-[#35105E] text-[#431599] dark:text-[#E9D5FF] text-[10.5px] font-bold flex items-center gap-1">
                                  <Radio className="w-3 h-3" />
                                  <span>
                                    #{msg.category}
                                    {msg.isCheckIn ? ' LAPANGAN' : ''}
                                  </span>
                                </span>
                                {activeTicket.fatCode && msg.isCheckIn && (
                                  <span className="font-mono text-[11px] font-bold text-[#431599] dark:text-[#D8B4FE]">
                                    {activeTicket.fatCode}
                                    {activeTicket.fatPort ? ` ${activeTicket.fatPort}` : ''}
                                  </span>
                                )}
                              </div>
                            )}

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
                                      className="rounded-xl overflow-hidden bg-white dark:bg-[#160D29] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_0_#cec3d4] dark:shadow-[0_2px_0_#241345]"
                                    >
                                      {isBroken || !previewUrl ? (
                                        <div className="h-36 rounded-lg bg-[#F4EAFF] dark:bg-[#22123F] flex flex-col items-center justify-center p-3 text-center gap-1">
                                          <ImageIcon className="w-6 h-6 text-[#7135B5]" />
                                          <span className="text-[11px] font-semibold truncate max-w-full text-[#1F182C] dark:text-white">
                                            {att.fileName}
                                          </span>
                                        </div>
                                      ) : (
                                        <div
                                          onClick={() => setZoomImage(previewUrl)}
                                          className="relative w-full h-36 rounded-lg overflow-hidden bg-[#E1D5F1] dark:bg-[#140827] group cursor-pointer"
                                        >
                                          <img
                                            src={previewUrl}
                                            alt={att.fileName}
                                            referrerPolicy="no-referrer"
                                            onError={() =>
                                              setBrokenImageIds(prev => ({ ...prev, [att.id]: true }))
                                            }
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                          />
                                          <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded bg-[#342D42]/85 backdrop-blur-xs text-[#F7EDFF] font-mono text-[10.5px] font-bold max-w-[90%] truncate">
                                            {att.fileSize > 0 ? formatFileSize(att.fileSize) : 'Bukti Lapangan'}
                                          </div>
                                        </div>
                                      )}
                                      <div className="mt-2 flex items-center justify-between gap-2">
                                        <span className="text-[11px] font-medium text-[#494453] dark:text-[#CEC0E8] truncate">
                                          {att.fileName}
                                        </span>
                                        {previewUrl && !isBroken && (
                                          <button
                                            type="button"
                                            onClick={() => setZoomImage(previewUrl)}
                                            className="px-2 py-1 rounded-lg bg-[#F4EAFF] dark:bg-[#22123F] text-[#431599] dark:text-[#D8B4FE] text-[10.5px] font-bold flex items-center gap-1 shrink-0 shadow-[0_2px_0_#dab9ff] dark:shadow-none active:translate-y-0.5 transition-all cursor-pointer"
                                          >
                                            <Maximize2 className="w-3 h-3" />
                                            <span>Lihat Foto Penuh</span>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {isMe && (
                            <div className="flex items-center gap-1.5 text-[11px] text-[#7A7484] dark:text-[#A78BFA]">
                              <MessageStatusReceipt
                                message={msg}
                                senderId={currentUser?.id}
                                variant="onLight"
                                showLabel={true}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Live Device / OPM / Check-in Telemetry Cards (Real Data Only) */}
                {(activeTicket.ontSerialNumber || activeTicket.rosetRedamanDbm !== undefined) && (
                  <div className="max-w-xl ml-auto p-2.5 rounded-xl bg-white/90 dark:bg-[#1E1236] shadow-[0_2px_0_#e8ddff] dark:shadow-[0_2px_0_#241345] flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 font-mono font-semibold text-[#1F182C] dark:text-white">
                      <Router className="w-4 h-4 text-[#58149C] dark:text-[#D8B4FE]" />
                      <span>
                        SN: {activeTicket.ontSerialNumber || '-'}
                        {activeTicket.dropcoreLengthMeter || activeTicket.dropcoreLength
                          ? ` | Dropcore: ${activeTicket.dropcoreLengthMeter || activeTicket.dropcoreLength}m`
                          : ''}
                      </span>
                    </div>
                    {activeTicket.rosetRedamanDbm !== undefined && activeTicket.rosetRedamanDbm !== null && (
                      <span className="font-mono text-[11px] font-bold text-[#10B981] tabular-nums">
                        OPM: {activeTicket.rosetRedamanDbm} dBm
                      </span>
                    )}
                  </div>
                )}

                {activeTicket.checkInAt && (
                  <div className="flex items-start gap-2.5 max-w-3xl mx-auto w-full">
                    <div className="w-9 h-9 rounded-xl bg-[#16A36A]/15 flex items-center justify-center text-[#16A36A] shrink-0">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <div className="flex-1 bg-white dark:bg-[#1E1236] rounded-2xl p-3.5 border border-[#16A36A]/25 shadow-2xs">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10.5px] font-bold text-[#16A36A] uppercase tracking-wider flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Audit Telemetry System Verification</span>
                        </span>
                        <span className="font-mono text-[11px] text-[#7A7484] tabular-nums">
                          {formatJakartaTimeOnly(activeTicket.checkInAt)} WIB
                        </span>
                      </div>
                      <p className="text-xs sm:text-[13px] text-[#1F182C] dark:text-[#F5F1FF]">
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

              {/* BOTTOM INTERACTION CONSOLE: Read-Only Leader OR Quick Reply Tactile Chips + Composer */}
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
                <footer className="bg-white dark:bg-[#1A0E2E] px-4 lg:px-6 py-3 flex flex-col gap-2.5 shadow-xl z-20 flex-shrink-0 border-t border-[#E9E5F0] dark:border-[#35105E]">
                  {/* QUICK REPLY TACTILE CHIPS ROW */}
                  <div className="flex items-center gap-2 overflow-x-auto py-0.5 no-scrollbar">
                    <span className="text-[10.5px] text-[#7A7484] dark:text-[#A78BFA] uppercase font-bold tracking-wider flex-shrink-0 flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-[#7135B5]" />
                      <span>Aksi Cepat:</span>
                    </span>
                    {quickReplyChips.map(chip => {
                      const chipClass =
                        chip.tone === 'emerald'
                          ? 'btn-3d-emerald'
                          : chip.tone === 'violet'
                          ? 'btn-3d-primary'
                          : 'tactile-chip text-[#1F182C] dark:text-[#E9D5FF]';
                      return (
                        <button
                          key={chip.id}
                          type="button"
                          onClick={() => insertQuickReply(chip.text)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap cursor-pointer active:translate-y-0.5 transition-all ${chipClass}`}
                        >
                          {chip.tone === 'emerald' ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : chip.tone === 'violet' ? (
                            <ShieldCheck className="w-3.5 h-3.5" />
                          ) : (
                            <Tag className="w-3.5 h-3.5 text-[#63597B] dark:text-[#A78BFA]" />
                          )}
                          <span>{chip.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Installer Mandatory Category Warning & Selector (Strictly Installer only; Dispatch has ZERO dropdown clutter) */}
                  {isInstaller && (
                    <div
                      className={`px-3 py-2 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
                        !installerCategory || installerCategory.toUpperCase() === 'UNCLASSIFIED'
                          ? 'bg-[#FEF3C7] dark:bg-amber-950/60 border border-[#E59A27]/40 text-[#92400E] dark:text-amber-200'
                          : 'bg-[#F8F1FF] dark:bg-[#22123F] border border-[#D8CCF3] dark:border-[#35105E] text-[#35105E] dark:text-[#D8B4FE]'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        <Tag className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {!installerCategory || installerCategory.toUpperCase() === 'UNCLASSIFIED'
                            ? 'Pilih kategori chat wajib sebelum kirim (pilih PROGRESS untuk Check-in otomatis).'
                            : `Kategori Aktif Teknisi: #${installerCategory}`}
                        </span>
                      </div>
                      <select
                        value={installerCategory}
                        onChange={e => handleCategoryChangeForActiveTicket(e.target.value)}
                        className="px-3 py-1 bg-white dark:bg-[#160D29] border border-[#D8CCF3] dark:border-[#35105E] rounded-lg font-bold text-xs text-[#1F182C] dark:text-white cursor-pointer"
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

                  {/* ERGONOMIC CHAT COMPOSER */}
                  <form onSubmit={handleSendMessage} className="flex items-center gap-2.5 w-full relative">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="btn-3d-icon w-11 h-11 rounded-xl flex-shrink-0 cursor-pointer"
                      title="Unggah Bukti Foto Lapangan"
                      aria-label="Ambil Foto"
                    >
                      <Camera className="w-5 h-5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="btn-3d-icon w-11 h-11 rounded-xl flex-shrink-0 cursor-pointer"
                      title="Lampirkan Berkas Foto"
                      aria-label="Lampirkan Berkas"
                    >
                      <Paperclip className="w-5 h-5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowTemplateMenu(prev => !prev)}
                      className="btn-3d-icon hidden sm:inline-flex w-11 h-11 rounded-xl flex-shrink-0 cursor-pointer"
                      title="Sisipkan Template SOP"
                      aria-label="Template SOP"
                    >
                      <FileText className="w-5 h-5" />
                    </button>

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
                        {quickReplyChips.map(tpl => (
                          <button
                            key={tpl.id}
                            type="button"
                            onClick={() => insertQuickReply(tpl.text)}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-[#211A2E] dark:text-[#E9D5FF] hover:bg-[#F5F1FF] dark:hover:bg-[#35105E] transition-colors cursor-pointer"
                          >
                            {tpl.text}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Debossed Chat Input Field */}
                    <div className="relative flex-1 flex items-center min-w-0">
                      <textarea
                        ref={composerRef}
                        rows={1}
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        placeholder={`Ketik pesan koordinasi ${isInstaller ? 'lapangan' : 'dispatch'} untuk ${activeTicket.woNumber} (${
                          activeTicket.installerName || activeTicket.customerName
                        })... Tekan Enter untuk kirim`}
                        className="tactile-debossed-input w-full px-4 py-3 bg-[#F8F1FF] dark:bg-[#160D29] rounded-xl text-xs sm:text-sm text-[#1F182C] dark:text-white placeholder:text-[#7A7484] focus:outline-none focus:bg-white dark:focus:bg-[#1E1236] resize-none transition-all"
                      />
                    </div>

                    {/* PRIMARY TACTILE SEND BUTTON */}
                    <button
                      type="submit"
                      disabled={isSubmitting || (!inputText.trim() && pendingAttachments.length === 0)}
                      className="tactile-btn-primary bg-gradient-to-b from-[#7135B5] to-[#58149C] text-white flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-display text-xs sm:text-sm font-bold disabled:opacity-45 disabled:cursor-not-allowed flex-shrink-0 cursor-pointer whitespace-nowrap"
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
                  </form>
                </footer>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#766B83] dark:text-[#CEC0E8] space-y-3">
              {isMobileView && (
                <button
                  type="button"
                  onClick={() => setMobilePane('queue')}
                  className="btn-3d-primary px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Lihat Daftar Antrean WO
                </button>
              )}
              <MessageSquare className="w-12 h-12 text-[#A78BFA]" />
              <div className="font-display font-bold text-base text-[#1F182C] dark:text-white">
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
