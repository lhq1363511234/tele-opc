import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config/index.js';
import type { Repositories } from '../db/repositories.js';
import type { PaymentQrCodeRecord, PaymentRequestRecord } from '../types.js';
import { ApprovalService } from '../approvals/service.js';

const MAX_QR_IMAGE_BYTES = 5 * 1024 * 1024;
const PAYMENT_UPLOAD_DIR = path.resolve(process.cwd(), 'runtime', 'uploads', 'payment-qr');

const qrUploadSchema = z.object({
  label: z.string().trim().min(1).max(80),
  provider: z.string().trim().min(1).max(40).default('other'),
  currency: z.string().trim().min(2).max(8).default('CNY'),
  imageDataUrl: z.string().min(32),
  isDefault: z.boolean().optional(),
  notes: z.string().trim().max(500).optional()
});

const paymentRequestSchema = z.object({
  qrCodeId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  customerName: z.string().trim().max(120).optional(),
  customerContact: z.string().trim().max(160).optional(),
  amount: z.coerce.number().positive().max(10_000_000),
  currency: z.string().trim().min(2).max(8).default('CNY'),
  dueAt: z.string().trim().max(80).optional()
});

const paymentClaimSchema = z.object({
  payerName: z.string().trim().max(120).optional(),
  payerContact: z.string().trim().max(160).optional(),
  note: z.string().trim().max(500).optional()
});

const paymentDecisionSchema = z.object({
  decision: z.enum(['paid', 'cancelled']),
  note: z.string().trim().max(500).optional()
});

export function registerPaymentRoutes(
  app: FastifyInstance<any, any, any, any>,
  config: AppConfig,
  repos: Repositories,
  allowWebConsoleAccess: any
) {
  const approvalService = new ApprovalService(config, repos);

  app.get('/api/web/payments', { preHandler: allowWebConsoleAccess }, async () => {
    const dashboard = await repos.getPaymentCollectionDashboard();
    return {
      ok: true,
      dashboard: {
        ...dashboard,
        qrCodes: dashboard.qrCodes.map((qr) => paymentQrView(qr)),
        requests: dashboard.requests.map((request) => paymentRequestView(request, config))
      },
      modes: [
        {
          id: 'newapi',
          label: 'NewAPI 自动收款通道',
          status: 'detected',
          note: '已在 NewAPI 侧检测到支付/充值相关配置。本系统不读取或展示密钥。'
        },
        {
          id: 'payment_qr',
          label: '收款码人工确认',
          status: 'active',
          note: '适合先快速收钱：客户扫码付款，系统记录收款单，你核对到账后一键入账。'
        }
      ]
    };
  });

  app.post<{ Body: unknown }>(
    '/api/web/payments/qr-codes',
    { preHandler: allowWebConsoleAccess, bodyLimit: MAX_QR_IMAGE_BYTES * 2 },
    async (request, reply) => {
      const parsed = qrUploadSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: 'invalid_qr_upload', issues: parsed.error.issues };
      }

      const decoded = decodeImageDataUrl(parsed.data.imageDataUrl);
      if (!decoded.ok) {
        reply.code(400);
        return { ok: false, error: decoded.error };
      }

      await fs.mkdir(PAYMENT_UPLOAD_DIR, { recursive: true });
      const filename = `${Date.now()}-${safeFilename(parsed.data.label)}.${decoded.extension}`;
      const absolutePath = path.join(PAYMENT_UPLOAD_DIR, filename);
      await fs.writeFile(absolutePath, decoded.bytes);
      const relativePath = path.relative(process.cwd(), absolutePath);

      const qrCode = await repos.createPaymentQrCode({
        label: parsed.data.label,
        provider: parsed.data.provider,
        currency: parsed.data.currency.toUpperCase(),
        imagePath: relativePath,
        imageMime: decoded.mime,
        imageSizeBytes: decoded.bytes.length,
        isDefault: parsed.data.isDefault,
        notes: parsed.data.notes,
        metadata: { source: 'web_payment_qr_upload' }
      });

      return { ok: true, qrCode: paymentQrView(qrCode) };
    }
  );

  app.post<{ Body: unknown }>(
    '/api/web/payments/requests',
    { preHandler: allowWebConsoleAccess },
    async (request, reply) => {
      const parsed = paymentRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: 'invalid_payment_request', issues: parsed.error.issues };
      }

      const qrCode = parsed.data.qrCodeId
        ? await repos.getPaymentQrCode(parsed.data.qrCodeId)
        : await repos.getDefaultPaymentQrCode();
      if (!qrCode || qrCode.status !== 'active') {
        reply.code(409);
        return {
          ok: false,
          error: 'payment_qr_required',
          message: '请先上传一个可用收款码，再创建收款页。'
        };
      }

      const dueAt = normalizeOptionalDate(parsed.data.dueAt);
      const paymentRequest = await repos.createPaymentRequest({
        qrCodeId: qrCode.id,
        title: parsed.data.title,
        description: parsed.data.description,
        customerName: parsed.data.customerName,
        customerContact: parsed.data.customerContact,
        amount: parsed.data.amount,
        currency: parsed.data.currency.toUpperCase(),
        dueAt,
        metadata: { source: 'web_payment_request_creator' }
      });

      await repos.audit({
        actorType: 'web_console',
        action: 'payment_request_created',
        entityType: 'payment_request',
        entityId: paymentRequest.id,
        metadata: {
          amount: paymentRequest.amount,
          currency: paymentRequest.currency,
          qrCodeId: qrCode.id,
          invoiceId: paymentRequest.invoice_id
        }
      });

      return { ok: true, request: paymentRequestView(paymentRequest, config) };
    }
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/web/payments/requests/:id/decision',
    { preHandler: allowWebConsoleAccess },
    async (request, reply) => {
      const parsed = paymentDecisionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: 'invalid_payment_decision', issues: parsed.error.issues };
      }

      if (parsed.data.decision === 'cancelled') {
        const cancelled = await repos.cancelPaymentRequest(request.params.id, parsed.data.note);
        if (!cancelled) {
          reply.code(404);
          return { ok: false, error: 'payment_request_not_found_or_paid' };
        }
        await repos.audit({
          actorType: 'web_console',
          action: 'payment_request_cancelled',
          entityType: 'payment_request',
          entityId: cancelled.id,
          metadata: { note: parsed.data.note ?? null }
        });
        return { ok: true, request: paymentRequestView(cancelled, config) };
      }

      const confirmed = await repos.confirmPaymentRequestPaid(request.params.id, {
        confirmedBy: 'web_console',
        note: parsed.data.note
      });
      if (!confirmed) {
        reply.code(404);
        return { ok: false, error: 'payment_request_not_found' };
      }
      await repos.audit({
        actorType: 'web_console',
        action: 'payment_request_confirmed_paid',
        entityType: 'payment_request',
        entityId: confirmed.request.id,
        metadata: {
          transactionId: confirmed.transactionId,
          note: parsed.data.note ?? null
        }
      });
      return {
        ok: true,
        request: paymentRequestView(confirmed.request, config),
        transactionId: confirmed.transactionId
      };
    }
  );

  app.get<{ Params: { shortCode: string } }>('/pay/:shortCode/qr', async (request, reply) => {
    const paymentRequest = await repos.getPaymentRequestByShortCode(request.params.shortCode);
    if (!paymentRequest?.qr_code_id || paymentRequest.status === 'cancelled') {
      reply.code(404);
      return { ok: false, error: 'payment_request_not_found' };
    }
    const qrCode = await repos.getPaymentQrCode(paymentRequest.qr_code_id);
    if (!qrCode) {
      reply.code(404);
      return { ok: false, error: 'payment_qr_not_found' };
    }
    return serveQrImage(qrCode, reply);
  });

  app.get<{ Params: { id: string } }>('/pay/assets/qr/:id', async (request, reply) => {
    const qrCode = await repos.getPaymentQrCode(request.params.id);
    if (!qrCode || qrCode.status !== 'active') {
      reply.code(404);
      return { ok: false, error: 'payment_qr_not_found' };
    }
    return serveQrImage(qrCode, reply);
  });

  app.post<{ Params: { shortCode: string }; Body: unknown }>('/api/pay/:shortCode/claim-paid', async (request, reply) => {
    const parsed = paymentClaimSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_payment_claim', issues: parsed.error.issues };
    }
    const paymentRequest = await repos.markPaymentRequestClaimed(request.params.shortCode, {
      payerName: parsed.data.payerName,
      payerContact: parsed.data.payerContact,
      payerNote: parsed.data.note,
      metadata: { claimedFrom: 'public_payment_page' }
    });
    if (!paymentRequest) {
      reply.code(404);
      return { ok: false, error: 'payment_request_not_found' };
    }
    if (paymentRequest.status === 'cancelled') {
      reply.code(409);
      return { ok: false, error: 'payment_request_cancelled', message: '这张收款页已取消，请联系收款方。' };
    }
    const approvalNotification = paymentRequest.status === 'paid'
      ? { ok: false, skipped: true, reason: 'already_paid' }
      : await createOrNotifyPaymentConfirmationApproval(approvalService, repos, paymentRequest, config);
    return {
      ok: true,
      status: paymentRequest.status,
      message: paymentRequest.status === 'paid'
        ? '这笔收款已经确认到账。'
        : '已提交到账确认，请等待收款方在飞书或 ClawBot 微信里审核。',
      approvalNotification
    };
  });

  app.get<{ Params: { shortCode: string } }>('/pay/:shortCode', async (request, reply) => {
    const paymentRequest = await repos.getPaymentRequestByShortCode(request.params.shortCode);
    if (!paymentRequest || paymentRequest.status === 'cancelled') {
      reply.code(404).type('text/html; charset=utf-8');
      return reply.send(publicNotFoundHtml());
    }
    reply.type('text/html; charset=utf-8');
    return reply.send(publicPaymentHtml(paymentRequest, config));
  });
}

function paymentQrView(qr: PaymentQrCodeRecord) {
  return {
    ...qr,
    imageUrl: `/pay/assets/qr/${encodeURIComponent(qr.id)}`
  };
}

function paymentRequestView(request: PaymentRequestRecord, config: AppConfig) {
  return {
    ...request,
    amountNumber: Number(request.amount),
    paymentUrl: publicUrl(config, `/pay/${encodeURIComponent(request.short_code)}`)
  };
}

function decodeImageDataUrl(input: string):
  | { ok: true; mime: string; extension: string; bytes: Buffer }
  | { ok: false; error: string } {
  const match = input.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return { ok: false, error: 'invalid_image_data_url' };
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (bytes.length <= 0) return { ok: false, error: 'empty_image' };
  if (bytes.length > MAX_QR_IMAGE_BYTES) return { ok: false, error: 'image_too_large' };
  if (!looksLikeAllowedImage(bytes, mime)) return { ok: false, error: 'unsupported_or_invalid_image' };
  return { ok: true, mime, extension: extensionForMime(mime), bytes };
}

function looksLikeAllowedImage(bytes: Buffer, mime: string) {
  if (mime === 'image/png') {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mime === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8;
  }
  if (mime === 'image/webp') {
    return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function extensionForMime(mime: string) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

async function serveQrImage(qrCode: PaymentQrCodeRecord, reply: FastifyReply) {
  const absolutePath = path.resolve(process.cwd(), qrCode.image_path);
  if (!absolutePath.startsWith(PAYMENT_UPLOAD_DIR + path.sep)) {
    reply.code(403);
    return { ok: false, error: 'invalid_image_path' };
  }
  try {
    const bytes = await fs.readFile(absolutePath);
    reply
      .type(qrCode.image_mime)
      .header('cache-control', 'private, max-age=300')
      .send(bytes);
  } catch {
    reply.code(404);
    return { ok: false, error: 'payment_qr_image_not_found' };
  }
}

function safeFilename(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'payment-qr';
}

function normalizeOptionalDate(value?: string) {
  if (!value) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  return new Date(time).toISOString();
}

async function createOrNotifyPaymentConfirmationApproval(
  approvalService: ApprovalService,
  repos: Repositories,
  paymentRequest: PaymentRequestRecord,
  config: AppConfig
) {
  let approval = await repos.findPendingPaymentConfirmationApproval(paymentRequest.id);
  if (!approval) {
    const result = await approvalService.request({
      actionType: 'payment_received_confirmation',
      riskLevel: 'high',
      prompt: '客户声明已付款，请核对微信/银行/收款平台是否真的到账；批准后才写入收入流水。',
      payload: {
        paymentRequestId: paymentRequest.id,
        paymentTitle: paymentRequest.title,
        amount: paymentRequest.amount,
        currency: paymentRequest.currency,
        customerName: paymentRequest.customer_name,
        payerName: paymentRequest.payer_name,
        payerContact: paymentRequest.payer_contact,
        payerNote: paymentRequest.payer_note,
        paymentUrl: publicUrl(config, `/pay/${encodeURIComponent(paymentRequest.short_code)}`)
      }
    });
    return result.notifications;
  }
  return await approvalService.notify(approval);
}

function publicPaymentHtml(paymentRequest: PaymentRequestRecord, config: AppConfig) {
  const title = escapeHtml(paymentRequest.title);
  const amount = escapeHtml(formatAmount(paymentRequest.amount, paymentRequest.currency));
  const description = escapeHtml(paymentRequest.description ?? '请扫码付款，付款后点击下方“我已支付”。');
  const customer = escapeHtml(paymentRequest.customer_name ?? '客户');
  const qrUrl = `/pay/${encodeURIComponent(paymentRequest.short_code)}/qr`;
  const claimUrl = `/api/pay/${encodeURIComponent(paymentRequest.short_code)}/claim-paid`;
  const statusText = paymentRequest.status === 'paid'
    ? '已确认到账'
    : paymentRequest.status === 'claimed_paid'
      ? '等待收款方核对到账'
      : '等待付款';
  const publicBase = escapeHtml(config.app.publicBaseUrl.replace(/\/$/, ''));

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · 收款</title>
  <style>
    :root { color-scheme: light; --ink:#151f1b; --muted:#66736c; --line:#dfe5dc; --accent:#177e72; --bg:#f4f6f1; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, rgba(23,126,114,.16), transparent 32rem), var(--bg); color:var(--ink); }
    main { width:min(520px,100%); border:1px solid var(--line); border-radius:20px; background:rgba(255,255,255,.92); box-shadow:0 24px 60px rgba(21,31,27,.12); overflow:hidden; }
    header { padding:24px 24px 18px; border-bottom:1px solid var(--line); }
    .eyebrow { display:inline-flex; border-radius:999px; background:#e8f5f1; color:#17695f; padding:6px 10px; font-size:12px; font-weight:800; }
    h1 { margin:16px 0 6px; font-size:26px; line-height:1.15; }
    .amount { font-size:42px; font-weight:900; letter-spacing:-.04em; }
    .muted { color:var(--muted); line-height:1.6; }
    section { padding:20px 24px 24px; display:grid; gap:16px; }
    .qrbox { display:grid; place-items:center; border:1px dashed #b8c6bf; border-radius:18px; background:#fbfcf8; padding:18px; }
    .qrbox img { width:min(320px, 82vw); height:auto; border-radius:14px; background:white; }
    input, textarea { width:100%; border:1px solid var(--line); border-radius:12px; padding:12px; font:inherit; background:#fbfcf8; }
    label { display:grid; gap:7px; color:var(--muted); font-size:13px; font-weight:700; }
    button { min-height:46px; border:0; border-radius:12px; background:var(--ink); color:#fff; font:inherit; font-weight:900; cursor:pointer; }
    button[disabled] { opacity:.58; cursor:not-allowed; }
    .notice { border:1px solid #d9eadf; border-radius:14px; background:#edf8f1; color:#24663d; padding:12px; line-height:1.55; }
    .status { display:flex; justify-content:space-between; gap:10px; color:var(--muted); font-size:13px; }
    .footer { padding:0 24px 22px; color:#8a968f; font-size:12px; line-height:1.55; }
  </style>
</head>
<body>
  <main>
    <header>
      <span class="eyebrow">Tele-OPC 收款页</span>
      <h1>${title}</h1>
      <div class="amount">${amount}</div>
      <p class="muted">${description}</p>
      <div class="status"><span>付款人：${customer}</span><span id="status">${escapeHtml(statusText)}</span></div>
    </header>
    <section>
      <div class="qrbox"><img alt="收款二维码" src="${qrUrl}" /></div>
      <label>付款人姓名/备注
        <input id="payerName" placeholder="可选：你的姓名或公司名" autocomplete="name" />
      </label>
      <label>联系方式
        <input id="payerContact" placeholder="可选：微信/手机号/邮箱" autocomplete="email" />
      </label>
      <label>付款备注
        <textarea id="note" rows="3" placeholder="可选：填写付款截图编号、订单备注"></textarea>
      </label>
      <button id="claimButton" ${paymentRequest.status === 'paid' ? 'disabled' : ''}>我已支付，通知收款方核对</button>
      <div id="result" class="notice" hidden></div>
    </section>
    <div class="footer">安全提示：这是人工确认收款页，不会自动扣款。请核对域名 ${publicBase}。</div>
  </main>
  <script>
    const button = document.getElementById('claimButton');
    const result = document.getElementById('result');
    button?.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = '正在通知…';
      try {
        const res = await fetch('${claimUrl}', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            payerName: document.getElementById('payerName').value,
            payerContact: document.getElementById('payerContact').value,
            note: document.getElementById('note').value
          })
        });
        const data = await res.json();
        result.hidden = false;
        result.textContent = data.message || (data.ok ? '已通知收款方。' : '提交失败，请联系收款方。');
        document.getElementById('status').textContent = data.status === 'paid' ? '已确认到账' : '等待收款方核对到账';
      } catch {
        result.hidden = false;
        result.textContent = '网络异常，请截图保存付款记录后联系收款方。';
        button.disabled = false;
      } finally {
        if (button.disabled) button.textContent = '已通知，等待核对';
      }
    });
  </script>
</body>
</html>`;
}

function publicNotFoundHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>收款页不存在</title></head><body style="font-family:system-ui;padding:24px;background:#f4f6f1;color:#16201b"><h1>收款页不存在或已取消</h1><p>请联系收款方重新发送链接。</p></body></html>`;
}

function formatAmount(amount: string, currency: string) {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${Number.isFinite(value) ? value.toFixed(2) : amount} ${currency}`;
  }
}

function publicUrl(config: AppConfig, route: string) {
  return `${config.app.publicBaseUrl.replace(/\/$/, '')}${route}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
