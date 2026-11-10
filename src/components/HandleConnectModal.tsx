import React, { useState } from 'react';
import { CFUser } from '../types/codeforces';
import { codeforcesApi, getRankTier } from '../services/codeforcesApi';
import { UserCheck, Loader2, Sparkles, X } from 'lucide-react';

interface HandleConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected: (user: CFUser) => void;
  currentHandle?: string;
}

export const HandleConnectModal: React.FC<HandleConnectModalProps> = ({
  isOpen,
  onClose,
  onConnected,
  currentHandle = '',
}) => {
  const [handle, setHandle] = useState(currentHandle);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUser, setPreviewUser] = useState<CFUser | null>(null);

  if (!isOpen) return null;

  const handleLookup = async (lookupHandle: string) => {
    if (!lookupHandle.trim()) {
      setError('Please enter a valid Codeforces handle.');
      return;
    }
    setLoading(true);
    setError(null);

    const user = await codeforcesApi.fetchUserInfo(lookupHandle.trim());
    setLoading(false);

    if (user) {
      setPreviewUser(user);
    } else {
      setError(`Could not find profile for "${lookupHandle}". Check spelling or internet connection.`);
      setPreviewUser(null);
    }
  };

  const handleConfirm = () => {
    if (previewUser) {
      onConnected(previewUser);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 shadow-2xl text-slate-100 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-slate-100">Connect Codeforces Profile</h3>
            <p className="text-xs text-slate-400">Track your daily 2 problems & future rating horizon</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Codeforces Handle</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. tourist, Benq, or your handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLookup(handle)}
                className="flex-1 bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
              />
              <button
                onClick={() => handleLookup(handle)}
                disabled={loading}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Find'}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 p-2.5 rounded-lg">
              {error}
            </div>
          )}

          {previewUser && (
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {previewUser.avatar ? (
                  <img src={previewUser.avatar} alt="Avatar" className="w-10 h-10 rounded-full border border-slate-600 object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold">
                    {previewUser.handle[0].toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="font-bold text-sm text-slate-100">{previewUser.handle}</div>
                  <div className="text-xs flex items-center gap-1.5">
                    <span
                      className="font-medium"
                      style={{ color: getRankTier(previewUser.rating).color }}
                    >
                      {getRankTier(previewUser.rating).name}
                    </span>
                    <span className="text-slate-400 font-mono">({previewUser.rating ?? 'Unrated'})</span>
                  </div>
                </div>
              </div>
              <button
                onClick={handleConfirm}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors shadow"
              >
                Connect
              </button>
            </div>
          )}

          <div className="pt-2 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
            <span className="flex items-center gap-1 text-slate-400">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Quick demo profiles:
            </span>
            <div className="flex gap-1.5">
              {['tourist', 'Benq', 'Petr'].map((demo) => (
                <button
                  key={demo}
                  onClick={() => {
                    setHandle(demo);
                    handleLookup(demo);
                  }}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-slate-300"
                >
                  {demo}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
