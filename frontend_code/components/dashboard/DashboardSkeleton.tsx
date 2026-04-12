'use client';

import { motion } from 'framer-motion';

const FADE = { hidden: { opacity: 0 }, show: { opacity: 1 } };
const STAGGER = { show: { transition: { staggerChildren: 0.05 } } };

export function DashboardSkeleton() {
  return (
    <motion.div variants={STAGGER} initial="hidden" animate="show" className="space-y-6 max-w-7xl mx-auto">
      {/* Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl skeleton" />
          <div className="space-y-2">
            <div className="h-6 w-32 rounded-lg skeleton" />
            <div className="h-4 w-24 rounded-lg skeleton" />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="h-10 w-28 rounded-xl skeleton" />
          <div className="h-10 w-28 rounded-xl skeleton" />
        </div>
      </div>

      {/* Stat Cards Skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card p-4 rounded-2xl border border-[var(--border)]">
            <div className="flex justify-between mb-4">
              <div className="w-10 h-10 rounded-xl skeleton" />
              <div className="w-12 h-5 rounded-lg skeleton" />
            </div>
            <div className="h-8 w-20 rounded-lg skeleton mb-2" />
            <div className="h-3 w-16 rounded-lg skeleton" />
          </div>
        ))}
      </div>

      {/* Main Grid Skeleton */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-5 rounded-2xl h-[320px]">
          <div className="flex justify-between mb-8">
            <div className="space-y-2">
              <div className="h-3 w-12 rounded skeleton" />
              <div className="h-5 w-32 rounded skeleton" />
            </div>
            <div className="w-24 h-5 rounded skeleton" />
          </div>
          <div className="w-full h-40 rounded-xl skeleton" />
        </div>
        <div className="card p-5 rounded-2xl h-[320px]">
          <div className="h-5 w-24 rounded skeleton mb-6" />
          <div className="flex justify-center mb-6">
            <div className="w-32 h-32 rounded-full skeleton" />
          </div>
          <div className="space-y-3">
            <div className="h-4 w-full rounded skeleton" />
            <div className="h-4 w-full rounded skeleton" />
          </div>
        </div>
      </div>

      {/* Bottom Grid Skeleton */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card rounded-2xl h-80 overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)] flex justify-between">
            <div className="h-5 w-32 rounded skeleton" />
            <div className="h-4 w-16 rounded skeleton" />
          </div>
          <div className="p-5 space-y-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl skeleton" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 rounded skeleton" />
                  <div className="h-3 w-20 rounded skeleton" />
                </div>
                <div className="w-12 h-4 rounded skeleton" />
              </div>
            ))}
          </div>
        </div>
        <div className="card rounded-2xl h-80 overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)] flex justify-between">
            <div className="h-5 w-32 rounded skeleton" />
            <div className="h-4 w-16 rounded skeleton" />
          </div>
          <div className="p-5 space-y-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg skeleton" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-28 rounded skeleton" />
                  <div className="h-3 w-16 rounded skeleton" />
                </div>
                <div className="w-10 h-4 rounded skeleton" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
