'use client';

import { motion } from 'framer-motion';
import { Target, Users, Ticket, Swords, Trophy } from 'lucide-react';

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: Users,
    title: 'Daftar Gratis',
    desc: 'Buat akun dalam 30 detik. Verifikasi email dan mulai bermain langsung.',
  },
  {
    step: '02',
    icon: Ticket,
    title: 'Pilih Divisi',
    desc: 'Pilih divisi Bronze, Silver, atau Gold sesuai target performa kamu.',
  },
  {
    step: '03',
    icon: Swords,
    title: 'Gabung Turnamen',
    desc: 'Turnamen otomatis setiap jam. Daftar, tunggu mulai, lalu bertanding.',
  },
  {
    step: '04',
    icon: Trophy,
    title: 'Naik Peringkat',
    desc: 'Kumpulkan poin ranking, naik leaderboard, dan raih badge kompetitif.',
  },
];

export function HowItWorks() {
  return (
    <section className="relative z-10 max-w-7xl mx-auto px-6 py-24 border-t border-amber-500/8">
      <motion.div 
        initial={{ y: 20, opacity: 0 }} 
        whileInView={{ y: 0, opacity: 1 }} 
        viewport={{ once: true }}
        className="text-center mb-16"
      >
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-bold uppercase tracking-widest mb-5">
          <Target className="w-3.5 h-3.5" /> Cara Bermain
        </div>
        <h2 className="text-4xl font-black mb-4">Dari Daftar ke <span className="gradient-gold">Menang</span> dalam 4 Langkah</h2>
        <p className="text-slate-400 max-w-md mx-auto text-lg">Mulai gratis, pilih divisi, dan fokus ke performa permainanmu.</p>
      </motion.div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {HOW_IT_WORKS.map((step, i) => (
          <motion.div 
            key={step.step}
            initial={{ y: 30, opacity: 0 }} 
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true }} 
            transition={{ delay: i * 0.1 }}
            className="glass-gold rounded-2xl p-6 transition-all group relative overflow-hidden cursor-default"
          >
            {/* Big step number watermark */}
            <div className="text-[5rem] font-black text-amber-400/5 absolute -top-2 -right-2 select-none leading-none">{step.step}</div>
            
            {/* Step number pill */}
            <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 text-sm font-black mb-5">
              {step.step}
            </div>

            <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 group-hover:border-amber-500/40 group-hover:bg-amber-500/5 transition-all">
              <step.icon className="w-6 h-6 text-amber-400" />
            </div>

            <h3 className="font-black text-white text-lg mb-2">{step.title}</h3>
            <p className="text-sm text-slate-400 leading-relaxed">{step.desc}</p>
            
            {i < 3 && (
              <div className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-px bg-gradient-to-r from-amber-500/30 to-transparent z-10" />
            )}
          </motion.div>
        ))}
      </div>
    </section>
  );
}
