import React, { useState, useEffect } from 'react';
import { 
  auth, 
  googleProvider, 
  isEmailWhitelisted, 
  isFirebasePlaceholder, 
  APPROVED_EMAILS 
} from '../firebase';
import { 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  User, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  Lock, 
  Mail, 
  Chrome, 
  AlertTriangle, 
  Check, 
  Sparkles, 
  Database,
  Eye,
  EyeOff,
  LogOut,
  ChevronRight
} from 'lucide-react';

interface AuthScreenProps {
  onAuthGranted: (user: User | { email: string; displayName: string; uid: string }) => void;
}

export default function AuthScreen({ onAuthGranted }: AuthScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Whitelist-rejection states
  const [isRejected, setIsRejected] = useState(false);
  const [rejectedEmail, setRejectedEmail] = useState('');

  // Sandbox states
  const [sandboxEmail, setSandboxEmail] = useState('jashan.grtlife@gmail.com');

  useEffect(() => {
    if (isFirebasePlaceholder) {
      setAuthChecked(true);
      return; // Skip active listeners for standard placeholder
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthChecked(true);
      
      if (user) {
        if (isEmailWhitelisted(user.email)) {
          setIsRejected(false);
          onAuthGranted(user);
        } else {
          // Force screen reject and trace
          setIsRejected(true);
          setRejectedEmail(user.email || '');
          signOut(auth);
        }
      }
    });

    return () => unsubscribe();
  }, [onAuthGranted]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isFirebasePlaceholder) {
      // In sandbox mode we instantly grant
      if (isEmailWhitelisted(sandboxEmail)) {
        setIsRejected(false);
        onAuthGranted({
          email: sandboxEmail,
          displayName: sandboxEmail.split('@')[0],
          uid: 'sandbox-uid-123'
        });
      } else {
        setIsRejected(true);
        setRejectedEmail(sandboxEmail);
      }
      return;
    }

    if (!email || !password) {
      setError('Please provide both email and secret password.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (isRegister) {
        // Enforce whitelist constraint upfront for signup
        if (!isEmailWhitelisted(email)) {
          setIsRejected(true);
          setRejectedEmail(email);
          setLoading(false);
          return;
        }
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Authentication operation failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (isFirebasePlaceholder) {
      // Direct sandbox bypass
      onAuthGranted({
        email: 'jashan.grtlife@gmail.com',
        displayName: 'Jashan Sandbox',
        uid: 'sandbox-uid-123'
      });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Google Auth flow rejected by browser popup permissions.');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLoginFromReject = () => {
    setIsRejected(false);
    setRejectedEmail('');
    setError(null);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-neutral-400 font-sans">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs tracking-widest font-mono text-neutral-500 uppercase">Synchronizing security keys...</p>
        </div>
      </div>
    );
  }

  // REJECT SCREEN (Access Denied)
  if (isRejected) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4 font-sans select-none">
        <div className="w-full max-w-md bg-neutral-950 border border-neutral-900 rounded-3xl p-8 shadow-2xl relative overflow-hidden transition-all">
          <div className="absolute top-0 inset-x-0 h-[2px] bg-red-600 animate-pulse"></div>
          
          <div className="flex flex-col items-center text-center space-y-6">
            <div className="w-16 h-16 bg-red-950/20 text-red-500 rounded-2xl flex items-center justify-center border border-red-500/30 shadow-inner">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl font-bold text-neutral-100 tracking-tight">Access Denied</h1>
              <p className="text-sm text-red-400 font-mono font-medium">{rejectedEmail}</p>
            </div>

            <p className="text-xs text-neutral-500 leading-relaxed max-w-sm">
              Your account email is verified but has not been greenlit on the permitted whitelist. Access is strictly constrained to authorized administrators.
            </p>

            <div className="w-full bg-neutral-900/50 rounded-xl p-4 text-left border border-neutral-850 space-y-2">
              <h3 className="text-xs font-semibold text-neutral-400 tracking-wider uppercase font-mono">Whitelisted Accounts</h3>
              <div className="space-y-1">
                {APPROVED_EMAILS.map(email => (
                  <div key={email} className="flex items-center space-x-2 text-xs text-neutral-300 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                    <span>{email}</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handleBackToLoginFromReject}
              className="w-full bg-neutral-900 hover:bg-neutral-850 text-neutral-200 border border-neutral-850 rounded-xl py-3 text-xs font-semibold uppercase tracking-wider active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center space-x-2"
            >
              <LogOut className="w-4 h-4" />
              <span>Back to Authentication</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4 font-sans select-none">
      {/* Background visual detail */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.03),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(99,102,241,0.03),transparent_40%)] pointer-events-none" />

      <div className="w-full max-w-md bg-neutral-950 border border-neutral-900 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
        {/* Dynamic premium visual accents */}
        <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-neutral-900 via-amber-500/40 to-neutral-900"></div>

        {/* Informative top banner for Sandbox Mode */}
        {isFirebasePlaceholder && (
          <div className="mb-6 bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex items-start space-x-3 text-neutral-300 animate-fadeIn">
            <Database className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-amber-400 font-mono uppercase tracking-wider">Firebase Status: Pending Setup</h4>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                Applet is running in secure fully-contained Sandbox Mode. All database calls are securely mocked locally so you can review immediately.
              </p>
            </div>
          </div>
        )}

        {/* LOGO & TITLE */}
        <div className="flex flex-col items-center text-center space-y-2 mb-8">
          <div className="w-12 h-12 bg-amber-500/10 text-amber-500 rounded-2xl flex items-center justify-center border border-amber-500/25 mb-2 relative">
            <Sparkles className="w-6 h-6" />
            <span className="absolute -top-1 -right-1 bg-amber-400 w-3 h-3 rounded-full animate-ping opacity-25"></span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">SyncScript</h1>
          <p className="text-xs text-neutral-500 uppercase tracking-widest font-mono">Automated Caption Burning</p>
        </div>

        {/* FORM */}
        <form onSubmit={handleEmailAuth} className="space-y-4">
          {isFirebasePlaceholder ? (
            // SANDBOX LOGIN SELECTOR
            <div className="space-y-3">
              <label className="block text-xs font-medium text-neutral-400 uppercase tracking-wider font-mono">Sandbox Email Auth Target</label>
              <div className="relative">
                <select
                  value={sandboxEmail}
                  onChange={(e) => setSandboxEmail(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-850 rounded-xl px-4 py-3 text-sm text-neutral-200 focus:outline-none focus:border-amber-500/50 cursor-pointer appearance-none"
                >
                  <option value="jashan.grtlife@gmail.com">jashan.grtlife@gmail.com (Whitelisted)</option>
                  <option value="unauthorized.test@example.com">unauthorized.test@example.com (Blocked)</option>
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-500">
                  <ChevronRight className="w-4 h-4 rotate-90" />
                </div>
              </div>
              <p className="text-[10px] text-neutral-600 font-mono">Select an account above to test how authorized vs rejected flows run.</p>
            </div>
          ) : (
            // REAL FIREBASE LOGIN
            <>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-neutral-400">Account Email</label>
                <div className="relative flex items-center">
                  <span className="absolute left-3.5 text-neutral-500"><Mail className="w-4 h-4" /></span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full bg-neutral-900 border border-neutral-850 rounded-xl pl-10 pr-4 py-3 text-sm text-neutral-200 focus:outline-none focus:border-amber-500/50 placeholder-neutral-600 transition-colors"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-neutral-400">Security Password</label>
                <div className="relative flex items-center">
                  <span className="absolute left-3.5 text-neutral-500"><Lock className="w-4 h-4" /></span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-neutral-900 border border-neutral-850 rounded-xl pl-10 pr-10 py-3 text-sm text-neutral-200 focus:outline-none focus:border-amber-500/50 placeholder-neutral-600 transition-colors font-mono"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 text-neutral-500 hover:text-neutral-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="p-3 bg-red-950/20 border border-red-500/20 rounded-xl text-xs text-red-400 flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-600 text-neutral-950 rounded-xl py-3 text-xs font-bold uppercase tracking-wider hover:shadow-lg active:scale-[0.99] disabled:opacity-50 disabled:scale-100 transition-all cursor-pointer flex items-center justify-center space-x-2"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-neutral-950 border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <>
                <span>{isFirebasePlaceholder ? 'Enter Sandbox Workspace' : (isRegister ? 'Register Whitelisted Account' : 'Authenticate Access')}</span>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* GOOGLE SIGN IN & FOOTER */}
        <div className="space-y-6 mt-6">
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-x-0 h-[1px] bg-neutral-905"></div>
            <span className="relative bg-neutral-950 px-3 text-[10px] text-neutral-500 font-mono uppercase tracking-widest">Or direct access</span>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full bg-neutral-900 hover:bg-neutral-850 text-neutral-200 border border-neutral-850 rounded-xl py-3 text-xs font-semibold active:scale-[0.99] transition-all flex items-center justify-center space-x-2.5 cursor-pointer"
          >
            <Chrome className="w-4 h-4" />
            <span>Connect with Google Account</span>
          </button>

          {!isFirebasePlaceholder && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setIsRegister(!isRegister);
                  setError(null);
                }}
                className="text-xs text-neutral-400 hover:text-amber-400 border-b border-dashed border-neutral-800 pb-0.5 transition-colors cursor-pointer"
              >
                {isRegister ? 'Already registered? Return to Login' : 'No password account? Sign up here'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
