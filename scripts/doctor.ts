import { config, isPublicCallbackUrl } from '../server/config';

type GroupCheck = {
  name: string;
  requiredFor: string;
  keys: (keyof typeof config)[];
  extra?: () => string[];
};

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^your_/i,
  /^my_/i,
  /example/i,
  /xxx/i,
  /\.\.\./,
];

const groups: GroupCheck[] = [
  {
    name: 'Core runtime',
    requiredFor: 'server auth, Gemini, and protected API routes',
    keys: ['geminiApiKey', 'firebaseProjectId', 'firebaseClientEmail', 'firebasePrivateKey'],
  },
  {
    name: 'Public URLs',
    requiredFor: 'checkout redirects, public links, and webhook callbacks',
    keys: ['serverBaseUrl', 'clientBaseUrl'],
    extra: () => {
      const warnings: string[] = [];
      if (!isPublicCallbackUrl(config.serverBaseUrl)) {
        warnings.push('APP_BASE_URL is not public. Stripe and Twilio webhooks will not work until this points to a public HTTPS URL.');
      }
      return warnings;
    },
  },
  {
    name: 'Email delivery',
    requiredFor: 'real outreach, invoice, and follow-up emails',
    keys: ['resendApiKey', 'resendFromEmail'],
  },
  {
    name: 'Stripe payments',
    requiredFor: 'real card checkout and payment confirmation webhooks',
    keys: ['stripeSecretKey', 'stripeWebhookSecret'],
  },
  {
    name: 'Twilio outbound calls',
    requiredFor: 'real phone calls and recordings',
    keys: ['twilioAccountSid', 'twilioAuthToken', 'twilioPhoneNumber'],
  },
  {
    name: 'ElevenLabs AI Agent',
    requiredFor: 'AI conversational agent on phone calls',
    keys: ['elevenlabsApiKey', 'elevenlabsAgentId'],
  },
  {
    name: 'Vercel live deployments',
    requiredFor: 'publishing generated websites and hosted widget previews',
    keys: ['vercelToken'],
  },
  {
    name: 'Agency branding',
    requiredFor: 'clean outbound identity in emails and CRM',
    keys: ['agencyName', 'agencyReplyToEmail'],
  },
];

function isConfigured(value: string | number | undefined) {
  const trimmed = String(value || '').trim();
  return !PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function statusIcon(ready: boolean) {
  return ready ? '[OK]' : '[MISSING]';
}

const missingCoreGroups = new Set<string>();

console.log('\nLeadGen AI Doctor\n');

for (const group of groups) {
  const missing = group.keys.filter((key) => !isConfigured(config[key]));
  const ready = missing.length === 0;

  if (!ready && (group.name === 'Core runtime' || group.name === 'Public URLs')) {
    missingCoreGroups.add(group.name);
  }

  console.log(`${statusIcon(ready)} ${group.name}`);
  console.log(`  Needed for: ${group.requiredFor}`);

  if (missing.length === 0) {
    console.log('  All required values look configured.\n');
  } else {
    console.log(`  Missing: ${missing.join(', ')}`);
    console.log('');
  }

  const extras = group.extra?.() || [];
  for (const warning of extras) {
    console.log(`  Warning: ${warning}`);
  }
  if (extras.length > 0) {
    console.log('');
  }
}

console.log('Quick start');
console.log('  1. Copy .env.example into .env.local or .env');
console.log('  2. Fill the missing values above');
console.log('  3. Run: npm run dev');
console.log('  4. For real calls/payments, point APP_BASE_URL to a public HTTPS backend URL\n');

if (missingCoreGroups.size > 0) {
  console.error(`Startup is not production-ready yet. Fix these first: ${Array.from(missingCoreGroups).join(', ')}`);
  process.exit(1);
}

console.log('Core startup requirements look good.');
