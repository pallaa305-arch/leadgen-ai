export type LeadStatus = 
  | 'DISCOVERED' 
  | 'EMAILED' 
  | 'RESPONDED' 
  | 'CALL_COMPLETED' 
  | 'PREVIEW_READY' 
  | 'DELIVERED';

export type PaymentMethod = 'PayPal' | 'Card' | 'Online' | 'Stripe Checkout';
export type AIAgentType = 'Chatbot' | 'Voice Agent' | 'Both' | 'None';

export interface AIAgentConfig {
  personality: string;
  responseStyle: 'Professional' | 'Friendly' | 'Casual' | 'Humorous';
  language: string;
  chatbotName: string;
  voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
}

export interface Task {
  id: string;
  title: string;
  dueDate?: string;
  completed: boolean;
  createdAt: any;
}

export interface Lead {
  id: string;
  name: string;
  address: string;
  phone: string;
  hasWebsite: boolean;
  email?: string;
  placeUri?: string;
  websiteUrl?: string;
  status: LeadStatus;
  businessType?: string;
  emailSubject?: string;
  emailDraft?: string;
  lastEmailMessageId?: string;
  lastEmailSentAt?: string;
  callTranscript?: string;
  callSummary?: string;
  callOpeningScript?: string;
  callStatus?: string;
  lastCallSid?: string;
  callRecordingUrl?: string;
  requiresAIAgent?: boolean;
  aiAgentType?: AIAgentType;
  aiAgentConfig?: AIAgentConfig;
  websiteCode?: string;
  liveSiteUrl?: string;
  liveSiteDeploymentId?: string;
  liveSiteStatus?: string;
  aiAgentSnippet?: string;
  paymentStatus?: 'CHECKOUT_CREATED' | 'PAID';
  paymentAmount?: number;
  paymentMethod?: PaymentMethod;
  transactionId?: string;
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  checkoutUrl?: string;
  invoiceSubject?: string;
  invoiceMessageId?: string;
  invoiceEmail?: string;
  followUpSubject?: string;
  followUpMessageId?: string;
  followUpEmail?: string;
  scheduledCall?: string;
  followUpCallSummary?: string;
  tasks?: Task[];
}
