'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, Swords, Trophy, DollarSign, Zap, Crown, Target, ChevronRight, Clock, Shield, Globe } from 'lucide-react';
import AppLayout from '@/components/ui/AppLayout';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton';
import { StatCard } from '@/components/dashboard/StatCard';
import { RankProgressBar } from '@/components/dashboard/RankProgressBar';

const FADE = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };
const STAGGER = { show: { transition: { staggerChildren: 0.07 } } };

function formatIDR(n: number) {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}K`;
  return `Rp ${n.toLocaleString('id-ID')}`;
}

const RANK_COLORS: Record<string, string> = {
  Bronze: '#cd7f32', Silver: '#c0c0c0', Gold: '#ffd700',
  Platinum: '#a0b2c6', Diamond: '#4da6ff', Master: '#9b59b6', Grandmaster: '#e74c3c',
};

interface GameHistoryEntry {
  id: string; winner: string; end_reason: string;
  white: { username: string; elo: number; avatar_url: string };
  black: { username: string; elo: number; avatar_url: string };
  white_elo_before: number; black_elo_before: number;
  white_elo_after: number; black_elo_after: number;
  stakes: number; time_control: { initial: number; increment: number };
  ended_at: string;
}

interface EloPoint { date: string; elo: number }

interface LeaderboardEntry {
  rank: number; id: string; username: string; avatar_url: string;
  elo: number; title?: string; country: string;
  wins: number; losses: number; draws: number; winRate: number;
}

export default function DashboardPage() {
  const { user, token } = useAppStore();
  const router = useRouter();
  const [recentGames, setRecentGames] = useState<GameHistoryEntry[]>([]);
  const [eloChart, setEloChart] = useState<EloPoint[]>([]);
  const [todayEloChange, setTodayEloChange] = useState<number | null>(null);
  const [topPlayers, setTopPlayers] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errors, setErrors] = useState({ chart: '', games: '', leaderboard: '' });

  useEffect(() => {
    if (user && !user.verified) {
      router.replace(`/verify-email/pending?email=${encodeURIComponent(user.email)}`);
    }
  }, [user, router]);

  useEffect(() => {
    if (!token || !user) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [gamesData, eloData, lbData] = await Promise.all([
          api.game.history(token, 10),
          api.game.eloHistory(token),
          api.leaderboard.get(100)
        ]);

        // Games
        setRecentGames(gamesData.history || []);

        // ELO
        const history = eloData.history || [];
        if (history.length) {
          const today = new Date().toDateString();
          let todayChange = 0;
          const points = history.slice().reverse().map((h: any) => {
            if (new Date(h.created_at).toDateString() === today) todayChange += h.change || 0;
            return {
              date: new Date(h.created_at).toLocaleDateString('id-ID', { month: 'short', day: 'numeric' }),
              elo: h.elo_after,
            };
          });
          setEloChart(points);
          setTodayEloChange(todayChange);
        }

        // Leaderboard
        const lb = lbData.leaderboard || [];
        setTopPlayers(lb.slice(0, 5));
        const pos = lb.findIndex((e: any) => e.id === user.id);
        if (pos !== -1) setMyRank(pos + 1);

      } catch (err) {
        setErrors({
          chart: 'Data ELO gagal dimuat',
          games: 'Riwayat game gagal dimuat',
          leaderboard: 'Leaderboard gagal dimuat'
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [token, user?.id]);

  if (!user) return null;

  const totalGames = user.wins + user.losses + user.draws;
  const winRate = totalGames > 0 ? Math.round((user.wins / totalGames) * 100) : 0;
  const rankColor = RANK_COLORS[(user.rank ?? '').split(' ')[0]] || '#ffd700';

  const statCards = [
    {
      label: 'ELO Rating', value: user.elo.toString(), icon: TrendingUp,
      change: todayEloChange !== null ? (todayEloChange >= 0 ? `+${todayEloChange}` : `${todayEloChange}`) : null,
      positive: (todayEloChange ?? 0) >= 0, color: 'amber', desc: 'Standar FIDE',
    },
    {
      label: 'Win Rate', value: `${winRate}%`, icon: Target,
      change: totalGames > 0 ? `${totalGames} game` : null,
      positive: true, color: 'emerald', desc: `${user.wins}M ${user.losses}K ${user.draws}S`,
    },
    {
      label: 'Saldo', value: formatIDR(user.balance), icon: DollarSign,
      change: null, positive: true, color: 'yellow', desc: 'Tersedia',
    },
    {
      label: 'Peringkat', value: myRank ? `#${myRank}` : user.rank, icon: Crown,
      change: myRank ? 'Global' : null, positive: true, color: 'purple',
      desc: myRank ? `Top ${myRank} dunia` : 'Belum ada peringkat',
    },
  ];

  return (
    <AppLayout title="Dashboard">
      <AnimatePresence mode="wait">
        {isLoading ? (
          <DashboardSkeleton key="skeleton" />
        ) : (
          <motion.div key="content" variants={STAGGER} initial="hidden" animate="show" exit={{ opacity: 0 }} className="space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <motion.div variants={FADE} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden ring-2 ring-amber-400/50 shadow-lg shadow-amber-500/20">
                    <img src={user.avatar || `https://api.dicebear.com/9.x/avataaars/svg?seed=${user.username}`} alt={user.username} className="w-full h-full object-cover" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg"
                    style={{ background: `linear-gradient(135deg, ${rankColor}, ${rankColor}aa)` }}>
                    {user.wins > 200 ? '♛' : '♟'}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    {user.title && (
                      <span className="text-[10px] font-black uppercase tracking-widest text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-lg border border-yellow-400/20">
                        {user.title}
                      </span>
                    )}
                    {user.verified && <Shield className="w-4 h-4 text-amber-400" />}
                  </div>
                  <h1 className="text-2xl font-black text-[var(--text-primary)] mt-0.5">{user.username}</h1>
                  <p className="text-xs font-medium text-[var(--text-muted)] tracking-wide">{user.rank} · {user.country}</p>
                </div>
              </div>

              <div className="w-full sm:w-72">
                <RankProgressBar currentElo={user.elo} />
              </div>

              <div className="flex gap-3">
                <Link href="/game" className="flex items-center gap-2 px-5 py-2.5 btn-gold rounded-xl font-bold text-sm text-black">
                  <Zap className="w-4 h-4" /> Main Cepat
                </Link>
                <Link href="/tournament" className="flex items-center gap-2 px-5 py-2.5 bg-[var(--bg-hover)] rounded-xl font-bold text-sm text-[var(--text-primary)] border border-[var(--border)] hover:bg-[var(--border)] transition-all">
                  <Trophy className="w-4 h-4" /> Turnamen
                </Link>
              </div>
            </motion.div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {statCards.map((card) => (
                <StatCard key={card.label} {...card} />
              ))}
            </div>

            {/* Main grid */}
            <div className="grid lg:grid-cols-3 gap-6">
              <motion.div variants={FADE} className="lg:col-span-2 card p-5 rounded-2xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <div className="esports-label mb-0.5">Grafik</div>
                    <h3 className="font-bold text-[var(--text-primary)]">Performa ELO</h3>
                  </div>
                  {todayEloChange !== null && (
                    <div className={`flex items-center gap-2 text-xs font-bold ${todayEloChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      <TrendingUp className="w-4 h-4" />
                      {todayEloChange >= 0 ? '+' : ''}{todayEloChange} HARI INI
                    </div>
                  )}
                </div>
                {eloChart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-[var(--text-muted)] opacity-50">
                    <TrendingUp className="w-8 h-8 mb-2" />
                    <p className="text-sm">Belum ada data ELO</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={eloChart} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="eloGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, fontWeight: 700 }} />
                      <Area type="monotone" dataKey="elo" stroke="#f59e0b" strokeWidth={3} fill="url(#eloGrad)" dot={{ fill: '#f59e0b', r: 4 }} activeDot={{ r: 6 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </motion.div>

              <motion.div variants={FADE} className="card p-5 rounded-2xl flex flex-col items-center justify-center">
                <h3 className="font-bold text-[var(--text-primary)] mb-1 w-full text-left">Rasio M/K/S</h3>
                <p className="text-xs text-[var(--text-muted)] mb-4 w-full text-left font-medium uppercase tracking-widest">{totalGames} Game</p>
                {totalGames === 0 ? (
                  <div className="h-40 flex flex-col items-center justify-center text-[var(--text-muted)] opacity-30">
                    <Swords className="w-10 h-10" />
                  </div>
                ) : (
                  <>
                    <PieChart width={150} height={150}>
                      <Pie data={[
                        { name: 'W', value: user.wins },
                        { name: 'L', value: user.losses },
                        { name: 'D', value: user.draws },
                      ]} cx={70} cy={70} innerRadius={45} outerRadius={65} paddingAngle={4} dataKey="value">
                        <Cell fill="#4ade80" stroke="none" />
                        <Cell fill="#f87171" stroke="none" />
                        <Cell fill="#94a3b8" stroke="none" />
                      </Pie>
                    </PieChart>
                    <div className="grid grid-cols-3 gap-6 mt-4 w-full">
                      {[
                        { label: 'W', value: user.wins, color: 'text-emerald-400' },
                        { label: 'L', value: user.losses, color: 'text-red-400' },
                        { label: 'D', value: user.draws, color: 'text-slate-400' },
                      ].map(i => (
                        <div key={i.label} className="text-center">
                          <div className={`text-lg font-black ${i.color}`}>{i.value}</div>
                          <div className="text-[10px] font-bold text-[var(--text-muted)]">{i.label}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </motion.div>
            </div>

            {/* Riwayat & Leaderboard */}
            <div className="grid lg:grid-cols-2 gap-6">
              <motion.div variants={FADE} className="card rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
                  <h3 className="font-bold text-[var(--text-primary)]">Game Terakhir</h3>
                  <Link href="/history" className="text-xs font-bold text-amber-400 hover:text-amber-300">LIHAT SEMUA</Link>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {recentGames.length === 0 ? (
                    <div className="py-12 text-center text-[var(--text-muted)]">Belum ada pertandingan</div>
                  ) : recentGames.map((game) => {
                    const isWhite = game.white?.username === user.username;
                    const opponent = isWhite ? game.black : game.white;
                    const eloBefore = isWhite ? game.white_elo_before : game.black_elo_before;
                    const eloAfter = isWhite ? game.white_elo_after : game.black_elo_after;
                    const eloChange = (eloAfter || eloBefore || 0) - (eloBefore || 0);
                    const result = game.winner === 'draw' ? 'draw' : (game.winner === 'white') === isWhite ? 'win' : 'loss';
                    return (
                      <div key={game.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--bg-hover)] transition-all">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${result === 'win' ? 'bg-emerald-500/10 text-emerald-400' : result === 'loss' ? 'bg-red-500/10 text-red-400' : 'bg-slate-500/10 text-slate-400'}`}>
                          {result === 'win' ? 'W' : result === 'loss' ? 'L' : 'D'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-[var(--text-primary)] truncate">vs {opponent?.username}</div>
                          <div className="text-[10px] font-medium text-[var(--text-muted)] mt-0.5 uppercase tracking-wider">{game.end_reason}</div>
                        </div>
                        <div className="text-right">
                          <div className={`text-sm font-black ${eloChange > 0 ? 'text-emerald-400' : eloChange < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                            {eloChange > 0 ? '+' : ''}{eloChange || 0}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>

              <motion.div variants={FADE} className="card rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
                  <h3 className="font-bold text-[var(--text-primary)]">Pemain Teratas</h3>
                  <Link href="/leaderboard" className="text-xs font-bold text-amber-400 hover:text-amber-300">RANKING GLOBAL</Link>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {topPlayers.map((entry, idx) => (
                    <div key={entry.id} className={`flex items-center gap-3 px-5 py-3.5 ${entry.id === user.id ? 'bg-amber-500/5' : ''}`}>
                      <div className="w-6 text-xs font-black text-[var(--text-muted)]">{idx + 1}</div>
                      <div className="w-8 h-8 rounded-lg overflow-hidden skeleton flex-shrink-0">
                        <img src={entry.avatar_url || `https://api.dicebear.com/9.x/avataaars/svg?seed=${entry.username}`} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-[var(--text-primary)] truncate">{entry.username}</div>
                        <div className="text-[10px] font-medium text-[var(--text-muted)] uppercase">{entry.country}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-black text-amber-400">{entry.elo}</div>
                        <div className="text-[10px] font-bold text-[var(--text-muted)]">{entry.winRate}% WR</div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppLayout>
  );
}
