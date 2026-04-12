'use client';

import { motion } from 'framer-motion';
import { Zap, Shield, Award, Clock } from 'lucide-react';

const FEATURES = [
  { 
    icon: Zap, 
    label: 'Bullet & Blitz', 
    desc: '1+0, 3+2, 5+3', 
    color: 'from-amber-500/10 to-yellow-600/5', 
    border: 'border-amber-500/20 hover:border-amber-400/40', 
    icon_color: 'text-amber-400' 
  },
  { 
    icon: Shield, 
    label: 'Anti-Cheat AI', 
    desc: '5 lapis keamanan', 
    color: 'from-emerald-500/10 to-green-600/5', 
    border: 'border-emerald-500/20 hover:border-emerald-400/40', 
    icon_color: 'text-emerald-400' 
  },
  { 
    icon: Award, 
    label: 'ELO Rating', 
    desc: 'Standard FIDE', 
    color: 'from-violet-500/10 to-purple-600/5', 
    border: 'border-violet-500/20 hover:border-violet-400/40', 
    icon_color: 'text-violet-400' 
  },
  { 
    icon: Clock, 
    label: 'Turnamen 24/7', 
    desc: 'Setiap jam', 
    color: 'from-amber-500/10 to-yellow-600/5', 
    border: 'border-amber-500/20 hover:border-amber-400/40', 
    icon_color: 'text-amber-400' 
  },
];

export function Features() {
  return (
    <section className="relative z-10 max-w-7xl mx-auto px-6 py-20 border-t border-amber-500/8">
      <motion.div 
        initial={{ y: 20, opacity: 0 }} 
        whileInView={{ y: 0, opacity: 1 }} 
        viewport={{ once: true }}
        className="text-center mb-12"
      >
        <h2 className="text-3xl font-black mb-3">Platform <span className="gradient-gold">Kelas Dunia</span></h2>
        <p className="text-slate-400">Dibangun dengan teknologi terdepan untuk pengalaman esports terbaik.</p>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {FEATURES.map((f, i) => (
          <motion.div 
            key={f.label}
            initial={{ y: 20, opacity: 0 }} 
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true }} 
            transition={{ delay: i * 0.08 }}
            className={`rounded-2xl p-6 border bg-gradient-to-br ${f.color} ${f.border} transition-all group`}
          >
            <div className={`w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
              <f.icon className={`w-6 h-6 ${f.icon_color}`} />
            </div>
            <div className="font-bold text-white mb-1">{f.label}</div>
            <div className="text-sm text-slate-500">{f.desc}</div>
          </motion.div>
        ))}
      </div>

      <div className="mt-5 grid md:grid-cols-3 gap-4">
        {[
          { title: '⚖️ Kebijakan Fair Play', desc: 'Deteksi anti-cheat berlapis dan audit pertandingan otomatis setiap game.' },
          { title: '📊 Ranking Transparan', desc: 'Perubahan ELO dan leaderboard diperbarui real-time setiap match selesai.' },
          { title: '📋 Aturan Kompetisi Jelas', desc: 'Syarat turnamen, status akun, dan proses banding terbuka dan tertulis.' },
        ].map((item) => (
          <div key={item.title} className="glass-gold rounded-2xl p-5">
            <p className="text-sm font-bold text-white mb-2">{item.title}</p>
            <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
