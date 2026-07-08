import React, { useCallback, useEffect, useRef, useState } from 'react';
import icalcLogo from '../assets/logo/icalc-logo.png';
import { Icons } from '../constants';
import {
  AccessCodeRow,
  adminApproveCode,
  adminDenyCode,
  adminListCodes,
  adminPauseCode,
  adminResumeCode,
  adminUpdateMemo,
  clearAdminSession,
} from '../utils/accessControl';
import { ADMIN_PROFILE_NAME, createAdminProfile } from '../utils/auth';

type AdminTab = 'unused' | 'pending' | 'approved';

interface AdminCodeDashboardProps {
  isLight: boolean;
  adminToken: string;
  onClose: () => void;
}

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'unused', label: 'Unused' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
];

const LONG_PRESS_MS = 520;

const formatWhen = (value: string | null | undefined): string => {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '—';
  return new Date(parsed).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const AdminCodeDashboard: React.FC<AdminCodeDashboardProps> = ({ isLight, adminToken, onClose }) => {
  const [tab, setTab] = useState<AdminTab>('pending');
  const [codes, setCodes] = useState<AccessCodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionCode, setActionCode] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<AccessCodeRow | null>(null);
  const [approveMemo, setApproveMemo] = useState('');
  const [detailRow, setDetailRow] = useState<AccessCodeRow | null>(null);
  const [detailMemo, setDetailMemo] = useState('');
  const [savingMemo, setSavingMemo] = useState(false);
  const longPressTimer = useRef<number | null>(null);

  const panelClass = isLight
    ? 'bg-white/90 border-black/10 text-black'
    : 'pos-dashboard-card-glass border border-white/12 text-white';

  const modalClass = isLight
    ? 'bg-white border-black/10 text-black'
    : 'pos-dashboard-card-glass border border-white/12 text-white';

  const inputClass = isLight
    ? 'bg-white/90 border-black/10 text-black placeholder:text-black/35'
    : 'bg-white/8 border-white/12 text-white placeholder:text-white/35';

  const loadCodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await adminListCodes(adminToken, tab);
    if (!result.ok) {
      setError(result.error);
      setCodes([]);
    } else {
      setCodes(result.codes);
    }
    setLoading(false);
  }, [adminToken, tab]);

  useEffect(() => {
    void loadCodes();
    const interval = window.setInterval(() => void loadCodes(), 4000);
    return () => window.clearInterval(interval);
  }, [loadCodes]);

  const runAction = async (code: string, action: () => Promise<{ ok: boolean; error?: string }>) => {
    setActionCode(code);
    setError(null);
    const result = await action();
    setActionCode(null);
    if (!result.ok) {
      setError(result.error ?? 'Action failed.');
      return;
    }
    await loadCodes();
  };

  const openApproveModal = (row: AccessCodeRow) => {
    setApproveTarget(row);
    setApproveMemo(row.admin_memo ?? '');
    setError(null);
  };

  const confirmApprove = async () => {
    if (!approveTarget) return;
    setActionCode(approveTarget.code);
    const result = await adminApproveCode(adminToken, approveTarget.code, approveMemo);
    setActionCode(null);
    if (!result.ok) {
      setError(result.error ?? 'Approve failed.');
      return;
    }
    setApproveTarget(null);
    setApproveMemo('');
    await loadCodes();
  };

  const openDetail = (row: AccessCodeRow) => {
    setDetailRow(row);
    setDetailMemo(row.admin_memo ?? '');
    setError(null);
  };

  const saveDetailMemo = async () => {
    if (!detailRow) return;
    setSavingMemo(true);
    const result = await adminUpdateMemo(adminToken, detailRow.code, detailMemo);
    setSavingMemo(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not save memo.');
      return;
    }
    await loadCodes();
    setDetailRow((prev) => (prev ? { ...prev, admin_memo: detailMemo.trim() || null } : prev));
  };

  const clearLongPressTimer = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleCardPointerDown = (row: AccessCodeRow) => {
    clearLongPressTimer();
    longPressTimer.current = window.setTimeout(() => {
      openDetail(row);
      if ('vibrate' in navigator) navigator.vibrate(12);
    }, LONG_PRESS_MS);
  };

  const handleCardPointerEnd = () => {
    clearLongPressTimer();
  };

  const handleExit = async () => {
    await clearAdminSession();
    onClose();
  };

  const adminProfile = createAdminProfile();

  return (
    <div className="fixed inset-0 z-[1100] flex flex-col bg-black/80 backdrop-blur-xl">
      <div className="flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-3">
          <img src={icalcLogo} alt="" className="w-10 h-10 rounded-xl object-cover" draggable={false} />
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] opacity-60">Admin Profile</p>
            <p className="text-lg font-black">{ADMIN_PROFILE_NAME}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleExit()}
          className={`h-10 w-10 rounded-full flex items-center justify-center border ${isLight ? 'bg-white/80 border-black/10' : 'bg-white/10 border-white/15'}`}
          aria-label="Exit admin portal"
        >
          <Icons.Close size={18} />
        </button>
      </div>

      <div className="flex justify-center px-4 pb-4">
        <div
          className={`inline-flex rounded-full p-1 gap-1 border shadow-lg ${isLight ? 'bg-white/70 border-black/10' : 'bg-black/40 border-white/10'}`}
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-5 py-2 rounded-full text-[11px] font-black uppercase tracking-[0.2em] transition-all ${
                tab === item.id
                  ? 'bg-blue-500 text-white shadow-md'
                  : isLight
                    ? 'text-black/55 hover:text-black'
                    : 'text-white/55 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <p className={`text-center text-[10px] opacity-45 px-4 pb-2 ${isLight ? 'text-white' : 'text-white'}`}>
        Press and hold any code for details
      </p>

      <div className="flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error && (
          <p className="text-center text-sm font-bold text-red-500 mb-3" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="auth-loading-ring auth-loading-ring--outer w-16 h-16" aria-hidden="true" />
          </div>
        ) : codes.length === 0 ? (
          <p className={`text-center text-sm opacity-50 py-16 ${isLight ? 'text-black' : 'text-white'}`}>
            No codes in this view.
          </p>
        ) : (
          <div className="max-w-lg mx-auto space-y-3">
            {codes.map((row) => (
              <div
                key={row.code}
                className={`rounded-2xl border px-4 py-4 select-none touch-manipulation ${panelClass}`}
                onPointerDown={() => handleCardPointerDown(row)}
                onPointerUp={handleCardPointerEnd}
                onPointerLeave={handleCardPointerEnd}
                onPointerCancel={handleCardPointerEnd}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono font-black text-lg tracking-widest">{row.code}</p>
                    {row.username && (
                      <p className="text-sm font-bold truncate mt-1">{row.username}</p>
                    )}
                    {row.email && (
                      <p className="text-xs opacity-60 truncate">{row.email}</p>
                    )}
                    {row.admin_memo && (
                      <p className="text-xs opacity-70 mt-2 line-clamp-2 italic">"{row.admin_memo}"</p>
                    )}
                    <p className="text-[10px] uppercase tracking-widest opacity-45 mt-2 font-black">
                      {row.status}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0">
                    {tab === 'pending' && (
                      <>
                        <button
                          type="button"
                          disabled={actionCode === row.code}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => openApproveModal(row)}
                          className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={actionCode === row.code}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => void runAction(row.code, () => adminDenyCode(adminToken, row.code))}
                          className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
                        >
                          Deny
                        </button>
                      </>
                    )}
                    {tab === 'approved' && row.status === 'approved' && (
                      <button
                        type="button"
                        disabled={actionCode === row.code}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => void runAction(row.code, () => adminPauseCode(adminToken, row.code))}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
                      >
                        Pause
                      </button>
                    )}
                    {tab === 'approved' && row.status === 'paused' && (
                      <button
                        type="button"
                        disabled={actionCode === row.code}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => void runAction(row.code, () => adminResumeCode(adminToken, row.code))}
                        className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
                      >
                        Resume
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {approveTarget && (
        <div className="fixed inset-0 z-[1110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className={`w-full max-w-sm rounded-2xl border p-5 shadow-2xl ${modalClass}`} role="dialog" aria-modal="true">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black uppercase tracking-[0.2em]">Approve access</h3>
              <button type="button" onClick={() => setApproveTarget(null)} aria-label="Close">
                <Icons.Close size={16} />
              </button>
            </div>
            <p className="font-mono font-black text-xl tracking-widest mb-1">{approveTarget.code}</p>
            <p className="text-xs opacity-60 mb-4">
              {approveTarget.username ?? 'Unknown user'}
              {approveTarget.email ? ` · ${approveTarget.email}` : ''}
            </p>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest opacity-50">Admin memo</span>
              <textarea
                value={approveMemo}
                onChange={(e) => setApproveMemo(e.target.value)}
                rows={3}
                placeholder="Who is this? e.g. Fred — front desk iPad"
                className={`mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none resize-none ${inputClass}`}
              />
            </label>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setApproveTarget(null)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider border ${isLight ? 'border-black/15' : 'border-white/15'}`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionCode === approveTarget.code}
                onClick={() => void confirmApprove()}
                className="flex-1 py-2.5 rounded-xl bg-green-500 text-white text-xs font-black uppercase tracking-wider disabled:opacity-50"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {detailRow && (
        <div className="fixed inset-0 z-[1110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className={`w-full max-w-sm rounded-2xl border p-5 shadow-2xl max-h-[85dvh] overflow-y-auto ${modalClass}`} role="dialog" aria-modal="true">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black uppercase tracking-[0.2em]">Code details</h3>
              <button type="button" onClick={() => setDetailRow(null)} aria-label="Close">
                <Icons.Close size={16} />
              </button>
            </div>

            <p className="font-mono font-black text-2xl tracking-widest">{detailRow.code}</p>
            <p className="text-[10px] uppercase tracking-widest opacity-50 font-black mt-1">{detailRow.status}</p>

            <dl className="mt-4 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="opacity-50 font-bold">Username</dt>
                <dd className="font-bold text-right truncate">{detailRow.username ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="opacity-50 font-bold">Email</dt>
                <dd className="text-right truncate">{detailRow.email ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="opacity-50 font-bold">Created</dt>
                <dd>{formatWhen(detailRow.created_at)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="opacity-50 font-bold">Requested</dt>
                <dd>{formatWhen(detailRow.requested_at)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="opacity-50 font-bold">Approved</dt>
                <dd>{formatWhen(detailRow.approved_at)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="opacity-50 font-bold">Denied</dt>
                <dd>{formatWhen(detailRow.denied_at)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="opacity-50 font-bold">Paused</dt>
                <dd>{formatWhen(detailRow.paused_at)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="opacity-50 font-bold">User ID</dt>
                <dd className="font-mono text-[10px] text-right break-all">{detailRow.user_id ?? '—'}</dd>
              </div>
            </dl>

            <label className="block mt-4">
              <span className="text-[10px] font-black uppercase tracking-widest opacity-50">Admin memo</span>
              <textarea
                value={detailMemo}
                onChange={(e) => setDetailMemo(e.target.value)}
                rows={3}
                placeholder="Notes about who owns this code"
                className={`mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none resize-none ${inputClass}`}
              />
            </label>

            <button
              type="button"
              disabled={savingMemo}
              onClick={() => void saveDetailMemo()}
              className={`w-full mt-3 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider ${isLight ? 'bg-black text-white' : 'bg-white text-black'} disabled:opacity-50`}
            >
              {savingMemo ? 'Saving…' : 'Save memo'}
            </button>
          </div>
        </div>
      )}

      <div className="px-4 pb-4 text-center">
        <p className="text-[10px] opacity-40 text-white">
          {adminProfile.name} · secure code management
        </p>
      </div>
    </div>
  );
};

export default AdminCodeDashboard;