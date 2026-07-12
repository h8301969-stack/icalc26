import React, { useCallback, useEffect, useRef, useState } from 'react';
import icalcLogo from '../assets/logo/icalc-logo.png';
import { Icons } from '../constants';
import {
  AccessCodeRow,
  adminApproveCode,
  adminDenyCode,
  adminGrantAccess,
  adminSetAccessBusinessInfo,
  adminListCodes,
  adminListPasswordHistory,
  adminRevokeAccess,
  adminUpdateMemo,
  clearAdminSession,
  PasswordHistoryRow,
} from '../utils/accessControl';
import { ADMIN_PROFILE_NAME, createAdminProfile } from '../utils/auth';
import { FORM_FIELD_LABEL, FORM_SECTION_TITLE, formInputClass, formTextareaClass } from '../utils/formFields';

type AdminTab = 'unused' | 'pending' | 'approved';

interface AdminCodeDashboardProps {
  isLight: boolean;
  adminToken: string;
  onClose: () => void;
  /** Logo tap returns to the calculator interface. */
  onReturnToCalc?: () => void;
}

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'unused', label: 'Unused' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
];

const LONG_PRESS_MS = 520;
const COPY_FEEDBACK_MS = 2000;
const CARD_STAGGER_MS = 48;
const HISTORY_STAGGER_MS = 40;

const cardEnterStyle = (index: number): React.CSSProperties => ({
  animationDelay: `${Math.min(index, 14) * CARD_STAGGER_MS}ms`,
});

const historyRowEnterStyle = (index: number): React.CSSProperties => ({
  animationDelay: `${Math.min(index, 10) * HISTORY_STAGGER_MS}ms`,
});

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
};

const maskPassword = (value: string): string =>
  value.length > 0 ? '•'.repeat(Math.min(value.length, 16)) : '••••••••';

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

const AdminCodeDashboard: React.FC<AdminCodeDashboardProps> = ({
  isLight,
  adminToken,
  onClose,
  onReturnToCalc,
}) => {
  const [tab, setTab] = useState<AdminTab>('pending');
  const [codes, setCodes] = useState<AccessCodeRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionCode, setActionCode] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<AccessCodeRow | null>(null);
  const [approveMemo, setApproveMemo] = useState('');
  const [approveBusinessName, setApproveBusinessName] = useState('');
  const [approveBusinessPhone, setApproveBusinessPhone] = useState('');
  const [approveBusinessAddress, setApproveBusinessAddress] = useState('');
  const [grantTarget, setGrantTarget] = useState<AccessCodeRow | null>(null);
  const [detailRow, setDetailRow] = useState<AccessCodeRow | null>(null);
  const [detailMemo, setDetailMemo] = useState('');
  const [savingMemo, setSavingMemo] = useState(false);
  const [passwordHistory, setPasswordHistory] = useState<PasswordHistoryRow[]>([]);
  const [passwordHistoryLoading, setPasswordHistoryLoading] = useState(false);
  const [revealedPasswordIds, setRevealedPasswordIds] = useState<Set<string>>(() => new Set());
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const copyFeedbackTimer = useRef<number | null>(null);

  const panelClass = isLight
    ? 'bg-white/90 border-black/10 text-black'
    : 'pos-dashboard-card-glass border border-white/12 text-white';

  const modalClass = isLight
    ? 'bg-white border-black/10 text-black'
    : 'pos-dashboard-card-glass border border-white/12 text-white';

  const refreshPendingCount = useCallback(async () => {
    const result = await adminListCodes(adminToken, 'pending');
    if (result.ok) setPendingCount(result.codes.length);
  }, [adminToken]);

  const loadCodes = useCallback(
    async (options?: { showLoading?: boolean }): Promise<AccessCodeRow[]> => {
      const showLoading = options?.showLoading ?? false;
      if (showLoading) setLoading(true);
      setError(null);
      const result = await adminListCodes(adminToken, tab);
      if (!result.ok) {
        setError(result.error);
        setCodes([]);
        if (showLoading) setLoading(false);
        return [];
      }
      setCodes(result.codes);
      if (tab === 'pending') setPendingCount(result.codes.length);
      if (showLoading) setLoading(false);
      return result.codes;
    },
    [adminToken, tab]
  );

  useEffect(() => {
    void loadCodes({ showLoading: true });
    if (tab !== 'pending') void refreshPendingCount();
    const interval = window.setInterval(() => {
      void loadCodes();
      if (tab !== 'pending') void refreshPendingCount();
    }, 4000);
    return () => window.clearInterval(interval);
  }, [loadCodes, refreshPendingCount, tab]);

  useEffect(
    () => () => {
      if (copyFeedbackTimer.current !== null) window.clearTimeout(copyFeedbackTimer.current);
    },
    []
  );

  const handleCopyCode = useCallback(async (code: string) => {
    const ok = await copyTextToClipboard(code);
    if (!ok) {
      setError('Could not copy code.');
      return;
    }
    setCopiedCode(code);
    if (copyFeedbackTimer.current !== null) window.clearTimeout(copyFeedbackTimer.current);
    copyFeedbackTimer.current = window.setTimeout(() => setCopiedCode(null), COPY_FEEDBACK_MS);
    if ('vibrate' in navigator) navigator.vibrate(8);
  }, []);

  const renderCopyableCode = (
    code: string,
    sizeClass: string,
    options?: { stopCard?: boolean }
  ) => {
    const isCopied = copiedCode === code;
    return (
      <button
        type="button"
        onClick={(e) => {
          if (options?.stopCard) e.stopPropagation();
          void handleCopyCode(code);
        }}
        onPointerDown={(e) => {
          if (options?.stopCard) e.stopPropagation();
        }}
        className={`inline-flex items-center gap-2 font-mono font-black tracking-widest text-left rounded-lg -mx-1 px-1 admin-interactive transition-colors active:opacity-70 ${
          isCopied ? 'text-emerald-500' : ''
        } ${sizeClass}`}
        aria-label={isCopied ? `Copied ${code}` : `Copy code ${code}`}
      >
        <span>{code}</span>
        {isCopied ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-emerald-500">
            <Icons.Check size={12} />
            Copied
          </span>
        ) : (
          <span className="text-[10px] font-black uppercase tracking-wider opacity-40">Copy</span>
        )}
      </button>
    );
  };

  const runAction = async (code: string, action: () => Promise<{ ok: boolean; error?: string }>) => {
    setActionCode(code);
    setError(null);
    setSuccessNotice(null);
    const result = await action();
    setActionCode(null);
    if (!result.ok) {
      setError(result.error ?? 'Action failed.');
      return;
    }
    await loadCodes();
    await refreshPendingCount();
  };

  const openGrantModal = (row: AccessCodeRow) => {
    setGrantTarget(row);
    setApproveBusinessName(row.business_name ?? '');
    setApproveBusinessPhone(row.business_phone ?? '');
    setApproveBusinessAddress(row.business_address ?? '');
    setError(null);
    setSuccessNotice(null);
  };

  const confirmGrantAccess = async () => {
    if (!grantTarget) return;
    if (!approveBusinessName.trim()) {
      setError('Enter the business name.');
      return;
    }
    setActionCode(grantTarget.code);
    setError(null);
    const result = await adminGrantAccess(adminToken, grantTarget.code);
    if (!result.ok) {
      setActionCode(null);
      setError(result.error ?? 'Grant access failed.');
      return;
    }
    const businessResult = await adminSetAccessBusinessInfo(adminToken, grantTarget.code, {
      businessName: approveBusinessName.trim(),
      businessPhone: approveBusinessPhone.trim(),
      businessAddress: approveBusinessAddress.trim(),
    });
    setActionCode(null);
    if (!businessResult.ok) {
      setError(businessResult.error ?? 'Access granted but business info could not be saved.');
      return;
    }
    const grantedCode = grantTarget.code;
    setGrantTarget(null);
    setSuccessNotice(result.hint);
    const refreshedCodes = await loadCodes();
    await refreshPendingCount();
    if (detailRow?.code === grantedCode) {
      const refreshed = refreshedCodes.find((row) => row.code === grantedCode);
      if (refreshed) setDetailRow(refreshed);
    }
  };

  const openApproveModal = (row: AccessCodeRow) => {
    setApproveTarget(row);
    setApproveMemo(row.admin_memo ?? '');
    setApproveBusinessName(row.business_name ?? '');
    setApproveBusinessPhone(row.business_phone ?? '');
    setApproveBusinessAddress(row.business_address ?? '');
    setError(null);
  };

  const confirmApprove = async () => {
    if (!approveTarget) return;
    if (!approveBusinessName.trim()) {
      setError('Enter the business name.');
      return;
    }
    setActionCode(approveTarget.code);
    const result = await adminApproveCode(adminToken, approveTarget.code, approveMemo);
    if (!result.ok) {
      setActionCode(null);
      setError(result.error ?? 'Approve failed.');
      return;
    }
    const businessResult = await adminSetAccessBusinessInfo(adminToken, approveTarget.code, {
      businessName: approveBusinessName.trim(),
      businessPhone: approveBusinessPhone.trim(),
      businessAddress: approveBusinessAddress.trim(),
    });
    setActionCode(null);
    if (!businessResult.ok) {
      setError(businessResult.error ?? 'Approved but business info could not be saved.');
      return;
    }
    setApproveTarget(null);
    setApproveMemo('');
    await loadCodes();
    await refreshPendingCount();
  };

  const loadPasswordHistory = useCallback(
    async (userId: string) => {
      setPasswordHistoryLoading(true);
      const result = await adminListPasswordHistory(adminToken, userId);
      if (!result.ok) {
        setPasswordHistory([]);
        setError(result.error);
      } else {
        setPasswordHistory(result.passwords);
      }
      setPasswordHistoryLoading(false);
    },
    [adminToken]
  );

  const togglePasswordReveal = useCallback((id: string) => {
    setRevealedPasswordIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const closeDetailModal = useCallback(() => {
    setDetailRow(null);
    setPasswordHistory([]);
    setRevealedPasswordIds(new Set());
  }, []);

  const openDetail = (row: AccessCodeRow) => {
    setDetailRow(row);
    setDetailMemo(row.admin_memo ?? '');
    setPasswordHistory([]);
    setRevealedPasswordIds(new Set());
    setError(null);
    if (row.user_id) void loadPasswordHistory(row.user_id);
  };

  const runAccessToggle = async (
    code: string,
    action: () => Promise<{ ok: boolean; error?: string }>
  ) => {
    setActionCode(code);
    setError(null);
    const result = await action();
    setActionCode(null);
    if (!result.ok) {
      setError(result.error ?? 'Action failed.');
      return;
    }
    const refreshedCodes = await loadCodes();
    await refreshPendingCount();
    if (detailRow?.code === code) {
      const refreshed = refreshedCodes.find((row) => row.code === code);
      if (refreshed) {
        setDetailRow(refreshed);
        if (refreshed.user_id) await loadPasswordHistory(refreshed.user_id);
      }
    }
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
    <div className="admin-portal-shell fixed inset-0 z-[1100] flex flex-col bg-black/80 backdrop-blur-xl">
      <div className="admin-portal-header flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-3">
          {onReturnToCalc ? (
            <button
              type="button"
              onClick={onReturnToCalc}
              className="admin-interactive w-10 h-10 rounded-xl overflow-hidden shrink-0"
              aria-label="Return to calculator"
              title="Return to calculator"
            >
              <img src={icalcLogo} alt="" className="w-full h-full object-cover" draggable={false} />
            </button>
          ) : (
            <img src={icalcLogo} alt="" className="w-10 h-10 rounded-xl object-cover" draggable={false} />
          )}
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] opacity-60">Admin Profile</p>
            <p className="text-lg font-black">{ADMIN_PROFILE_NAME}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleExit()}
          className={`admin-interactive h-10 w-10 rounded-full flex items-center justify-center border ${isLight ? 'bg-white/80 border-black/10' : 'bg-white/10 border-white/15'}`}
          aria-label="Exit admin portal"
        >
          <Icons.X size={18} />
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
              className={`admin-interactive px-5 py-2 rounded-full text-[11px] font-black uppercase tracking-[0.2em] inline-flex items-center gap-2 ${
                tab === item.id
                  ? 'bg-blue-500 text-white shadow-md'
                  : isLight
                    ? 'text-black/55 hover:text-black'
                    : 'text-white/55 hover:text-white'
              }`}
            >
              {item.label}
              {item.id === 'pending' && pendingCount > 0 && (
                <span
                  className={`min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-black tabular-nums leading-5 text-center ${
                    tab === 'pending'
                      ? 'bg-white text-blue-600'
                      : 'bg-red-500 text-white shadow-sm'
                  }`}
                  aria-label={`${pendingCount} pending`}
                >
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <p className="app-subtext text-center opacity-45 px-4 pb-2 text-white">
        Tap code to copy · tap card for details · hold for quick open
      </p>

      <div className="flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error && (
          <p className="admin-error-enter text-center text-sm font-bold text-red-500 mb-3" role="alert">
            {error}
          </p>
        )}
        {successNotice && (
          <p className="admin-section-enter text-center app-hint font-bold text-emerald-500 mb-3 px-2" role="status">
            {successNotice}
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="auth-loading-ring auth-loading-ring--outer w-16 h-16" aria-hidden="true" />
          </div>
        ) : codes.length === 0 ? (
          <p className={`admin-list-enter text-center text-sm opacity-50 py-16 ${isLight ? 'text-black' : 'text-white'}`}>
            No codes in this view.
          </p>
        ) : (
          <div key={tab} className="admin-list-enter max-w-lg mx-auto space-y-3">
            {codes.map((row, index) => (
              <div
                key={row.code}
                role="button"
                tabIndex={0}
                style={cardEnterStyle(index)}
                className={`admin-card-enter admin-interactive rounded-2xl border px-4 py-4 select-none touch-manipulation cursor-pointer ${panelClass}`}
                onClick={() => openDetail(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openDetail(row);
                  }
                }}
                onPointerDown={() => handleCardPointerDown(row)}
                onPointerUp={handleCardPointerEnd}
                onPointerLeave={handleCardPointerEnd}
                onPointerCancel={handleCardPointerEnd}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {renderCopyableCode(row.code, 'text-lg', { stopCard: true })}
                    {row.username && (
                      <p className="text-sm font-bold truncate mt-1">{row.username}</p>
                    )}
                    {row.email && (
                      <p className="text-xs opacity-60 truncate">{row.email}</p>
                    )}
                    {row.business_name && (
                      <p className="text-sm font-bold truncate mt-1">{row.business_name}</p>
                    )}
                    {row.business_phone && (
                      <p className="text-xs opacity-60 truncate">{row.business_phone}</p>
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
                          onClick={(e) => { e.stopPropagation(); openApproveModal(row); }}
                          className="admin-interactive px-3 py-1.5 rounded-lg bg-green-500 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={actionCode === row.code}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); void runAction(row.code, () => adminDenyCode(adminToken, row.code)); }}
                          className="admin-interactive px-3 py-1.5 rounded-lg bg-red-500 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
                        >
                          Deny
                        </button>
                      </>
                    )}
                    {tab === 'approved' && row.status === 'approved' && row.user_id && (
                      <button
                        type="button"
                        disabled={actionCode === row.code}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          void runAction(row.code, () => adminRevokeAccess(adminToken, row.code));
                        }}
                        className="admin-interactive px-3 py-1.5 rounded-lg bg-amber-500 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    )}
                    {tab === 'approved' && row.status === 'paused' && (
                      <button
                        type="button"
                        disabled={actionCode === row.code}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          openGrantModal(row);
                        }}
                        className="admin-interactive px-3 py-1.5 rounded-lg bg-blue-500 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
                      >
                        Grant
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
        <div
          className="admin-modal-backdrop fixed inset-0 z-[1110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setApproveTarget(null)}
          role="presentation"
        >
          <div
            className={`admin-modal-panel w-full max-w-sm rounded-2xl border p-5 shadow-2xl ${modalClass}`}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className={FORM_SECTION_TITLE}>Approve access</h3>
              <button
                type="button"
                onClick={() => setApproveTarget(null)}
                aria-label="Close approve modal"
                className={`admin-interactive p-2 rounded-full ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
              >
                <Icons.X size={20} />
              </button>
            </div>
            <div className="mb-1">{renderCopyableCode(approveTarget.code, 'text-xl')}</div>
            <p className="text-xs opacity-60 mb-4">
              {approveTarget.username ?? 'Unknown user'}
              {approveTarget.email ? ` · ${approveTarget.email}` : ''}
            </p>
            <label className="block">
              <span className={FORM_FIELD_LABEL}>Business name</span>
              <input
                type="text"
                value={approveBusinessName}
                onChange={(e) => setApproveBusinessName(e.target.value)}
                required
                className={formInputClass(isLight)}
                placeholder="Shop or business name"
              />
            </label>
            <label className="block mt-3">
              <span className={FORM_FIELD_LABEL}>Phone number</span>
              <input
                type="tel"
                value={approveBusinessPhone}
                onChange={(e) => setApproveBusinessPhone(e.target.value)}
                className={formInputClass(isLight)}
                placeholder="+233 …"
              />
            </label>
            <label className="block mt-3">
              <span className={FORM_FIELD_LABEL}>Location</span>
              <input
                type="text"
                value={approveBusinessAddress}
                onChange={(e) => setApproveBusinessAddress(e.target.value)}
                className={formInputClass(isLight)}
                placeholder="Street, city"
              />
            </label>
            <label className="block mt-3">
              <span className={`${FORM_FIELD_LABEL} opacity-50 mb-0`}>Admin memo</span>
              <textarea
                value={approveMemo}
                onChange={(e) => setApproveMemo(e.target.value)}
                rows={3}
                placeholder="Who is this? e.g. Fred — front desk iPad"
                className={`mt-2 ${formTextareaClass(isLight)}`}
              />
            </label>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setApproveTarget(null)}
                className={`admin-interactive flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider border ${isLight ? 'border-black/15' : 'border-white/15'}`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionCode === approveTarget.code}
                onClick={() => void confirmApprove()}
                className="admin-interactive flex-1 py-2.5 rounded-xl bg-green-500 text-white text-xs font-black uppercase tracking-wider disabled:opacity-50"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {grantTarget && (
        <div
          className="admin-modal-backdrop fixed inset-0 z-[1110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setGrantTarget(null)}
          role="presentation"
        >
          <div
            className={`admin-modal-panel w-full max-w-sm rounded-2xl border p-5 shadow-2xl ${modalClass}`}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className={FORM_SECTION_TITLE}>Grant access</h3>
              <button
                type="button"
                onClick={() => setGrantTarget(null)}
                aria-label="Close grant modal"
                className={`admin-interactive p-2 rounded-full ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
              >
                <Icons.X size={20} />
              </button>
            </div>
            <div className="mb-1">{renderCopyableCode(grantTarget.code, 'text-xl')}</div>
            <p className="text-xs opacity-60 mb-4">
              {grantTarget.username ?? 'Unknown user'}
              {grantTarget.email ? ` · ${grantTarget.email}` : ''}
            </p>
            <label className="block">
              <span className={FORM_FIELD_LABEL}>Business name</span>
              <input
                type="text"
                value={approveBusinessName}
                onChange={(e) => setApproveBusinessName(e.target.value)}
                required
                className={formInputClass(isLight)}
                placeholder="Shop or business name"
              />
            </label>
            <label className="block mt-3">
              <span className={FORM_FIELD_LABEL}>Phone number</span>
              <input
                type="tel"
                value={approveBusinessPhone}
                onChange={(e) => setApproveBusinessPhone(e.target.value)}
                className={formInputClass(isLight)}
                placeholder="+233 …"
              />
            </label>
            <label className="block mt-3">
              <span className={FORM_FIELD_LABEL}>Location</span>
              <input
                type="text"
                value={approveBusinessAddress}
                onChange={(e) => setApproveBusinessAddress(e.target.value)}
                className={formInputClass(isLight)}
                placeholder="Street, city"
              />
            </label>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setGrantTarget(null)}
                className={`admin-interactive flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider border ${isLight ? 'border-black/15' : 'border-white/15'}`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionCode === grantTarget.code}
                onClick={() => void confirmGrantAccess()}
                className="admin-interactive flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-xs font-black uppercase tracking-wider disabled:opacity-50"
              >
                Grant
              </button>
            </div>
          </div>
        </div>
      )}

      {detailRow && (
        <div
          className="admin-modal-backdrop fixed inset-0 z-[1110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={closeDetailModal}
          role="presentation"
        >
          <div
            className={`admin-modal-panel w-full max-w-sm rounded-2xl border p-5 shadow-2xl max-h-[85dvh] overflow-y-auto custom-scrollbar ${modalClass}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="code-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 sticky top-0 z-10 pb-2 -mt-1 pt-1 backdrop-blur-sm">
              <h3 id="code-detail-title" className={FORM_SECTION_TITLE}>Code details</h3>
              <button
                type="button"
                onClick={closeDetailModal}
                aria-label="Close code details"
                className={`admin-interactive p-2 rounded-full shrink-0 ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
              >
                <Icons.X size={20} />
              </button>
            </div>

            {renderCopyableCode(detailRow.code, 'text-2xl')}
            <p className="text-[10px] uppercase tracking-widest opacity-50 font-black mt-1">{detailRow.status}</p>

            {(detailRow.business_name || detailRow.business_phone || detailRow.business_address) && (
              <div className={`admin-section-enter mt-4 rounded-xl border px-4 py-3 space-y-2 ${isLight ? 'bg-emerald-50 border-emerald-200/80' : 'bg-emerald-500/10 border-emerald-400/25'}`} style={{ animationDelay: '60ms' }}>
                <p className="text-[10px] font-black uppercase tracking-widest opacity-55">Business info</p>
                {detailRow.business_name && (
                  <p className="text-sm font-black">{detailRow.business_name}</p>
                )}
                {detailRow.business_phone && (
                  <p className="text-xs opacity-80">{detailRow.business_phone}</p>
                )}
                {detailRow.business_address && (
                  <p className="text-xs opacity-70 leading-relaxed">{detailRow.business_address}</p>
                )}
              </div>
            )}

            {detailRow.user_id && (
              <div className={`admin-section-enter mt-4 rounded-xl border px-4 py-3 ${isLight ? 'bg-zinc-50 border-zinc-200' : 'bg-white/5 border-white/10'}`} style={{ animationDelay: '120ms' }}>
                <p className="text-[10px] font-black uppercase tracking-widest opacity-55 mb-3">
                  Password history
                </p>
                {passwordHistoryLoading ? (
                  <p className="app-subtext text-[10px] opacity-45 py-2">Loading…</p>
                ) : passwordHistory.length === 0 ? (
                  <p className="app-subtext text-[10px] opacity-45 py-2">No passwords recorded yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {passwordHistory.map((entry, index) => {
                      const isRevealed = revealedPasswordIds.has(entry.id);
                      return (
                        <li
                          key={entry.id}
                          style={historyRowEnterStyle(index)}
                          className={`admin-history-row-enter flex items-center justify-between gap-2 rounded-lg px-3 py-2 ${
                            entry.is_current
                              ? isLight
                                ? 'bg-emerald-100 border border-emerald-200'
                                : 'bg-emerald-500/15 border border-emerald-400/25'
                              : isLight
                                ? 'bg-white border border-zinc-100'
                                : 'bg-black/20 border border-white/8'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => void handleCopyCode(entry.password_value)}
                            className="min-w-0 flex-1 text-left"
                            aria-label={`Copy password ${entry.password_value}`}
                          >
                            <span className="font-mono font-black text-sm tracking-widest block truncate transition-opacity duration-200">
                              {isRevealed ? entry.password_value : maskPassword(entry.password_value)}
                            </span>
                            <span className="text-[10px] opacity-50 font-bold uppercase tracking-wider">
                              {entry.source.replace('_', ' ')} · {formatWhen(entry.created_at)}
                            </span>
                          </button>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {entry.is_current && (
                              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500">
                                Current
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => togglePasswordReveal(entry.id)}
                              className={`admin-interactive h-8 w-8 rounded-lg flex items-center justify-center border ${
                                isLight
                                  ? 'border-black/10 bg-white/80 text-black/55 hover:text-black'
                                  : 'border-white/12 bg-white/8 text-white/55 hover:text-white'
                              }`}
                              aria-label={isRevealed ? 'Hide password' : 'Show password'}
                            >
                              {isRevealed ? <Icons.EyeOff size={16} /> : <Icons.Eye size={16} />}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            <dl className="admin-section-enter mt-4 space-y-2 text-xs" style={{ animationDelay: '180ms' }}>
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
              <span className={`${FORM_FIELD_LABEL} opacity-50 mb-0`}>Admin memo</span>
              <textarea
                value={detailMemo}
                onChange={(e) => setDetailMemo(e.target.value)}
                rows={3}
                placeholder="Notes about who owns this code"
                className={`mt-2 ${formTextareaClass(isLight)}`}
              />
            </label>

            <button
              type="button"
              disabled={savingMemo}
              onClick={() => void saveDetailMemo()}
              className={`admin-interactive w-full mt-3 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider ${isLight ? 'bg-black text-white' : 'bg-white text-black'} disabled:opacity-50`}
            >
              {savingMemo ? 'Saving…' : 'Save memo'}
            </button>

            {detailRow.user_id && detailRow.status === 'approved' && (
              <button
                type="button"
                disabled={actionCode === detailRow.code}
                onClick={() =>
                  void runAccessToggle(detailRow.code, () =>
                    adminRevokeAccess(adminToken, detailRow.code)
                  )
                }
                className="admin-interactive w-full mt-2 py-2.5 rounded-xl bg-amber-500 text-white text-xs font-black uppercase tracking-wider disabled:opacity-50"
              >
                Revoke access
              </button>
            )}
            {detailRow.user_id && detailRow.status === 'paused' && (
              <button
                type="button"
                disabled={actionCode === detailRow.code}
                onClick={() => openGrantModal(detailRow)}
                className="admin-interactive w-full mt-2 py-2.5 rounded-xl bg-blue-500 text-white text-xs font-black uppercase tracking-wider disabled:opacity-50"
              >
                Grant access
              </button>
            )}

            <button
              type="button"
              onClick={closeDetailModal}
              className={`admin-interactive w-full mt-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider border ${
                isLight ? 'border-black/15 hover:bg-black/5' : 'border-white/15 hover:bg-white/5'
              }`}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div className="px-4 pb-4 text-center">
        <p className="app-hint opacity-40 text-white">
          {adminProfile.name} · secure code management
        </p>
      </div>
    </div>
  );
};

export default AdminCodeDashboard;