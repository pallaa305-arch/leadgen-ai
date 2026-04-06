import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { Resend } from 'resend';
import Stripe from 'stripe';
import twilio from 'twilio';
import type { Request, Response } from 'express';
import type { AIAgentConfig, Lead } from '../src/types';
import { config, isPublicCallbackUrl, requireConfig } from './config';
import { adminAuth, adminDb, FieldValue, leadDoc } from './firebaseAdmin';
import {
  chatWithAgencyAssistant,
  findLeadsWithAI,
  generateAIAgentEmbed,
  generateCallOpening,
  generateCallReply,
  generateDeepAnalysisText,
  generateFollowUpEmailText,
  generateOutreachEmailDraft,
  generateSpeechWithAI,
  generateWebsiteHtml,
  summarizeCallTranscript,
  transcribeAudioWithAI,
} from './ai';

declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        email?: string;
        name?: string;
      };
    }
  }
}

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;
const stripe = config.stripeSecretKey
  ? new Stripe(config.stripeSecretKey, { apiVersion: '2026-03-25.dahlia' })
  : null;
const twilioClient =
  config.twilioAccountSid && config.twilioAuthToken
    ? twilio(config.twilioAccountSid, config.twilioAuthToken)
    : null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    res.status(500).send('Stripe is not configured.');
    return;
  }

  try {
    requireConfig('stripeWebhookSecret');
    const signature = req.headers['stripe-signature'];
    if (!signature || Array.isArray(signature)) {
      res.status(400).send('Missing Stripe signature.');
      return;
    }

    const event = stripe.webhooks.constructEvent(req.body, signature, config.stripeWebhookSecret);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const uid = session.metadata?.uid;
      const leadId = session.metadata?.leadId;

      if (uid && leadId) {
        const ref = leadDoc(uid, leadId);
        const snap = await ref.get();
        const lead = snap.data() as Lead | undefined;

        if (lead) {
          const invoiceText = buildInvoiceText(lead, session);
          const invoiceSubject = `Payment received for ${lead.name}`;

          let invoiceMessageId: string | undefined;
          if (lead.email) {
            const result = await sendEmail({
              to: lead.email,
              subject: invoiceSubject,
              text: invoiceText,
              replyTo: config.agencyReplyToEmail || undefined,
            });
            invoiceMessageId = result?.data?.id || undefined;
          }

          await ref.set(
            {
              status: 'DELIVERED',
              paymentStatus: 'PAID',
              paymentMethod: 'Stripe Checkout',
              paymentAmount: (session.amount_total || 0) / 100,
              transactionId: String(session.payment_intent || session.id),
              stripeCheckoutSessionId: session.id,
              stripePaymentIntentId: String(session.payment_intent || ''),
              checkoutUrl: session.url || null,
              invoiceEmail: invoiceText,
              invoiceSubject,
              invoiceMessageId: invoiceMessageId || null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('Stripe webhook error', error);
    res.status(400).send(error.message || 'Webhook failed.');
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/calls/twiml', async (req, res) => {
  const uid = String(req.query.uid || '');
  const leadId = String(req.query.leadId || '');

  if (!uid || !leadId) {
    res.status(400).send('Missing lead context.');
    return;
  }

  const ref = leadDoc(uid, leadId);
  const snap = await ref.get();
  const lead = snap.data() as Lead | undefined;

  if (!lead) {
    res.status(404).send('Lead not found.');
    return;
  }

  if (config.elevenlabsAgentId) {
    const transcript = lead.callTranscript ? lead.callTranscript : 'Call connected to ElevenLabs AI Agent.';
    await ref.set(
      {
        callTranscript: transcript,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${config.elevenlabsAgentId}${config.elevenlabsApiKey ? `&amp;xi-api-key=${config.elevenlabsApiKey}` : ''}" />
  </Connect>
</Response>`);
    return;
  }

  const opening = lead.callOpeningScript || (await generateCallOpening(lead));
  const transcript = lead.callTranscript ? lead.callTranscript : `Alex: ${opening}`;

  await ref.set(
    {
      callOpeningScript: opening,
      callTranscript: transcript,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const gatherUrl = `${config.serverBaseUrl}/api/calls/respond?uid=${encodeURIComponent(uid)}&leadId=${encodeURIComponent(leadId)}&turn=1`;
  res.type('text/xml').send(buildGatherTwiml(opening, gatherUrl));
});

app.post('/api/calls/respond', async (req, res) => {
  const uid = String(req.query.uid || '');
  const leadId = String(req.query.leadId || '');
  const turn = Number(req.query.turn || 1);
  const speechResult = String(req.body.SpeechResult || '').trim();

  if (!uid || !leadId) {
    res.status(400).send('Missing lead context.');
    return;
  }

  const ref = leadDoc(uid, leadId);
  const snap = await ref.get();
  const lead = snap.data() as Lead | undefined;

  if (!lead) {
    res.status(404).send('Lead not found.');
    return;
  }

  if (!speechResult) {
    res.type('text/xml').send(buildClosingTwiml('Thanks for your time. I will follow up with a quick summary by email.'));
    return;
  }

  const baseTranscript = lead.callTranscript || '';
  const reply = await generateCallReply(lead, baseTranscript, speechResult, turn);
  const transcript = `${baseTranscript}\nOwner: ${speechResult}\nAlex: ${reply}`.trim();
  const shouldClose = turn >= 2 || /not interested|call back|busy|send email/i.test(speechResult);

  if (shouldClose) {
    const summary = await summarizeCallTranscript(lead, transcript);
    await ref.set(
      {
        status: 'CALL_COMPLETED',
        callStatus: 'completed',
        callTranscript: transcript,
        callSummary: summary.summary,
        requiresAIAgent: summary.requiresAIAgent,
        aiAgentType: summary.aiAgentType,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.type('text/xml').send(buildClosingTwiml(`${reply} Thanks again. I'll send over the next steps shortly.`));
    return;
  }

  await ref.set(
    {
      callTranscript: transcript,
      callStatus: 'in-progress',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const gatherUrl = `${config.serverBaseUrl}/api/calls/respond?uid=${encodeURIComponent(uid)}&leadId=${encodeURIComponent(leadId)}&turn=${turn + 1}`;
  res.type('text/xml').send(buildGatherTwiml(reply, gatherUrl));
});

app.post('/api/calls/status', async (req, res) => {
  const uid = String(req.query.uid || '');
  const leadId = String(req.query.leadId || '');
  const callStatus = String(req.body.CallStatus || '').trim();
  const callSid = String(req.body.CallSid || '').trim();

  if (uid && leadId) {
    await leadDoc(uid, leadId).set(
      {
        lastCallSid: callSid || null,
        callStatus: callStatus || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  res.json({ ok: true });
});

app.post('/api/calls/recording', async (req, res) => {
  const uid = String(req.query.uid || '');
  const leadId = String(req.query.leadId || '');
  const recordingUrl = String(req.body.RecordingUrl || '').trim();

  if (uid && leadId && recordingUrl) {
    await leadDoc(uid, leadId).set(
      {
        callRecordingUrl: recordingUrl,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  res.json({ ok: true });
});

app.post('/api/leads/search', requireUser, async (req, res) => {
  try {
    const { query, location } = req.body as { query: string; location: string };
    const leads = await findLeadsWithAI(query, location);
    res.json(leads);
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/pipeline/import-discovered', requireUser, async (req, res) => {
  try {
    const { leads } = req.body as { leads: Lead[] };
    if (!Array.isArray(leads)) {
      throw new Error('Leads payload must be an array.');
    }

    const batch = adminDb.batch();
    for (const lead of leads) {
      if (!lead?.id) {
        continue;
      }

      batch.set(
        leadDoc(req.user!.uid, lead.id),
        {
          ...lead,
          status: lead.status || 'DISCOVERED',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    res.json({ imported: leads.length });
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/pipeline/list', requireUser, async (req, res) => {
  try {
    const snap = await adminDb
      .collection(`users/${req.user!.uid}/leads`)
      .orderBy('updatedAt', 'desc')
      .get();

    const leads = snap.docs.map((leadSnap) => ({
      id: leadSnap.id,
      ...(leadSnap.data() as Lead),
    }));

    res.json(leads);
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/pipeline/upsert', requireUser, async (req, res) => {
  try {
    const { lead } = req.body as { lead: Partial<Lead> & { id?: string } };
    const leadId = lead?.id;

    if (!leadId) {
      throw new Error('Lead id is required.');
    }

    const ref = leadDoc(req.user!.uid, leadId);
    await ref.set(
      {
        ...lead,
        id: leadId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const saved = await ref.get();
    res.json({
      id: saved.id,
      ...(saved.data() as Lead),
    });
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/pipeline/delete', requireUser, async (req, res) => {
  try {
    const { leadId } = req.body as { leadId: string };
    if (!leadId) {
      throw new Error('Lead id is required.');
    }

    await leadDoc(req.user!.uid, leadId).delete();
    res.json({ ok: true });
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/pipeline/reset', requireUser, async (req, res) => {
  try {
    const snap = await adminDb.collection(`users/${req.user!.uid}/leads`).get();
    const batch = adminDb.batch();
    snap.docs.forEach((leadSnap) => batch.delete(leadSnap.ref));
    await batch.commit();
    res.json({ deleted: snap.size });
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/config/get', requireUser, async (req, res) => {
  try {
    const snap = await adminDb.doc(`users/${req.user!.uid}/config/aiAgent`).get();
    res.json(snap.exists ? snap.data() : null);
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/config/save', requireUser, async (req, res) => {
  try {
    const { config: agentConfig } = req.body as { config: AIAgentConfig };
    if (!agentConfig) {
      throw new Error('Config payload is required.');
    }

    await adminDb.doc(`users/${req.user!.uid}/config/aiAgent`).set(agentConfig, { merge: true });
    res.json(agentConfig);
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/emails/draft-outreach', requireUser, async (req, res) => {
  try {
    const { lead, businessType } = req.body as { lead: Lead; businessType: string };
    const draft = await generateOutreachEmailDraft(lead, businessType);
    res.json(draft);
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/emails/send-outreach', requireUser, async (req, res) => {
  try {
    requireConfig('resendApiKey', 'resendFromEmail');

    const { lead, businessType, subject, body } = req.body as {
      lead: Lead;
      businessType: string;
      subject: string;
      body: string;
    };

    if (!lead.email) {
      throw new Error('A recipient email is required before sending.');
    }

    const result = await sendEmail({
      to: lead.email,
      subject,
      text: body,
      replyTo: req.user?.email || config.agencyReplyToEmail || undefined,
    });

    const nextLead: Partial<Lead> = {
      ...lead,
      status: 'EMAILED',
      businessType,
      emailDraft: body,
      emailSubject: subject,
      lastEmailSentAt: new Date().toISOString(),
    };

    if (result?.data?.id) {
      nextLead.lastEmailMessageId = result.data.id;
    }

    await leadDoc(req.user!.uid, lead.id).set(
      {
        ...nextLead,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json(nextLead);
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/calls/initiate', requireUser, async (req, res) => {
  try {
    requireConfig('twilioAccountSid', 'twilioAuthToken', 'twilioPhoneNumber');
    ensurePublicWebhookUrl();

    const { leadId } = req.body as { leadId: string };
    const ref = leadDoc(req.user!.uid, leadId);
    const snap = await ref.get();
    const lead = snap.data() as Lead | undefined;

    if (!lead) {
      throw new Error('Lead not found.');
    }

    if (!twilioClient) {
      throw new Error('Twilio is not configured.');
    }

    const normalizedPhone = normalizePhoneNumber(lead.phone);
    if (!normalizedPhone) {
      throw new Error('Phone number is not valid enough to place a real call. Please store it in international or standard US format.');
    }

    const opening = config.elevenlabsAgentId ? 'Call handled by ElevenLabs AI Agent.' : await generateCallOpening(lead);
    const call = await twilioClient.calls.create({
      from: config.twilioPhoneNumber,
      to: normalizedPhone,
      url: `${config.serverBaseUrl}/api/calls/twiml?uid=${encodeURIComponent(req.user!.uid)}&leadId=${encodeURIComponent(leadId)}`,
      statusCallback: `${config.serverBaseUrl}/api/calls/status?uid=${encodeURIComponent(req.user!.uid)}&leadId=${encodeURIComponent(leadId)}`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      record: true,
      recordingStatusCallback: `${config.serverBaseUrl}/api/calls/recording?uid=${encodeURIComponent(req.user!.uid)}&leadId=${encodeURIComponent(leadId)}`,
      recordingStatusCallbackMethod: 'POST',
    });

    await ref.set(
      {
        status: 'RESPONDED',
        phone: normalizedPhone,
        lastCallSid: call.sid,
        callStatus: call.status,
        callOpeningScript: opening,
        callTranscript: `Alex: ${opening}`,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({ callSid: call.sid, status: call.status });
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/sites/generate', requireUser, async (req, res) => {
  try {
    const { leadId, config: agentConfig } = req.body as { leadId: string; config?: AIAgentConfig };
    const ref = leadDoc(req.user!.uid, leadId);
    const snap = await ref.get();
    const lead = snap.data() as Lead | undefined;

    if (!lead) {
      throw new Error('Lead not found.');
    }

    if (lead.hasWebsite) {
      requireConfig('vercelToken');
      const snippet = await generateAIAgentEmbed(lead.name, lead.aiAgentType || 'Chatbot', agentConfig);
      const deployment = await deployStaticSite({
        html: buildSnippetPreviewHtml(lead.name, snippet),
        leadId,
        leadName: `${lead.name}-agent-preview`,
        uid: req.user!.uid,
      });

      await ref.set(
        {
          status: 'PREVIEW_READY',
          aiAgentSnippet: snippet,
          liveSiteUrl: deployment.url,
          liveSiteDeploymentId: deployment.id,
          liveSiteStatus: deployment.readyState || 'READY',
          aiAgentConfig: agentConfig || null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      res.json({
        aiAgentSnippet: snippet,
        liveSiteUrl: deployment.url,
        liveSiteDeploymentId: deployment.id,
        liveSiteStatus: deployment.readyState || 'READY',
        status: 'PREVIEW_READY',
      });
      return;
    }

    requireConfig('vercelToken');
    const html = await generateWebsiteHtml(
      lead.name,
      lead.callSummary || 'Modern lead-generation website.',
      Boolean(lead.requiresAIAgent),
      lead.aiAgentType || 'None',
      agentConfig
    );

    const deployment = await deployStaticSite({
      html,
      leadId,
      leadName: lead.name,
      uid: req.user!.uid,
    });

    await ref.set(
      {
        status: 'PREVIEW_READY',
        websiteCode: html,
        liveSiteUrl: deployment.url,
        liveSiteDeploymentId: deployment.id,
        liveSiteStatus: deployment.readyState || 'READY',
        aiAgentConfig: agentConfig || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({
      websiteCode: html,
      liveSiteUrl: deployment.url,
      liveSiteDeploymentId: deployment.id,
      liveSiteStatus: deployment.readyState || 'READY',
      status: 'PREVIEW_READY',
    });
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/sites/redeploy', requireUser, async (req, res) => {
  try {
    requireConfig('vercelToken');

    const { leadId, websiteCode } = req.body as { leadId: string; websiteCode: string };
    const ref = leadDoc(req.user!.uid, leadId);
    const snap = await ref.get();
    const lead = snap.data() as Lead | undefined;

    if (!lead) {
      throw new Error('Lead not found.');
    }

    const deployment = await deployStaticSite({
      html: websiteCode,
      leadId,
      leadName: lead.name,
      uid: req.user!.uid,
    });

    await ref.set(
      {
        websiteCode,
        liveSiteUrl: deployment.url,
        liveSiteDeploymentId: deployment.id,
        liveSiteStatus: deployment.readyState || 'READY',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({
      websiteCode,
      liveSiteUrl: deployment.url,
      liveSiteDeploymentId: deployment.id,
      liveSiteStatus: deployment.readyState || 'READY',
    });
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/payments/create-checkout-session', requireUser, async (req, res) => {
  try {
    requireConfig('stripeSecretKey');
    ensurePublicWebhookUrl();

    if (!stripe) {
      throw new Error('Stripe is not configured.');
    }

    const { leadId, amount } = req.body as { leadId: string; amount: number };
    const ref = leadDoc(req.user!.uid, leadId);
    const snap = await ref.get();
    const lead = snap.data() as Lead | undefined;

    if (!lead) {
      throw new Error('Lead not found.');
    }

    const safeAmount = Math.round(Number(amount) * 100);
    if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
      throw new Error('Enter a valid payment amount.');
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: lead.email || undefined,
      success_url: `${config.clientBaseUrl}?payment=success&lead=${encodeURIComponent(leadId)}`,
      cancel_url: `${config.clientBaseUrl}?payment=cancelled&lead=${encodeURIComponent(leadId)}`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: safeAmount,
            product_data: {
              name: lead.hasWebsite ? `AI agent implementation for ${lead.name}` : `Website project for ${lead.name}`,
              description: lead.liveSiteUrl
                ? `Live site: ${lead.liveSiteUrl}`
                : 'Lead generation website and automation work',
            },
          },
        },
      ],
      metadata: {
        uid: req.user!.uid,
        leadId,
        leadName: lead.name,
      },
      payment_intent_data: {
        metadata: {
          uid: req.user!.uid,
          leadId,
        },
      },
    });

    await ref.set(
      {
        paymentAmount: amount,
        paymentStatus: 'CHECKOUT_CREATED',
        paymentMethod: 'Stripe Checkout',
        stripeCheckoutSessionId: session.id,
        checkoutUrl: session.url || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/emails/send-follow-up', requireUser, async (req, res) => {
  try {
    requireConfig('resendApiKey', 'resendFromEmail');

    const { leadId } = req.body as { leadId: string };
    const ref = leadDoc(req.user!.uid, leadId);
    const snap = await ref.get();
    const lead = snap.data() as Lead | undefined;

    if (!lead) {
      throw new Error('Lead not found.');
    }

    if (!lead.email) {
      throw new Error('Lead is missing an email address.');
    }

    const followUpText = await generateFollowUpEmailText(lead);
    const subject = `Checking in on ${lead.name}'s project`;
    const result = await sendEmail({
      to: lead.email,
      subject,
      text: followUpText,
      replyTo: req.user?.email || config.agencyReplyToEmail || undefined,
    });

    await ref.set(
      {
        followUpEmail: followUpText,
        followUpSubject: subject,
        followUpMessageId: result?.data?.id || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({
      followUpEmail: followUpText,
      followUpSubject: subject,
    });
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/analysis/deep', requireUser, async (req, res) => {
  try {
    const { leadId } = req.body as { leadId: string };
    const snap = await leadDoc(req.user!.uid, leadId).get();
    const lead = snap.data() as Lead | undefined;

    if (!lead) {
      throw new Error('Lead not found.');
    }

    const analysis = await generateDeepAnalysisText(lead);
    res.json({ analysis });
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/chat', requireUser, async (req, res) => {
  try {
    const { message, history } = req.body as {
      message: string;
      history: { role: 'user' | 'model'; parts: { text: string }[] }[];
    };
    const response = await chatWithAgencyAssistant(message, history);
    res.json({ response });
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/audio/transcribe', requireUser, async (req, res) => {
  try {
    const { base64Audio, mimeType } = req.body as { base64Audio: string; mimeType: string };
    const transcript = await transcribeAudioWithAI(base64Audio, mimeType);
    res.json({ transcript });
  } catch (error: any) {
    respondWithError(res, error);
  }
});

app.post('/api/audio/speech', requireUser, async (req, res) => {
  try {
    const { text, voiceName } = req.body as { text: string; voiceName: string };
    const audio = await generateSpeechWithAI(text, voiceName);
    res.json({ audio });
  } catch (error: any) {
    respondWithError(res, error);
  }
});

if (existsSync(path.resolve(__dirname, '../dist'))) {
  app.use(express.static(path.resolve(__dirname, '../dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, '../dist/index.html'));
  });
}

app.listen(config.port, () => {
  console.log(`LeadGen AI server running on http://localhost:${config.port}`);
});

async function requireUser(req: Request, res: Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing bearer token.' });
      return;
    }

    const token = authHeader.slice('Bearer '.length);
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized request.' });
  }
}

function respondWithError(res: Response, error: any) {
  const message = error instanceof Error ? error.message : 'Request failed.';
  console.error(error);
  res.status(400).json({ error: message });
}

function normalizePhoneNumber(rawPhone: string) {
  if (!rawPhone) return null;
  // If it's a 10 digit number without prefix, assume India
  let phoneToParse = rawPhone.trim();
  if (/^\d{10}$/.test(phoneToParse)) {
    phoneToParse = '+91' + phoneToParse;
  }
  
  const parsed = parsePhoneNumberFromString(phoneToParse, phoneToParse.startsWith('+') ? undefined : 'US');
  return parsed?.isValid() ? parsed.number : null;
}

function ensurePublicWebhookUrl() {
  if (!isPublicCallbackUrl(config.serverBaseUrl)) {
    throw new Error('APP_BASE_URL must be a public URL for Stripe and Twilio webhooks.');
  }
}

async function sendEmail({
  to,
  subject,
  text,
  replyTo,
}: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}) {
  if (!resend) {
    throw new Error('Resend is not configured.');
  }

  return resend.emails.send({
    from: config.resendFromEmail,
    to: [to],
    subject,
    text,
    html: textToHtml(text),
    replyTo,
  });
}

function textToHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildGatherTwiml(prompt: string, actionUrl: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${escapeHtml(actionUrl)}" method="POST" speechTimeout="auto">
    <Say voice="alice">${escapeHtml(prompt)}</Say>
  </Gather>
  <Say voice="alice">I wasn't able to hear a response, so I'll follow up by email. Thanks for your time.</Say>
  <Hangup />
</Response>`;
}

function buildClosingTwiml(message: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${escapeHtml(message)}</Say>
  <Hangup />
</Response>`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

async function deployStaticSite({
  html,
  leadId,
  leadName,
  uid,
}: {
  html: string;
  leadId: string;
  leadName: string;
  uid: string;
}) {
  const deploymentName = slugify(`${config.vercelProjectPrefix}-${leadName}-${leadId}-${uid.slice(0, 6)}`);
  const query = new URLSearchParams();
  if (config.vercelTeamId) {
    query.set('teamId', config.vercelTeamId);
  }

  const response = await fetch(`https://api.vercel.com/v13/deployments?${query.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.vercelToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: deploymentName,
      files: [
        {
          file: 'index.html',
          data: ensureHtmlDocument(html),
        },
      ],
      projectSettings: {
        framework: null,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vercel deployment failed: ${errorText}`);
  }

  const deployment = await response.json();
  return {
    id: deployment.id as string,
    url: `https://${deployment.url}`,
    readyState: deployment.readyState as string | undefined,
  };
}

function ensureHtmlDocument(html: string) {
  if (/<html[\s>]/i.test(html)) {
    return html;
  }

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LeadGen Client Site</title>
  </head>
  <body>
    ${html}
  </body>
</html>`;
}

function buildSnippetPreviewHtml(leadName: string, snippet: string) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(leadName)} AI Agent Preview</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="min-h-screen bg-zinc-50 text-zinc-900">
    <main class="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-6 py-16">
      <section class="w-full rounded-3xl border border-zinc-200 bg-white p-10 shadow-sm">
        <p class="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-indigo-600">AI Agent Preview</p>
        <h1 class="text-4xl font-bold tracking-tight text-zinc-900">${escapeHtml(leadName)}</h1>
        <p class="mt-4 max-w-2xl text-lg leading-8 text-zinc-600">
          This hosted preview shows how the floating AI widget will appear when embedded into the client's existing website.
        </p>
        <div class="mt-8 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-500">
          The preview canvas is intentionally minimal so the widget behavior stands out clearly.
        </div>
      </section>
    </main>
    ${snippet}
  </body>
</html>`;
}

function buildInvoiceText(lead: Lead, session: Stripe.Checkout.Session) {
  const amount = ((session.amount_total || 0) / 100).toFixed(2);
  const liveUrl = lead.liveSiteUrl ? `Live site: ${lead.liveSiteUrl}\n` : '';

  return `Hi ${lead.name},

Thanks for your payment. This confirms we received USD ${amount} for your ${lead.hasWebsite ? 'AI agent implementation' : 'website project'}.

Payment reference: ${session.payment_intent || session.id}
${liveUrl}
If you need revisions or support, just reply to this email.

Best,
Alex from ${config.agencyName}`;
}
