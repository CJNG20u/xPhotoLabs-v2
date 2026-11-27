import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import {
  AUTH_REQUIRED_EVENT,
  clearPrivateCaches,
  fetchAuthStatus,
  loginRequest,
  logoutRequest,
  setupAccountRequest,
  type AuthStatus,
} from '../lib/api';

interface AuthContextValue {
  authEnabled: boolean;
  username: string | null;
  minPasswordLength: number;
  signOut: () => Promise<void>;
  /** Call after the server has already ended every session (e.g. "sign out everywhere"). */
  handleSignedOutRemotely: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  authEnabled: false,
  username: null,
  minPasswordLength: 10,
  signOut: async () => {},
  handleSignedOutRemotely: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

type GateState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; status: AuthStatus };

/** Public share pages (/s/<token>) are meant for people without an account: never gate them. */
function isPublicSharePath(): boolean {
  return typeof window !== 'undefined' && /^\/s\/[^/]+\/?$/.test(window.location.pathname);
}

/** The sign-in screen renders before the gallery does, so apply the saved theme itself. */
function applySavedTheme(): void {
  try {
    const saved = localStorage.getItem('xphotolabs_theme');
    document.documentElement.classList.toggle('dark', saved === 'dark');
  } catch {
    // ignore storage errors
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<GateState>({ phase: 'loading' });
  const publicShare = isPublicSharePath();

  const loadStatus = useCallback(async () => {
    setGate({ phase: 'loading' });
    try {
      const status = await fetchAuthStatus();
      setGate({ phase: 'ready', status });
    } catch (err) {
      setGate({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Cannot reach the server.',
      });
    }
  }, []);

  useEffect(() => {
    if (publicShare) return;
    applySavedTheme();
    void loadStatus();
  }, [loadStatus, publicShare]);

  // Any request answered with "sign in required" (expired / revoked session) returns to the sign-in screen
  useEffect(() => {
    if (publicShare) return;
    const onAuthRequired = () => {
      void clearPrivateCaches();
      setGate((prev) =>
        prev.phase === 'ready' && prev.status.authEnabled
          ? { phase: 'ready', status: { ...prev.status, authenticated: false, username: null } }
          : prev
      );
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, [publicShare]);

  const markSignedOut = useCallback(() => {
    void clearPrivateCaches();
    setGate((prev) =>
      prev.phase === 'ready'
        ? { phase: 'ready', status: { ...prev.status, authenticated: false, username: null } }
        : prev
    );
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // the cookie may already be invalid; go back to the sign-in screen regardless
    }
    markSignedOut();
  }, [markSignedOut]);

  const ctx = useMemo<AuthContextValue>(
    () => ({
      authEnabled: gate.phase === 'ready' ? gate.status.authEnabled : false,
      username: gate.phase === 'ready' ? gate.status.username : null,
      minPasswordLength: gate.phase === 'ready' ? gate.status.minPasswordLength : 10,
      signOut,
      handleSignedOutRemotely: markSignedOut,
    }),
    [gate, signOut, markSignedOut]
  );

  if (publicShare) return <>{children}</>;

  if (gate.phase === 'loading') {
    return (
      <AuthShell>
        <div className="flex items-center justify-center gap-2 text-sm text-[#444746] dark:text-[#C4C7C5] py-6">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Connecting…</span>
        </div>
      </AuthShell>
    );
  }

  if (gate.phase === 'error') {
    return (
      <AuthShell>
        <div className="space-y-4 text-center">
          <p className="text-sm text-[#1F1F1F] dark:text-[#E3E3E3]">Can’t reach xPhotoLabs.</p>
          <p className="text-xs text-[#747775] dark:text-[#8E918F]">
            Check that your server is running and that you are online.
          </p>
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="inline-flex items-center gap-2 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] px-5 py-2.5 text-sm font-medium text-white dark:text-[#062E6F] hover:opacity-95 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        </div>
      </AuthShell>
    );
  }

  const { status } = gate;

  if (status.authEnabled && (status.setupRequired || !status.authenticated)) {
    return (
      <AuthShell>
        <CredentialsForm
          mode={status.setupRequired ? 'setup' : 'login'}
          minPasswordLength={status.minPasswordLength}
          onSuccess={(next) => setGate({ phase: 'ready', status: next })}
        />
      </AuthShell>
    );
  }

  return <AuthContext.Provider value={ctx}>{children}</AuthContext.Provider>;
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full h-full bg-white dark:bg-[#131314] flex items-center justify-center px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] overflow-y-auto">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <img src="/icon.svg" alt="" className="w-14 h-14" referrerPolicy="no-referrer" />
          <h1 className="mt-3 text-xl font-normal tracking-tight text-[#1F1F1F] dark:text-[#E3E3E3]">
            xPhotoLabs
          </h1>
        </div>
        <div className="rounded-3xl bg-[#F8FAFD] dark:bg-[#1E1F20] p-6">{children}</div>
      </div>
    </div>
  );
}

function CredentialsForm({
  mode,
  minPasswordLength,
  onSuccess,
}: {
  mode: 'login' | 'setup';
  minPasswordLength: number;
  onSuccess: (status: AuthStatus) => void;
}) {
  const isSetup = mode === 'setup';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (isSetup) {
      if (password.length < minPasswordLength) {
        setError(`Password must be at least ${minPasswordLength} characters.`);
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }
    }

    setBusy(true);
    try {
      const next = isSetup
        ? await setupAccountRequest(username.trim(), password)
        : await loginRequest(username.trim(), password);
      onSuccess(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setPassword('');
      setConfirm('');
      setBusy(false);
    }
  };

  const inputClass =
    'w-full rounded-xl bg-white dark:bg-[#282A2C] border border-black/10 dark:border-white/10 px-3.5 py-2.5 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] focus:border-[#0B57D0] dark:focus:border-[#A8C7FA] focus:outline-none';
  const labelClass = 'block text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1.5';

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="text-center">
        <h2 className="text-base font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
          {isSetup ? 'Create your account' : 'Sign in'}
        </h2>
        <p className="text-xs text-[#747775] dark:text-[#8E918F] mt-1">
          {isSetup
            ? 'Choose a username and password to protect your photos.'
            : 'Enter your username and password to open your photos.'}
        </p>
      </div>

      <div>
        <label htmlFor="xp-username" className={labelClass}>
          Username
        </label>
        <input
          id="xp-username"
          type="text"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="xp-password" className={labelClass}>
          Password
        </label>
        <div className="relative">
          <input
            id="xp-password"
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 px-3.5 text-[#747775] dark:text-[#8E918F] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] cursor-pointer"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {isSetup && (
          <p className="text-[11px] text-[#747775] dark:text-[#8E918F] mt-1">
            At least {minPasswordLength} characters.
          </p>
        )}
      </div>

      {isSetup && (
        <div>
          <label htmlFor="xp-confirm" className={labelClass}>
            Confirm password
          </label>
          <input
            id="xp-confirm"
            type={showPassword ? 'text' : 'password'}
            name="confirm-password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-[#FCE8E6] dark:bg-[#3C1E1B] text-[#B3261E] dark:text-[#F2B8B5] text-xs px-3 py-2.5"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !username.trim() || !password}
        className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] px-5 py-2.5 text-sm font-medium text-white dark:text-[#062E6F] hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {isSetup ? 'Create account' : 'Sign in'}
      </button>
    </form>
  );
}
