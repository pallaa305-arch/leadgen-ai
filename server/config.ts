import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const config = {
  port: Number(process.env.PORT || 8787),
  serverBaseUrl: trimTrailingSlash(process.env.APP_BASE_URL || process.env.APP_URL || 'http://localhost:8787'),
  clientBaseUrl: trimTrailingSlash(process.env.CLIENT_APP_URL || process.env.APP_URL || 'http://localhost:3000'),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  resendFromEmail: process.env.RESEND_FROM_EMAIL || '',
  agencyName: process.env.AGENCY_NAME || 'LeadGen AI',
  agencyReplyToEmail: process.env.AGENCY_REPLY_TO_EMAIL || process.env.RESEND_FROM_EMAIL || '',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  elevenlabsAgentId: process.env.ELEVENLABS_AGENT_ID || '',
  vercelToken: process.env.VERCEL_TOKEN || '',
  vercelTeamId: process.env.VERCEL_TEAM_ID || '',
  vercelProjectPrefix: process.env.VERCEL_PROJECT_PREFIX || 'leadgen-client',
  vercelAliasDomain: process.env.VERCEL_ALIAS_DOMAIN || '',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') || '',
};

export function requireConfig(...keys: (keyof typeof config)[]) {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export function isPublicCallbackUrl(url: string) {
  return /^https?:\/\/(?!localhost|127\.0\.0\.1)/i.test(url);
}
