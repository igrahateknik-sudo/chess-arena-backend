/**
 * Anti-cheat detection + enforcement module
 *
 * Layer 1  — Timing analysis (sync, always runs)
 * Layer 2  — Game integrity check (sync, always runs)
 * Layer 3  — Accuracy / blunder-rate analysis (sync, chess.js based)
 * Layer 4  — ELO anomaly detection (async, DB query)
 * Layer 5  — Stockfish engine comparison (async, background only, needs package)
 *
 * Enforcement:
 *   score ≥ 40 → warn
 *   score ≥ 65 → flag for review
 *   score ≥ 90 → auto-suspend
 */

const { Chess }       = require('chess.js');
const { query, eloHistory } = require('./db');
const { logAnticheatAction }   = require('./auditLog');
const { analyzeAccuracy, runStockfishComparison } = require('./stockfishAnalysis');

// ── Thresholds ─────────────────────────────────────────────────────────────

const TIMING_THRESHOLDS = {
  avgMoveTimeMin:  0.5,   // detik — terlalu cepat
  consistencyMax:  0.15,  // coefficient of variation terlalu kecil
  minMoves:        10,
};

const TRUST_PENALTY = {
  FAST_MOVES:            15,
  ULTRA_FAST_MOVES:      20,
  CONSISTENT_TIMING:     25,
  ILLEGAL_MOVE:          60,
  INVALID_MOVE:          60,
  HIGH_ACCURACY_NO_TIME: 20,
  PERFECT_NO_BLUNDER:    25,
  ELO_GAP_WIN:           25,
  RAPID_ELO_GAIN:        30,
  VERY_HIGH_WIN_RATE:    20,
  WHITE_VERY_HIGH_ENGINE_MATCH:  50,
  BLACK_VERY_HIGH_ENGINE_MATCH:  50,
  WHITE_HIGH_ENGINE_MATCH:       30,
  BLACK_HIGH_ENGINE_MATCH:       30,
  WHITE_PERFECT_ENGINE_ACCURACY: 20,
  BLACK_PERFECT_ENGINE_ACCURACY: 20,
  WHITE_HIGH_ENGINE_ACCURACY:    10,
  BLACK_HIGH_ENGINE_ACCURACY:    10,
  DISCONNECT_ABUSE:       10,
  REPEAT_PAIR:           20,
  ONE_SIDED_WINS:        35,
  FAST_RESIGN_PATTERN:   30,
  FAST_RESIGN:           15,
  MATERIAL_GIFT:         35,
  MULTI_ACCOUNT_IP:      40,
};

const ENFORCE_THRESHOLDS = {
  warn:    40,
  flag:    65,
  suspend: 90,
};

// ── Layer 1: Timing Analysis ───────────────────────────────────────────────

function analyzeMoveTimings(moveHistory) {
  const flags = [];
  let suspicionScore = 0;

  if (!moveHistory || moveHistory.length < TIMING_THRESHOLDS.minMoves) {
    return { suspicious: false, flags: [], score: 0 };
  }

  const moveTimes = [];
  for (let i = 1; i < moveHistory.length; i++) {
    const prev = moveHistory[i - 1];
    const curr = moveHistory[i];
    if (prev?.timestamp && curr?.timestamp) {
      const dt = (curr.timestamp - prev.timestamp) / 1000;
      if (dt > 0 && dt < 300) moveTimes.push(dt);
    }
  }

  if (moveTimes.length < 5) return { suspicious: false, flags: [], score: 0 };

  const avg      = moveTimes.reduce((a, b) => a + b, 0) / moveTimes.length;
  const variance = moveTimes.reduce((s, t) => s + Math.pow(t - avg, 2), 0) / moveTimes.length;
  const stdDev   = Math.sqrt(variance);
  const cv       = stdDev / avg;

  if (avg < TIMING_THRESHOLDS.avgMoveTimeMin) {
    flags.push('FAST_MOVES');
    suspicionScore += 40;
  }

  if (cv < TIMING_THRESHOLDS.consistencyMax && avg < 5) {
    flags.push('CONSISTENT_TIMING');
    suspicionScore += 35;
  }

  const ultraFastCount = moveTimes.filter(t => t < 1).length;
  if (ultraFastCount / moveTimes.length > 0.5) {
    flags.push('ULTRA_FAST_MOVES');
    suspicionScore += 30;
  }

  return {
    suspicious: suspicionScore >= 50,
    flags,
    score: suspicionScore,
    stats: { avg: avg.toFixed(2), stdDev: stdDev.toFixed(2), cv: cv.toFixed(2), samples: moveTimes.length },
  };
}

// ── Layer 2: Game Integrity Check ──────────────────────────────────────────

function validateGameIntegrity(moveHistory) {
  const chess = new Chess();
  const flags = [];

  for (const move of moveHistory) {
    try {
      const result = chess.move({ from: move.from, to: move.to, promotion: move.promotion });
      if (!result) {
        flags.push(`ILLEGAL_MOVE:${move.san}`);
        return { valid: false, flags };
      }
    } catch {
      flags.push(`INVALID_MOVE:${move.san}`);
      return { valid: false, flags };
    }
  }

  return { valid: true, flags };
}

// ── Layer 3: Accuracy analysis integration ────────────────────────────────

function buildAccuracyFlags(accuracyResult, timingAvg) {
  const flags = [];
  let score   = 0;

  if (!accuracyResult) return { flags, score };

  if (accuracyResult.blunderRate < 0.01 && timingAvg !== null && timingAvg < 5) {
    flags.push(`HIGH_ACCURACY_NO_TIME:blunder=${(accuracyResult.blunderRate * 100).toFixed(1)}%`);
    score += 20;
  }

  if (accuracyResult.blunders === 0 && accuracyResult.total >= 20) {
    flags.push(`PERFECT_NO_BLUNDER:moves=${accuracyResult.total}`);
    score += 25;
  }

  return { flags, score };
}

// ── Layer 4: ELO Anomaly Detection ────────────────────────────────────────

async function detectEloAnomaly(userId, { playerElo, opponentElo, result }) {
  const flags = [];
  let score   = 0;

  const eloGap = opponentElo - playerElo;
  if (result === 'win' && eloGap > 400) {
    const gapStr = `+${eloGap}`;
    flags.push(`ELO_GAP_WIN:${gapStr}`);
    score += eloGap > 600 ? 40 : 25;
  }

  try {
    const history = await eloHistory.getForUser(userId, 10);
    if (history.length >= 5) {
      const recentGain = history
        .slice(0, 5)
        .reduce((sum, h) => sum + (h.change || 0), 0);

      if (recentGain > 200) {
        flags.push(`RAPID_ELO_GAIN:+${recentGain}in5games`);
        score += recentGain > 300 ? 40 : 30;
      }

      const winsVsHigher = history.filter(h => h.change > 10).length;
      if (winsVsHigher >= 8 && history.length >= 10) {
        flags.push(`VERY_HIGH_WIN_RATE:${winsVsHigher}/10`);
        score += 20;
      }
    }
  } catch (e) {
    console.error('[ELO-ANOMALY] History query failed:', e.message);
  }

  return { suspicious: score >= 25, flags, score };
}

// ── Layer 5: Stockfish background analysis (async, non-blocking) ──────────

async function runStockfishBackground(gameId, moveHistory, existingFlags, io) {
  try {
    if (existingFlags.length === 0) return;

    const sfResult = await runStockfishComparison(moveHistory, {
      maxSamples: 15,
      depth: 12,
    });

    if (!sfResult || sfResult.flags.length === 0) return;

    console.log(`[Stockfish] Game ${gameId} — flags: ${sfResult.flags.join(', ')}`);

    const gameRes = await query('SELECT anticheat_flags, white_id, black_id FROM games WHERE id = $1', [gameId]);
    if (gameRes.rowCount > 0) {
      const gameData = gameRes.rows[0];
      const existingDbFlags = gameData.anticheat_flags || [];
      const newFlags = [
        ...existingDbFlags,
        { source: 'stockfish', flags: sfResult.flags, score: sfResult.suspicionScore },
      ];
      await query('UPDATE games SET anticheat_flags = $2 WHERE id = $1', [gameId, JSON.stringify(newFlags)]);

      for (const color of ['white', 'black']) {
        const colorFlags = sfResult.flags.filter(f => f.startsWith(color.toUpperCase()));
        if (colorFlags.length === 0) continue;

        const userId = color === 'white' ? gameData.white_id : gameData.black_id;
        await enforceAnticheat(userId, gameId, {
          flags: colorFlags,
          score: sfResult.suspicionScore,
        }, io);
      }
    }
  } catch (err) {
    console.error('[Stockfish:background]', err.message);
  }
}

// ── Main Analysis (sync, fast) ─────────────────────────────────────────────

function analyzeGame(game) {
  const results = {
    white: { suspicious: false, flags: [], score: 0 },
    black: { suspicious: false, flags: [], score: 0 },
  };

  const moves = game.move_history || game.moveHistory || [];
  if (!moves.length) return results;

  const integrity = validateGameIntegrity(moves);
  if (!integrity.valid) {
    for (const color of ['white', 'black']) {
      results[color].flags.push(...integrity.flags);
      results[color].score += 100;
      results[color].suspicious = true;
    }
    return results;
  }

  const whiteMoves = moves.filter((_, i) => i % 2 === 0);
  const blackMoves = moves.filter((_, i) => i % 2 === 1);

  const whiteTiming = analyzeMoveTimings(whiteMoves);
  const blackTiming = analyzeMoveTimings(blackMoves);
  const accuracy = analyzeAccuracy(moves);

  // White
  {
    const accFlags = accuracy.white
      ? buildAccuracyFlags(accuracy.white, parseFloat(whiteTiming.stats?.avg || '999'))
      : { flags: [], score: 0 };

    results.white = {
      suspicious: whiteTiming.suspicious || accFlags.score >= 20,
      flags: [...whiteTiming.flags, ...accFlags.flags],
      score: whiteTiming.score + accFlags.score,
      stats: { timing: whiteTiming.stats, accuracy: accuracy.white },
    };
  }

  // Black
  {
    const accFlags = accuracy.black
      ? buildAccuracyFlags(accuracy.black, parseFloat(blackTiming.stats?.avg || '999'))
      : { flags: [], score: 0 };

    results.black = {
      suspicious: blackTiming.suspicious || accFlags.score >= 20,
      flags: [...blackTiming.flags, ...accFlags.flags],
      score: blackTiming.score + accFlags.score,
      stats: { timing: blackTiming.stats, accuracy: accuracy.black },
    };
  }

  return results;
}

function analyzeRealtime(moveHistory) {
  if (!moveHistory || moveHistory.length < 6) {
    return { white: { suspicious: false, flags: [], score: 0 }, black: { suspicious: false, flags: [], score: 0 } };
  }
  const whiteMoves = moveHistory.filter((_, i) => i % 2 === 0);
  const blackMoves = moveHistory.filter((_, i) => i % 2 === 1);
  return {
    white: analyzeMoveTimings(whiteMoves),
    black: analyzeMoveTimings(blackMoves),
  };
}

function detectDisconnectAbuse(userId, disconnectHistory) {
  const recent = disconnectHistory.filter(d =>
    d.userId === userId && Date.now() - d.timestamp < 86400000
  );
  return {
    abusive: recent.length >= 3,
    count: recent.length,
    flags: recent.length >= 3 ? ['DISCONNECT_ABUSE'] : [],
  };
}

// ── Enforcement ────────────────────────────────────────────────────────────

async function enforceAnticheat(userId, gameId, result, io) {
  if (!result?.flags?.length) return;

  const { flags, score } = result;
  const penalty = flags.reduce((sum, flag) => {
    const baseFlag = flag.split(':')[0];
    return sum + (TRUST_PENALTY[baseFlag] || 5);
  }, 0);

  try {
    const userRes = await query('SELECT trust_score, flagged, username FROM users WHERE id = $1', [userId]);
    if (userRes.rowCount === 0) return;
    const userData = userRes.rows[0];

    const currentTrust = userData.trust_score ?? 100;
    const newTrust     = Math.max(0, currentTrust - penalty);

    let action  = 'warn';
    const updates = { trust_score: newTrust };

    if (score >= ENFORCE_THRESHOLDS.suspend && !userData.flagged) {
      action = 'suspend';
      updates.flagged        = true;
      updates.flagged_reason = `Auto-suspend: score ${score} — ${flags.join(', ')}`;
      updates.flagged_at     = new Date();
    } else if (score >= ENFORCE_THRESHOLDS.flag && !userData.flagged) {
      action = 'flag';
      updates.flagged        = true;
      updates.flagged_reason = `Auto-flag: score ${score} — ${flags.join(', ')}`;
      updates.flagged_at     = new Date();
    }

    const setClause = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
    await query(`UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = $1`, [userId, ...Object.values(updates)]);

    await logAnticheatAction({
      userId, gameId, action,
      reason: `flags: ${flags.join(', ')} | score: ${score} | penalty: -${penalty}`,
      flags,
      score,
    });

    if (io && (action === 'flag' || action === 'suspend')) {
      io.to(userId).emit('account:status', {
        action,
        trustScore: newTrust,
        message: action === 'suspend'
          ? '🚫 Akun Anda disuspend karena indikasi penggunaan engine. Hubungi support untuk banding.'
          : '⚠️ Akun Anda ditandai karena pola permainan mencurigakan dan sedang ditinjau.',
      });
    }
  } catch (err) {
    console.error('[ANTICHEAT] enforceAnticheat error:', err.message);
  }
}

module.exports = {
  analyzeGame,
  analyzeRealtime,
  analyzeMoveTimings,
  validateGameIntegrity,
  detectDisconnectAbuse,
  detectEloAnomaly,
  enforceAnticheat,
  runStockfishBackground,
};
