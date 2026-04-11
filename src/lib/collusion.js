/**
 * Collusion Detection — Match-Fixing & Material Gifting
 */

const { Chess } = require('chess.js');
const { query } = require('./db');

// Nilai bidak (centipawn)
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// ── Helpers ────────────────────────────────────────────────────────────────

function countMaterial(chess) {
  const board = chess.board();
  const scores = { w: 0, b: 0 };
  for (const row of board) {
    for (const sq of row) {
      if (sq) scores[sq.color] += PIECE_VALUES[sq.type] || 0;
    }
  }
  return scores;
}

// ── Detector 1: Repeat Pair ────────────────────────────────────────────────

async function detectRepeatPair(userAId, userBId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  try {
    const res = await query(`
      SELECT id, winner, ended_at, move_history, white_id, black_id
      FROM games
      WHERE ((white_id = $1 AND black_id = $2) OR (white_id = $2 AND black_id = $1))
        AND status = 'finished'
        AND ended_at >= $3
      ORDER BY ended_at DESC
    `, [userAId, userBId, thirtyDaysAgo]);

    const data = res.rows;
    if (data.length < 5) return { flags: [], score: 0 };

    const gameCount = data.length;
    let aWins = 0, bWins = 0, draws = 0;
    for (const g of data) {
      const aIsWhite = g.white_id === userAId;
      if (g.winner === 'draw') { draws++; continue; }
      const aWon = (g.winner === 'white' && aIsWhite) || (g.winner === 'black' && !aIsWhite);
      if (aWon) aWins++; else bWins++;
    }

    const flags = [];
    let score = 0;

    if (gameCount > 15) {
      flags.push(`REPEAT_PAIR:${gameCount}games`);
      score += gameCount > 25 ? 35 : 20;
    } else if (gameCount > 10) {
      flags.push(`REPEAT_PAIR:${gameCount}games`);
      score += 15;
    }

    const total = aWins + bWins + draws;
    const aWinRate = total > 0 ? aWins / total : 0;
    const bWinRate = total > 0 ? bWins / total : 0;

    if (aWinRate >= 0.80 && total >= 8) {
      flags.push(`ONE_SIDED_WINS:A_wins_${Math.round(aWinRate * 100)}%`);
      score += aWinRate >= 0.90 ? 40 : 25;
    } else if (bWinRate >= 0.80 && total >= 8) {
      flags.push(`ONE_SIDED_WINS:B_wins_${Math.round(bWinRate * 100)}%`);
      score += bWinRate >= 0.90 ? 40 : 25;
    }

    const shortGames = data.filter(g => {
      const moves = g.move_history || [];
      return moves.length <= 8;
    });

    if (shortGames.length >= 3 && shortGames.length / gameCount >= 0.3) {
      flags.push(`FAST_RESIGN_PATTERN:${shortGames.length}of${gameCount}`);
      score += 30;
    }

    return { flags, score, stats: { gameCount, aWins, bWins, draws } };
  } catch (e) {
    console.error('[Collusion:detectRepeatPair]', e.message);
    return { flags: [], score: 0 };
  }
}

// ── Detector 2: Material Gifting ────────────────────────────────────────────

function detectMaterialGifting(moveHistory) {
  if (!moveHistory || moveHistory.length < 6) return { flags: [], score: 0 };

  const chess = new Chess();
  const gifts = { white: [], black: [] };

  for (let i = 0; i < moveHistory.length; i++) {
    const m = moveHistory[i];
    const color = i % 2 === 0 ? 'white' : 'black';
    const colorChar = i % 2 === 0 ? 'w' : 'b';

    const matBefore = countMaterial(chess);

    let result;
    try {
      result = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch { break; }
    if (!result) break;

    const matAfter = countMaterial(chess);
    const ownDelta = matAfter[colorChar] - matBefore[colorChar];
    if (ownDelta <= -300 && !result.captured) {
      gifts[color].push({
        move: i,
        san: result.san,
        drop: -ownDelta,
      });
    }
  }

  const flags = [];
  let score = 0;

  for (const color of ['white', 'black']) {
    if (gifts[color].length >= 2) {
      flags.push(`MATERIAL_GIFT:${color.toUpperCase()}:${gifts[color].length}times`);
      score += gifts[color].length >= 3 ? 40 : 25;
    }
  }

  return { flags, score, gifts };
}

// ── Main: runCollusionDetection ────────────────────────────────────────────

async function runCollusionDetection(gameId, whiteId, blackId, moveHistory, winner, endReason) {
  try {
    console.log(`[Collusion] Analyzing game ${gameId}...`);

    const pairResult = await detectRepeatPair(whiteId, blackId);
    const giftResult = detectMaterialGifting(moveHistory);
    const currentGameShort = moveHistory.length <= 8 && endReason === 'resign';

    const combined = {
      white: {
        flags: [
          ...pairResult.flags,
          ...giftResult.flags.filter(f => f.includes('WHITE')),
          ...(currentGameShort ? ['FAST_RESIGN:current_game'] : []),
        ],
        score: pairResult.score + giftResult.flags.filter(f => f.includes('WHITE')).length * 20,
      },
      black: {
        flags: [
          ...pairResult.flags,
          ...giftResult.flags.filter(f => f.includes('BLACK')),
          ...(currentGameShort ? ['FAST_RESIGN:current_game'] : []),
        ],
        score: pairResult.score + giftResult.flags.filter(f => f.includes('BLACK')).length * 20,
      },
    };

    combined.white.suspicious = combined.white.score >= 25;
    combined.black.suspicious = combined.black.score >= 25;

    if (pairResult.flags.length > 0 || giftResult.flags.length > 0) {
      console.warn('[Collusion] Suspicious patterns detected:', {
        gameId, pairFlags: pairResult.flags, giftFlags: giftResult.flags,
        stats: pairResult.stats,
      });

      const userA = whiteId < blackId ? whiteId : blackId;
      const userB = whiteId < blackId ? blackId : whiteId;

      await query(`
        INSERT INTO collusion_flags (game_id, user_id_a, user_id_b, pair_flags, gift_flags, pair_score, pair_stats, detected_at, reviewed)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), false)
      `, [
        gameId, userA, userB, 
        JSON.stringify(pairResult.flags), 
        JSON.stringify(giftResult.flags), 
        pairResult.score, 
        pairResult.stats ? JSON.stringify(pairResult.stats) : null
      ]).catch(e => console.error('[Collusion] DB insert failed:', e.message));
    }

    return combined;
  } catch (err) {
    console.error('[Collusion] runCollusionDetection error:', err.message);
    return {
      white: { flags: [], score: 0, suspicious: false },
      black: { flags: [], score: 0, suspicious: false },
    };
  }
}

module.exports = { runCollusionDetection, detectMaterialGifting, detectRepeatPair };
