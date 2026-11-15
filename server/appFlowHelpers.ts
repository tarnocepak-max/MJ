/**
 * Shared MoraJaws App Flow Helpers (Server & Adapter)
 *
 * Implements:
 * 1. Automatic WO Distribution to Leader:
 *    Match Contractor/Vendor + Area first, then fallback to Contractor-level Leader.
 *    Never select a random Leader fallback; otherwise mark as Belum Terdistribusi
 *    ('unmapped_contractor' or 'unmapped_leader') with clear reason.
 * 2. Scope matching helpers for Contractor & Area.
 * 3. Strict LiveChat category === 'PROGRESS' check-in rule.
 * 4. Supabase ticket_messages normalization (readBy, category, timestamp).
 */

export interface AutoDistributionOutcome {
  matched: boolean;
  distributionStatus:
    | 'distributed'
    | 'unmapped_contractor'
    | 'unmapped_leader'
    | 'coverage_mismatch'
    | 'schedule_not_available';
  distributionNotes: string;
  contractorId?: string;
  contractorName?: string;
  contactorName?: string;
  leaderId?: string;
  leaderName?: string;
  leaderContact?: string;
  corlapName?: string;
}

function norm(val?: string | null): string {
  return String(val || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isContractorMatch(a?: string | null, b?: string | null): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function isAreaMatch(a?: string | null, b?: string | null): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function userMatchesContractor(
  user: any,
  contractorObj: any | undefined,
  rawContractorName: string
): boolean {
  const uContrId = norm(user?.contractorId || user?.contractor_id);
  const uContrName = norm(user?.contractor);

  if (contractorObj) {
    const cId = norm(contractorObj.id);
    const cName = norm(contractorObj.name);
    const cCode = norm(contractorObj.code);
    if (uContrId && cId && uContrId === cId) return true;
    if (uContrName && (isContractorMatch(uContrName, cName) || (cCode && uContrName === cCode))) {
      return true;
    }
  }

  if (rawContractorName) {
    if (uContrName && isContractorMatch(uContrName, rawContractorName)) return true;
    if (uContrId && isContractorMatch(uContrId, rawContractorName)) return true;
  }

  return false;
}

/**
 * Resolves the authoritative Leader for an imported Work Order.
 * Priority:
 *  1) Active Leader matching Contractor AND Area
 *  2) Active Contractor-level Leader matching Contractor (preferring designated contractor leaderId/leaderName or leader without area restriction, then deterministic Contractor Leader)
 *  3) Never select a random leader across contractors; return unmapped_contractor / unmapped_leader ('Belum Terdistribusi')
 */
export function resolveLeaderForWorkOrder(
  ticket: any,
  users: any[] = [],
  contractors: any[] = []
): AutoDistributionOutcome {
  const rawContractorName = String(
    ticket?.contactorName || ticket?.contractorName || ticket?.contractor_name || ''
  ).trim();
  const rawContractorId = String(ticket?.contractorId || ticket?.contractor_id || '').trim();
  const rawArea = String(ticket?.area || '').trim();

  if (!rawContractorName && !rawContractorId) {
    return {
      matched: false,
      distributionStatus: 'unmapped_contractor',
      distributionNotes: 'Belum Terdistribusi: Contractor/Vendor pada Work Order kosong.'
    };
  }

  const activeContractors = (contractors || []).filter(
    c => c && c.active !== false && !c.isArchived
  );

  const matchedContractor = activeContractors.find(c => {
    if (rawContractorId && norm(c.id) === norm(rawContractorId)) return true;
    if (rawContractorName) {
      if (norm(c.name) === norm(rawContractorName)) return true;
      if (c.code && norm(c.code) === norm(rawContractorName)) return true;
      if (isContractorMatch(c.name, rawContractorName)) return true;
    }
    return false;
  });

  const activeLeaders = (users || []).filter(
    u => u && u.role === 'leader' && u.active !== false && !u.isDeleted
  );

  // Filter active leaders belonging to this contractor
  const contractorLeaders = activeLeaders
    .filter(u => userMatchesContractor(u, matchedContractor, rawContractorName))
    .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));

  if (!matchedContractor && contractorLeaders.length === 0) {
    return {
      matched: false,
      distributionStatus: 'unmapped_contractor',
      distributionNotes: `Belum Terdistribusi: Contractor/Vendor "${rawContractorName || rawContractorId}" tidak dikenali dalam Master Contractor.`
    };
  }

  const canonicalContractorName = matchedContractor?.name || rawContractorName;
  const canonicalContractorId = matchedContractor?.id || rawContractorId || undefined;

  // Priority 1: Match Contractor AND Area
  if (rawArea) {
    const areaMatchedLeader = contractorLeaders.find(u => u.area && isAreaMatch(u.area, rawArea));
    if (areaMatchedLeader) {
      return {
        matched: true,
        distributionStatus: 'distributed',
        distributionNotes: `Terdistribusi otomatis ke Leader ${areaMatchedLeader.name} (Contractor: ${canonicalContractorName}, Area: ${areaMatchedLeader.area || rawArea}).`,
        contractorId: canonicalContractorId,
        contractorName: canonicalContractorName,
        contactorName: canonicalContractorName,
        leaderId: areaMatchedLeader.id,
        leaderName: areaMatchedLeader.name,
        leaderContact: areaMatchedLeader.phone || undefined,
        corlapName: areaMatchedLeader.name
      };
    }
  }

  // Priority 2: Fallback to Contractor-level Leader
  let contractorLeader: any = null;
  if (matchedContractor?.leaderId || matchedContractor?.leaderName) {
    contractorLeader = contractorLeaders.find(
      u =>
        (matchedContractor.leaderId && u.id === matchedContractor.leaderId) ||
        (matchedContractor.leaderName && norm(u.name) === norm(matchedContractor.leaderName))
    ) || null;
  }
  if (!contractorLeader) {
    // Prefer leader without area restriction first, otherwise first active leader in contractor
    contractorLeader =
      contractorLeaders.find(u => !String(u.area || '').trim()) ||
      contractorLeaders[0] ||
      null;
  }

  if (contractorLeader) {
    return {
      matched: true,
      distributionStatus: 'distributed',
      distributionNotes: `Terdistribusi otomatis ke Contractor Leader ${contractorLeader.name} (${canonicalContractorName}).`,
      contractorId: canonicalContractorId,
      contractorName: canonicalContractorName,
      contactorName: canonicalContractorName,
      leaderId: contractorLeader.id,
      leaderName: contractorLeader.name,
      leaderContact: contractorLeader.phone || undefined,
      corlapName: contractorLeader.name
    };
  }

  // Fallback if contractor record has leaderName configured (even without matching user object) — keep traceable
  if (matchedContractor?.leaderName && String(matchedContractor.leaderName).trim()) {
    return {
      matched: true,
      distributionStatus: 'distributed',
      distributionNotes: `Terdistribusi ke Contractor Leader ${matchedContractor.leaderName} (${canonicalContractorName}).`,
      contractorId: canonicalContractorId,
      contractorName: canonicalContractorName,
      contactorName: canonicalContractorName,
      leaderId: matchedContractor.leaderId || undefined,
      leaderName: matchedContractor.leaderName.trim(),
      corlapName: matchedContractor.leaderName.trim()
    };
  }

  return {
    matched: false,
    distributionStatus: 'unmapped_leader',
    distributionNotes: `Belum Terdistribusi: Contractor "${canonicalContractorName}" belum memiliki akun Leader aktif.`,
    contractorId: canonicalContractorId,
    contractorName: canonicalContractorName,
    contactorName: canonicalContractorName
  };
}

/**
 * Strictly requires selected LiveChat category 'PROGRESS' to trigger technician check-in.
 * Keyword-based detection in non-PROGRESS categories is intentionally disabled.
 */
export function isProgressCategoryOnly(category?: string | null): boolean {
  return String(category || '').trim().toUpperCase() === 'PROGRESS';
}

/**
 * Normalizes a Supabase ticket_messages row into the canonical TicketMessage shape.
 */
export function mapSupabaseMessageToModel(row: any): any {
  if (!row) return null;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const readBy = Array.isArray(payload.readBy)
    ? payload.readBy.filter((x: any) => typeof x === 'string' && x.trim().length > 0)
    : (row.sender_id ? [String(row.sender_id)] : []);

  return {
    id: String(row.id || ''),
    ticketId: String(row.ticket_id || row.ticketId || ''),
    woNumber: String(row.wo_number || row.woNumber || ''),
    senderId: String(row.sender_id || row.senderId || ''),
    senderName: String(row.sender_name || row.senderName || ''),
    senderRole: row.sender_role || row.senderRole || 'installer',
    text: String(row.message_text ?? row.text ?? ''),
    category: payload.category || row.category || undefined,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    timestamp: row.created_at || row.timestamp || new Date().toISOString(),
    readBy,
    isCheckIn: Boolean(payload.isCheckIn)
  };
}
