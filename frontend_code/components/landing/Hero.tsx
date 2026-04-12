'use client';

import { motion } from 'framer-motion';
import { Crown, ChevronRight, Zap, Shield, Award, Clock } from 'lucide-react';
import { ChessBoardVisual } from './ChessBoardVisual';

const STATS = [
  { value: 'LIVE', label: 'Matchmaking' },
  { value: 'AUTO', label: 'Turnamen' },
  { value: '100%', label: 'Skill-Based' },
  { value: '24/7', label: 'Anti-Cheat' },
];

interface HeroProps {
  onRegister: () => void;
  onLogin: () => void;
}

export function Hero({ onRegister, onLogin }: HeroProps) {
  return (
    <section className="relative z-10 max-w-7xl mx-auto px-6 pt-10 pb-24 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
      <div className="text-left">
        {/* Badge */}
        <motion.div 
          initial={{ y: 30, opacity: 0 }} 
          animate={{ y: 0, opacity: 1 }} 
          transition={{ delay: 0.1 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold mb-7 tracking-widest uppercase"
        >
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-lg shadow-amber-400/50" />
          Platform Esports Catur #1 Indonesia
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-lg shadow-amber-400/50" />
        </motion.div>

        {/* Headline */}
        <motion.h1 
          initial={{ y: 30, opacity: 0 }} 
          animate={{ y: 0, opacity: 1 }} 
          transition={{ delay: 0.15 }}
          className="text-5xl lg:text-6xl xl:text-[4.5rem] font-black leading-[1.04] tracking-tight mb-6"
        >
          <span className="text-white">Kuasai Papan.</span><br />
          <span className="text-white">Jadi </span>
          <span className="gradient-gold">Grandmaster.</span>
        </motion.h1>

        <motion.p 
          initial={{ y: 30, opacity: 0 }} 
          animate={{ y: 0, opacity: 1 }} 
          transition={{ delay: 0.2 }}
          className="text-lg text-slate-400 mb-9 max-w-lg leading-relaxed"
        >
          Platform esports catur paling kompetitif di Indonesia. Turnamen setiap jam,
          anti-cheat 5 lapis, dan sistem ELO berstandar FIDE.
        </motion.p>

        {/* CTA Buttons */}
        <motion.div 
          initial={{ y: 30, opacity: 0 }} 
          animate={{ y: 0, opacity: 1 }} 
          transition={{ delay: 0.25 }}
          className="flex flex-wrap gap-4 mb-12"
        >
          <button 
            onClick={onRegister}
            className="btn-gold flex items-center gap-2.5 px-8 py-4 rounded-2xl text-base font-black text-black"
          >
            <Crown className="w-5 h-5" /> Mulai Bertanding
          </button>
          <button 
            onClick={onLogin}
            className="flex items-center gap-2 px-8 py-4 rounded-2xl text-base font-bold text-white border border-white/15 hover:border-amber-500/40 hover:bg-amber-500/5 transition-all"
          >
            Sudah Punya Akun <ChevronRight className="w-4 h-4" />
          </button>
        </motion.div>

        {/* Stats strip */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }} 
          animate={{ y: 0, opacity: 1 }} 
          transition={{ delay: 0.32 }}
          className="grid grid-cols-4 gap-5 pt-7 border-t border-amber-500/10"
        >
          {STATS.map((s) => (
            <div key={s.label}>
              <div className="text-2xl font-black gradient-gold">{s.value}</div>
              <div className="text-xs text-slate-500 mt-1 leading-tight">{s.label}</div>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Chess board visual */}
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        transition={{ delay: 0.2, type: 'spring', stiffness: 80 }}
        className="flex items-center justify-center lg:justify-end order-first lg:order-none"
      >
        <div className="relative w-full max-w-[440px]">
          {/* Outer glow ring */}
          <div className="absolute -inset-4 bg-gradient-to-br from-amber-500/15 via-yellow-400/5 to-transparent rounded-3xl blur-xl" />
          <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-amber-500/20 to-transparent" />

          <div className="relative aspect-square w-full rounded-2xl overflow-hidden board-glow border border-amber-500/20 bg-[#0a0c15]">
            <ChessBoardVisual />
          </div>

          {/* Board info strip */}
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {[
              { label: 'Mode', value: 'Ranked Live' },
              { label: 'Format', value: 'Blitz 3+2' },
              { label: 'Sistem', value: 'Swiss Fair' },
            ].map((item) => (
              <div key={item.label} className="glass-gold rounded-xl px-3 py-2.5 text-center">
                <div className="text-[10px] text-amber-500/60 uppercase tracking-widest leading-none">{item.label}</div>
                <div className="text-xs font-bold text-amber-200 mt-1">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}
