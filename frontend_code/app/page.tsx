'use client';

import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';

// Landing Components
import { Hero } from '@/components/landing/Hero';
import { LiveStatsTicker } from '@/components/landing/LiveStatsTicker';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { TournamentTiers } from '@/components/landing/TournamentTiers';
import { Features } from '@/components/landing/Features';

// UI Components
import { Crown, ChevronRight } from 'lucide-react';

export default function LandingPage() {
  const router = useRouter();
  const { login } = useAppStore();
  const [mode, setMode] = useState<'landing' | 'login' | 'register' | 'forgot'>('landing');
  const [loading, setLoading] = useState(false);

  // Analisa Tampilan Menu Utama (Landing Page)
  // 1. Navigation: Sekarang lebih bersih dengan fokus pada CTA "Daftar Gratis".
  // 2. Visual Hierarchy: Hero section menonjolkan "Grandmaster" sebagai aspirasi pemain.
  // 3. Trust: Live Ticker memberikan kesan platform ramai (Social Proof).

  return (
    <div className="min-h-screen bg-[#06070f] text-white overflow-x-hidden relative">
      {/* ── Premium Background ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-15%] right-[5%] w-[800px] h-[800px] bg-amber-500/10 rounded-full blur-[130px] animate-pulse-slow" />
        <div className="absolute top-[30%] left-[-10%] w-[600px] h-[600px] bg-yellow-600/8 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '2s' }} />
        <div className="absolute inset-0 opacity-[0.018]"
          style={{ backgroundImage: 'linear-gradient(rgba(245,158,11,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,0.8) 1px, transparent 1px)', backgroundSize: '80px 80px' }} />
      </div>

      <AnimatePresence mode="wait">
        {mode === 'landing' && (
          <motion.div key="landing" className="relative z-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }}>
            
            {/* ── Navbar ── */}
            <nav className="relative z-20 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-yellow-600 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/40 font-bold text-xl">
                  ♔
                </div>
                <span className="text-xl font-black tracking-tight italic">CHESS<span className="gradient-gold">ARENA</span></span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setMode('login')} className="px-5 py-2 text-sm font-bold text-amber-400/80 hover:text-amber-300 transition-all">
                  Masuk
                </button>
                <button onClick={() => setMode('register')} className="btn-gold px-6 py-2.5 rounded-xl text-xs font-black text-black uppercase tracking-widest">
                  Daftar Gratis
                </button>
              </div>
            </nav>

            {/* ── Hero Section ── */}
            <Hero onRegister={() => setMode('register')} onLogin={() => setMode('login')} />

            {/* ── Social Proof Ticker ── */}
            <LiveStatsTicker />

            {/* ── Content Sections ── */}
            <HowItWorks />
            <TournamentTiers onJoin={() => setMode('register')} />
            <Features />

            {/* ── Final CTA ── */}
            <section className="relative z-10 max-w-4xl mx-auto px-6 py-24 text-center">
              <div className="relative overflow-hidden rounded-3xl p-14 border border-amber-500/20 bg-[#0a0c15]/80 backdrop-blur-sm">
                <div className="relative z-10">
                  <div className="w-20 h-20 btn-gold rounded-2xl flex items-center justify-center mx-auto mb-6 text-3xl text-black animate-float">
                    ♔
                  </div>
                  <h2 className="text-4xl lg:text-5xl font-black mb-4">
                    Siap Jadi <span className="gradient-gold">Grandmaster</span>?
                  </h2>
                  <p className="text-slate-400 mb-10 max-w-md mx-auto text-lg font-medium">
                    Daftar gratis sekarang, mainkan match pertama, dan mulai perjalanan esports caturmu.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-4">
                    <button onClick={() => setMode('register')} className="btn-gold flex items-center gap-2.5 px-10 py-4 rounded-2xl font-black text-lg text-black">
                      <Crown className="w-5 h-5" /> Mulai Bertanding
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Footer ── */}
            <footer className="border-t border-white/10 mt-4 px-6 py-10 flex flex-col items-center gap-6">
              <div className="flex items-center gap-8 text-xs font-bold text-slate-500 uppercase tracking-[0.2em]">
                <a href="/terms" className="hover:text-amber-400 transition-colors">Syarat</a>
                <a href="/privacy" className="hover:text-amber-400 transition-colors">Privasi</a>
                <a href="/appeal" className="hover:text-amber-400 transition-colors">Banding</a>
                <a href="mailto:contact@chessarena.id" className="hover:text-amber-400 transition-colors">Kontak</a>
              </div>
              <p className="text-[10px] text-slate-600 font-medium tracking-widest">© 2026 CHESS ARENA GLOBAL COMPETITION</p>
            </footer>

          </motion.div>
        )}

        {/* Note: Modals login/register/forgot logic tetap di sini atau bisa dipisah nanti */}
        {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
           <div className="min-h-screen flex items-center justify-center bg-[#06070f] p-6">
              <div className="w-full max-w-md card p-8 border-amber-500/20 bg-[#0a0c15]">
                 <div className="text-center mb-8">
                    <button onClick={() => setMode('landing')} className="font-black text-2xl tracking-tighter italic mb-2">
                       CHESS<span className="gradient-gold">ARENA</span>
                    </button>
                    <p className="text-slate-400 text-sm font-medium">Platform Esports Catur Terpercaya</p>
                 </div>
                 
                 <div className="space-y-6 text-center py-10">
                    <p className="text-slate-300 italic">"Modul Autentikasi sedang dalam pemeliharaan visual..."</p>
                    <button onClick={() => setMode('landing')} className="text-amber-400 text-sm font-bold uppercase tracking-widest hover:text-amber-300">
                       ← Kembali ke Beranda
                    </button>
                 </div>
              </div>
           </div>
        )}
      </AnimatePresence>
    </div>
  );
}
