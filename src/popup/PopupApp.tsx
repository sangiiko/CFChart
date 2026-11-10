import React, { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';
import { CFUser, CFRatingChange, CFSubmission, RecommendedProblem, HabitProgress } from '../types/codeforces';
import { storageService } from '../services/storage';
import { codeforcesApi, getRankTier } from '../services/codeforcesApi';
import { calculateHabitProgress } from '../services/habitTracker';
import { DailyHabitRing } from '../components/DailyHabitRing';
import { RecommendedCard } from '../components/RecommendedCard';
import { HandleConnectModal } from '../components/HandleConnectModal';
import { RotateCw, ExternalLink, UserCheck, Sparkles } from 'lucide-react';

export const PopupApp: React.FC = () => {
  const [handle, setHandle] = useState<string>('tourist');
  const [user, setUser] = useState<CFUser | null>(null);
  const [, setRatings] = useState<CFRatingChange[]>([]);
  const [submissions, setSubmissions] = useState<CFSubmission[]>([]);
  const [recommended, setRecommended] = useState<RecommendedProblem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isConnectOpen, setIsConnectOpen] = useState<boolean>(false);

  const loadData = async (targetHandle: string) => {
    setLoading(true);
    try {
      const [u, r, s] = await Promise.all([
        codeforcesApi.fetchUserInfo(targetHandle),
        codeforcesApi.fetchUserRatingHistory(targetHandle),
        codeforcesApi.fetchUserSubmissions(targetHandle, 100),
      ]);

      setUser(u);
      setRatings(r);
      setSubmissions(s);

      const solvedKeys = new Set(
        s.filter(sub => sub.verdict === 'OK').map(sub => `${sub.problem.contestId}-${sub.problem.index}`)
      );
      const rec = await codeforcesApi.fetchRecommendedProblems(u?.rating || 1200, solvedKeys);
      setRecommended(rec);

      // Save to storage
      await storageService.set('cf_handle', targetHandle);
      await storageService.set('cf_user', u);
      await storageService.set('cf_ratings', r);
      await storageService.set('cf_submissions', s);
    } catch (err) {
      console.error('Failed to load popup data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      const savedHandle = await storageService.get('cf_handle');
      const initialHandle = savedHandle || 'tourist';
      setHandle(initialHandle);
      await loadData(initialHandle);
    })();
  }, []);

  const progress: HabitProgress = calculateHabitProgress(submissions, 2);
  const rankTier = getRankTier(user?.rating);

  const handleOpenDashboard = () => {
    try {
      if (typeof browser !== 'undefined' && browser.tabs?.create) {
        browser.tabs.create({ url: browser.runtime.getURL('dashboard.html') });
        return;
      }
    } catch {
      // Fallback
    }
    window.open('dashboard.html', '_blank');
  };

  return (
    <div className="w-[380px] bg-slate-950 text-slate-100 p-4 font-sans select-none min-h-[520px] flex flex-col justify-between">
      <div>
        {/* Top Header */}
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            {user?.avatar ? (
              <img src={user.avatar} alt="avatar" className="w-8 h-8 rounded-full border border-slate-700 object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300">
                {handle[0].toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm text-slate-100 tracking-tight">{handle}</span>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.2 rounded"
                  style={{ backgroundColor: `${rankTier.color}20`, color: rankTier.color }}
                >
                  {rankTier.name}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 font-mono">Rating: {user?.rating ?? 'Unrated'}</div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => loadData(handle)}
              title="Refresh submissions"
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
            </button>
            <button
              onClick={() => setIsConnectOpen(true)}
              title="Switch Handle"
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <UserCheck className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 2-Problem Habit Ring Card */}
        <div className="mb-3">
          <DailyHabitRing progress={progress} compact={false} />
        </div>

        {/* Recommended 2 Problems */}
        <div className="mb-3">
          <RecommendedCard problems={recommended} />
        </div>
      </div>

      {/* Footer Call to Action */}
      <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
        <button
          onClick={handleOpenDashboard}
          className="flex-1 py-2 px-3 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg transition-all flex items-center justify-center gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5 text-sky-200" />
          <span>Open Full Horizon Predictor</span>
          <ExternalLink className="w-3 h-3 text-sky-200" />
        </button>
      </div>

      {/* Connect Profile Modal */}
      <HandleConnectModal
        isOpen={isConnectOpen}
        onClose={() => setIsConnectOpen(false)}
        currentHandle={handle}
        onConnected={(connectedUser) => {
          setHandle(connectedUser.handle);
          loadData(connectedUser.handle);
        }}
      />
    </div>
  );
};
