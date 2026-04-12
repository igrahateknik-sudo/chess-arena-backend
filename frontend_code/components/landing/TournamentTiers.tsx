'use client';

import { motion } from 'framer-motion';
import { Trophy } from 'lucide-react';

const TIERS = [
  {
    key: 'bronze', label: 'Bronze', icon: '🥉',
    subtitle: 'Divisi Pemula', tc: '3+2', max: 32, prize: '+120 PTS',
    bg: 'bg-gradient-to-b from-amber-900/30 to-amber-950/20',
    border: 'border-amber-700/30 hover:border-amber-600/50',
    badge: 'bg-amber-700/20 text-amber-500 border-amber-700/30',
    glow: '',
  },
  {
    key: 'silver', label: 'Silver', icon: '🥈',
    subtitle: 'Divisi Menengah', tc: '5+3', max: 32, prize: '+240 PTS',
    bg: 'bg-gradient-to-b from-slate-700/30 to-slate-800/20',
    border: 'border-slate-400/40 hover:border-slate-300/60',
    badge: 'bg-slate-500/20 text-slate-300 border-slate-400/30',
    glow: 'shadow-xl shadow-white/5',
    featured: true,
  },
  {
    key: 'gold', label: 'Gold', icon: '🥇',
    subtitle: 'Divisi Pro', tc: '10+5', max: 16, prize: '+360 PTS',
    bg: 'bg-gradient-to-b from-amber-500/20 to-yellow-900/15',
    border: 'border-amber-400/50 hover:border-amber-300/70',
    badge: 'bg-amber-400/20 text-amber-300 border-amber-400/30',
    glow: 'shadow-2xl shadow-amber-500/15 neon-gold',
  },
];

interface TournamentTiersProps {
  onJoin: () => void;
}

export function TournamentTiers({ onJoin }: TournamentTiersProps) {
  return (
    <section className="relative z-10 max-w-7xl mx-auto px-6 py-24 border-t border-amber-500/8">
      <motion.div 
        initial={{ y: 20, opacity: 0 }} 
        whileInView={{ y: 0, opacity: 1 }} 
        viewport={{ once: true }}
        className="text-center mb-16"
      >
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-bold uppercase tracking-widest mb-5">
          <Trophy className="w-3.5 h-3.5" /> Divisi Kompetisi
        </div>
        <h2 className="text-4xl font-black mb-4">Pilih <span className="gradient-gold">Divisi</span>, Bertanding, Naik Peringkat</h2>
        <p className="text-slate-400 text-lg">Event otomatis setiap jam — siap kapanpun kamu mau bertanding.</p>
      </motion.div>

      <div className="grid md:grid-cols-3 gap-6">
        {TIERS.map((tier, i) => (
          <motion.div 
            key={tier.key}
            initial={{ y: 30, opacity: 0 }} 
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true }} 
            transition={{ delay: i * 0.12 }}
            className={`relative rounded-2xl p-7 border ${tier.bg} ${tier.border} ${tier.glow} transition-all duration-300 hover:-translate-y-2`}
          >
            {tier.featured && (
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-slate-400 text-slate-900 rounded-full text-[11px] font-black uppercase tracking-widest">
                Populer
              </div>
            )}
            {tier.key === 'gold' && (
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 btn-gold text-black rounded-full text-[11px] font-black uppercase tracking-widest">
                ★ Pro Tier
              </div>
            )}

            <div className="flex items-center gap-3 mb-6">
              <span className="text-4xl">{tier.icon}</span>
              <div>
                <div className={`text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${tier.badge}`}>{tier.label}</div>
                <div className="text-slate-500 text-xs mt-1">{tier.subtitle}</div>
              </div>
            </div>

            <div className="space-y-3 mb-7">
              {[
                { label: 'Kontrol Waktu', value: tier.tc, mono: true },
                { label: 'Max Pemain', value: String(tier.max), mono: false },
                { label: 'Reward', value: tier.prize, gold: true },
                { label: 'Jadwal', value: 'Setiap jam', gold: true },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between text-sm py-2 border-b border-white/5">
                  <span className="text-slate-500">{row.label}</span>
                  <span className={`font-bold ${row.mono ? 'font-mono text-white' : row.gold ? 'text-amber-400' : 'text-white'}`}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            <button 
              onClick={onJoin}
              className={`w-full py-3 rounded-xl text-sm font-black transition-all ${
                tier.key === 'gold'
                  ? 'btn-gold text-black'
                  : 'bg-white/6 border border-white/10 hover:bg-white/12 text-white'
              }`}
            >
              Gabung {tier.label} →
            </button>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
