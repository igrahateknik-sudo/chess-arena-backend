'use client';

import { motion } from 'framer-motion';
import { Award, ChevronRight } from 'lucide-react';

const RANK_THRESHOLDS = [
  { name: 'Bronze', min: 0, max: 1000, color: '#cd7f32' },
  { name: 'Silver', min: 1000, max: 1500, color: '#c0c0c0' },
  { name: 'Gold', min: 1500, max: 2000, color: '#ffd700' },
  { name: 'Platinum', min: 2000, max: 2400, color: '#a0b2c6' },
  { name: 'Diamond', min: 2400, max: 2800, color: '#4da6ff' },
  { name: 'Master', min: 2800, max: 3200, color: '#9b59b6' },
  { name: 'Grandmaster', min: 3200, max: 9999, color: '#e74c3c' },
];

interface RankProgressBarProps {
  currentElo: number;
}

export function RankProgressBar({ currentElo }: RankProgressBarProps) {
  const currentRankIndex = RANK_THRESHOLDS.findIndex(
    (r, i) => currentElo >= r.min && (i === RANK_THRESHOLDS.length - 1 || currentElo < RANK_THRESHOLDS[i + 1].min)
  );

  const currentRank = RANK_THRESHOLDS[currentRankIndex];
  const nextRank = RANK_THRESHOLDS[currentRankIndex + 1] || currentRank;
  
  const isMaxRank = currentRankIndex === RANK_THRESHOLDS.length - 1;
  
  // Hitung progres dalam tier saat ini
  const range = nextRank.min - currentRank.min;
  const progressInTier = currentElo - currentRank.min;
  const percentage = isMaxRank ? 100 : Math.min(Math.max((progressInTier / range) * 100, 0), 100);
  const eloToGo = isMaxRank ? 0 : nextRank.min - currentElo;

  return (
    <div className="mt-4 p-4 rounded-2xl bg-white/[0.03] border border-white/5 relative overflow-hidden group">
      {/* Background glow accent */}
      <div 
        className="absolute -right-4 -top-4 w-24 h-24 blur-3xl opacity-10 pointer-events-none transition-all duration-500 group-hover:opacity-20"
        style={{ backgroundColor: nextRank.color }}
      />

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10">
            <Award className="w-4 h-4" style={{ color: currentRank.color }} />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] leading-none">Peringkat Saat Ini</div>
            <div className="text-sm font-black text-white mt-0.5">{currentRank.name}</div>
          </div>
        </div>

        {!isMaxRank && (
          <div className="text-right">
            <div className="text-[10px] font-black uppercase tracking-widest text-amber-400/60 leading-none">Target Berikutnya</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-sm font-black text-white">{nextRank.name}</span>
              <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />
            </div>
          </div>
        )}
      </div>

      {/* The Bar */}
      <div className="relative h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="absolute top-0 left-0 h-full rounded-full shadow-[0_0_12px_rgba(0,0,0,0.5)]"
          style={{ 
            background: `linear-gradient(90deg, ${currentRank.color}aa, ${nextRank.color})`,
            boxShadow: `0 0 10px ${nextRank.color}44`
          }}
        />
      </div>

      <div className="flex justify-between items-center mt-2.5">
        <div className="text-[10px] font-bold text-[var(--text-muted)]">
          {currentElo} ELO
        </div>
        {!isMaxRank && (
          <div className="text-[10px] font-black text-amber-400 uppercase tracking-tighter">
            {eloToGo} ELO LAGI MENUJU {nextRank.name.toUpperCase()}
          </div>
        )}
        {isMaxRank && (
          <div className="text-[10px] font-black text-red-400 uppercase tracking-widest animate-pulse">
            MAX RANK REACHED 👑
          </div>
        )}
      </div>
    </div>
  );
}
