import React from 'react';
import { useApp } from '../../context/AppContext';
import { Ticket, WOKpiFilterKey } from '../../types';
import { SlaTelemetryDashboardView } from '../sla/SlaTelemetryDashboardView';
import { DashboardKpiSummaryCards } from './DashboardKpiSummaryCards';

interface DashboardOverviewProps {
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ onNavigate, onSelectTicket }) => {
  const {
    currentUser,
    todayWIB,
    setActiveKpiDrilldown,
    setKpiContractorFilter,
    setKpiAreaFilter
  } = useApp();

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

  return (
    <div className="space-y-6">
      {/* Live WO Lifecycle 13 KPI Cards & Vendor Breakdown */}
      <DashboardKpiSummaryCards
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
    </div>
  );
};
