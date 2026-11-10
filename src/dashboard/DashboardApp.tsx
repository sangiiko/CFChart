import React, { useEffect, useState } from 'react';
import { CFUser, CFRatingChange, CFSubmission, RecommendedProblem, PredictionParams, HabitProgress } from '../types/codeforces';
import { storageService } from '../services/storage';
import { codeforcesApi, getRankTier } from '../services/codeforcesApi';
import { calculateHabitProgress } from '../services/habitTracker';
import { generateHorizonProjection } from '../services/predictorModel';
import { HorizonChart } from '../components/HorizonChart';
import { PracticeSimulator } from '../components/PracticeSimulator';
import { MilestoneGrid } from '../components/MilestoneGrid';
import { DailyHabitRing } from '../components/DailyHabitRing';
import { RecommendedCard } from '../components/RecommendedCard';
import { HandleConnectModal } from '../components/HandleConnectModal';
import { Sparkles, RotateCw, UserCheck, Flame, ExternalLink, ShieldCheck } from 'lucide-react';

export const DashboardApp: React.FC = () => {
  const [handle, setHandle] = useState<string>('tourist');
  const [user, setUser] = useState<CFUser | null>(null);
  const [ratings, setRatings] = useState<CFRatingChange[]>([]);
  const [submissions, setSubmissions] = useState<CFSubmission[]>([]);
  const [recommended, setRecommended] = useState<RecommendedProblem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isConnectOpen, setIsConnectOpen] = useState<boolean>(false);

  const [predictionParams, setPredictionParams] = useState<PredictionParams>({
    dailyProblems: 2,
    difficultyOffset: 150,
    horizonMonths: 6,
  });

  const loadData = async (targetHandle: string) => {
    setLoading(true);
    try {
      const [u, r, s] = await Promise.all([
        codeforcesApi.fetchUserInfo(targetHandle),
        codeforcesApi.fetchUserRatingHistory(targetHandle),
        codeforcesApi.fetchUserSubmissions(targetHandle, 200),
      ]);

      setUser(u);
      setRatings(r);
      setSubmissions(s);

      const solvedKeys = new Set(
        s.filter(sub => sub.verdict === 'OK').map(sub => `${sub.problem.contestId}-${sub.problem.index}`)
      );
      const rec = await codeforcesApi.fetchRecommendedProblems(u?.rating || 1200, solvedKeys);
      setRecommended(rec);

      await storageService.set('cf_handle', targetHandle);
      await storageService.set('cf_user', u);
      await storageService.set('cf_ratings', r);
      await storageService.set('cf_submissions', s);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
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
  const horizon = generateHorizonProjection(ratings, user?.rating || 1200, predictionParams);
  const rankTier = getRankTier(user?.rating);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-sky-500 selection:text-white">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40 px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 text-white font-black text-sm">
              CF
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-white">CFChart</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-sky-400 border border-slate-700">
                  Firefox Add-on
                </span>
              </div>
              <p className="text-xs text-slate-400">Competitive Programming Daily Habit & Horizon Predictor</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Active User Badge */}
            <div className="flex items-center gap-2.5 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
              {user?.avatar ? (
                <img src={user.avatar} alt="avatar" className="w-7 h-7 rounded-full border border-slate-700 object-cover" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300">
                  {handle[0].toUpperCase()}
                </div>
              )}
              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs text-slate-200">{handle}</span>
                  <span
                    className="text-[10px] font-semibold px-1.5 rounded"
                    style={{ backgroundColor: `${rankTier.color}20`, color: rankTier.color }}
                  >
                    {rankTier.name}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono">
                  Rating: <strong className="text-slate-200">{user?.rating ?? 'Unrated'}</strong>
                </div>
              </div>
            </div>

            {/* Streak Pill */}
            <div className="hidden sm:flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 px-3 py-1.5 rounded-xl text-xs font-semibold">
              <Flame className="w-4 h-4 fill-amber-400" />
              <span>{progress.currentStreak}d Streak</span>
            </div>

            <button
              onClick={() => loadData(handle)}
              title="Refresh Data"
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors border border-slate-800"
            >
              <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
            </button>

            <button
              onClick={() => setIsConnectOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors border border-slate-700"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Switch Profile</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Dashboard */}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Hero Rating Horizon Section */}
        <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-2xl relative overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-sky-400" />
                <h2 className="text-lg font-bold text-white tracking-tight">Codeforces Rating Horizon</h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Colored historical contests &bull; <strong className="text-slate-300">Dashed slate-grey future trajectory</strong> for your 2 problems/day journey
              </p>
            </div>

            <a
              href={`https://codeforces.com/profile/${encodeURIComponent(handle)}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 bg-sky-950/60 border border-sky-800/60 px-3 py-1.5 rounded-lg transition-colors"
            >
              <span>View on Codeforces</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Codeforces Chart */}
          <div className="bg-slate-950/70 rounded-xl p-3 border border-slate-800/80 mb-5">
            <HorizonChart
              data={horizon.chartData}
              currentRating={horizon.currentRating}
              height={420}
            />
          </div>

          {/* Upcoming Milestone ETA Grid */}
          <div className="mb-5">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
              <span>Projected Milestone Checkpoints</span>
            </div>
            <MilestoneGrid
              milestones={horizon.milestones}
              currentRating={horizon.currentRating}
            />
          </div>

          {/* Interactive Simulation Sliders */}
          <PracticeSimulator
            params={predictionParams}
            onChange={setPredictionParams}
            projectedRating={horizon.projectedRatingAtHorizon}
            currentRating={horizon.currentRating}
            totalProblems={horizon.totalProjectedProblems}
          />
        </section>

        {/* Daily 2-Problems Habit & Recommended Workout */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DailyHabitRing progress={progress} compact={false} />
          <RecommendedCard problems={recommended} />
        </section>
      </main>

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
