import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { GitBranch, Power, Lock, Loader2, AlertTriangle } from 'lucide-react';

export const WorkflowManager: React.FC = () => {
  const { workflowRules, toggleWorkflowRule, currentUser } = useApp();
  const isSuperAdmin = currentUser.role === 'super_admin';
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleToggle = async (ruleId: string, nextEnabled: boolean) => {
    if (!isSuperAdmin || savingRuleId) return;
    setSavingRuleId(ruleId);
    setSaveError(null);
    const res = await toggleWorkflowRule(ruleId, nextEnabled);
    if (!res.success && res.error) {
      setSaveError(res.error);
    }
    setSavingRuleId(null);
  };

  return (
    <div className="space-y-5">
      <div className="card-3d-lavender rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-b from-[#EAE8FF] to-[#DDF4F4] dark:from-[#7135B5] dark:to-[#58149C] border border-[#C5BEEF] dark:border-transparent text-[#5145A6] dark:text-white flex items-center justify-center shrink-0 shadow-[0_2px_0_#D2DAEA] dark:shadow-[0_2px_0_#35105E]">
            <GitBranch className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="px-2 py-0.5 rounded-full text-[9.5px] font-extrabold uppercase tracking-wider bg-[#EAE8FF] text-[#5145A6] border border-[#C5BEEF] dark:border-transparent dark:bg-gradient-to-b dark:from-[#6b103b] dark:to-[#480123] dark:text-white dark:shadow-[0_1.5px_0_#260112]">
                AUTOMATION ENGINE
              </span>
              <span className="font-mono text-[10.5px] font-bold text-[#5145A6] dark:text-[#DAB9FF]">
                {workflowRules.filter(r => r.enabled).length}/{workflowRules.length} RULES ACTIVE
              </span>
            </div>
            <h3 className="font-display text-sm sm:text-base font-extrabold text-[#26364A] dark:text-white">
              Workflow &amp; Dispatch Automation Rules
            </h3>
            <p className="text-xs text-[#52647A] dark:text-[#CABDE8]">
              Aturan otomatisasi global (Database-First) yang berlaku serentak di seluruh sistem setelah disimpan ke PostgreSQL.
            </p>
          </div>
        </div>
      </div>

      {!isSuperAdmin && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-200">
          <Lock className="w-4 h-4 shrink-0 text-amber-600" />
          <span>
            <strong>Mode Baca Saja:</strong> Hanya Super Admin yang dapat mengaktifkan atau menonaktifkan Workflow Rules global.
          </span>
        </div>
      )}

      {saveError && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center gap-2.5 text-xs text-rose-700 dark:text-rose-200">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{saveError}</span>
        </div>
      )}

      <div className="space-y-3.5">
        {workflowRules.map(rule => {
          const isSaving = savingRuleId === rule.id;
          return (
            <div
              key={rule.id}
              className={`card-3d-lavender p-5 rounded-2xl transition-all space-y-3 text-xs ${
                rule.enabled ? '' : 'opacity-80'
              }`}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className={`w-2.5 h-2.5 rounded-full ${rule.enabled ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-[#CBD5E1] dark:bg-[#4b386b]'}`} />
                  <h4 className="font-display font-bold text-[#26364A] dark:text-white text-xs sm:text-sm">
                    {rule.name}
                  </h4>
                  <span className="font-mono text-[10.5px] px-2 py-0.5 bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#DAB9FF] border border-[#C5BEEF] dark:border-[#5b35b1] rounded-full font-bold">
                    trigger: {rule.trigger}
                  </span>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    disabled={!isSuperAdmin || Boolean(savingRuleId)}
                    onClick={() => handleToggle(rule.id, !rule.enabled)}
                    className={`px-3.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 ${
                      rule.enabled ? 'btn-3d-emerald' : 'btn-3d-lilac'
                    } ${isSuperAdmin && !savingRuleId ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}
                  >
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                    <span>{isSaving ? 'SAVING...' : rule.enabled ? 'ACTIVE' : 'DISABLED'}</span>
                  </button>
                </div>
              </div>

              <p className="text-[#52647A] dark:text-[#CABDE8] text-xs leading-relaxed">
                {rule.description}
              </p>

              <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0] dark:border-[#3b1d78] text-[11px] text-[#8492A5] dark:text-[#A79BC0] font-mono tabular-nums">
                <div>
                  Total Executed: <span className="font-bold text-[#5145A6] dark:text-[#DAB9FF]">{rule.executionCount}x</span>
                </div>
                <div>
                  Last Run: {rule.lastExecutedAt ? new Date(rule.lastExecutedAt).toLocaleString('id-ID') : 'Never'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
