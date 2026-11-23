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
  Check,
  BadgeCheck,
  Phone,
  Info,
  Crosshair,
  Gauge,
  AlertTriangle,
  Volume2,
  VolumeX,
  BellRing
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useMoraJawsSound } from '../../context/SoundContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { formatIndonesianWODate } from '../../services/woDateFilterEngine';
import { getSafePreviewUrl, formatFileSize } from '../../services/storageCompatibility';
import { formatJakartaTimeOnly } from '../../services/workSessionService';
import { ContactTicketDetailDrawer } from './ContactTicketDetailDrawer';
import { MessageStatusReceipt } from '../chat/MessageStatusReceipt';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';

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

const renderHighlightedText = (text: string, isMe: boolean): React.ReactNode => {
  const tokenRegex = /(-?\d+(?:[.,]\d+)?\s*dBm|#[A-Za-z0-9_-]+|SN:\s*[A-Za-z0-9_-]+)/gi;
  const parts = text.split(tokenRegex);
  if (parts.length <= 1) return text;

  return parts.map((part, idx) => {
    if (!part) return null;
    if (/^-?\d+(?:[.,]\d+)?\s*dBm$/i.test(part)) {
      const numeric = parseFloat(part.replace(',', '.'));
      const isCritical = !Number.isNaN(numeric) && numeric < -27;
      return (
        <span
          key={idx}
          className={`inline-block px-1.5 py-0.5 rounded font-mono text-[11.5px] font-bold mx-0.5 ${
            isMe
              ? 'bg-white/20 text-white'
              : isCritical
              ? 'bg-[#ffdad6] text-[#93000a] dark:bg-rose-950/80 dark:text-rose-200'
              : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#27104A] dark:text-[#D8B4FE]'
          }`}
        >
          {part}
        </span>
      );
    }
    if (/^#[A-Za-z0-9_-]+$/i.test(part) || /^SN:\s*[A-Za-z0-9_-]+$/i.test(part)) {
      return (
        <span
          key={idx}
          className={`inline-block px-1.5 py-0.5 rounded font-mono text-[11.5px] font-bold mx-0.5 ${
            isMe
              ? 'bg-white/20 text-white'
              : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#27104A] dark:text-[#D8B4FE]'
          }`}
        >
          {part}
        </span>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
};

export const ContactCentreView: React.FC<ContactCentreViewProps> = ({
  onSelectTicket,
  onOpenWhatsApp,
  initialTicketId
}) => {
  const { isCompactUI } = useResponsiveViewport();
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
  const {
    soundSettings,
    audioEngineState,
    unlockAudio,
    updateSoundSettings,
    previewSound
  } = useMoraJawsSound();

  const isLiveChatSoundOn =
    soundSettings.enabled &&
    !soundSettings.muteNormal &&
    (soundSettings.categories?.live_chat ?? true);

  const handleToggleLiveChatSound = async () => {
    await unlockAudio();
    if (!isLiveChatSoundOn) {
      await updateSoundSettings({
        enabled: true,
        muteNormal: false,
        categories: {
          ...soundSettings.categories,
          live_chat: true
        }
      });
      previewSound('live_chat');
      toast.success('Notifikasi suara Live Chat diaktifkan.', 'Suara Chat Aktif', {
        withSound: false
      });
    } else {
      await updateSoundSettings({
        categories: {
          ...soundSettings.categories,
          live_chat: false
        }
      });
      toast.info('Notifikasi suara Live Chat dimatikan untuk perangkat ini.', 'Suara Chat Senyap', {
        withSound: false
      });
    }
  };

  const handleUnlockLiveChatAudio = async () => {
    const state = await unlockAudio();
    if (state === 'running' || state === 'idle') {
      previewSound('live_chat');
      toast.success('Audio browser siap memutar notifikasi Live Chat.', 'Audio Aktif', {
        withSound: false
      });
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>(() =>
    !initialTicketId && totalLiveChatUnreadCount > 0 ? 'all_unread' : 'all'
  ); // 'all', 'all_unread', 'approval', 'field', or categoryId
  const [selectedTicketId, setSelectedTicketId] = useState<string>(initialTicketId || '');
  const [inputText, setInputText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
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
  const [newCatColor, setNewCatColor] = useState('#5145A6');
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
      if (isCompactUI && mobilePane !== 'chat') return;
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
  }, [activeTicket?.id, activeMessages.length, isCompactUI, mobilePane, getTicketUnreadCount, markTicketMessagesAsRead]);

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

  const handleShareGps = () => {
    if (isLeader || isLocating || !activeTicket) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error('Perangkat atau browser ini tidak mendukung Geolocation GPS.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setIsLocating(false);
        const lat = pos.coords.latitude.toFixed(6);
        const lng = pos.coords.longitude.toFixed(6);
        insertQuickReply(`Lokasi terverifikasi GPS: ${lat}, ${lng} (https://maps.google.com/?q=${lat},${lng})`);
        toast.success('Koordinat GPS disisipkan ke pesan.');
      },
      () => {
        setIsLocating(false);
        toast.info('Izin GPS belum diaktifkan. Silakan ketik patokan lokasi manual.');
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  };

  const handleInsertTelemetry = () => {
    if (isLeader || !activeTicket) return;
    const parts: string[] = [];
    if (activeTicket.fatCode) parts.push(`FAT: ${activeTicket.fatCode}${activeTicket.fatPort ? ` (${activeTicket.fatPort})` : ''}`);
    if (activeTicket.rosetRedamanDbm !== undefined && activeTicket.rosetRedamanDbm !== null) {
      parts.push(`OPM Roset: ${activeTicket.rosetRedamanDbm} dBm`);
    }
    if (activeTicket.ontSerialNumber) parts.push(`SN: ${activeTicket.ontSerialNumber}`);
    const text =
      parts.length > 0
        ? `Update telemetri ${activeTicket.woNumber} — ${parts.join(' | ')}.`
        : `Update hasil ukur OPM ${activeTicket.fatCode || 'FAT'} untuk ${activeTicket.woNumber}: ... dBm`;
    insertQuickReply(text);
  };

  const handleTriggerIssue = () => {
    if (isLeader || !activeTicket) return;
    if (isInstaller) {
      const issueCat = activeCategories.find(c => String(c.name).toUpperCase() === 'ISSUE')?.name || 'ISSUE';
      handleCategoryChangeForActiveTicket(issueCat);
    }
    insertQuickReply(`Kendala lapangan pada ${activeTicket.woNumber} (${activeTicket.fatCode || activeTicket.area || 'lokasi'}): `);
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
          <span className="px-1.5 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#27104A] text-[#5145A6] dark:text-[#D8B4FE] border border-[#C5BEEF] dark:border-[#5B35B1] font-sans text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
            DISPATCH
          </span>
        );
      case 'installer':
        return (
          <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-200 font-sans text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
            TEKNISI
          </span>
        );
      case 'leader':
        return (
          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 font-sans text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
            KORLAP
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded bg-[#5145A6] dark:bg-[#6b103b] text-white font-sans text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
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
        className={`relative w-full text-left p-3.5 rounded-2xl transition-all duration-150 cursor-pointer border ${
          isSelected
            ? 'bg-gradient-to-br from-[#F0EDFF] via-white to-[#DDF4F4] dark:from-[#241145] dark:via-[#241145] dark:to-[#241145] dark:bg-[#241145] border-[#6657C8]/50 dark:border-[#A380FE]/60 shadow-[0_3px_0_#DDE6F0,0_8px_16px_-6px_rgba(81,69,166,0.14)] dark:shadow-[0_3px_0_#130826]'
            : 'bg-white dark:bg-[#1E1238] border-[#DDE6F0] dark:border-[#3B1D78] hover:bg-[#F4F7FB] dark:hover:bg-[#27104A]/80'
        }`}
      >
        {isSelected && (
          <span
            aria-hidden="true"
            className="absolute left-1.5 top-3 bottom-3 w-1 rounded-full bg-[#6657C8] dark:bg-[#D8B4FE]"
          />
        )}
        <div className={`${isSelected ? 'pl-3' : ''} flex flex-col gap-1`}>
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-[11px] font-mono font-bold tracking-wider truncate tabular-nums ${
                isSelected ? 'text-[#5145A6] dark:text-[#D8B4FE]' : 'text-[#8492A5] dark:text-[#C5B3DF]'
              }`}
            >
              {t.woNumber}
            </span>
            <span className="text-[11px] font-mono text-[#8492A5] dark:text-[#A493C2] shrink-0 tabular-nums">
              {lastTime ? formatWibTime(lastTime) : t.slotTime || '-'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <h4 className="font-display text-[13.5px] font-bold text-[#26364A] dark:text-white truncate">
              {t.customerName}
            </h4>
            <div className="flex items-center gap-1.5 shrink-0">
              {isUrgent && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[9px] font-extrabold uppercase tracking-wider">
                  EXPRESS
                </span>
              )}
              {!isUrgent && isB2B && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#D8B4FE] text-[9.5px] font-bold">
                  B2B
                </span>
              )}
              {unread > 0 ? (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#6657C8] dark:bg-[#7135B5] text-white font-mono text-[10px] font-bold flex items-center justify-center shadow-xs tabular-nums">
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-[#CBD7E6] dark:bg-[#4B386B]" />
              )}
            </div>
          </div>

          <p className="text-xs text-[#52647A] dark:text-[#C5B3DF] truncate">
            {lastMsg ? (
              <>
                <span className={`font-semibold ${isSelected ? 'text-[#5145A6] dark:text-[#D8B4FE]' : 'text-[#26364A] dark:text-white'}`}>
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
              <span className="px-1.5 py-0.5 rounded bg-[#EDF3F8] dark:bg-[#160D29] text-[#52647A] dark:text-[#C5B3DF] text-[10px] font-medium tracking-wide truncate max-w-[110px]">
                {t.slotTime}
              </span>
            )}
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                isSelected
                  ? 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#D8B4FE]'
                  : 'bg-[#F4F7FB] text-[#52647A] dark:bg-[#27104A] dark:text-[#C5B3DF]'
              }`}
            >
              {t.statusWOInstaller || 'ASSIGNED'}
            </span>
            {approvalBadgeText && (
              <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-200 text-[10px] font-bold uppercase">
                {approvalBadgeText}
              </span>
            )}
            {categoryLabel && (
              <span
                className="font-mono text-[10px] font-bold truncate"
                style={{ color: catConfig?.color || '#5145A6' }}
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
    <div className="flex flex-col w-full h-full min-h-0 flex-1 overflow-hidden bg-[#F3F8FC] dark:bg-[#140827]">
      {/* Main Fullscreen Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative bg-[#F3F8FC] dark:bg-[#140827]">
        {/* LEFT PANEL: Live Feeds Queue Strip */}
        <aside
          className={`${
            isCompactUI
              ? mobilePane === 'queue'
                ? 'flex w-full'
                : 'hidden'
              : 'flex w-72 lg:w-80 xl:w-96'
          } flex-shrink-0 flex-col bg-white dark:bg-[#160D29] shadow-sm z-10 min-h-0 overflow-hidden border-r border-[#DDE6F0] dark:border-[#35105E]`}
        >
          {/* Panel Header: Search, Live Counts & Filter Chips */}
          <div className="p-3 bg-white dark:bg-[#160D29] flex flex-col gap-2.5 border-b border-[#DDE6F0] dark:border-[#35105E] shrink-0 relative">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-xs ${
                    isStreamLive ? 'bg-[#16A36A]' : 'bg-amber-500'
                  }`}
                  title={isStreamLive ? 'SSE Stream & Supabase Terhubung' : 'Mode Lokal / Offline'}
                />
                <span className="font-display text-sm font-bold text-[#26364A] dark:text-white truncate">
                  Live Feeds
                </span>
                <span className="px-2 py-0.5 rounded-full bg-[#DDF4F4] dark:bg-[#27104A] text-[#2E7D8B] dark:text-[#D8B4FE] text-[11px] font-bold tabular-nums shrink-0 border border-[#BDE4E8] dark:border-[#5B35B1]">
                  {availableTickets.length} Aktif
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {audioEngineState === 'suspended' && isLiveChatSoundOn && (
                  <button
                    type="button"
                    onClick={() => void handleUnlockLiveChatAudio()}
                    className="h-10 px-2.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 flex items-center gap-1.5 text-[11px] font-bold cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/70 transition-colors shrink-0"
                    title="Browser menahan audio otomatis. Klik untuk mengaktifkan suara Live Chat."
                    aria-label="Aktifkan Suara Live Chat"
                  >
                    <BellRing className="w-3.5 h-3.5 animate-pulse" />
                    <span className="hidden sm:inline">Aktifkan Suara</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void handleToggleLiveChatSound()}
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center cursor-pointer transition-colors shrink-0 ${
                    isLiveChatSoundOn
                      ? 'bg-[#EAE8FF] dark:bg-[#27104A] text-[#5145A6] dark:text-[#D8B4FE] border-[#6657C8]/40 dark:border-[#7135B5]/40'
                      : 'btn-3d-icon text-[#8492A5] dark:text-[#A493C2]'
                  }`}
                  title={
                    isLiveChatSoundOn
                      ? 'Suara Live Chat Aktif (Klik untuk senyapkan)'
                      : 'Suara Live Chat Senyap (Klik untuk aktifkan & tes suara)'
                  }
                  aria-label={isLiveChatSoundOn ? 'Senyapkan Suara Live Chat' : 'Aktifkan Suara Live Chat'}
                >
                  {isLiveChatSoundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>

                <button
                  type="button"
                  onClick={() => setIsFilterPopoverOpen(prev => !prev)}
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center cursor-pointer transition-colors ${
                    isFilterPopoverOpen || !['all', 'all_unread', 'approval', 'field'].includes(activeCategoryFilter)
                      ? 'bg-[#EAE8FF] dark:bg-[#27104A] text-[#5145A6] dark:text-[#D8B4FE] border-[#6657C8]/50 dark:border-[#7135B5]/50'
                      : 'btn-3d-icon'
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
              <div className="card-3d-lavender absolute right-3 top-14 z-30 w-64 rounded-xl p-2.5 space-y-1.5">
                <div className="flex items-center justify-between px-1 pb-1 border-b border-[#E2E8F0] dark:border-[#35105E]">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#C5B3DF]">
                    Topik Operasional
                  </span>
                  {canManageCategories && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsFilterPopoverOpen(false);
                        setIsSettingsOpen(true);
                      }}
                      className="text-[11px] font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE] hover:underline flex items-center gap-1 cursor-pointer"
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
                        className={`w-full flex items-center justify-between px-2.5 min-h-[38px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                          isCatSelected
                            ? 'bg-[#6657C8] dark:bg-[#58149C] text-white'
                            : 'text-[#26364A] dark:text-[#E8DDFF] hover:bg-[#EDF3F8] dark:hover:bg-[#27104A]'
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

            {/* Search Well */}
            <div className="relative w-full flex items-center">
              <Search className="w-4 h-4 text-[#8492A5] dark:text-[#A493C2] absolute left-3.5 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari WO, ID Pelanggan, Teknisi..."
                className="tactile-debossed-input w-full min-h-[44px] pl-10 pr-9 py-2 bg-[#F4F7FB] dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#4B386B] rounded-xl text-xs text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8] focus:bg-white dark:focus:bg-[#160D29] transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 p-1 text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
                  aria-label="Hapus pencarian"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Horizontal Filter Segment Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
              <button
                type="button"
                onClick={() => setActiveCategoryFilter('all')}
                className={`px-3 min-h-[38px] rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer tabular-nums transition-all shrink-0 ${
                  activeCategoryFilter === 'all'
                    ? 'tactile-chip-active'
                    : 'tactile-chip text-[#52647A]'
                }`}
              >
                Semua ({searchFilteredTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveCategoryFilter('all_unread')}
                className={`px-3 min-h-[38px] rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer tabular-nums transition-all shrink-0 ${
                  activeCategoryFilter === 'all_unread'
                    ? 'tactile-chip-active'
                    : 'tactile-chip text-[#52647A]'
                }`}
              >
                Unread ({allUnreadTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveCategoryFilter('approval')}
                className={`px-3 min-h-[38px] rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer tabular-nums transition-all shrink-0 ${
                  activeCategoryFilter === 'approval'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-200 border border-rose-200 dark:border-rose-800/60'
                }`}
              >
                Approval ({approvalTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveCategoryFilter('field')}
                className={`px-3 min-h-[38px] rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer tabular-nums transition-all shrink-0 ${
                  activeCategoryFilter === 'field'
                    ? 'tactile-chip-active'
                    : 'tactile-chip text-[#5145A6] dark:text-[#D8B4FE]'
                }`}
              >
                Lapangan ({fieldTickets.length})
              </button>
            </div>
          </div>

          {/* Scrollable Ticket List */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5 space-y-2.5 bg-[#F3F8FC] dark:bg-[#140827]">
            {conversationList.length === 0 ? (
              <div className="p-7 text-center text-xs text-[#8492A5] dark:text-[#C5B3DF] space-y-2.5">
                {activeCategoryFilter === 'all_unread' ? (
                  <>
                    <CheckCircle2 className="w-8 h-8 text-[#16A36A] mx-auto" />
                    <div className="font-bold text-[#26364A] dark:text-white">
                      Semua Pesan Baru Telah Dibaca
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Tidak ada WO dengan chat masuk belum dibaca. Riwayat chat tetap tersimpan pada tab Semua & Detail Tiket.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveCategoryFilter('all')}
                      className="btn-3d-primary px-4 min-h-[40px] rounded-xl text-[11px] font-bold cursor-pointer"
                    >
                      Lihat Semua ({searchFilteredTickets.length})
                    </button>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-7 h-7 text-[#5145A6] dark:text-[#D8B4FE] mx-auto" />
                    <div className="font-bold text-[#26364A] dark:text-white">
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
                        className="btn-3d-lilac px-4 min-h-[40px] rounded-xl text-[11px] font-bold cursor-pointer"
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
          <div className="px-3.5 py-2.5 bg-white dark:bg-[#160D29] border-t border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between text-[11px] text-[#8492A5] dark:text-[#C5B3DF] shrink-0 gap-2">
            <span className="flex items-center gap-1.5 min-w-0 truncate">
              <Headphones className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE] shrink-0" />
              <span className="truncate font-medium">
                {currentUser?.role === 'installer' ? 'Teknisi' : currentUser?.role === 'leader' ? 'Korlap' : 'Dispatcher'}:{' '}
                <strong className="text-[#26364A] dark:text-white">{currentUser?.name || '-'}</strong>
              </span>
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[10.5px] text-[#8492A5] dark:text-[#A493C2] uppercase">
                {currentUser?.area || activeTicket?.area || `${activeTechnicianCount} TECH`}
              </span>
              <button
                type="button"
                onClick={handleRefreshQueue}
                disabled={isRefreshing}
                className="btn-3d-icon w-8 h-8 !text-[#5145A6] dark:!text-[#D8B4FE] font-bold cursor-pointer disabled:opacity-50"
                title="Sinkronkan antrean chat"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </aside>

        {/* CENTER/MAIN: WAR ROOM CHAT WORKSPACE */}
        <section
          className={`${
            isCompactUI && mobilePane === 'queue' ? 'hidden' : 'flex'
          } flex-1 flex-col h-full bg-[#F3F8FC] dark:bg-[#140827] min-w-0 relative overflow-hidden`}
        >
          {activeTicket ? (
            <>
              {/* TOP CONVERSATION HEADER + FLOATING CONTEXT STRIP */}
              <header className="bg-white dark:bg-[#160D29] px-3.5 sm:px-5 py-2.5 z-20 flex-shrink-0 border-b border-[#DDE6F0] dark:border-[#35105E] space-y-2 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  {/* Left: Back (mobile), Monogram Avatar, War Room Title & Live Status */}
                  <div className="flex items-center gap-2 min-w-0">
                    {isCompactUI && (
                      <button
                        type="button"
                        onClick={() => setMobilePane('queue')}
                        className="btn-3d-icon w-11 h-11 rounded-xl shrink-0 cursor-pointer"
                        aria-label="Kembali ke daftar antrean"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                    )}

                    <div className="relative shrink-0">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#EAE8FF] to-[#DDF4F4] dark:from-[#27104A] dark:to-[#27104A] text-[#5145A6] dark:text-[#D8B4FE] font-display font-bold text-xs flex items-center justify-center border border-[#C5BEEF] dark:border-[#5B35B1]">
                        {getInitials(activeTicket.installerName || activeTicket.customerName)}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-[#160D29] ${
                          isStreamLive ? 'bg-[#16A36A]' : 'bg-amber-500'
                        }`}
                      />
                    </div>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-display text-sm sm:text-[15px] font-bold text-[#26364A] dark:text-white truncate">
                          Dispatch War Room Chat
                        </span>
                        <BadgeCheck className="w-4 h-4 text-[#6657C8] dark:text-[#D8B4FE] shrink-0" />
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-[#8492A5] dark:text-[#C5B3DF] truncate">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            isStreamLive ? 'bg-[#6657C8] dark:bg-[#D8B4FE]' : 'bg-amber-500'
                          }`}
                        />
                        <span className="truncate font-medium">
                          {isStreamLive ? 'Radio & Dispatch Active' : 'Mode Sinkronisasi Lokal'} ·{' '}
                          <span className="font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE]">
                            {activeTicket.woNumber}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Action Icons & Detail Drawer Toggle */}
                  <div className="flex items-center gap-1.5 flex-shrink-0 relative">
                    <button
                      type="button"
                      onClick={handleCallKorlap}
                      className="btn-3d-icon w-10 h-10 rounded-xl cursor-pointer"
                      title={korlapContact ? `Hubungi ${korlapContact.label}: ${korlapContact.phone}` : 'Nomor Korlap belum tersedia'}
                      aria-label="Panggilan Korlap"
                    >
                      <Phone className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsDetailDrawerOpen(prev => !prev)}
                      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                        isDetailDrawerOpen
                          ? 'bg-[#EAE8FF] text-[#5145A6] border border-[#6657C8]/40 dark:bg-[#27104A] dark:text-[#D8B4FE]'
                          : 'btn-3d-icon'
                      }`}
                      title="Buka / Tutup Ringkasan WO (Shift + D)"
                      aria-label="Toggle Ringkasan WO"
                    >
                      <Info className="w-4 h-4" />
                    </button>

                    {onSelectTicket && (
                      <button
                        type="button"
                        onClick={() => onSelectTicket(activeTicket, 'overview')}
                        className="btn-3d-lilac hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Detail WO</span>
                      </button>
                    )}

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
                      <div className="card-3d-lavender absolute right-0 top-12 z-30 w-56 rounded-2xl p-1.5 space-y-1 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            setIsDetailDrawerOpen(prev => !prev);
                          }}
                          className="w-full min-h-[40px] flex items-center gap-2 px-2.5 py-2 rounded-xl text-left font-semibold text-[#26364A] dark:text-white hover:bg-[#EDF3F8] dark:hover:bg-[#27104A] cursor-pointer"
                        >
                          <PanelRightOpen className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
                          <span>{isDetailDrawerOpen ? 'Tutup Ringkasan WO' : 'Buka Ringkasan WO'}</span>
                        </button>
                        {onSelectTicket && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsMoreMenuOpen(false);
                              onSelectTicket(activeTicket, 'report');
                            }}
                            className="w-full min-h-[40px] flex items-center gap-2 px-2.5 py-2 rounded-xl text-left font-semibold text-[#26364A] dark:text-white hover:bg-[#EDF3F8] dark:hover:bg-[#27104A] cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
                            <span>Buka Tab Laporan Teknisi</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            handleCopyWoSummary();
                          }}
                          className="w-full min-h-[40px] flex items-center gap-2 px-2.5 py-2 rounded-xl text-left font-semibold text-[#26364A] dark:text-white hover:bg-[#EDF3F8] dark:hover:bg-[#27104A] cursor-pointer"
                        >
                          {copiedWoId === activeTicket.id ? (
                            <Check className="w-3.5 h-3.5 text-[#16A36A]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
                          )}
                          <span>Salin Ringkasan WO</span>
                        </button>
                        {canManageCategories && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsMoreMenuOpen(false);
                              setIsSettingsOpen(true);
                            }}
                            className="w-full min-h-[40px] flex items-center gap-2 px-2.5 py-2 rounded-xl text-left font-semibold text-[#26364A] dark:text-white hover:bg-[#EDF3F8] dark:hover:bg-[#27104A] cursor-pointer"
                          >
                            <Settings className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
                            <span>Kelola Kategori Chat</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            handleRefreshQueue();
                          }}
                          className="w-full min-h-[40px] flex items-center gap-2 px-2.5 py-2 rounded-xl text-left font-semibold text-[#26364A] dark:text-white hover:bg-[#EDF3F8] dark:hover:bg-[#27104A] cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
                          <span>Sinkronkan LiveChat</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* FLOATING OPERATIONAL CONTEXT STRIP */}
                <div className="mj-tactile-well flex flex-wrap items-center justify-between gap-2 px-3 py-2 border border-[#DDE6F0] dark:border-[#35105E] text-[11px]">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <ShieldCheck className="w-4 h-4 text-[#16A36A] shrink-0" />
                    <span className="font-semibold text-[#26364A] dark:text-white truncate">
                      {activeTicket.customerName}
                    </span>
                    <span className="hidden sm:inline text-[#8492A5] dark:text-[#A493C2]">•</span>
                    <span className="hidden sm:inline font-medium text-[#52647A] dark:text-[#C5B3DF] truncate">
                      {activeTicket.installerName || 'Unassigned'} · {activeTicket.area || activeTicket.clusterName || '-'}
                    </span>
                    {activeTicket.fatCode && (
                      <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-white dark:bg-[#27104A] border border-[#C5BEEF] dark:border-[#5B35B1] text-[#5145A6] dark:text-[#D8B4FE] shrink-0">
                        {activeTicket.fatCode}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {onOpenWhatsApp ? (
                      <button
                        type="button"
                        onClick={() => onOpenWhatsApp(activeTicket)}
                        className="btn-3d-icon-wa px-2.5 min-h-[32px] py-1 font-bold text-[10.5px] gap-1 cursor-pointer"
                      >
                        <MessageSquare className="w-3 h-3" />
                        <span>WhatsApp</span>
                      </button>
                    ) : activeTicket.customerPhone ? (
                      <a
                        href={`https://wa.me/${activeTicket.customerPhone.replace(/\D/g, '').replace(/^0/, '62')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-3d-icon-wa px-2.5 min-h-[32px] py-1 font-bold text-[10.5px] gap-1"
                      >
                        <MessageSquare className="w-3 h-3" />
                        <span>WhatsApp</span>
                      </a>
                    ) : null}

                    <span
                      className={`px-2 py-1 rounded-lg font-bold text-[10.5px] uppercase tracking-wide ${
                        activeTicket.approvalStatus === 'BUTUH APPROVAL'
                          ? 'bg-rose-600 text-white'
                          : activeTicket.approvalStatus === 'APPROVED'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                          : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#35105E] dark:text-[#D8B4FE]'
                      }`}
                    >
                      {activeTicket.approvalStatus === 'BUTUH APPROVAL'
                        ? 'BUTUH ACC'
                        : activeTicket.statusWOInstaller || 'ASSIGNED'}
                    </span>
                  </div>
                </div>
              </header>

              {/* EXPANDED CHAT STREAM */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3.5 sm:px-5 lg:px-8 py-4 space-y-4">
                {/* Timeline Date & Checkpoint Pill */}
                <div className="flex items-center justify-center my-1">
                  <div className="px-4 py-1.5 rounded-full bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#3B1D78] text-[#52647A] dark:text-[#E8DDFF] text-[11px] font-semibold flex items-center gap-1.5 shadow-2xs max-w-full">
                    <MapPin className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#D8B4FE] shrink-0" />
                    <span className="truncate">
                      {activeTicket.checkInAt
                        ? `${activeTicket.installerName || 'Teknisi'} tiba & Check-in (${formatJakartaTimeOnly(
                            activeTicket.checkInAt
                          )} WIB) • ${activeTicket.clusterName || activeTicket.area || '-'}`
                        : `Hari Ini — ${formattedTodayLabel} • ${activeTicket.area || activeTicket.clusterName || '-'}`}
                    </span>
                  </div>
                </div>

                {/* Real System Telemetry Event: Assignment / Distribution */}
                {(activeTicket.assignedAt || activeTicket.dateAssignTechnician || activeTicket.installerName) && (
                  <div className="flex items-start gap-2.5 max-w-3xl mx-auto w-full">
                    <div className="w-8 h-8 rounded-full bg-[#EAE8FF] dark:bg-[#27104A] border border-[#C5BEEF] dark:border-[#5B35B1] flex items-center justify-center text-[#5145A6] dark:text-[#D8B4FE] shrink-0 mt-0.5">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="card-3d-lavender flex-1 rounded-2xl rounded-tl-sm p-3.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10.5px] font-bold text-[#5145A6] dark:text-[#D8B4FE] uppercase tracking-wider">
                          Telemetri Penugasan Work Order
                        </span>
                        <span className="font-mono text-[11px] text-[#8492A5] dark:text-[#A493C2] tabular-nums">
                          {activeTicket.assignedAt
                            ? formatWibTime(activeTicket.assignedAt)
                            : activeTicket.dateAssignTechnician || activeTicket.slotTime || '-'}
                        </span>
                      </div>
                      <p className="text-xs sm:text-[13px] text-[#26364A] dark:text-[#E8DDFF] leading-relaxed">
                        <span className="font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE]">[SYSTEM]</span>{' '}
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
                        <div className="mt-2 pt-2 border-t border-[#E2E8F0] dark:border-[#35105E] flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#8492A5] dark:text-[#C5B3DF] font-mono">
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
                  <div className="card-3d-lavender max-w-xl mx-auto my-8 p-6 rounded-2xl text-center space-y-2.5">
                    <MessageSquare className="w-9 h-9 text-[#5145A6] dark:text-[#D8B4FE] mx-auto" />
                    <div className="font-display font-bold text-sm text-[#26364A] dark:text-white">
                      Belum Ada Pesan pada Channel {activeTicket.woNumber}
                    </div>
                    <p className="text-xs text-[#8492A5] dark:text-[#C5B3DF] leading-relaxed">
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
                          isMe ? 'ml-auto justify-end' : 'justify-start'
                        }`}
                      >
                        {!isMe && (
                          <div className="relative flex-shrink-0 mt-1">
                            <div
                              className={`w-8 h-8 rounded-full font-display text-[11px] font-bold flex items-center justify-center ${
                                isTechBubble
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                                  : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#27104A] dark:text-[#D8B4FE]'
                              }`}
                            >
                              {getInitials(msg.senderName)}
                            </div>
                            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#16A36A] border-2 border-[#F3F8FC] dark:border-[#140827]" />
                          </div>
                        )}

                        <div
                          className={`flex flex-col gap-1 min-w-0 max-w-[85%] sm:max-w-[78%] ${
                            isMe ? 'items-end' : 'items-start'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-1.5 text-xs px-0.5">
                            {isMe ? (
                              <>
                                <span className="font-mono text-[10.5px] text-[#8492A5] dark:text-[#A493C2] tabular-nums">
                                  {formatWibTime(msg.timestamp)}
                                </span>
                                <span className="font-display font-bold text-[#5145A6] dark:text-[#D8B4FE]">
                                  Anda ({msg.senderName?.split(' ')[0] || 'User'})
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="font-display font-bold text-[#26364A] dark:text-white">
                                  {msg.senderName}
                                </span>
                                {getRoleBadge(msg.senderRole)}
                                <span className="font-mono text-[10.5px] text-[#8492A5] dark:text-[#A493C2] tabular-nums">
                                  {formatWibTime(msg.timestamp)}
                                </span>
                              </>
                            )}
                          </div>

                          {/* Speech Bubble */}
                          <div
                            className={`p-3.5 rounded-2xl text-[13.5px] leading-relaxed space-y-2 ${
                              isMe
                                ? 'rounded-tr-sm bg-gradient-to-br from-[#6657C8] to-[#5145A6] dark:from-[#7135B5] dark:to-[#58149C] text-white shadow-[0_3px_0_#3F3588,0_6px_14px_rgba(81,69,166,0.22)] dark:shadow-[0_3px_0_#35105E,0_6px_14px_rgba(53,16,94,0.22)]'
                                : 'rounded-tl-sm bg-white dark:bg-[#1E1238] text-[#26364A] dark:text-[#F5EEFF] border border-[#DDE6F0] dark:border-[#3B1D78] shadow-[0_2px_0_#DDE6F0] dark:shadow-[0_2px_0_#130826]'
                            }`}
                          >
                            {msg.category && String(msg.category).toUpperCase() !== 'UNCLASSIFIED' && (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                                    isMe
                                      ? 'bg-white/20 text-white'
                                      : 'bg-[#EAE8FF] dark:bg-[#27104A] text-[#5145A6] dark:text-[#D8B4FE]'
                                  }`}
                                >
                                  <Radio className="w-3 h-3" />
                                  <span>
                                    #{msg.category}
                                    {msg.isCheckIn ? ' · CHECK-IN' : ''}
                                  </span>
                                </span>
                                {activeTicket.fatCode && msg.isCheckIn && (
                                  <span
                                    className={`font-mono text-[10.5px] font-bold ${
                                      isMe ? 'text-[#E0DEFF]' : 'text-[#5145A6] dark:text-[#D8B4FE]'
                                    }`}
                                  >
                                    {activeTicket.fatCode}
                                    {activeTicket.fatPort ? ` ${activeTicket.fatPort}` : ''}
                                  </span>
                                )}
                              </div>
                            )}

                            {msg.text && (
                              <p className="whitespace-pre-wrap break-words">
                                {renderHighlightedText(msg.text, isMe)}
                              </p>
                            )}

                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                                {msg.attachments.map(att => {
                                  const previewUrl = getSafePreviewUrl(att.url);
                                  const isBroken = Boolean(brokenImageIds[att.id]);
                                  return (
                                    <div
                                      key={att.id}
                                      className="rounded-xl overflow-hidden bg-white dark:bg-[#160D29] p-1.5 border border-[#DDE6F0] dark:border-[#4B386B] shadow-2xs"
                                    >
                                      {isBroken || !previewUrl ? (
                                        <div className="h-36 rounded-lg bg-[#F4F7FB] dark:bg-[#241145] flex flex-col items-center justify-center p-3 text-center gap-1">
                                          <ImageIcon className="w-6 h-6 text-[#5145A6] dark:text-[#D8B4FE]" />
                                          <span className="text-[11px] font-semibold truncate max-w-full text-[#26364A] dark:text-white">
                                            {att.fileName}
                                          </span>
                                        </div>
                                      ) : (
                                        <div
                                          onClick={() => setZoomImage(previewUrl)}
                                          className="relative w-full h-36 rounded-lg overflow-hidden bg-[#26364A]/10 dark:bg-[#140827] group cursor-pointer"
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
                                          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between gap-2">
                                            <span className="px-2 py-0.5 rounded bg-[#26364A]/85 dark:bg-[#160D29]/80 text-white font-mono text-[10px] font-bold truncate">
                                              {att.fileSize > 0 ? formatFileSize(att.fileSize) : 'Bukti Lapangan'}
                                            </span>
                                            <span className="px-2 py-0.5 rounded-full bg-[#16A36A] text-white text-[9.5px] font-bold shrink-0">
                                              Terverifikasi
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                      <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
                                        <span className="text-[11px] font-medium text-[#52647A] dark:text-[#C5B3DF] truncate">
                                          {att.fileName}
                                        </span>
                                        {previewUrl && !isBroken && (
                                          <button
                                            type="button"
                                            onClick={() => setZoomImage(previewUrl)}
                                            className="btn-3d-lilac px-2.5 min-h-[30px] py-0.5 rounded-lg text-[10.5px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                                          >
                                            <Maximize2 className="w-3 h-3" />
                                            <span>Perbesar</span>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {isMe && (
                              <div className="flex justify-end pt-0.5">
                                <MessageStatusReceipt
                                  message={msg}
                                  senderId={currentUser?.id}
                                  variant="onDark"
                                  showLabel={true}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Live Device / OPM / Check-in Telemetry Terminal Card (Real Data Only) */}
                {(activeTicket.ontSerialNumber || activeTicket.rosetRedamanDbm !== undefined) && (
                  <div className="max-w-xl ml-auto rounded-2xl bg-gradient-to-br from-[#F0EDFF] via-white to-[#DDF4F4] dark:from-[#160D29] dark:via-[#160D29] dark:to-[#160D29] dark:bg-[#160D29] text-[#26364A] dark:text-[#F5EEFF] p-3.5 font-mono text-[11px] space-y-1.5 shadow-sm border border-[#C5BEEF] dark:border-[#4B386B]">
                    <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-[#5145A6] dark:text-[#D8B4FE]">
                      <span className="flex items-center gap-1.5 font-bold">
                        <Router className="w-3.5 h-3.5" />
                        <span>Telemetry Diagnostik Lapangan</span>
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 font-bold">
                        {activeTicket.checkInAt ? 'PASSED' : 'RECORDED'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        SN: {activeTicket.ontSerialNumber || '-'}
                        {activeTicket.dropcoreLengthMeter || activeTicket.dropcoreLength
                          ? ` | Dropcore: ${activeTicket.dropcoreLengthMeter || activeTicket.dropcoreLength}m`
                          : ''}
                      </span>
                      {activeTicket.rosetRedamanDbm !== undefined && activeTicket.rosetRedamanDbm !== null && (
                        <span
                          className={`font-bold tabular-nums ${
                            Number(activeTicket.rosetRedamanDbm) < -27 ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          Rx Power: {activeTicket.rosetRedamanDbm} dBm
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Error Banner */}
              {errorMessage && (
                <div className="mx-4 mb-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setErrorMessage(null)}
                    className="p-1 hover:opacity-75 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Pending Attachments Strip */}
              {pendingAttachments.length > 0 && (
                <div className="px-4 py-2 bg-[#F4F7FB] dark:bg-[#1E1238] border-t border-[#DDE6F0] dark:border-[#35105E] flex items-center gap-2.5 overflow-x-auto shrink-0">
                  {pendingAttachments.map(att => (
                    <div
                      key={att.id}
                      className="relative w-16 h-16 rounded-xl overflow-hidden border-2 border-[#6657C8] dark:border-[#7135B5] shrink-0"
                    >
                      <img src={att.url} alt={att.fileName} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setPendingAttachments(prev => prev.filter(a => a.id !== att.id))}
                        className="absolute top-1 right-1 p-0.5 bg-rose-600 text-white rounded-full cursor-pointer"
                        aria-label="Hapus lampiran"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <span className="text-xs font-semibold text-[#26364A] dark:text-[#E8DDFF]">
                    {pendingAttachments.length} foto siap dikirim
                  </span>
                </div>
              )}

              {/* BOTTOM INTERACTION CONSOLE: Read-Only Leader OR Quick Chips + Composer */}
              {isLeader ? (
                <div className="p-4 bg-amber-50 dark:bg-[#1E1238] border-t border-amber-200 dark:border-[#35105E] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 pb-safe">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-amber-600 text-white flex items-center justify-center shrink-0">
                      <Shield className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-xs text-amber-950 dark:text-amber-300 flex items-center gap-2 flex-wrap">
                        <span>Mode Pantau: Leader / Korlap (Read-Only)</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200/80 text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                          Hanya Pantau Percakapan
                        </span>
                      </div>
                      <p className="text-[11px] text-amber-800 dark:text-[#C5B3DF] mt-0.5 truncate">
                        Korlap memantau percakapan area {currentUser?.area || activeTicket.area || '-'} ·{' '}
                        {currentUser?.contractor || activeTicket.contactorName || activeTicket.contractorName || '-'}.
                        Pengiriman pesan dibatasi untuk Dispatch & Teknisi Lapangan.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px] font-bold text-[#16A36A]">
                    <span className="w-2 h-2 rounded-full bg-[#16A36A]" />
                    <span>Live Monitor</span>
                  </div>
                </div>
              ) : (
                <footer className="bg-white dark:bg-[#160D29] px-3.5 lg:px-6 pt-2.5 pb-safe flex flex-col gap-2 shadow-sm z-20 flex-shrink-0 border-t border-[#DDE6F0] dark:border-[#35105E]">
                  {/* QUICK ACTION CHIPS ROW */}
                  <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
                    <button
                      type="button"
                      onClick={handleShareGps}
                      disabled={isLocating}
                      className="tactile-chip inline-flex items-center gap-1.5 px-3 min-h-[38px] rounded-full text-[#5145A6] dark:text-[#D8B4FE] text-xs font-bold whitespace-nowrap cursor-pointer shrink-0"
                    >
                      {isLocating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />}
                      <span>Share GPS</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleInsertTelemetry}
                      className="inline-flex items-center gap-1.5 px-3 min-h-[38px] rounded-full bg-amber-100 dark:bg-amber-950/60 hover:bg-amber-200 text-amber-800 dark:text-amber-300 text-xs font-bold whitespace-nowrap cursor-pointer shrink-0 transition-colors"
                    >
                      <Gauge className="w-3.5 h-3.5" />
                      <span>Telemetri OPM</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="tactile-chip inline-flex items-center gap-1.5 px-3 min-h-[38px] rounded-full text-[#5145A6] dark:text-[#D8B4FE] text-xs font-bold whitespace-nowrap cursor-pointer shrink-0"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>Foto Bukti</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleTriggerIssue}
                      className="inline-flex items-center gap-1.5 px-3 min-h-[38px] rounded-full bg-rose-100 dark:bg-rose-950/70 hover:brightness-95 text-rose-800 dark:text-rose-200 text-xs font-bold whitespace-nowrap cursor-pointer shrink-0 transition-colors"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Kendala</span>
                    </button>

                    <span className="h-4 w-px bg-[#DDE6F0] dark:bg-[#4B386B] shrink-0 mx-0.5" />

                    {quickReplyChips.map(chip => (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => insertQuickReply(chip.text)}
                        className="tactile-chip inline-flex items-center gap-1 px-3 min-h-[38px] rounded-full text-[#52647A] dark:text-[#E8DDFF] text-xs font-semibold whitespace-nowrap cursor-pointer shrink-0"
                      >
                        <Zap className="w-3 h-3 text-[#6657C8] dark:text-[#D8B4FE]" />
                        <span>{chip.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Installer Mandatory Category Pills & Selector (Strictly Installer only) */}
                  {isInstaller && (
                    <div
                      className={`px-3 py-2 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
                        !installerCategory || installerCategory.toUpperCase() === 'UNCLASSIFIED'
                          ? 'bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                          : 'mj-tactile-well border border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#E8DDFF]'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        <Tag className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {!installerCategory || installerCategory.toUpperCase() === 'UNCLASSIFIED'
                            ? 'Pilih kategori wajib (pilih #PROGRESS untuk Check-in lokasi):'
                            : `Kategori Aktif Teknisi: #${installerCategory}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {activeCategories.map(cat => {
                          const isSelected = installerCategory.toUpperCase() === String(cat.name).toUpperCase();
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => handleCategoryChangeForActiveTicket(cat.name)}
                              className={`px-3 min-h-[36px] rounded-full text-[10.5px] font-bold uppercase cursor-pointer transition-colors ${
                                isSelected
                                  ? 'tactile-chip-active shadow-2xs'
                                  : 'tactile-chip text-[#52647A]'
                              }`}
                            >
                              #{cat.name}
                            </button>
                          );
                        })}
                      </div>
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
                  <form onSubmit={handleSendMessage} className="flex items-center gap-2 w-full relative">
                    <div className="tactile-debossed-input flex items-center gap-1.5 flex-1 min-w-0 bg-[#F4F7FB] dark:bg-[#1E1238] rounded-2xl p-1.5 border border-[#DDE6F0] dark:border-[#4B386B]">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="btn-3d-icon w-11 h-11 rounded-xl !text-[#5145A6] dark:!text-[#D8B4FE] flex-shrink-0 cursor-pointer"
                        title="Lampirkan Berkas Foto"
                        aria-label="Lampirkan Berkas"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="btn-3d-icon hidden sm:flex w-11 h-11 rounded-xl !text-[#5145A6] dark:!text-[#D8B4FE] flex-shrink-0 cursor-pointer"
                        title="Ambil Foto Lapangan"
                        aria-label="Ambil Foto"
                      >
                        <Camera className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowTemplateMenu(prev => !prev)}
                        className="btn-3d-icon hidden md:flex w-11 h-11 rounded-xl !text-[#5145A6] dark:!text-[#D8B4FE] flex-shrink-0 cursor-pointer"
                        title="Sisipkan Template SOP"
                        aria-label="Template SOP"
                      >
                        <FileText className="w-4 h-4" />
                      </button>

                      {showTemplateMenu && (
                        <div className="card-3d-lavender absolute bottom-full left-0 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-2 z-30 space-y-1">
                          <div className="px-2 py-1 flex items-center justify-between text-[11px] font-bold text-[#5145A6] dark:text-[#D8B4FE] border-b border-[#E2E8F0] dark:border-[#35105E]">
                            <span>Template Cepat SOP</span>
                            <button
                              type="button"
                              onClick={() => setShowTemplateMenu(false)}
                              className="cursor-pointer p-1"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {quickReplyChips.map(tpl => (
                            <button
                              key={tpl.id}
                              type="button"
                              onClick={() => insertQuickReply(tpl.text)}
                              className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-[#26364A] dark:text-[#E8DDFF] hover:bg-[#EDF3F8] dark:hover:bg-[#27104A] transition-colors cursor-pointer"
                            >
                              {tpl.text}
                            </button>
                          ))}
                        </div>
                      )}

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
                        placeholder={`Ketik pesan koordinasi operasional ${activeTicket.woNumber}...`}
                        className="flex-1 min-w-0 bg-transparent px-2 py-2.5 text-xs sm:text-sm text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none resize-none"
                      />

                      <button
                        type="submit"
                        disabled={isSubmitting || (!inputText.trim() && pendingAttachments.length === 0)}
                        className="btn-3d-primary h-11 px-4 rounded-xl flex items-center justify-center gap-1.5 font-display text-xs sm:text-sm font-bold disabled:opacity-45 disabled:cursor-not-allowed flex-shrink-0 cursor-pointer whitespace-nowrap"
                      >
                        {isSubmitting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <span className="hidden sm:inline">Kirim</span>
                            <Send className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </footer>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#8492A5] dark:text-[#C5B3DF] space-y-3">
              {isCompactUI && (
                <button
                  type="button"
                  onClick={() => setMobilePane('queue')}
                  className="btn-3d-primary px-4 min-h-[44px] rounded-xl text-xs font-bold cursor-pointer"
                >
                  Lihat Daftar Antrean WO
                </button>
              )}
              <MessageSquare className="w-12 h-12 text-[#5145A6] dark:text-[#D8B4FE]" />
              <div className="font-display font-bold text-base text-[#26364A] dark:text-white">
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
      <ResponsiveModal
        isOpen={Boolean(zoomImage)}
        onClose={() => setZoomImage(null)}
        size="xl"
        mobileVariant="fullscreen"
        zIndexClass="z-70"
        icon={<ImageIcon className="w-4 h-4" />}
        title="Bukti Foto Lapangan"
      >
        {zoomImage && (
          <div className="flex items-center justify-center min-h-[260px] bg-[#26364A]/95 dark:bg-[#160D29]/95 rounded-xl p-2 sm:p-4">
            <img
              src={zoomImage}
              alt="Bukti Foto Zoom"
              referrerPolicy="no-referrer"
              className="max-w-full max-h-[75dvh] object-contain rounded-xl shadow-2xl"
            />
          </div>
        )}
      </ResponsiveModal>

      {/* Admin Chat Category Management Modal */}
      <ResponsiveModal
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false);
          setEditingCategory(null);
        }}
        size="lg"
        mobileVariant="sheet"
        zIndexClass="z-60"
        icon={<Tag className="w-4 h-4" />}
        title="Pengaturan Kategori Chat (Contact Center)"
        subtitle="Kelola kategori percakapan untuk pengelompokan unread chat dan alur komunikasi operasional."
        footer={
          <button
            type="button"
            onClick={() => {
              setIsSettingsOpen(false);
              setEditingCategory(null);
            }}
            className="btn-3d-primary px-4 py-2 text-xs font-bold rounded-xl cursor-pointer min-h-[44px]"
          >
            Selesai
          </button>
        }
      >
        <div className="space-y-4">
          {/* Create / Edit Category Form */}
          <div className="mj-tactile-well p-4 border border-[#DDE6F0] dark:border-[#35105E] space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="text-[10.5px] font-semibold text-[#52647A] dark:text-[#C5B3DF] block mb-1">
                  Nama Kategori (Wajib)
                </label>
                <input
                  type="text"
                  placeholder="Mis. PROGRESS, KENDALA_REDAMAN..."
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  className="tactile-debossed-input w-full min-h-[42px] px-3 py-1.5 bg-white dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#4B386B] rounded-lg text-xs text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8]"
                />
              </div>
              <div>
                <label className="text-[10.5px] font-semibold text-[#52647A] dark:text-[#C5B3DF] block mb-1">
                  Warna Tag
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newCatColor}
                    onChange={e => setNewCatColor(e.target.value)}
                    className="w-10 h-10 rounded border border-[#DDE6F0] dark:border-[#4B386B] cursor-pointer"
                  />
                  <span className="text-xs font-mono text-[#26364A] dark:text-white">{newCatColor}</span>
                </div>
              </div>
            </div>

            <div>
              <label className="text-[10.5px] font-semibold text-[#52647A] dark:text-[#C5B3DF] block mb-1">
                Deskripsi Operasional (Opsional)
              </label>
              <input
                type="text"
                placeholder="Keterangan alur penanganan tiket..."
                value={newCatDesc}
                onChange={e => setNewCatDesc(e.target.value)}
                className="tactile-debossed-input w-full min-h-[42px] px-3 py-1.5 bg-white dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#4B386B] rounded-lg text-xs text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8]"
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
                    setNewCatColor('#5145A6');
                  }}
                  className="btn-3d-ceramic px-3 min-h-[40px] py-1.5 text-xs rounded-lg cursor-pointer"
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
                  setNewCatColor('#5145A6');
                }}
                className="btn-3d-primary px-4 min-h-[40px] py-1.5 text-xs font-bold rounded-lg cursor-pointer"
              >
                {editingCategory ? 'Simpan Perubahan' : 'Tambahkan Kategori'}
              </button>
            </div>
          </div>

          {/* Responsive Category List Table */}
          <ResponsiveDataTable<ChatCategoryConfig>
            data={chatCategories || []}
            getRowKey={cat => cat.id}
            maxTableHeightClass="max-h-72"
            mobileTitle={cat => (
              <div className="flex items-center gap-2">
                <span className="inline-block w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                <span>{cat.name}</span>
              </div>
            )}
            mobileSubtitle={cat => cat.description || undefined}
            mobileStatus={cat => {
              const usageCount = tickets.filter(
                t => (t.chatCategory || '').toUpperCase() === cat.name.toUpperCase()
              ).length;
              return (
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      cat.isActive
                        ? 'bg-[#ECFDF5] text-[#16A36A] dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-[#F4F7FB] text-[#52647A] dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {cat.isActive ? 'Aktif' : 'Nonaktif'}
                  </span>
                  <span className="text-[10px] text-[#8492A5] font-mono tabular-nums">
                    {usageCount} tiket
                  </span>
                </div>
              );
            }}
            columns={
              [
                {
                  key: 'color',
                  label: 'Warna',
                  widthClass: 'w-12',
                  priority: 'hidden_mobile',
                  render: cat => (
                    <span
                      className="inline-block w-4 h-4 rounded-full shadow-2xs"
                      style={{ backgroundColor: cat.color }}
                    />
                  )
                },
                {
                  key: 'name',
                  label: 'Nama Kategori',
                  priority: 'primary',
                  render: cat => {
                    const usageCount = tickets.filter(
                      t => (t.chatCategory || '').toUpperCase() === cat.name.toUpperCase()
                    ).length;
                    return (
                      <div>
                        <div className="font-bold text-[#26364A] dark:text-white">{cat.name}</div>
                        {cat.description && (
                          <div className="text-[10.5px] text-[#52647A] dark:text-[#CEC0E8]">{cat.description}</div>
                        )}
                        <div className="text-[10px] text-[#8492A5] font-mono mt-0.5 tabular-nums">
                          Digunakan pada {usageCount} tiket
                        </div>
                      </div>
                    );
                  }
                },
                {
                  key: 'status',
                  label: 'Status',
                  priority: 'primary',
                  render: cat => (
                    <button
                      type="button"
                      onClick={() => toggleChatCategoryActive(cat.id)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer ${
                        cat.isActive
                          ? 'bg-[#ECFDF5] text-[#16A36A] dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-[#F4F7FB] text-[#52647A] dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {cat.isActive ? 'Aktif' : 'Nonaktif'}
                    </button>
                  )
                }
              ] as ResponsiveColumn<ChatCategoryConfig>[]
            }
            getRowActions={cat => [
              {
                id: 'toggle_active',
                label: cat.isActive ? 'Nonaktifkan' : 'Aktifkan',
                icon: <CheckCircle2 className="w-3.5 h-3.5" />,
                onClick: () => toggleChatCategoryActive(cat.id)
              },
              {
                id: 'edit',
                label: 'Edit Kategori',
                icon: <Edit2 className="w-3.5 h-3.5" />,
                onClick: () => {
                  setEditingCategory(cat);
                  setNewCatName(cat.name);
                  setNewCatColor(cat.color);
                  setNewCatDesc(cat.description || '');
                }
              },
              {
                id: 'delete',
                label: 'Hapus Kategori',
                icon: <Trash2 className="w-3.5 h-3.5" />,
                tone: 'danger',
                onClick: () => {
                  deleteChatCategory(cat.id);
                  toast.info(
                    `Kategori ${cat.name} dihapus. Tiket terkait dipindahkan ke UNCLASSIFIED.`,
                    'Dihapus'
                  );
                }
              }
            ]}
            renderDesktopActions={cat => (
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setEditingCategory(cat);
                    setNewCatName(cat.name);
                    setNewCatColor(cat.color);
                    setNewCatDesc(cat.description || '');
                  }}
                  className="p-1 text-[#5145A6] dark:text-[#D8B4FE] hover:bg-[#EDF3F8] dark:hover:bg-[#35105E] rounded cursor-pointer"
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
              </div>
            )}
          />
        </div>
      </ResponsiveModal>
    </div>
  );
};
