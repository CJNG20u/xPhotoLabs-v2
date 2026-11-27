import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { changePasswordRequest, logoutAllRequest } from '../lib/api';
import { useAuth } from './AuthGate';

export function SecuritySection() {
  const { authEnabled, username, minPasswordLength, signOut, handleSignedOutRemotely } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const cardClass = 'rounded-3xl bg-[#F8FAFD] dark:bg-[#1E1F20] p-6 space-y-4';
  const titleClass = 'flex items-center gap-2.5 text-base font-medium text-[#1F1F1F] dark:text-[#E3E3E3]';

  if (!authEnabled) {
    return (
      <section className={cardClass}>
        <div className={titleClass}>
          <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-300" />
          <h2>Account security</h2>
        </div>
        <p className="text-xs text-[#747775] dark:text-[#8E918F] leading-relaxed">
          Sign-in is turned off (<code>AUTH_DISABLED=true</code>). Anyone who can reach this server can see your photos. Remove
          that setting to require a sign-in.
        </p>
      </section>
    );
  }

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setMessage(null);
    if (newPassword.length < minPasswordLength) {
      setMessage({ kind: 'error', text: `New password must be at least ${minPasswordLength} characters.` });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ kind: 'error', text: 'New passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      const res = await changePasswordRequest(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage({
        kind: 'ok',
        text:
          res.otherSessionsSignedOut > 0
            ? `Password updated. ${res.otherSessionsSignedOut} other signed-in ${
                res.otherSessionsSignedOut === 1 ? 'device was' : 'devices were'
              } signed out.`
            : 'Password updated.',
      });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not change password.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSignOutEverywhere = async () => {
    if (busy) return;
    if (!window.confirm('Sign out of every device, including this one?')) return;
    setBusy(true);
    try {
      await logoutAllRequest();
      handleSignedOutRemotely();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not sign out.' });
      setBusy(false);
    }
  };

  const inputClass =
    'w-full rounded-xl bg-white dark:bg-[#282A2C] border border-black/10 dark:border-white/10 px-3.5 py-2.5 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#0B57D0] dark:focus:border-[#A8C7FA] focus:outline-none';
  const primaryBtn =
    'inline-flex items-center gap-1.5 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] px-4 py-2 text-xs font-medium text-white dark:text-[#062E6F] hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap';
  const tonalBtn =
    'inline-flex items-center gap-1.5 rounded-full bg-[#C2E7FF] dark:bg-[#004A77] px-4 py-2 text-xs font-semibold text-[#001D35] dark:text-[#C2E7FF] hover:opacity-95 disabled:opacity-50 cursor-pointer whitespace-nowrap';

  return (
    <section className={cardClass}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className={titleClass}>
            <ShieldCheck className="w-5 h-5 text-[#0B57D0] dark:text-[#A8C7FA]" />
            <h2>Account security</h2>
          </div>
          <p className="mt-1 text-xs text-[#747775] dark:text-[#8E918F]">
            Signed in as <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">{username}</span>. Your photos are only
            reachable after signing in. Share links and phone-sync tokens keep working.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button type="button" onClick={() => void signOut()} className={tonalBtn}>
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
          <button
            type="button"
            onClick={() => void handleSignOutEverywhere()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 px-4 py-2 text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            Sign out everywhere
          </button>
        </div>
      </div>

      <form onSubmit={handleChangePassword} className="space-y-3 pt-2" noValidate>
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">
          <KeyRound className="w-3.5 h-3.5" />
          Change password
        </h3>
        {/* Hidden username helps password managers attach the new password to the right account */}
        <input type="text" name="username" autoComplete="username" value={username ?? ''} readOnly hidden />
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            type="password"
            placeholder="Current password"
            aria-label="Current password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
          />
          <input
            type="password"
            placeholder="New password"
            aria-label="New password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputClass}
          />
          <input
            type="password"
            placeholder="Confirm new password"
            aria-label="Confirm new password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || !currentPassword || !newPassword || !confirmPassword}
            className={primaryBtn}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Update password
          </button>
          {message && (
            <p
              role="status"
              className={`flex items-center gap-1.5 text-xs ${
                message.kind === 'ok' ? 'text-[#146C2E] dark:text-[#6DD58C]' : 'text-[#B3261E] dark:text-[#F2B8B5]'
              }`}
            >
              {message.kind === 'ok' ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              )}
              {message.text}
            </p>
          )}
        </div>
        <p className="text-[11px] text-[#747775] dark:text-[#8E918F]">
          Changing your password signs out every other device. At least {minPasswordLength} characters.
        </p>
      </form>
    </section>
  );
}
