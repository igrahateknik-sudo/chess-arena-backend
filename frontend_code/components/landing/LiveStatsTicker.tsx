'use client';

const TICKER_ITEMS = [
  { icon: '🛡️', text: '5 Lapis Sistem Anti-Cheat Aktif' },
  { icon: '⚡', text: 'Matchmaking Instan: Blitz & Bullet' },
  { icon: '🏆', text: 'Turnamen Otomatis Setiap Jam' },
  { icon: '⚖️', text: 'Kebijakan Fair Play Sangat Ketat' },
  { icon: '🎯', text: 'Sistem ELO Berstandar FIDE' },
  { icon: '🌐', text: 'Server Lokal (Indonesia) Latensi Rendah' },
  { icon: '🎮', text: 'Full Skill-Based Tanpa Unsur Keberuntungan' },
  { icon: '✅', text: 'Audit Pertandingan Real-time Aktif' },
];

export function LiveStatsTicker() {
  return (
    <div className="relative z-10 max-w-7xl mx-auto px-6 pb-8">
      <div className="overflow-hidden rounded-2xl border border-amber-500/15 bg-amber-500/[0.03] flex items-center py-3 px-4">
        <div className="flex items-center gap-1.5 flex-shrink-0 mr-4 pr-4 border-r border-white/10">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.2em] whitespace-nowrap">System Status</span>
        </div>
        <div className="flex overflow-hidden flex-1">
          <div className="flex gap-12 animate-ticker whitespace-nowrap">
            {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
              <span key={i} className="flex items-center gap-2 text-[11px] font-bold text-slate-400 flex-shrink-0 uppercase tracking-wider">
                <span>{item.icon}</span>
                <span>{item.text}</span>
                <span className="text-white/10 ml-4">•</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
