'use client';

import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

const FADE = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  change?: string | null;
  positive?: boolean;
  color: string;
  desc: string;
}

export function StatCard({ label, value, icon: Icon, change, positive, color, desc }: StatCardProps) {
  const colorMap: Record<string, { bg: string, icon: string, badge: string }> = {
    amber: { bg: 'bg-amber-500/10', icon: 'text-amber-400', badge: 'text-emerald-400 bg-emerald-500/10' },
    emerald: { bg: 'bg-emerald-500/10', icon: 'text-emerald-400', badge: 'text-emerald-400 bg-emerald-500/10' },
    yellow: { bg: 'bg-yellow-500/10', icon: 'text-yellow-400', badge: 'text-emerald-400 bg-emerald-500/10' },
    purple: { bg: 'bg-purple-500/10', icon: 'text-purple-400', badge: 'text-emerald-400 bg-emerald-500/10' },
  };

  const style = colorMap[color] || colorMap.amber;

  return (
    <motion.div variants={FADE} className="card p-4 rounded-2xl card-hover cursor-default">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${style.bg}`}>
          <Icon className={`w-5 h-5 ${style.icon}`} />
        </div>
        {change && (
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg tracking-wider ${positive ? style.badge : 'text-red-400 bg-red-500/10'}`}>
            {change}
          </span>
        )}
      </div>
      <div className="stat-number mb-0.5">{value}</div>
      <div className="esports-label mt-1">{label}</div>
      <div className="text-[10px] text-[var(--text-muted)] mt-1 font-medium tracking-wide">{desc}</div>
    </motion.div>
  );
}
