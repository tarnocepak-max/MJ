import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Ticket, WOKpiFilterKey } from '../../types';
import { SlaTelemetryDashboardView } from '../sla/SlaTelemetryDashboardView';
import { DashboardKpiSummaryCards } from './DashboardKpiSummaryCards';
import { OpsCommandHero, OpsCommandViewTab } from './OpsCommandHero';
import { StitchLeaderCommandHub } from '../portals/StitchLeaderCommandHub';

interface DashboardOverviewProps {
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  onNavigate,
  onSelectTicket,
  onOpenWhatsApp
}) => {
  const {
    currentUser,
    todayWIB,
    setActiveKpiDrilldown,
    setKpiContractorFilter,
    setKpiAreaFilter
  } = useApp();

  const [activeCommandView, setActiveCommandView] = useState<OpsCommandViewTab>('overview');

  const canViewSlaEngine =
    currentUser?.role === 'super_admin' ||
    currentUser?.role === 'dispatch' ||
    currentUser?.role === 'leader' ||
    currentUser?.role === 'management_data';

  const handleKpiDrillDown = (
    filterKey: WOKpiFilterKey,
    filters?: { contractor?: string; area?: string }
  ) => {
    if (filters?.contractor) {
      setKpiContractorFilter(filters.contractor);
    }
    if (filters?.area) {
      setKpiAreaFilter(filters.area);
    }
    setActiveKpiDrilldown({
      filterKey,
      dateWIB: todayWIB,
      contractor: filters?.contractor,
      area: filters?.area
    });

    if (currentUser?.role === 'leader') {
      onNavigate('wo_assignment');
    } else if (currentUser?.role === 'installer') {
      onNavigate('installer_tasks');
    } else {
      onNavigate('tickets');
    }
  };

  if (currentUser?.role === 'leader') {
    return (
      <StitchLeaderCommandHub
        onNavigate={onNavigate}
        onSelectTicket={onSelectTicket}
        onOpenWhatsApp={onOpenWhatsApp}
        onDrillDown={handleKpiDrillDown}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Stitch 3D Tactile Ops Command Header & Interactive Operational Views */}
      <OpsCommandHero
        activeView={activeCommandView}
        onChangeView={setActiveCommandView}
        onNavigate={onNavigate}
        onSelectTicket={onSelectTicket}
        onOpenWhatsApp={onOpenWhatsApp}
        onDrillDown={handleKpiDrillDown}
      />

      {activeCommandView === 'overview' && (
        <>
          {/* Live WO Lifecycle Vendor / Area / Leader / Installer Capacity Breakdown */}
          <DashboardKpiSummaryCards
            defaultPerspective="vendor"
            onDrillDown={handleKpiDrillDown}
            onOpenHistoryReport={() => onNavigate('history_progress')}
          />

          {/* Existing SLA & Vendor Telemetry Engine */}
          {canViewSlaEngine && (
            <SlaTelemetryDashboardView
              viewContext="dashboard_monitoring"
              onNavigate={onNavigate}
              onSelectTicket={onSelectTicket}
            />
          )}
        </>
      )}
    </div>
  );
};
