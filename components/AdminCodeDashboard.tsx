import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '../constants';
import {
  AccessCodePlan,
  AccessCodeRow,
  adminApproveCode,
  adminClearUnusedAccessCodes,
  adminDenyCode,
  adminGrantAccess,
  adminIssueAccessCode,
  adminSetAccessBusinessInfo,
  adminSetAccessTelegram,
  adminSetTelegramDefaults,
  adminGetTelegramDefaults,
  adminListCodes,
  adminListPasswordHistory,
  adminRevokeAccess,
  adminUpdateMemo,
  clearAdminSession,
  PasswordHistoryRow,
} from '../utils/accessControl';
import { ADMIN_PROFILE_NAME, createAdminProfile } from '../utils/auth';
import { UserProfile } from '../types';
import { FORM_FIELD_LABEL, FORM_SECTION_TITLE, formInputClass, formTextareaClass } from '../utils/formFields';
import ProfileAvatar from './ProfileAvatar';
import { MorphPresence } from './MorphCrossfade';
import telegramDbMarkdown from '../telegramdb.md?raw';
import {
  getSharedTelegramDbConfig,
  looksLikeBotToken,
  setSharedTelegramDbConfig,
} from '../utils/telegramDb';
import PasswordField from './PasswordField';

const renderSimpleMarkdown = (source: string): string => {
  const escape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  const inlineFormat = (text: string) =>
    escape(text)
      .replace(/`([^`]+)`/g, '<code class="telegram-db-code">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push('</code></pre>');
        inCode = false;
      } else {
        closeList();
        out.push('<pre class="telegram-db-pre"><code>');
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(`${escape(line)}\n`);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      closeList();
      out.push('<hr class="telegram-db-hr" />');
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level} class="telegram-db-h${level}">${inlineFormat(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\|.+\|$/.test(line.trim())) {
      closeList();
      out.push(`<pre class="telegram-db-table-line">${escape(line)}</pre>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul class="telegram-db-ul">');
        inList = true;
      }
      out.push(`<li>${inlineFormat(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) {
      out.push('<div class="telegram-db-spacer"></div>');
      continue;
    }
    out.push(`<p class="telegram-db-p">${inlineFormat(line)}</p>`);
  }
  closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('');
};

type AdminTab = 'new' | 'pending' | 'active';

interface AdminCodeDashboardProps {
  isLight: boolean;
  adminToken: string;
  /** Active @admin profile (avatar + name) for this account. */
  adminProfile?: UserProfile;
  onClose: () => void;
  /** Logo tap returns to the calculator interface. */
  onReturnToCalc?: () => void;
}

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'pending', label: 'Pending' },
  { id: 'active', label: 'Active' },
];

const tabToApi = (tab: AdminTab): 'unused' | 'pending' | 'approved' =>
  tab === 'new' ? 'unused' : tab === 'active' ? 'approved' : 'pending';

const PLAN_COPY: Record<
  AccessCodePlan,
  { title: string; blurb: string; howTo: string; accent: string }
> = {
  premium: {
    title: 'Premium',
    blurb: 'For shops with staff profiles',
    howTo:
      'Hand this code to the owner. They sign up, you approve, then they connect Telegram. Staff mini-profiles are allowed.',
    accent: 'bg-violet-600',
  },
  regular: {
    title: 'Regular',
    blurb: 'For one person running the shop',
    howTo:
      'Hand this code to a solo seller. One profile only — no staff accounts. Same idea: sign up, you approve, then Telegram.',
    accent: 'bg-zinc-700',
  },
};

const LONG_PRESS_MS = 520;
const COPY_FEEDBACK_MS = 2000;
const CARD_STAGGER_MS = 48;
const HISTORY_STAGGER_MS = 40;
/** Fake generator load — snappy for admin UX */
const ISSUE_FAKE_LOAD_MS = 280;

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
  adminProfile,
  onClose,
  onReturnToCalc,
}) => {
  const [tab, setTab] = useState<AdminTab>('new');
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
  const [approveTelegramBotToken, setApproveTelegramBotToken] = useState('');
  const [approveTelegramChatId, setApproveTelegramChatId] = useState('');
  const [grantTarget, setGrantTarget] = useState<AccessCodeRow | null>(null);
  const [detailRow, setDetailRow] = useState<AccessCodeRow | null>(null);
  const [detailMemo, setDetailMemo] = useState('');
  const [detailTelegramBotToken, setDetailTelegramBotToken] = useState('');
  const [detailTelegramChatId, setDetailTelegramChatId] = useState('');
  const [savingMemo, setSavingMemo] = useState(false);
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [passwordHistory, setPasswordHistory] = useState<PasswordHistoryRow[]>([]);
  const [passwordHistoryLoading, setPasswordHistoryLoading] = useState(false);
  const [revealedPasswordIds, setRevealedPasswordIds] = useState<Set<string>>(() => new Set());
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [showTelegramDbDoc, setShowTelegramDbDoc] = useState(false);
  const [issuingPlan, setIssuingPlan] = useState<AccessCodePlan | null>(null);
  const [lastIssuedCode, setLastIssuedCode] = useState<string | null>(null);
  const clearedUnusedRef = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const copyFeedbackTimer = useRef<number | null>(null);
  const telegramDbHtml = useMemo(() => renderSimpleMarkdown(telegramDbMarkdown), []);

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
      if (tab === 'new') {
        setCodes([]);
        setLoading(false);
        return [];
      }
      const showLoading = options?.showLoading ?? false;
      if (showLoading) setLoading(true);
      setError(null);
      const result = await adminListCodes(adminToken, tabToApi(tab));
      if (result.ok === false) {
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

  // Clear leftover unused codes when admin portal opens.
  useEffect(() => {
    if (clearedUnusedRef.current) return;
    clearedUnusedRef.current = true;
    void adminClearUnusedAccessCodes(adminToken).then((result) => {
      if (result.ok && result.deleted > 0) {
        setSuccessNotice(`Cleared ${result.deleted} old unused codes.`);
        window.setTimeout(() => setSuccessNotice(null), 3500);
      }
    });
  }, [adminToken]);

  useEffect(() => {
    void loadCodes({ showLoading: true });
    if (tab !== 'pending') void refreshPendingCount();
    if (tab === 'new') return;
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

  const handleIssueCode = useCallback(
    async (plan: AccessCodePlan) => {
      setIssuingPlan(plan);
      setError(null);
      setLastIssuedCode(null);
      // Drop any previous unused codes so New stays a clean generator.
      await adminClearUnusedAccessCodes(adminToken);
      const started = Date.now();
      const result = await adminIssueAccessCode(adminToken, plan);
      const elapsed = Date.now() - started;
      if (elapsed < ISSUE_FAKE_LOAD_MS) {
        await new Promise<void>((r) => window.setTimeout(r, ISSUE_FAKE_LOAD_MS - elapsed));
      }
      setIssuingPlan(null);
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      setLastIssuedCode(result.code);
      setSuccessNotice(`${PLAN_COPY[plan].title} code ready — copied to clipboard`);
      window.setTimeout(() => setSuccessNotice(null), 4000);
      setTab('new');
      await handleCopyCode(result.code);
    },
    [adminToken, handleCopyCode]
  );

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
        className={`inline-flex items-center gap-2 font-mono font-black text-left rounded-lg -mx-1 px-1 admin-interactive transition-colors active:opacity-70 ${
          isCopied ? 'text-emerald-500' : ''
        } ${sizeClass}`}
        aria-label={isCopied ? `Copied ${code}` : `Copy code ${code}`}
      >
        <span>{code}</span>
        {isCopied ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-emerald-500">
            <Icons.Check size={12} />
            Copied
          </span>
        ) : (
          <span className="text-[10px] font-black uppercase opacity-40">Copy</span>
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

  const persistTelegramDefaults = async (botToken: string, chatId: string) => {
    setSharedTelegramDbConfig({
      botToken: botToken.trim(),
      chatId: chatId.trim(),
      connectedAt: Date.now(),
    });
    // Cross-device: other admin sessions can prefill without re-pasting.
    await adminSetTelegramDefaults(adminToken, botToken, chatId);
  };

  const prefillTelegramFromOwner = () => {
    const owner = getSharedTelegramDbConfig();
    if (owner?.botToken) setApproveTelegramBotToken(owner.botToken);
    if (owner?.chatId) setApproveTelegramChatId(owner.chatId);
    // If this device has no local link yet, pull defaults saved on Supabase.
    if (owner?.botToken && owner?.chatId) return;
    void adminGetTelegramDefaults(adminToken).then((remote) => {
      if (remote.ok === false) return;
      setApproveTelegramBotToken((prev) => prev || remote.botToken);
      setApproveTelegramChatId((prev) => prev || remote.chatId);
      setSharedTelegramDbConfig({
        botToken: remote.botToken,
        chatId: remote.chatId,
        connectedAt: Date.now(),
      });
    });
  };

  const openGrantModal = (row: AccessCodeRow) => {
    setGrantTarget(row);
    setApproveBusinessName(row.business_name ?? '');
    setApproveBusinessPhone(row.business_phone ?? '');
    setApproveBusinessAddress(row.business_address ?? '');
    setApproveTelegramBotToken('');
    setApproveTelegramChatId('');
    prefillTelegramFromOwner();
    setError(null);
    setSuccessNotice(null);
  };

  const confirmGrantAccess = async () => {
    if (!grantTarget) return;
    if (!approveBusinessName.trim()) {
      setError('Enter the business name.');
      return;
    }
    if (!looksLikeBotToken(approveTelegramBotToken) || !approveTelegramChatId.trim()) {
      setError('Paste Bot API token and chat ID before granting. Shops never enter these — only you do while they wait.');
      return;
    }
    setActionCode(grantTarget.code);
    setError(null);
    const result = await adminGrantAccess(adminToken, grantTarget.code);
    if (result.ok === false) {
      setActionCode(null);
      setError(result.error ?? 'Grant access failed.');
      return;
    }
    const businessResult = await adminSetAccessBusinessInfo(adminToken, grantTarget.code, {
      businessName: approveBusinessName.trim(),
      businessPhone: approveBusinessPhone.trim(),
      businessAddress: approveBusinessAddress.trim(),
      telegramBotToken: approveTelegramBotToken.trim(),
      telegramChatId: approveTelegramChatId.trim(),
    });
    setActionCode(null);
    if (businessResult.ok === false) {
      setError(businessResult.error ?? 'Access granted but business info could not be saved.');
      return;
    }
    await persistTelegramDefaults(approveTelegramBotToken, approveTelegramChatId);
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
    setApproveTelegramBotToken('');
    setApproveTelegramChatId('');
    prefillTelegramFromOwner();
    setError(null);
  };

  const confirmApprove = async () => {
    if (!approveTarget) return;
    if (!approveBusinessName.trim()) {
      setError('Enter the business name.');
      return;
    }
    if (!looksLikeBotToken(approveTelegramBotToken) || !approveTelegramChatId.trim()) {
      setError('Paste Bot API token and chat ID before approve. Shops never enter these — only you do while they wait.');
      return;
    }
    setActionCode(approveTarget.code);
    const result = await adminApproveCode(adminToken, approveTarget.code, approveMemo);
    if (result.ok === false) {
      setActionCode(null);
      setError(result.error ?? 'Approve failed.');
      return;
    }
    const businessResult = await adminSetAccessBusinessInfo(adminToken, approveTarget.code, {
      businessName: approveBusinessName.trim(),
      businessPhone: approveBusinessPhone.trim(),
      businessAddress: approveBusinessAddress.trim(),
      telegramBotToken: approveTelegramBotToken.trim(),
      telegramChatId: approveTelegramChatId.trim(),
    });
    setActionCode(null);
    if (businessResult.ok === false) {
      setError(businessResult.error ?? 'Approved but business info could not be saved.');
      return;
    }
    await persistTelegramDefaults(approveTelegramBotToken, approveTelegramChatId);
    setApproveTarget(null);
    setApproveMemo('');
    await loadCodes();
    await refreshPendingCount();
  };

  const loadPasswordHistory = useCallback(
    async (userId: string) => {
      setPasswordHistoryLoading(true);
      const result = await adminListPasswordHistory(adminToken, userId);
      if (result.ok === false) {
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
    setDetailTelegramBotToken(row.telegram_bot_token ?? '');
    setDetailTelegramChatId(row.telegram_chat_id ?? '');
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

  const saveDetailTelegram = async () => {
    if (!detailRow) return;
    if (!looksLikeBotToken(detailTelegramBotToken) || !detailTelegramChatId.trim()) {
      setError('Paste Bot API token and Telegram user / chat ID.');
      return;
    }
    setSavingTelegram(true);
    setError(null);
    const result = await adminSetAccessTelegram(
      adminToken,
      detailRow.code,
      detailTelegramBotToken,
      detailTelegramChatId
    );
    setSavingTelegram(false);
    if (result.ok === false) {
      setError(result.error ?? 'Could not save Telegram link.');
      return;
    }
    const token = detailTelegramBotToken.trim();
    const chatId = detailTelegramChatId.trim();
    setDetailRow((prev) =>
      prev ? { ...prev, telegram_bot_token: token, telegram_chat_id: chatId } : prev
    );
    setCodes((prev) =>
      prev.map((row) =>
        row.code === detailRow.code
          ? { ...row, telegram_bot_token: token, telegram_chat_id: chatId }
          : row
      )
    );
    setSuccessNotice('Telegram Bot API and chat ID saved for this account.');
    window.setTimeout(() => setSuccessNotice(null), 3500);
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

  const profile = adminProfile ?? createAdminProfile();

  return (
    <div className="admin-portal-shell fixed inset-0 z-[1100] flex flex-col bg-black/80 backdrop-blur-xl">
      <div className="admin-portal-header flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-3 min-w-0">
          {onReturnToCalc ? (
            <button
              type="button"
              onClick={onReturnToCalc}
              className="admin-interactive shrink-0 rounded-xl"
              aria-label="Return to calculator"
              title="Return to calculator"
            >
              <ProfileAvatar profile={profile} size={40} isLight={isLight} />
            </button>
          ) : (
            <ProfileAvatar profile={profile} size={40} isLight={isLight} />
          )}
          <div className="min-w-0">
            <p className="text-xs font-black uppercase opacity-60">Admin profile</p>
            <p className="text-lg font-black truncate">{profile.name || ADMIN_PROFILE_NAME}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowTelegramDbDoc(true)}
            className={`admin-interactive h-10 px-3 rounded-full flex items-center justify-center gap-1.5 border text-[10px] font-black uppercase ${isLight ? 'bg-white/80 border-black/10' : 'bg-white/10 border-white/15'}`}
            aria-label="Read telegramdb.md"
            title="Telegram database design"
          >
            <Icons.List size={14} />
            DB
          </button>
          <button
            type="button"
            onClick={() => void handleExit()}
            className={`admin-interactive h-10 w-10 rounded-full flex items-center justify-center border ${isLight ? 'bg-white/80 border-black/10' : 'bg-white/10 border-white/15'}`}
            aria-label="Exit admin portal"
          >
            <Icons.X size={18} />
          </button>
        </div>
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
              className={`admin-interactive px-5 py-2 rounded-full text-[11px] font-black uppercase inline-flex items-center gap-2 ${
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

        {tab === 'new' ? (
          <div className="admin-list-enter max-w-lg mx-auto space-y-4">
            <p className="app-subtext text-center opacity-50 text-[11px]" style={{ letterSpacing: 0 }}>
              Pick Premium or Regular. We’ll make a new code and clear old unused ones.
            </p>
            {(['premium', 'regular'] as AccessCodePlan[]).map((plan) => {
              const copy = PLAN_COPY[plan];
              const busy = issuingPlan === plan;
              return (
                <button
                  key={plan}
                  type="button"
                  disabled={!!issuingPlan}
                  onClick={() => void handleIssueCode(plan)}
                  className={`admin-interactive w-full rounded-[22px] px-4 py-4 text-left text-white shadow-lg disabled:opacity-55 ${copy.accent}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase opacity-80">
                        {busy ? 'Making code…' : 'New code'}
                      </p>
                      <p className="text-xl font-black mt-0.5">{copy.title}</p>
                      <p className="text-[11px] font-semibold opacity-85 mt-1" style={{ letterSpacing: 0 }}>
                        {copy.blurb}
                      </p>
                    </div>
                    {busy ? (
                      <span className="auth-spinner shrink-0 mt-1" aria-hidden="true" />
                    ) : (
                      <span className="text-2xl font-black opacity-40 shrink-0">+</span>
                    )}
                  </div>
                  <p
                    className="text-[10px] font-medium opacity-75 mt-3 leading-relaxed"
                    style={{ letterSpacing: 0 }}
                  >
                    {copy.howTo}
                  </p>
                </button>
              );
            })}

            {lastIssuedCode && (
              <div className={`rounded-2xl border px-4 py-4 ${panelClass}`}>
                <p className="text-[10px] font-black uppercase opacity-50 mb-2" style={{ letterSpacing: 0 }}>
                  Ready to share
                </p>
                {renderCopyableCode(lastIssuedCode, 'text-2xl')}
                <p className="app-subtext text-[10px] opacity-50 mt-3" style={{ letterSpacing: 0 }}>
                  Send this for signup. It shows under Pending when they request access, then Active after you approve.
                </p>
              </div>
            )}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="auth-loading-ring auth-loading-ring--outer w-16 h-16" aria-hidden="true" />
          </div>
        ) : codes.length === 0 ? (
          <p className={`admin-list-enter text-center text-sm opacity-50 py-16 ${isLight ? 'text-black' : 'text-white'}`}>
            {tab === 'pending' ? 'No pending requests.' : 'No active codes in use.'}
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
                    <p
                      className={`text-[9px] font-black uppercase mt-1 ${
                        row.plan === 'premium' ? 'text-violet-400' : 'opacity-50'
                      }`}
                      style={{ letterSpacing: 0 }}
                    >
                      {row.plan === 'premium' ? 'Premium' : 'Regular'}
                      {tab === 'active' ? ` · ${row.status}` : ''}
                    </p>
                    {row.username && (
                      <p className="text-sm font-bold truncate mt-1">{row.username}</p>
                    )}
                    {row.email && (
                      <p className="text-xs opacity-60 truncate">{row.email}</p>
                    )}
                    {tab === 'active' && (
                      <div className="mt-2 space-y-0.5 text-[11px] font-semibold opacity-70" style={{ letterSpacing: 0 }}>
                        {row.user_id && <p className="truncate">User: {row.user_id}</p>}
                        {row.business_name && <p className="truncate">Business: {row.business_name}</p>}
                        {row.business_phone && <p className="truncate">Phone: {row.business_phone}</p>}
                        {row.business_address && <p className="truncate">Address: {row.business_address}</p>}
                        <p className="truncate">
                          Telegram:{' '}
                          {row.telegram_bot_token && row.telegram_chat_id
                            ? `linked · ${row.telegram_chat_id}`
                            : 'not set'}
                        </p>
                        {row.requested_at && <p>Requested: {formatWhen(row.requested_at)}</p>}
                        {row.approved_at && <p>Approved: {formatWhen(row.approved_at)}</p>}
                        {row.paused_at && <p>Paused: {formatWhen(row.paused_at)}</p>}
                        {row.created_at && <p>Created: {formatWhen(row.created_at)}</p>}
                      </div>
                    )}
                    {row.business_name && tab !== 'active' && (
                      <p className="text-sm font-bold truncate mt-1">{row.business_name}</p>
                    )}
                    {row.business_phone && tab !== 'active' && (
                      <p className="text-xs opacity-60 truncate">{row.business_phone}</p>
                    )}
                    {row.admin_memo && (
                      <p className="text-xs opacity-70 mt-2 line-clamp-2 italic">"{row.admin_memo}"</p>
                    )}
                    {tab !== 'active' && (
                      <p className="text-[10px] uppercase opacity-45 mt-2 font-black">
                        {row.status}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 shrink-0">
                    {tab === 'pending' && (
                      <>
                        <button
                          type="button"
                          disabled={actionCode === row.code}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); openApproveModal(row); }}
                          className="admin-interactive px-3 py-1.5 rounded-lg bg-green-500 text-white text-[10px] font-black uppercase disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={actionCode === row.code}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); void runAction(row.code, () => adminDenyCode(adminToken, row.code)); }}
                          className="admin-interactive px-3 py-1.5 rounded-lg bg-red-500 text-white text-[10px] font-black uppercase disabled:opacity-50"
                        >
                          Deny
                        </button>
                      </>
                    )}
                    {tab === 'active' && row.status === 'approved' && row.user_id && (
                      <button
                        type="button"
                        disabled={actionCode === row.code}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          void runAction(row.code, () => adminRevokeAccess(adminToken, row.code));
                        }}
                        className="admin-interactive px-3 py-1.5 rounded-lg bg-amber-500 text-white text-[10px] font-black uppercase disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    )}
                    {tab === 'active' && row.status === 'paused' && (
                      <button
                        type="button"
                        disabled={actionCode === row.code}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          openGrantModal(row);
                        }}
                        className="admin-interactive px-3 py-1.5 rounded-lg bg-blue-500 text-white text-[10px] font-black uppercase disabled:opacity-50"
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
              <span className={FORM_FIELD_LABEL}>Telegram Bot API *</span>
              <PasswordField
                isLight={isLight}
                value={approveTelegramBotToken}
                onChange={setApproveTelegramBotToken}
                placeholder="From BotFather — you set this for the shop"
                autoComplete="off"
              />
            </label>
            <label className="block mt-3">
              <span className={FORM_FIELD_LABEL}>Telegram chat ID *</span>
              <input
                type="text"
                value={approveTelegramChatId}
                onChange={(e) => setApproveTelegramChatId(e.target.value)}
                className={formInputClass(isLight)}
                placeholder="e.g. 123456789"
                autoComplete="off"
              />
              <span className="app-subtext text-[9px] opacity-50 mt-1 block" style={{ letterSpacing: 0 }}>
                You enter Bot API + chat ID here while they wait. The shop never pastes these.
              </span>
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
                className={`admin-interactive flex-1 py-2.5 rounded-xl text-xs font-black uppercase border ${isLight ? 'border-black/15' : 'border-white/15'}`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionCode === approveTarget.code}
                onClick={() => void confirmApprove()}
                className="admin-interactive flex-1 py-2.5 rounded-xl bg-green-500 text-white text-xs font-black uppercase disabled:opacity-50"
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
            <label className="block mt-3">
              <span className={FORM_FIELD_LABEL}>Telegram Bot API *</span>
              <PasswordField
                isLight={isLight}
                value={approveTelegramBotToken}
                onChange={setApproveTelegramBotToken}
                placeholder="From BotFather — you set this for the shop"
                autoComplete="off"
              />
            </label>
            <label className="block mt-3">
              <span className={FORM_FIELD_LABEL}>Telegram chat ID *</span>
              <input
                type="text"
                value={approveTelegramChatId}
                onChange={(e) => setApproveTelegramChatId(e.target.value)}
                className={formInputClass(isLight)}
                placeholder="e.g. 123456789"
                autoComplete="off"
              />
              <span className="app-subtext text-[9px] opacity-50 mt-1 block" style={{ letterSpacing: 0 }}>
                You enter Bot API + chat ID here while they wait. The shop never pastes these.
              </span>
            </label>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setGrantTarget(null)}
                className={`admin-interactive flex-1 py-2.5 rounded-xl text-xs font-black uppercase border ${isLight ? 'border-black/15' : 'border-white/15'}`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionCode === grantTarget.code}
                onClick={() => void confirmGrantAccess()}
                className="admin-interactive flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-xs font-black uppercase disabled:opacity-50"
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
            <p className="text-[10px] uppercase opacity-50 font-black mt-1">{detailRow.status}</p>

            {(detailRow.business_name || detailRow.business_phone || detailRow.business_address) && (
              <div className={`admin-section-enter mt-4 rounded-xl border px-4 py-3 space-y-2 ${isLight ? 'bg-emerald-50 border-emerald-200/80' : 'bg-emerald-500/10 border-emerald-400/25'}`} style={{ animationDelay: '60ms' }}>
                <p className="text-[10px] font-black uppercase opacity-55">Business info</p>
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
                <p className="text-[10px] font-black uppercase opacity-55 mb-3">
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
                            <span className="font-mono font-black text-sm block truncate transition-opacity duration-200">
                              {isRevealed ? entry.password_value : maskPassword(entry.password_value)}
                            </span>
                            <span className="text-[10px] opacity-50 font-bold uppercase ">
                              {entry.source.replace('_', ' ')} · {formatWhen(entry.created_at)}
                            </span>
                          </button>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {entry.is_current && (
                              <span className="text-[9px] font-black uppercase text-emerald-500">
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

            <div className={`admin-section-enter mt-4 rounded-xl border px-4 py-3 space-y-3 ${isLight ? 'bg-sky-50 border-sky-200/80' : 'bg-sky-500/10 border-sky-400/25'}`}>
              <p className="text-[10px] font-black uppercase opacity-55">Telegram (this account)</p>
              <label className="block">
                <span className={FORM_FIELD_LABEL}>Bot API token</span>
                <PasswordField
                  isLight={isLight}
                  value={detailTelegramBotToken}
                  onChange={setDetailTelegramBotToken}
                  placeholder="From BotFather"
                  autoComplete="off"
                />
              </label>
              <label className="block">
                <span className={FORM_FIELD_LABEL}>User / chat ID</span>
                <input
                  type="text"
                  value={detailTelegramChatId}
                  onChange={(e) => setDetailTelegramChatId(e.target.value)}
                  className={formInputClass(isLight)}
                  placeholder="e.g. 123456789"
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                disabled={savingTelegram}
                onClick={() => void saveDetailTelegram()}
                className="admin-interactive w-full py-2.5 rounded-xl bg-sky-500 text-white text-xs font-black uppercase disabled:opacity-50"
              >
                {savingTelegram ? 'Saving…' : 'Save Telegram'}
              </button>
            </div>

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
              className={`admin-interactive w-full mt-3 py-2.5 rounded-xl text-xs font-black uppercase ${isLight ? 'bg-black text-white' : 'bg-white text-black'} disabled:opacity-50`}
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
                className="admin-interactive w-full mt-2 py-2.5 rounded-xl bg-amber-500 text-white text-xs font-black uppercase disabled:opacity-50"
              >
                Revoke access
              </button>
            )}
            {detailRow.user_id && detailRow.status === 'paused' && (
              <button
                type="button"
                disabled={actionCode === detailRow.code}
                onClick={() => openGrantModal(detailRow)}
                className="admin-interactive w-full mt-2 py-2.5 rounded-xl bg-blue-500 text-white text-xs font-black uppercase disabled:opacity-50"
              >
                Grant access
              </button>
            )}

            <button
              type="button"
              onClick={closeDetailModal}
              className={`admin-interactive w-full mt-4 py-2.5 rounded-xl text-xs font-black uppercase border ${
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
          {adminProfile.name} · access codes
        </p>
      </div>

      <MorphPresence show={showTelegramDbDoc}>
        {(visible) => (
          <div
            className={`fixed inset-0 z-[1200] flex items-end sm:items-center justify-center p-4 ${
              visible ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            role="presentation"
            aria-hidden={!visible}
          >
            <div
              className={`absolute inset-0 cursor-pointer morph-scrim ${visible ? 'morph-scrim--in' : 'morph-scrim--out'} ${
                isLight ? 'bg-[#f2f2f7]/92' : 'bg-black/75'
              }`}
              onClick={() => setShowTelegramDbDoc(false)}
              aria-hidden="true"
            />
            <div
              className={`relative w-full max-w-lg max-h-[82vh] flex flex-col rounded-[28px] overflow-hidden shadow-[0_40px_120px_rgba(0,0,0,0.55)] morph-panel ${
                visible ? 'morph-panel--in' : 'morph-panel--out'
              } ${isLight ? 'bg-white text-zinc-900' : 'bg-[#141416] text-zinc-100'}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="telegram-db-doc-title"
            >
              <div
                className={`flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b shrink-0 ${
                  isLight ? 'border-black/8' : 'border-white/10'
                }`}
              >
                <div className="min-w-0">
                  <h3 id="telegram-db-doc-title" className="text-lg font-black" style={{ letterSpacing: 0 }}>
                    telegramdb.md
                  </h3>
                  <p
                    className={`text-[11px] font-medium mt-0.5 ${isLight ? 'text-black/50' : 'text-white/50'}`}
                    style={{ letterSpacing: 0 }}
                  >
                    Per-account Telegram DB · Supabase = auth + codes
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTelegramDbDoc(false)}
                  className={`admin-interactive h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
                    isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-white/10 text-white'
                  }`}
                  aria-label="Close telegramdb.md"
                >
                  <Icons.X size={16} />
                </button>
              </div>
              <div
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 custom-scrollbar telegram-db-reader"
                style={{ letterSpacing: 0 }}
                dangerouslySetInnerHTML={{ __html: telegramDbHtml }}
              />
            </div>
          </div>
        )}
      </MorphPresence>
    </div>
  );
};

export default AdminCodeDashboard;