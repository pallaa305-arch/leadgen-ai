import { createHash } from 'node:crypto';
import { GoogleGenAI, Modality, ThinkingLevel, Type } from '@google/genai';
import type { AIAgentConfig, AIAgentType, Lead } from '../src/types';
import { config, requireConfig } from './config';

requireConfig('geminiApiKey');

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

function parseJsonBlock<T>(text: string, fallback: T): T {
  if (!text) {
    return fallback;
  }

  const jsonBlock = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const rawJson = jsonBlock || text;

  try {
    return JSON.parse(rawJson.trim()) as T;
  } catch {
    return fallback;
  }
}

function buildStableLeadId(values: { name?: string; address?: string; phone?: string; placeUri?: string }) {
  const base =
    values.placeUri ||
    `${values.name || 'unknown'}|${values.phone || 'unknown'}|${values.address || 'unknown'}`;

  return createHash('sha1').update(base.trim().toLowerCase()).digest('hex').slice(0, 12);
}

export async function findLeadsWithAI(query: string, location: string): Promise<Lead[]> {
  const prompt = `Find REAL local businesses matching "${query}" in "${location}".
Current search timestamp: ${new Date().toISOString()}

Rules:
1. Only return real businesses you can ground in Google Maps.
2. Prefer businesses that have no website or a weak digital presence.
3. Include a public email only when you are confident it is publicly listed.
4. Include a websiteUrl only when you can find a valid public website.
5. Never invent data.
6. Return JSON only.

Each item must use these keys:
- name
- address
- phone
- hasWebsite
- websiteUrl
- email`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      tools: [{ googleMaps: {} }],
      temperature: 0.1,
    },
  });

  const text = response.text || '[]';
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const mapsUrls = new Map<string, string>();

  for (const chunk of chunks as any[]) {
    if (chunk?.maps?.title && chunk?.maps?.uri) {
      mapsUrls.set(chunk.maps.title, chunk.maps.uri);
    }
  }

  const leads = parseJsonBlock<any[]>(text, []);

  return leads.map((lead) => {
    const placeUri = mapsUrls.get(lead.name) || undefined;

    return {
      id: buildStableLeadId({
        name: lead.name,
        address: lead.address,
        phone: lead.phone,
        placeUri,
      }),
      name: lead.name || 'Unknown',
      address: lead.address || 'Unknown',
      phone: lead.phone || 'Unknown',
      hasWebsite: Boolean(lead.hasWebsite),
      websiteUrl: lead.websiteUrl || undefined,
      email: lead.email || undefined,
      placeUri,
      status: 'DISCOVERED',
      businessType: query,
      updatedAt: new Date().toISOString() as any,
    };
  });
}

export async function generateOutreachEmailDraft(lead: Lead, businessType: string) {
  const prompt = `Write a concise, human-sounding cold outreach email for ${lead.name}, a ${businessType || lead.businessType || 'local business'}.

Context:
- Website present: ${lead.hasWebsite ? 'Yes' : 'No'}
- Website URL: ${lead.websiteUrl || 'Unknown'}
- Public email: ${lead.email || 'Unknown'}

Goal:
- Offer web design / conversion optimization help.
- If they already have a website, focus on improvement, speed, SEO, lead capture, and AI chat/voice automation.
- If they do not have a website, focus on getting found locally and converting calls into customers.
- Keep it under 140 words.
- Avoid hype and placeholders.
- Sign off as "Alex from ${config.agencyName}".

Return JSON with:
- subject
- body`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING },
          body: { type: Type.STRING },
        },
        required: ['subject', 'body'],
      },
    },
  });

  return parseJsonBlock<{ subject: string; body: string }>(response.text || '{}', {
    subject: `Quick idea for ${lead.name}`,
    body: `Hi ${lead.name},\n\nI spotted a few simple ways your online presence could bring in more local leads. If you'd like, I can send over a quick website and AI automation plan tailored to your business.\n\nBest,\nAlex from ${config.agencyName}`,
  });
}

export async function generateCallOpening(lead: Lead) {
  const prompt = `Write a short, natural phone opening script for an outbound sales call to ${lead.name}, a ${lead.businessType || 'local business'}.

Rules:
- 55 words max.
- Sound conversational, not robotic.
- Mention website/help with lead generation.
- If they already have a website, mention improving it plus adding AI chat/voice automation.
- End with a question that invites them to describe how they currently get customers.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite-preview',
    contents: prompt,
  });

  return (
    response.text ||
    `Hi, this is Alex from ${config.agencyName}. I had a quick idea that could help ${lead.name} bring in more local customers online. How are you currently handling website leads and customer questions today?`
  ).trim();
}

export async function generateCallReply(lead: Lead, transcript: string, latestSpeech: string, turn: number) {
  const prompt = `You are Alex from ${config.agencyName} on a live phone call with ${lead.name}, a ${lead.businessType || 'local business'}.

Existing transcript:
${transcript}

Latest thing the owner said:
${latestSpeech}

Write the assistant's next spoken reply.

Rules:
- Keep it under 65 words.
- Be natural and phone-friendly.
- Acknowledge what they said.
- Gently position either a website rebuild, website improvement, chatbot, voice agent, or both.
- End with one clear follow-up question.
- This is turn ${turn}.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite-preview',
    contents: prompt,
  });

  return (
    response.text ||
    `That makes sense. Based on what you shared, I can see a couple of ways we could tighten up your lead flow and customer follow-up. Would it help if I gave you a simple recommendation tailored to your current setup?`
  ).trim();
}

export async function summarizeCallTranscript(lead: Lead, transcript: string) {
  const prompt = `Analyze this sales call transcript for ${lead.name}, a ${lead.businessType || 'local business'}.

Transcript:
${transcript}

Return JSON with:
- summary: concise client requirements summary
- requiresAIAgent: boolean
- aiAgentType: one of "Chatbot", "Voice Agent", "Both", "None"

Rules:
- If they already have a website and want automation, prefer Chatbot, Voice Agent, or Both.
- If they need a new website and also like automation, set requiresAIAgent true.
- Be conservative.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          requiresAIAgent: { type: Type.BOOLEAN },
          aiAgentType: { type: Type.STRING },
        },
        required: ['summary', 'requiresAIAgent', 'aiAgentType'],
      },
    },
  });

  return parseJsonBlock<{ summary: string; requiresAIAgent: boolean; aiAgentType: AIAgentType }>(
    response.text || '{}',
    {
      summary: 'Call completed, but no structured summary could be generated.',
      requiresAIAgent: false,
      aiAgentType: 'None',
    }
  );
}

export async function generateWebsiteHtml(
  businessName: string,
  summary: string,
  requiresAIAgent: boolean,
  aiAgentType: string,
  agentConfig?: AIAgentConfig
) {
  const prompt = `You are an expert web developer. Create a polished, responsive single-file HTML landing page for "${businessName}".

Client requirements:
${summary}

${requiresAIAgent ? `Also include a floating ${aiAgentType} UI element in the bottom-right corner.` : ''}
${agentConfig ? `Use this AI agent configuration when relevant:
- Name: ${agentConfig.chatbotName}
- Personality: ${agentConfig.personality}
- Response style: ${agentConfig.responseStyle}
- Language: ${agentConfig.language}
- Voice: ${agentConfig.voiceName}` : ''}

Rules:
- Return raw HTML only.
- Use Tailwind via CDN.
- Include a clear hero, services/about, trust section, and contact CTA.
- Make it production-looking, not a wireframe.
- Keep assets remote-only or CSS-only.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: prompt,
  });

  return (response.text || '').replace(/```html|```/g, '').trim();
}

export async function generateAIAgentEmbed(businessName: string, aiAgentType: string, agentConfig?: AIAgentConfig) {
  const prompt = `Create a clean embeddable HTML/CSS/JavaScript snippet for "${businessName}".

Requirements:
- Widget type: ${aiAgentType}
${agentConfig ? `- Agent name: ${agentConfig.chatbotName}
- Personality: ${agentConfig.personality}
- Style: ${agentConfig.responseStyle}
- Language: ${agentConfig.language}
- Voice: ${agentConfig.voiceName}` : ''}

Rules:
- Return raw code only.
- It must inject a bottom-right floating widget.
- If Chatbot, show a chat bubble with a mock chat UI.
- If Voice Agent, show a mic button with a pulsing animation.
- If Both, combine both controls elegantly.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: prompt,
  });

  return (response.text || '').replace(/```html|```javascript|```/g, '').trim();
}

export async function generateFollowUpEmailText(lead: Lead) {
  const prompt = `Write a concise follow-up email to ${lead.name} after delivering their ${lead.hasWebsite ? 'AI agent integration' : 'website'}.

Rules:
- Ask how the launch is going.
- Offer revisions or support.
- Under 120 words.
- Sign off as Alex from ${config.agencyName}.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite-preview',
    contents: prompt,
  });

  return (response.text || '').trim();
}

export async function generateDeepAnalysisText(lead: Lead) {
  const prompt = `Perform a practical digital growth analysis for ${lead.name}.

Business summary:
${lead.callSummary || 'No summary available.'}

Include:
1. Immediate website or local SEO quick wins.
2. A realistic conversion improvement plan.
3. How AI chat or voice automation could help.
4. Suggested next 30-day actions.

Return markdown.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
    },
  });

  return (response.text || '').trim();
}

export async function chatWithAgencyAssistant(
  message: string,
  history: { role: 'user' | 'model'; parts: { text: string }[] }[]
) {
  const chat = ai.chats.create({
    model: 'gemini-3.1-pro-preview',
    config: {
      systemInstruction:
        'You are a helpful AI assistant for a web development and AI agency owner. Help with CRM workflows, outreach, client strategy, delivery, pricing, and operations.',
    },
  });

  for (const item of history) {
    if (item.role === 'user') {
      await chat.sendMessage({ message: item.parts[0]?.text || '' });
    }
  }

  const response = await chat.sendMessage({ message });
  return response.text || '';
}

export async function transcribeAudioWithAI(base64Audio: string, mimeType: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        inlineData: {
          data: base64Audio,
          mimeType,
        },
      },
      'Transcribe this audio and return only the text.',
    ],
  });

  return response.text || '';
}

export async function generateSpeechWithAI(text: string, voiceName: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voiceName as any },
        },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
}
