import { auth } from '../firebase';
import type { AIAgentConfig, Lead } from '../types';

type ChatHistory = { role: 'user' | 'model'; parts: { text: string }[] }[];

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || '';

async function apiRequest<T>(path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Please sign in first.');
  }

  const token = await user.getIdToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.error || 'Request failed.');
  }

  return payload as T;
}

export async function findLeads(query: string, location: string): Promise<Lead[]> {
  return apiRequest<Lead[]>('/api/leads/search', { query, location });
}

export async function importDiscoveredLeads(leads: Lead[]): Promise<{ imported: number }> {
  return apiRequest<{ imported: number }>('/api/pipeline/import-discovered', { leads });
}

export async function listPipelineLeads(): Promise<Lead[]> {
  return apiRequest<Lead[]>('/api/pipeline/list');
}

export async function upsertPipelineLead(lead: Partial<Lead> & { id: string }): Promise<Lead> {
  return apiRequest<Lead>('/api/pipeline/upsert', { lead });
}

export async function deletePipelineLead(leadId: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/api/pipeline/delete', { leadId });
}

export async function resetPipeline(): Promise<{ deleted: number }> {
  return apiRequest<{ deleted: number }>('/api/pipeline/reset');
}

export async function getAIConfig(): Promise<AIAgentConfig | null> {
  return apiRequest<AIAgentConfig | null>('/api/config/get');
}

export async function saveAIConfig(config: AIAgentConfig): Promise<AIAgentConfig> {
  return apiRequest<AIAgentConfig>('/api/config/save', { config });
}

export async function generateOutreachEmail(lead: Lead, businessType: string): Promise<{ subject: string; body: string }> {
  return apiRequest<{ subject: string; body: string }>('/api/emails/draft-outreach', { lead, businessType });
}

export async function sendOutreachEmail(
  lead: Lead,
  businessType: string,
  subject: string,
  body: string
): Promise<Partial<Lead>> {
  return apiRequest<Partial<Lead>>('/api/emails/send-outreach', {
    lead,
    businessType,
    subject,
    body,
  });
}

export async function initiateLeadCall(leadId: string): Promise<{ callSid: string; status: string }> {
  return apiRequest<{ callSid: string; status: string }>('/api/calls/initiate', { leadId });
}

export async function generateWebsitePreview(leadId: string, config: AIAgentConfig): Promise<Partial<Lead>> {
  return apiRequest<Partial<Lead>>('/api/sites/generate', { leadId, config });
}

export async function redeployWebsite(leadId: string, websiteCode: string): Promise<Partial<Lead>> {
  return apiRequest<Partial<Lead>>('/api/sites/redeploy', { leadId, websiteCode });
}

export async function createCheckoutSession(leadId: string, amount: number): Promise<{ sessionId: string; url: string }> {
  return apiRequest<{ sessionId: string; url: string }>('/api/payments/create-checkout-session', { leadId, amount });
}

export async function generateFollowUpEmail(leadId: string): Promise<{ followUpEmail: string; followUpSubject: string }> {
  return apiRequest<{ followUpEmail: string; followUpSubject: string }>('/api/emails/send-follow-up', { leadId });
}

export async function transcribeAudio(base64Audio: string, mimeType: string): Promise<string> {
  const result = await apiRequest<{ transcript: string }>('/api/audio/transcribe', { base64Audio, mimeType });
  return result.transcript;
}

export async function generateSpeech(text: string, voiceName = 'Kore'): Promise<string | null> {
  const result = await apiRequest<{ audio: string | null }>('/api/audio/speech', { text, voiceName });
  return result.audio;
}

export async function generateDeepAnalysis(leadId: string): Promise<string> {
  const result = await apiRequest<{ analysis: string }>('/api/analysis/deep', { leadId });
  return result.analysis;
}

export async function chatWithAI(message: string, history: ChatHistory): Promise<string> {
  const result = await apiRequest<{ response: string }>('/api/chat', { message, history });
  return result.response;
}
