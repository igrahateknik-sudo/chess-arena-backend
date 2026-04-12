/**
 * Engine Detection via Stockfish + Blunder-Rate Fallback
 *
 * Layer 1 (always active): Simplified accuracy analysis menggunakan chess.js
 *   - Blunder rate (move yang menjatuhkan material tanpa kompensasi)
 *   - Non-blunder rate (kalau terlalu sering tidak blunder = suspicious)
 *   - Capture optimization rate
 *
 * Layer 2 (jika stockfish binary tersedia): Stockfish comparison via spawn
 *   - Binary dicari di PATH atau path umum (Alpine apk, macOS Homebrew)
 *   - Komunikasi via UCI protocol (stdin/stdout) — tidak butuh WASM/fetch
 *   - Bandingkan setiap move dengan top-3 rekomendasi engine
 *   - Exact match rate (>75% = sangat suspicious)
 *   - Top-3 match rate (>90% = engine-level accuracy)
 *
 * Design decision: Layer 1 selalu jalan. Layer 2 hanya jika binary terinstall
 * dan sudah ada flag timing suspicious (hemat compute).
 */

import { Chess, Color, PieceSymbol } from 'chess.js';
import { spawn, spawnSync } from 'child_process';

// ── Piece values (centipawn) ───────────────────────────────────────────────
const PIECE_VALUES: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function countMaterial(chess: Chess) {
  const board = chess.board();
  const scores: Record<Color, number> = { w: 0, b: 0 };
  for (const row of board) {
    for (const sq of row) {
      if (sq) scores[sq.color] += PIECE_VALUES[sq.type] || 0;
    }
  }
  return scores;
}

// ── Stockfish binary finder ────────────────────────────────────────────────
// Cari binary stockfish di lokasi umum. Dicoba sekali, hasilnya di-cache.
let _stockfishStatus: 'unknown' | 'available' | 'unavailable' = 'unknown'; // 'available' | 'unavailable'
let _stockfishBinary: string | null = null; // path ke binary yang berhasil dideteksi

const STOCKFISH_CANDIDATES = [
  'stockfish', // dalam PATH (Railway, Docker)
  '/usr/bin/stockfish', // Alpine Linux (apk add stockfish)
  '/usr/games/stockfish', // Debian/Ubuntu
  '/usr/local/bin/stockfish', // macOS Homebrew (Intel)
  '/opt/homebrew/bin/stockfish', // macOS Homebrew (Apple Silicon)
  '/usr/local/games/stockfish',
];

function tryLoadStockfish(): boolean {
  if (_stockfishStatus !== 'unknown') return _stockfishStatus === 'available';

  for (const candidate of STOCKFISH_CANDIDATES) {
    try {
      // spawnSync dengan 'quit' — cepat, tidak blocking lama
      const result = spawnSync(candidate, [], {
        input: 'quit\n',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Exit code 0 atau ada stdout = binary bisa dijalankan
      if (result.status === 0 || (result.stdout && result.stdout.length > 0)) {
        _stockfishBinary = candidate;
        _stockfishStatus = 'available';
        console.log(`[Stockfish] ✅ Binary ditemukan: ${candidate}`);
        return true;
      }
    } catch {
      // kandidat ini gagal, coba berikutnya
    }
  }

  _stockfishStatus = 'unavailable';
  console.warn('[Stockfish] ⚠️  Binary tidak ditemukan. Gunakan Layer 1 (chess.js) saja.');
  console.warn('[Stockfish]    Untuk aktivasi: apt-get install stockfish  atau  apk add stockfish');
  return false;
}

// ── Layer 1: Blunder-rate analysis (chess.js based, always works) ──────────

interface AccuracyStats {
  blunders: number;
  total: number;
  captures: number;
  optimalCaptures: number;
}

interface AccuracyResult {
  blunderRate: number;
  blunders: number;
  total: number;
  captureOptRate: number;
  accuracyScore: number;
}

/**
 * Analisis akurasi berdasarkan blunder rate dan material tracking.
 * Tidak butuh Stockfish — hanya chess.js.
 */
export function analyzeAccuracy(moveHistory: any[]) {
  if (!moveHistory || moveHistory.length < 10) {
    return { white: null, black: null };
  }

  const stats: Record<'white' | 'black', AccuracyStats> = {
    white: { blunders: 0, total: 0, captures: 0, optimalCaptures: 0 },
    black: { blunders: 0, total: 0, captures: 0, optimalCaptures: 0 },
  };

  const chess = new Chess();

  for (let i = 0; i < moveHistory.length; i++) {
    const m = moveHistory[i];
    const color: 'white' | 'black' = i % 2 === 0 ? 'white' : 'black';
    const colorChar: Color = i % 2 === 0 ? 'w' : 'b';

    const matBefore = countMaterial(chess);

    let result;
    try {
      result = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch {
      break;
    }
    if (!result) break;

    const matAfter = countMaterial(chess);
    stats[color].total++;

    // Blunder: player drops >150cp (1.5 pawns) of their own material
    const playerDelta = matAfter[colorChar] - matBefore[colorChar];
    const isBlunder = playerDelta < -150;
    if (isBlunder) stats[color].blunders++;

    // Capture analysis: did player take the highest-value piece available?
    if (result.captured) {
      stats[color].captures++;
      const possibleCaptures = chess
        .history({ verbose: true })
        .filter((h: any) => h.captured)
        .sort(
          (a: any, b: any) =>
            (PIECE_VALUES[b.captured as PieceSymbol] || 0) -
            (PIECE_VALUES[a.captured as PieceSymbol] || 0),
        );

      const capturedValue = PIECE_VALUES[result.captured as PieceSymbol] || 0;
      const bestCaptureValue = possibleCaptures[0]
        ? PIECE_VALUES[(possibleCaptures[0] as any).captured as PieceSymbol] || 0
        : capturedValue;

      if (capturedValue >= bestCaptureValue) {
        stats[color].optimalCaptures++;
      }
    }
  }

  const results: Record<'white' | 'black', AccuracyResult | null> = { white: null, black: null };
  for (const color of ['white', 'black'] as const) {
    const s = stats[color];
    if (s.total < 5) {
      results[color] = null;
      continue;
    }

    const blunderRate = s.blunders / s.total;
    const captureOpt = s.captures > 0 ? s.optimalCaptures / s.captures : 1;

    results[color] = {
      blunderRate: +blunderRate.toFixed(3),
      blunders: s.blunders,
      total: s.total,
      captureOptRate: +captureOpt.toFixed(3),
      accuracyScore: Math.round((1 - blunderRate) * 100),
    };
  }

  return results;
}

// ── Layer 2: Stockfish comparison (spawn-based, butuh binary) ─────────────

interface StockfishTopMoves {
  bestMove: string | null;
  topMoves: string[];
  timedOut?: boolean;
  unavailable?: boolean;
  error?: string;
}

/**
 * Get Stockfish top-N moves untuk FEN tertentu via UCI spawn.
 */
export function getTopMovesFromStockfish(
  fen: string,
  depth = 12,
  multiPV = 3,
  timeoutMs = 6000,
): Promise<StockfishTopMoves> {
  return new Promise((resolve) => {
    if (!tryLoadStockfish() || !_stockfishBinary) {
      return resolve({ bestMove: null, topMoves: [], unavailable: true });
    }

    let proc: any;
    try {
      proc = spawn(_stockfishBinary, [], {
        stdio: ['pipe', 'pipe', 'ignore'], // stdin, stdout, stderr
      });
    } catch (e: any) {
      _stockfishStatus = 'unavailable'; // binary broken
      return resolve({ bestMove: null, topMoves: [], unavailable: true, error: e.message });
    }

    const pvMoves = new Map<number, string>(); // multipv index (1,2,3) → UCI move string
    let maxDepthSeen = 0;
    let resolved = false;
    let buffer = '';

    const done = (extra = {}) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try {
        proc.stdin.end();
        proc.kill('SIGTERM');
      } catch (_e) {
        // Ignore kill errors
      }
      const topMoves = [1, 2, 3].map((i) => pvMoves.get(i)).filter((m): m is string => !!m);
      resolve({ bestMove: topMoves[0] || null, topMoves, ...extra });
    };

    const timer = setTimeout(() => done({ timedOut: true }), timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // simpan baris belum lengkap

      for (const line of lines) {
        const trimmed = line.trim();

        // Parse: info depth D [multipv M] pv MOVE ...
        if (trimmed.startsWith('info') && trimmed.includes(' pv ')) {
          const depthM = trimmed.match(/\bdepth (\d+)/);
          const mpvM = trimmed.match(/\bmultipv (\d+)/);
          const pvM = trimmed.match(/\bpv (\S+)/);
          if (depthM && pvM) {
            const d = parseInt(depthM[1]);
            const mpv = mpvM ? parseInt(mpvM[1]) : 1;
            if (d >= maxDepthSeen) {
              maxDepthSeen = d;
              pvMoves.set(mpv, pvM[1]);
            }
          }
        }

        if (trimmed.startsWith('bestmove')) {
          const bmM = trimmed.match(/bestmove (\S+)/);
          if (bmM?.[1] && !pvMoves.get(1)) pvMoves.set(1, bmM[1]);
          done();
        }
      }
    });

    proc.on('error', (e: any) => {
      console.error('[Stockfish] Spawn error:', e.message);
      _stockfishStatus = 'unavailable';
      done({ unavailable: true, error: e.message });
    });

    proc.on('exit', (code: number) => {
      if (!resolved) done({ error: `Engine exited with code ${code}` });
    });

    // Kirim perintah UCI
    proc.stdin.write('uci\n');
    proc.stdin.write(`setoption name MultiPV value ${multiPV}\n`);
    proc.stdin.write('isready\n');
    proc.stdin.write(`position fen ${fen}\n`);
    proc.stdin.write(`go depth ${depth}\n`);
  });
}

interface StockfishComparisonResult {
  white: {
    exactMatch: number;
    top3Match: number;
    analyzed: number;
    exactMatchRate: number;
    top3MatchRate: number;
  };
  black: {
    exactMatch: number;
    top3Match: number;
    analyzed: number;
    exactMatchRate: number;
    top3MatchRate: number;
  };
  flags: string[];
  suspicionScore: number;
}

/**
 * Full Stockfish comparison across sampled positions.
 */
export async function runStockfishComparison(
  moveHistory: any[],
  options: { maxSamples?: number; depth?: number; minMoves?: number } = {},
): Promise<StockfishComparisonResult | null> {
  const {
    maxSamples = 15, // Max posisi yang dianalisis per warna
    depth = 12, // Kedalaman Stockfish
    minMoves = 10, // Minimum move untuk analisis
  } = options;

  if (!tryLoadStockfish()) return null; // binary tidak tersedia
  if (!moveHistory || moveHistory.length < minMoves) return null;

  // Rekonstruksi FEN sebelum setiap move
  const chess = new Chess();
  const allPositions: { fenBefore: string; move: any; color: 'white' | 'black' }[] = [];

  for (let i = 0; i < moveHistory.length; i++) {
    const fenBefore = chess.fen();
    const m = moveHistory[i];
    const color: 'white' | 'black' = i % 2 === 0 ? 'white' : 'black';
    try {
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      allPositions.push({ fenBefore, move: m, color });
    } catch {
      break;
    }
  }

  // Sample secara merata agar tidak overload
  function sampleEvenly<T>(arr: T[], max: number): T[] {
    if (arr.length <= max) return arr;
    const step = arr.length / max;
    return Array.from({ length: max }, (_, i) => arr[Math.floor(i * step)]);
  }

  const toAnalyze = [
    ...sampleEvenly(
      allPositions.filter((p) => p.color === 'white'),
      maxSamples,
    ),
    ...sampleEvenly(
      allPositions.filter((p) => p.color === 'black'),
      maxSamples,
    ),
  ];

  const results = {
    white: { exactMatch: 0, top3Match: 0, analyzed: 0, exactMatchRate: 0, top3MatchRate: 0 },
    black: { exactMatch: 0, top3Match: 0, analyzed: 0, exactMatchRate: 0, top3MatchRate: 0 },
  };

  console.log(`[Stockfish] Analyzing ${toAnalyze.length} positions at depth ${depth}...`);
  const t0 = Date.now();

  for (const { fenBefore, move, color } of toAnalyze) {
    try {
      const { topMoves, unavailable } = await getTopMovesFromStockfish(fenBefore, depth, 3);
      if (unavailable || !topMoves.length) break; // Stockfish not working, abort

      const playerUCI = `${move.from}${move.to}${move.promotion || ''}`;
      const isExact = topMoves[0] === playerUCI;
      const isTop3 = topMoves.includes(playerUCI);

      results[color].analyzed++;
      if (isExact) results[color].exactMatch++;
      if (isTop3) results[color].top3Match++;
    } catch (e: any) {
      console.error('[Stockfish] Position error:', e.message);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[Stockfish] Done in ${elapsed}s — white: ${results.white.analyzed}, black: ${results.black.analyzed} analyzed`,
  );

  // Hitung rates
  for (const color of ['white', 'black'] as const) {
    const r = results[color];
    r.exactMatchRate = r.analyzed > 0 ? r.exactMatch / r.analyzed : 0;
    r.top3MatchRate = r.analyzed > 0 ? r.top3Match / r.analyzed : 0;
  }

  // Flags dan score
  const flags: string[] = [];
  let suspicionScore = 0;

  for (const color of ['white', 'black'] as const) {
    const r = results[color];
    const prefix = color.toUpperCase();
    if (r.analyzed < 5) continue;

    const exactPct = (r.exactMatchRate * 100).toFixed(0);
    const top3Pct = (r.top3MatchRate * 100).toFixed(0);

    if (r.exactMatchRate >= 0.75) {
      flags.push(`${prefix}_VERY_HIGH_ENGINE_MATCH:${exactPct}%`);
      suspicionScore += 55;
    } else if (r.exactMatchRate >= 0.6) {
      flags.push(`${prefix}_HIGH_ENGINE_MATCH:${exactPct}%`);
      suspicionScore += 35;
    }

    if (r.top3MatchRate >= 0.9) {
      flags.push(`${prefix}_PERFECT_ENGINE_ACCURACY:${top3Pct}%`);
      suspicionScore += 25;
    } else if (r.top3MatchRate >= 0.8) {
      flags.push(`${prefix}_HIGH_ENGINE_ACCURACY:${top3Pct}%`);
      suspicionScore += 15;
    }
  }

  return { white: results.white, black: results.black, flags, suspicionScore };
}
