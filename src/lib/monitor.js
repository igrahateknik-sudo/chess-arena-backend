/**
 * Admin Review Queue Monitor — SLA Enforcement
 *
 * Memeriksa secara berkala apakah ada item di review queue yang
 * melebihi SLA threshold dan mengirim alert.
 */

const { query } = require('./db');
const nodemailer = require('nodemailer');

// ── Config ────────────────────────────────────────────────────────────────

const SLA_HOURS = {
  appeals:       48,
  collusion:     72,
  multiAccount:  72,
  suspended:     96,
};

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // setiap 1 jam

// ── Transporter Email (opsional) ──────────────────────────────────────────

let mailer = null;

function getMailer() {
  if (mailer) return mailer;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;

  mailer = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return mailer;
}

// ── Alert Sender ──────────────────────────────────────────────────────────

async function sendAlert(subject, body, urgency = 'normal') {
  const prefix = urgency === 'critical' ? '🚨 CRITICAL' : '⚠️  WARNING';
  const fullSubject = `[Chess Arena Admin] ${prefix}: ${subject}`;

  console.warn(`[MONITOR] ${fullSubject}`);
  console.warn(`[MONITOR] ${body}`);

  const transport = getMailer();
  if (transport && process.env.ADMIN_EMAIL) {
    try {
      await transport.sendMail({
        from:    `Chess Arena Monitor <${process.env.SMTP_USER}>`,
        to:      process.env.ADMIN_EMAIL,
        subject: fullSubject,
        text:    body,
        html:    `<pre style="font-family:monospace">${body}</pre>`,
      });
      console.log(`[MONITOR] Email alert sent to ${process.env.ADMIN_EMAIL}`);
    } catch (e) {
      console.error('[MONITOR] Email send failed:', e.message);
    }
  }

  if (process.env.MONITOR_WEBHOOK_URL) {
    try {
      const payload = {
        text:    `*${fullSubject}*\n\`\`\`${body}\`\`\``,
        embeds:  [{ title: fullSubject, description: body, color: urgency === 'critical' ? 0xff0000 : 0xffa500 }],
      };
      await fetch(process.env.MONITOR_WEBHOOK_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      console.log('[MONITOR] Webhook alert sent');
    } catch (e) {
      console.error('[MONITOR] Webhook send failed:', e.message);
    }
  }
}

// ── Queue Health Check ────────────────────────────────────────────────────

async function checkQueueHealth() {
  const now       = new Date();
  const alerts    = [];
  const report    = {};

  // ── Appeals ──
  try {
    const slaThreshold = new Date(now - SLA_HOURS.appeals * 3600000);
    
    const overdueRes = await query(`
      SELECT a.id, a.created_at, u.username 
      FROM appeals a
      JOIN users u ON a.user_id = u.id
      WHERE a.status = 'pending' AND a.created_at < $1
    `, [slaThreshold]);

    const totalRes = await query(`
      SELECT COUNT(*) as count FROM appeals WHERE status = 'pending'
    `);

    const overdueCount = overdueRes.rowCount;
    const totalCount = parseInt(totalRes.rows[0].count);

    report.appeals = {
      pending:       totalCount,
      overdueSla:    overdueCount,
      slaHours:      SLA_HOURS.appeals,
      healthy:       overdueCount === 0,
    };

    if (overdueCount > 0) {
      const usernames = overdueRes.rows.map(a => a.username || 'unknown').join(', ');
      alerts.push({
        urgency: overdueCount >= 5 ? 'critical' : 'normal',
        subject: `${overdueCount} appeal(s) past ${SLA_HOURS.appeals}h SLA`,
        body:    `${overdueCount} appeal(s) are overdue for review (>${SLA_HOURS.appeals}h pending).\nUsers: ${usernames}\n\nReview at: ${process.env.FRONTEND_URL}/admin`,
      });
    }
  } catch (e) {
    console.error('[MONITOR] Appeals check failed:', e.message);
    report.appeals = { error: e.message };
  }

  // ── Collusion Flags ──
  try {
    const slaThreshold = new Date(now - SLA_HOURS.collusion * 3600000);
    
    const overdueRes = await query(`
      SELECT COUNT(*) as count FROM collusion_flags 
      WHERE reviewed = false AND detected_at < $1
    `, [slaThreshold]);

    const totalRes = await query(`
      SELECT COUNT(*) as count FROM collusion_flags WHERE reviewed = false
    `);

    const overdueCount = parseInt(overdueRes.rows[0].count);
    const totalCount = parseInt(totalRes.rows[0].count);

    report.collusionFlags = {
      unreviewed:  totalCount,
      overdueSla:  overdueCount,
      slaHours:    SLA_HOURS.collusion,
      healthy:     overdueCount === 0,
    };

    if (overdueCount > 0) {
      alerts.push({
        urgency: 'normal',
        subject: `${overdueCount} collusion flag(s) past ${SLA_HOURS.collusion}h SLA`,
        body:    `${overdueCount} collusion investigation(s) need review.\nReview at: ${process.env.FRONTEND_URL}/admin`,
      });
    }
  } catch (e) {
    console.error('[MONITOR] Collusion check failed:', e.message);
    report.collusionFlags = { error: e.message };
  }

  // ── Multi-Account Flags ──
  try {
    const slaThreshold = new Date(now - SLA_HOURS.multiAccount * 3600000);
    
    const overdueRes = await query(`
      SELECT COUNT(*) as count FROM multi_account_flags 
      WHERE reviewed = false AND detected_at < $1
    `, [slaThreshold]);

    const totalRes = await query(`
      SELECT COUNT(*) as count FROM multi_account_flags WHERE reviewed = false
    `);

    const overdueCount = parseInt(overdueRes.rows[0].count);
    const totalCount = parseInt(totalRes.rows[0].count);

    report.multiAccountFlags = {
      unreviewed:  totalCount,
      overdueSla:  overdueCount,
      slaHours:    SLA_HOURS.multiAccount,
      healthy:     overdueCount === 0,
    };

    if (overdueCount > 0) {
      alerts.push({
        urgency: 'normal',
        subject: `${overdueCount} multi-account flag(s) past ${SLA_HOURS.multiAccount}h SLA`,
        body:    `${overdueCount} multi-account case(s) need review.\nReview at: ${process.env.FRONTEND_URL}/admin`,
      });
    }
  } catch (e) {
    console.error('[MONITOR] Multi-account check failed:', e.message);
    report.multiAccountFlags = { error: e.message };
  }

  // ── Long-Suspended Users ──
  try {
    const slaThreshold = new Date(now - SLA_HOURS.suspended * 3600000);
    
    const res = await query(`
      SELECT COUNT(*) as count FROM users 
      WHERE flagged = true AND flagged_at < $1
    `, [slaThreshold]);

    const longSuspended = parseInt(res.rows[0].count);

    report.longSuspended = {
      count:    longSuspended,
      slaHours: SLA_HOURS.suspended,
      healthy:  longSuspended === 0,
    };

    if (longSuspended > 0) {
      alerts.push({
        urgency: longSuspended >= 3 ? 'critical' : 'normal',
        subject: `${longSuspended} user(s) suspended for >${SLA_HOURS.suspended}h without resolution`,
        body:    `${longSuspended} account(s) have been suspended for over ${SLA_HOURS.suspended} hours.\nPlease review or close these cases.\nAdmin panel: ${process.env.FRONTEND_URL}/admin`,
      });
    }
  } catch (e) {
    console.error('[MONITOR] Suspended check failed:', e.message);
    report.longSuspended = { error: e.message };
  }

  report.checkedAt    = now.toISOString();
  report.totalAlerts  = alerts.length;
  report.healthy      = alerts.length === 0;

  return { report, alerts };
}

// ── Interval Runner ───────────────────────────────────────────────────────

let monitorInterval = null;

async function runMonitorCycle() {
  try {
    const { report, alerts } = await checkQueueHealth();

    if (alerts.length === 0) {
      console.log(`[MONITOR] Queue health OK — ${new Date().toISOString()}`);
    } else {
      console.warn(`[MONITOR] ${alerts.length} alert(s) found`);
      for (const alert of alerts) {
        await sendAlert(alert.subject, alert.body, alert.urgency);
      }
    }

    return report;
  } catch (err) {
    console.error('[MONITOR] Cycle error:', err.message);
  }
}

function startMonitor() {
  if (monitorInterval) return;

  console.log(`[MONITOR] Starting queue health monitor (interval: ${CHECK_INTERVAL_MS / 60000}m)`);
  setTimeout(runMonitorCycle, 30_000);
  monitorInterval = setInterval(runMonitorCycle, CHECK_INTERVAL_MS);
  if (monitorInterval.unref) monitorInterval.unref();
}

function stopMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

module.exports = { startMonitor, stopMonitor, checkQueueHealth, runMonitorCycle };
