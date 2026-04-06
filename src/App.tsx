import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { 
  Search, MapPin, Briefcase, Globe, Phone, Mail, ChevronRight, 
  Loader2, CheckCircle2, XCircle, LayoutDashboard, ListTodo, 
  MessageSquare, PhoneCall, Code, CreditCard, Play, FileText,
  Wallet, Receipt, Download, Bot, Plus, Link, Edit3, Save, ExternalLink,
  Mic, Volume2, Sparkles, Send, Calendar, Clock, Flame, Share2, Copy,
  LogIn, LogOut, AlertTriangle, Trash2, Users
} from 'lucide-react';
import {
  chatWithAI,
  createCheckoutSession,
  deletePipelineLead,
  findLeads,
  generateDeepAnalysis,
  generateFollowUpEmail,
  generateOutreachEmail,
  generateSpeech,
  getAIConfig,
  generateWebsitePreview,
  importDiscoveredLeads,
  initiateLeadCall,
  listPipelineLeads,
  redeployWebsite,
  resetPipeline,
  saveAIConfig,
  sendOutreachEmail,
  transcribeAudio,
  upsertPipelineLead,
} from './services/gemini';
import { Lead, LeadStatus, AIAgentConfig, Task } from './types';
import { auth } from './firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-javascript';
import 'prismjs/themes/prism.css';

// Error Boundary Component
class AppErrorBoundary extends React.Component<any, any> {
  public state: any = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsedError = JSON.parse(this.state.error.message);
        errorMessage = `Firestore Error: ${parsedError.error} during ${parsedError.operationType} on ${parsedError.path}`;
      } catch (e) {
        errorMessage = this.state.error?.message || String(this.state.error);
      }

      return (
        <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white p-8 rounded-2xl border border-zinc-200 shadow-xl text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900 mb-2">Application Error</h2>
            <p className="text-zinc-600 mb-6 text-sm">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

const STATUS_GROUPS: { status: LeadStatus; label: string }[] = [
  { status: 'DISCOVERED', label: 'New Leads' },
  { status: 'EMAILED', label: 'Outreach Sent' },
  { status: 'RESPONDED', label: 'Interested' },
  { status: 'CALL_COMPLETED', label: 'Requirements Gathered' },
  { status: 'PREVIEW_READY', label: 'Ready for Review' },
  { status: 'DELIVERED', label: 'Completed & Paid' }
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'pipeline' | 'accounts' | 'ai-config'>('search');
  
  // Search State
  const [query, setQuery] = useState('Plumbers');
  const [location, setLocation] = useState('Austin, TX');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [generatingEmail, setGeneratingEmail] = useState(false);

  // AI Agent Config State
  const [globalAIConfig, setGlobalAIConfig] = useState<AIAgentConfig>({
    personality: 'Professional, helpful, and efficient assistant focused on solving customer problems.',
    responseStyle: 'Friendly',
    language: 'English',
    chatbotName: 'LeadGen Assistant',
    voiceName: 'Kore'
  });

  const AI_PROFILES = [
    {
      id: 'executive',
      name: 'The Executive',
      style: 'Professional',
      description: 'Highly professional, concise, and results-oriented.',
      prompt: 'You are a highly professional, concise, and results-oriented executive assistant. You communicate with formal business etiquette, prioritize efficiency, and focus strictly on the client\'s business objectives. Avoid slang and keep responses brief and to the point.'
    },
    {
      id: 'consultant',
      name: 'The Consultant',
      style: 'Friendly',
      description: 'Knowledgeable, warm, and eager to help.',
      prompt: 'You are a knowledgeable and friendly consultant. You are eager to help, explain concepts clearly without jargon, and maintain a warm, approachable, and supportive tone. You ask clarifying questions to ensure you fully understand the user\'s needs.'
    },
    {
      id: 'buddy',
      name: 'The Buddy',
      style: 'Casual',
      description: 'Relaxed, conversational, and peer-like.',
      prompt: 'You are a casual, relaxed, and conversational assistant. You speak like a peer, use everyday language, and keep the conversation light and easygoing. Feel free to use mild slang and emojis where appropriate to keep the vibe friendly.'
    },
    {
      id: 'comedian',
      name: 'The Comedian',
      style: 'Humorous',
      description: 'Witty, sarcastic, and entertaining.',
      prompt: 'You are a witty, humorous, and slightly sarcastic assistant. You love making clever observations, using puns, and keeping the user entertained while still getting the job done. Your tone is playful and engaging, but you never cross the line into being unhelpful.'
    }
  ];

  // Pipeline State
  const [pipeline, setPipeline] = useState<Lead[]>([]);
  const [selectedPipelineLead, setSelectedPipelineLead] = useState<Lead | null>(null);
  const [pipelineActionLoading, setPipelineActionLoading] = useState<string | null>(null);
  const [selectedAccountClient, setSelectedAccountClient] = useState<Lead | null>(null);
  const [isEditingCode, setIsEditingCode] = useState(false);
  const [editedCode, setEditedCode] = useState('');

  // New Features State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model', parts: { text: string }[] }[]>([
    { role: 'model', parts: [{ text: "Hi! I'm your AI agency assistant. How can I help you grow your business today?" }] }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);

  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [showCallDetailsModal, setShowCallDetailsModal] = useState<Lead | null>(null);
  
  const [scheduledCallDate, setScheduledCallDate] = useState<string>('');
  const [followUpSummaryInput, setFollowUpSummaryInput] = useState<string>('');
  
  const [analyzingLeadId, setAnalyzingLeadId] = useState<string | null>(null);
  const [deepAnalysis, setDeepAnalysis] = useState<Record<string, string>>({});
  
  // Task State
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');

  const [shareLinkModal, setShareLinkModal] = useState<{ isOpen: boolean, url: string, leadName: string }>({ 
    isOpen: false, 
    url: '', 
    leadName: '' 
  });

  // Auth State Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const refreshPipeline = async () => {
    const leadsData = await listPipelineLeads();
    setPipeline(leadsData);
    return leadsData;
  };

  const refreshAIConfig = async () => {
    const config = await getAIConfig();
    if (config) {
      setGlobalAIConfig(config);
    }
    return config;
  };

  // Backend Sync
  useEffect(() => {
    if (!user) {
      setPipeline([]);
      setSelectedPipelineLead(null);
      return;
    }

    refreshPipeline().catch((error) => {
      console.error('Failed to load pipeline', error);
      alert(error instanceof Error ? error.message : 'Failed to load pipeline.');
    });

    refreshAIConfig().catch((error) => {
      console.error('Failed to load AI config', error);
    });
  }, [user]);

  useEffect(() => {
    setSelectedPipelineLead((prev) => {
      if (pipeline.length === 0) {
        return null;
      }

      if (!prev) {
        return pipeline[0];
      }

      return pipeline.find((lead) => lead.id === prev.id) || pipeline[0];
    });
  }, [pipeline]);

  // Debounced Config Save
  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(async () => {
      try {
        await saveAIConfig(globalAIConfig);
      } catch (error) {
        console.error("Failed to save config", error);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [globalAIConfig, user]);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error?.code !== 'auth/cancelled-popup-request' && error?.code !== 'auth/popup-closed-by-user') {
        console.error("Login failed", error);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  // Preview Route Handling
  const urlParams = new URLSearchParams(window.location.search);
  const previewId = urlParams.get('preview');

  if (previewId) {
    const lead = pipeline.find(l => l.id === previewId);
    if (lead) {
      if (lead.websiteCode) {
        return (
          <iframe 
            srcDoc={lead.websiteCode} 
            className="w-full h-screen border-none"
            title="Website Preview"
          />
        );
      } else if (lead.aiAgentSnippet) {
        const mockHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>AI Agent Preview</title>
            <script src="https://cdn.tailwindcss.com"></script>
          </head>
          <body class="bg-gray-50 flex items-center justify-center h-screen">
            <div class="text-center p-8 max-w-2xl">
              <h1 class="text-3xl font-bold text-gray-900 mb-4">AI Agent Preview</h1>
              <p class="text-gray-600 text-lg">This is a blank preview page. The AI Agent widget should appear in the bottom right corner.</p>
            </div>
            ${lead.aiAgentSnippet}
          </body>
          </html>
        `;
        return (
          <iframe 
            srcDoc={mockHtml} 
            className="w-full h-screen border-none"
            title="AI Agent Preview"
          />
        );
      }
    }
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-zinc-800 mb-2">Preview Not Found</h1>
          <p className="text-zinc-500">The requested preview could not be found or has expired.</p>
        </div>
      </div>
    );
  }

  // Payment State
  const [paymentAmount, setPaymentAmount] = useState<string>('500');

  // Manual Lead State
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualLead, setManualLead] = useState({
    name: '',
    businessType: '',
    address: '',
    phone: '',
    email: '',
    websiteUrl: '',
    hasWebsite: false
  });

  // --- New Feature Functions ---
  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      setMediaRecorder(recorder);
      setAudioChunks([]);
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          setAudioChunks(prev => [...prev, e.data]);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string).split(',')[1];
          setLoading(true);
          try {
            const transcription = await transcribeAudio(base64Audio, 'audio/webm');
            setQuery(transcription);
          } catch (e) {
            console.error(e);
            alert("Failed to transcribe audio.");
          } finally {
            setLoading(false);
          }
        };
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone.");
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
    }
  };

  const handlePlayAudio = async (text: string, id: string) => {
    if (playingAudioId === id) {
      setPlayingAudioId(null);
      return;
    }
    setPlayingAudioId(id);
    try {
      const base64Audio = await generateSpeech(text, globalAIConfig.voiceName);
      if (base64Audio) {
        const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
        audio.onended = () => setPlayingAudioId(null);
        await audio.play();
      } else {
        setPlayingAudioId(null);
        alert("Failed to generate speech.");
      }
    } catch (e) {
      console.error(e);
      setPlayingAudioId(null);
    }
  };

  const handleDeepAnalysis = async (lead: Lead) => {
    setAnalyzingLeadId(lead.id);
    try {
      const analysis = await generateDeepAnalysis(lead.id);
      setDeepAnalysis(prev => ({ ...prev, [lead.id]: analysis }));
    } catch (e) {
      console.error(e);
      alert("Failed to generate deep analysis.");
    } finally {
      setAnalyzingLeadId(null);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    
    const newMessages = [...chatMessages, { role: 'user' as const, parts: [{ text: chatInput }] }];
    setChatMessages(newMessages);
    setChatInput('');
    setIsChatLoading(true);
    
    try {
      const response = await chatWithAI(chatInput, chatMessages);
      setChatMessages([...newMessages, { role: 'model' as const, parts: [{ text: response }] }]);
    } catch (e) {
      console.error(e);
      setChatMessages([...newMessages, { role: 'model' as const, parts: [{ text: "Sorry, I encountered an error. Please try again." }] }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // --- Search Phase Functions ---

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !location.trim()) return;
    setLoading(true);
    // We keep old leads until new ones arrive to avoid "clearing" feel, 
    // but we can clear them if the user wants via a separate button.
    setSelectedLead(null);
    try {
      console.log(`[LIVE SEARCH] Query: ${query}, Location: ${location}, Time: ${new Date().toISOString()}`);
      const results = await findLeads(query, location);
      console.log(`[LIVE SEARCH] Success: Found ${results.length} results.`);
      setLeads(results);
      if (user && results.length > 0) {
        await importDiscoveredLeads(results);
        await refreshPipeline();
      }
      if (results.length === 0) {
        alert("No leads found for this search. Try a different query or location.");
      }
    } catch (error: any) {
      console.error("Error finding leads:", error);
      const msg = error?.message || "";
      if (msg.includes("API_KEY_INVALID") || msg.includes("API key not valid")) {
        alert("Invalid API Key. Please check your GEMINI_API_KEY in Settings.");
      } else if (msg) {
        alert(`Lead search failed: ${msg}`);
      } else {
        alert("Failed to find leads. Please check your internet connection and API key settings.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLead = async (lead: Lead) => {
    setSelectedLead(lead);
    setGeneratingEmail(true);
    setEmailSubject('');
    setEmailDraft('');
    try {
      const draft = await generateOutreachEmail(lead, query);
      setEmailSubject(draft.subject);
      setEmailDraft(draft.body);
    } catch (error) {
      console.error("Error generating email:", error);
      setEmailSubject(`Quick idea for ${lead.name}`);
      setEmailDraft("Failed to generate email draft.");
    } finally {
      setGeneratingEmail(false);
    }
  };

  const handleSendEmail = async () => {
    if (!selectedLead || !user) return;
    if (!selectedLead.email?.trim()) {
      alert("Lead email is required before sending a real email.");
      return;
    }
    if (!emailSubject.trim() || !emailDraft.trim()) {
      alert("Subject and email body are required.");
      return;
    }

    try {
      const result = await sendOutreachEmail(selectedLead, query, emailSubject, emailDraft);
      const newPipelineLead: Lead = {
        ...selectedLead,
        ...result,
        status: 'EMAILED',
        businessType: query,
        emailDraft,
        emailSubject,
      };
      setLeads(leads.filter(l => l.id !== selectedLead.id));
      setSelectedLead(null);
      setEmailSubject('');
      setEmailDraft('');
      setActiveTab('pipeline');
      setPipeline((prev) => [newPipelineLead, ...prev.filter((lead) => lead.id !== newPipelineLead.id)]);
      setSelectedPipelineLead(newPipelineLead);
    } catch (error) {
      console.error("Send email failed", error);
      alert(error instanceof Error ? error.message : "Failed to send email.");
    }
  };

  // --- Pipeline Phase Functions ---

  const updatePipelineLead = async (id: string, updates: Partial<Lead>) => {
    if (!user) return;
    try {
      const savedLead = await upsertPipelineLead({ id, ...updates });
      setPipeline((prev) => {
        const existing = prev.filter((lead) => lead.id !== id);
        return [savedLead, ...existing];
      });
      if (selectedPipelineLead?.id === id) {
        setSelectedPipelineLead(savedLead);
      }
    } catch (error) {
      console.error("Pipeline update failed", error);
      alert(error instanceof Error ? error.message : "Failed to update pipeline lead.");
    }
  };

  const deleteLead = async (id: string) => {
    if (!user) return;
    if (!confirm("Are you sure you want to delete this lead?")) return;
    try {
      await deletePipelineLead(id);
      setPipeline((prev) => prev.filter((lead) => lead.id !== id));
      if (selectedPipelineLead?.id === id) setSelectedPipelineLead(null);
    } catch (error) {
      console.error("Delete failed", error);
      alert(error instanceof Error ? error.message : "Failed to delete lead.");
    }
  };

  const handleMarkAsResponded = (lead: Lead) => {
    updatePipelineLead(lead.id, { status: 'RESPONDED' });
  };

  const handleInitiateCall = async (lead: Lead) => {
    setPipelineActionLoading('calling');
    try {
      const result = await initiateLeadCall(lead.id);
      updatePipelineLead(lead.id, {
        status: 'RESPONDED',
        callStatus: result.status,
        lastCallSid: result.callSid,
      });
    } catch (error) {
      console.error("Call failed", error);
      alert(error instanceof Error ? error.message : "Real call failed.");
    } finally {
      setPipelineActionLoading(null);
    }
  };

  const handleDevelopWebsite = async (lead: Lead) => {
    setPipelineActionLoading('developing');
    try {
      const result = await generateWebsitePreview(lead.id, globalAIConfig);
      updatePipelineLead(lead.id, result);
    } catch (error) {
      console.error("Development failed", error);
      alert(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      setPipelineActionLoading(null);
    }
  };

  const handleDeliverAndCollect = async (lead: Lead) => {
    const amount = parseFloat(paymentAmount) || 0;
    if (amount <= 0) {
      alert("Please enter a valid amount.");
      return;
    }
    setPipelineActionLoading('invoicing');
    try {
      const checkout = await createCheckoutSession(lead.id, amount);
      updatePipelineLead(lead.id, {
        paymentAmount: amount,
        paymentMethod: 'Stripe Checkout',
        paymentStatus: 'CHECKOUT_CREATED',
        checkoutUrl: checkout.url,
      });
      window.open(checkout.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error("Checkout creation failed", error);
      alert(error instanceof Error ? error.message : "Failed to create checkout session.");
    } finally {
      setPipelineActionLoading(null);
    }
  };

  const handleSendFollowUp = async (lead: Lead) => {
    setPipelineActionLoading('followup');
    try {
      const followUp = await generateFollowUpEmail(lead.id);
      updatePipelineLead(lead.id, followUp);
    } catch (error) {
      console.error("Follow-up generation failed", error);
      alert(error instanceof Error ? error.message : "Failed to send follow-up email.");
    } finally {
      setPipelineActionLoading(null);
    }
  };

  const handleGeneratePipelineOutreach = async (lead: Lead) => {
    setGeneratingEmail(true);
    setEmailSubject('');
    setEmailDraft('');
    try {
      const draft = await generateOutreachEmail(lead, query || lead.businessType || 'business');
      setEmailSubject(draft.subject);
      setEmailDraft(draft.body);
    } catch (error) {
      console.error("Error generating email:", error);
      setEmailSubject(`Quick idea for ${lead.name}`);
      setEmailDraft("Failed to generate email draft. Please check your Gemini API key.");
    } finally {
      setGeneratingEmail(false);
    }
  };

  const handleSendPipelineEmail = async (lead: Lead) => {
    if (!user) return;
    if (!lead.email?.trim()) {
      alert("Lead email is required before sending a real email.");
      return;
    }
    if (!emailSubject.trim() || !emailDraft.trim()) {
      alert("Subject and email body are required.");
      return;
    }

    setPipelineActionLoading('emailing');
    try {
      const result = await sendOutreachEmail(lead, query || lead.businessType || 'business', emailSubject, emailDraft);
      const updatedLead: Lead = {
        ...lead,
        ...result,
        status: 'EMAILED',
        emailDraft,
        emailSubject,
      };
      
      // Update pipeline state
      setPipeline((prev) => prev.map(l => l.id === updatedLead.id ? updatedLead : l));
      setSelectedPipelineLead(updatedLead);
      
      // Clear draft state
      setEmailSubject('');
      setEmailDraft('');
    } catch (error) {
      console.error("Send pipeline email failed", error);
      alert(error instanceof Error ? error.message : "Failed to send email.");
    } finally {
      setPipelineActionLoading(null);
    }
  };

  const handleSaveEditedWebsite = async (lead: Lead) => {
    setPipelineActionLoading('redeploying');
    try {
      const result = await redeployWebsite(lead.id, editedCode);
      setPipeline((prev) => prev.map((item) => item.id === lead.id ? { ...item, ...result } : item));
      if (selectedAccountClient?.id === lead.id) {
        setSelectedAccountClient((prev) => prev ? { ...prev, ...result } : prev);
      }
      if (selectedPipelineLead?.id === lead.id) {
        setSelectedPipelineLead((prev) => prev ? { ...prev, ...result } : prev);
      }
      setIsEditingCode(false);
    } catch (error) {
      console.error("Redeploy failed", error);
      alert(error instanceof Error ? error.message : "Failed to redeploy website.");
    } finally {
      setPipelineActionLoading(null);
    }
  };

  const handleScheduleCall = (lead: Lead) => {
    if (!scheduledCallDate) return;
    updatePipelineLead(lead.id, { scheduledCall: scheduledCallDate });
    setScheduledCallDate('');
  };

  const handleAddTask = async (leadId: string) => {
    if (!newTaskTitle.trim()) return;
    
    const newTask: Task = {
      id: Math.random().toString(36).substring(2, 9),
      title: newTaskTitle,
      dueDate: newTaskDueDate || undefined,
      completed: false,
      createdAt: new Date().toISOString()
    };
    
    const lead = pipeline.find(l => l.id === leadId);
    if (!lead) return;
    
    const updatedTasks = [...(lead.tasks || []), newTask];
    await updatePipelineLead(leadId, { tasks: updatedTasks });
    setNewTaskTitle('');
    setNewTaskDueDate('');
  };

  const handleToggleTask = async (leadId: string, taskId: string) => {
    const lead = pipeline.find(l => l.id === leadId);
    if (!lead || !lead.tasks) return;
    
    const updatedTasks = lead.tasks.map(t => 
      t.id === taskId ? { ...t, completed: !t.completed } : t
    );
    
    await updatePipelineLead(leadId, { tasks: updatedTasks });
  };

  const handleDeleteTask = async (leadId: string, taskId: string) => {
    const lead = pipeline.find(l => l.id === leadId);
    if (!lead || !lead.tasks) return;
    
    const updatedTasks = lead.tasks.filter(t => t.id !== taskId);
    await updatePipelineLead(leadId, { tasks: updatedTasks });
  };

  const handleLogFollowUpSummary = (lead: Lead) => {
    if (!followUpSummaryInput) return;
    updatePipelineLead(lead.id, { followUpCallSummary: followUpSummaryInput });
    setFollowUpSummaryInput('');
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      handleLogin();
      return;
    }
    const leadId = Math.random().toString(36).substring(7);
    const newLead: Lead = {
      id: leadId,
      name: manualLead.name,
      businessType: manualLead.businessType,
      address: manualLead.address,
      phone: manualLead.phone,
      email: manualLead.email || undefined,
      websiteUrl: manualLead.websiteUrl || undefined,
      hasWebsite: manualLead.hasWebsite,
      status: 'DISCOVERED'
    };
    
    try {
      const savedLead = await upsertPipelineLead(newLead);
      setPipeline((prev) => [savedLead, ...prev.filter((lead) => lead.id !== savedLead.id)]);
      setSelectedPipelineLead(savedLead);
      setActiveTab('pipeline');
      setShowManualAdd(false);
      setManualLead({ name: '', businessType: '', address: '', phone: '', email: '', websiteUrl: '', hasWebsite: false });
      alert("Manual lead added to pipeline successfully!");
    } catch (error) {
      console.error("Manual lead add failed", error);
      alert(error instanceof Error ? error.message : "Failed to add manual lead.");
    }
  };

  const handleCopyPreviewLink = (leadId: string) => {
    const lead = pipeline.find(l => l.id === leadId);
    const url = lead?.liveSiteUrl || `${window.location.origin}?preview=${leadId}`;
    setShareLinkModal({
      isOpen: true,
      url,
      leadName: lead?.name || 'Client'
    });
  };

  // --- Render Helpers ---

  const calculateLeadScore = (lead: Lead): number => {
    let score = 0;
    
    // Base score by status
    switch (lead.status) {
      case 'DISCOVERED': score += 10; break;
      case 'EMAILED': score += 20; break;
      case 'RESPONDED': score += 40; break;
      case 'CALL_COMPLETED': score += 60; break;
      case 'PREVIEW_READY': score += 80; break;
      case 'DELIVERED': score += 100; break;
    }

    // Engagement modifiers
    if (lead.callTranscript) score += 15;
    if (deepAnalysis[lead.id]) score += 15;
    if (lead.requiresAIAgent) score += 10;
    if (lead.scheduledCall) score += 10;
    if (lead.followUpCallSummary) score += 10;
    if (lead.invoiceEmail) score += 10;
    if (lead.followUpEmail) score += 10;
    
    return Math.min(100, score);
  };

  const getLeadScoreBreakdown = (lead: Lead): { label: string, score: number }[] => {
    const breakdown: { label: string, score: number }[] = [];
    
    // Base score by status
    switch (lead.status) {
      case 'DISCOVERED': breakdown.push({ label: 'Status: Discovered', score: 10 }); break;
      case 'EMAILED': breakdown.push({ label: 'Status: Emailed', score: 20 }); break;
      case 'RESPONDED': breakdown.push({ label: 'Status: Responded', score: 40 }); break;
      case 'CALL_COMPLETED': breakdown.push({ label: 'Status: Call Completed', score: 60 }); break;
      case 'PREVIEW_READY': breakdown.push({ label: 'Status: Preview Ready', score: 80 }); break;
      case 'DELIVERED': breakdown.push({ label: 'Status: Delivered', score: 100 }); break;
    }

    // Engagement modifiers
    if (lead.callTranscript) breakdown.push({ label: 'Call Transcript', score: 15 });
    if (deepAnalysis[lead.id]) breakdown.push({ label: 'Deep Analysis', score: 15 });
    if (lead.requiresAIAgent) breakdown.push({ label: 'AI Agent Required', score: 10 });
    if (lead.scheduledCall) breakdown.push({ label: 'Scheduled Call', score: 10 });
    if (lead.followUpCallSummary) breakdown.push({ label: 'Follow-up Summary', score: 10 });
    if (lead.invoiceEmail) breakdown.push({ label: 'Invoice Sent', score: 10 });
    if (lead.followUpEmail) breakdown.push({ label: 'Follow-up Email', score: 10 });
    
    return breakdown;
  };

  const getStatusBadge = (status: LeadStatus) => {
    switch(status) {
      case 'DISCOVERED': return <span className="px-2 py-1 bg-zinc-100 text-zinc-600 text-xs rounded-md border border-zinc-200">Discovered</span>;
      case 'EMAILED': return <span className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-md border border-blue-200">Emailed</span>;
      case 'RESPONDED': return <span className="px-2 py-1 bg-purple-50 text-purple-700 text-xs rounded-md border border-purple-200">Responded</span>;
      case 'CALL_COMPLETED': return <span className="px-2 py-1 bg-amber-50 text-amber-700 text-xs rounded-md border border-amber-200">Call Done</span>;
      case 'PREVIEW_READY': return <span className="px-2 py-1 bg-indigo-50 text-indigo-700 text-xs rounded-md border border-indigo-200">Preview Ready</span>;
      case 'DELIVERED': return <span className="px-2 py-1 bg-emerald-50 text-emerald-700 text-xs rounded-md border border-emerald-200">Delivered & Paid</span>;
      default: return null;
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl border border-zinc-200 shadow-xl text-center">
          <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <Globe className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-zinc-900 mb-2">Welcome to LeadGen AI</h2>
          <p className="text-zinc-600 mb-8">Sign in with your Google account to access your lead generation dashboard.</p>
          <button 
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {isLoggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
            {isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <AppErrorBoundary>
      <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">LeadGen AI</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex bg-zinc-100 p-1 rounded-lg">
            <button 
              onClick={() => setActiveTab('search')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 transition-all ${activeTab === 'search' ? 'bg-white shadow-sm text-indigo-600' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              <Search className="w-4 h-4" /> Find Leads
            </button>
            <button 
              onClick={() => setActiveTab('pipeline')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 transition-all ${activeTab === 'pipeline' ? 'bg-white shadow-sm text-indigo-600' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              <LayoutDashboard className="w-4 h-4" /> Pipeline
              {pipeline.filter(l => l.status !== 'DELIVERED').length > 0 && (
                <span className="bg-indigo-100 text-indigo-700 text-xs px-1.5 py-0.5 rounded-full">{pipeline.filter(l => l.status !== 'DELIVERED').length}</span>
              )}
            </button>
            <button 
              onClick={() => setActiveTab('ai-config')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 transition-all ${activeTab === 'ai-config' ? 'bg-white shadow-sm text-indigo-600' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              <Bot className="w-4 h-4" /> AI Agents
            </button>
            <button 
              onClick={() => {
                setActiveTab('accounts');
                setSelectedAccountClient(null);
              }}
              className={`px-4 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 transition-all ${activeTab === 'accounts' ? 'bg-white shadow-sm text-indigo-600' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              <Wallet className="w-4 h-4" /> Accounts
            </button>
          </div>

          <div className="h-8 w-px bg-zinc-200 mx-2 hidden md:block" />
          
          <div className="flex items-center gap-3">
            <div className="text-right hidden lg:block">
              <p className="text-sm font-medium text-zinc-900">{user?.displayName}</p>
              <p className="text-xs text-zinc-500">{user?.email}</p>
            </div>
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-zinc-200" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-8 h-8 bg-zinc-100 rounded-full flex items-center justify-center border border-zinc-200">
                <Users className="w-4 h-4 text-zinc-400" />
              </div>
            )}
            <button 
              onClick={handleLogout}
              className="p-2 text-zinc-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {activeTab === 'search' && (
          <>
            {/* Left Panel: Search & Results */}
            <div className="w-full md:w-1/2 lg:w-3/5 flex flex-col border-r border-zinc-200 bg-white overflow-hidden">
              <div className="p-6 border-b border-zinc-200">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold">Find Local Businesses</h2>
                  <button 
                    onClick={() => setShowManualAdd(true)}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1 bg-indigo-50 px-3 py-1.5 rounded-md transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Add Manual Lead
                  </button>
                </div>
                <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 relative">
                    <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Business type (e.g., Plumbers)"
                      className="w-full pl-9 pr-10 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                      required
                    />
                    <button
                      type="button"
                      onClick={isRecording ? handleStopRecording : handleStartRecording}
                      className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-colors ${isRecording ? 'bg-red-100 text-red-600 animate-pulse' : 'text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
                      title={isRecording ? "Stop recording" : "Use voice input"}
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Location (e.g., Austin, TX)"
                      className="w-full pl-9 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                      required
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-70 whitespace-nowrap"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      Search
                    </button>
                    {leads.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setLeads([])}
                        className="px-3 py-2 bg-white border border-zinc-200 text-zinc-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="Clear results"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </form>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-zinc-50/50">
                {loading ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-400 space-y-4">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                    <p className="text-sm font-medium animate-pulse">Scanning Google Maps for leads...</p>
                  </div>
                ) : leads.length > 0 ? (
                  <div className="space-y-3">
                    {leads.map((lead) => (
                      <div
                        key={lead.id}
                        onClick={() => handleSelectLead(lead)}
                        className={`p-4 rounded-xl border transition-all cursor-pointer ${
                          selectedLead?.id === lead.id
                            ? 'bg-indigo-50/50 border-indigo-200 shadow-sm'
                            : 'bg-white border-zinc-200 hover:border-indigo-300 hover:shadow-sm'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-semibold text-zinc-900">
                            {lead.placeUri ? (
                              <a href={lead.placeUri} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600 hover:underline inline-flex items-center gap-1">
                                {lead.name} <Link className="w-3 h-3" />
                              </a>
                            ) : lead.name}
                          </h3>
                          {lead.hasWebsite ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200/50">
                              <CheckCircle2 className="w-3 h-3" /> Has Website
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200/50">
                              <XCircle className="w-3 h-3" /> No Website
                            </span>
                          )}
                        </div>
                        <div className="space-y-1.5 text-sm text-zinc-600">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3.5 h-3.5 text-zinc-400" />
                            <span className="truncate">{lead.address}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Phone className="w-3.5 h-3.5 text-zinc-400" />
                            <span>{lead.phone}</span>
                          </div>
                          {lead.email && (
                            <div className="flex items-center gap-2">
                              <Mail className="w-3.5 h-3.5 text-zinc-400" />
                              <span className="truncate">{lead.email}</span>
                            </div>
                          )}
                          {lead.websiteUrl && (
                            <div className="flex items-center gap-2">
                              <Globe className="w-3.5 h-3.5 text-zinc-400" />
                              <a href={lead.websiteUrl} target="_blank" rel="noopener noreferrer" className="truncate text-indigo-600 hover:underline">
                                {lead.websiteUrl}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-400 space-y-2">
                    <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mb-2">
                      <Search className="w-6 h-6 text-zinc-300" />
                    </div>
                    <p className="text-sm font-medium">No leads found yet</p>
                    <p className="text-xs text-zinc-500">Enter a business type and location to start searching.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: Outreach */}
            <div className="hidden md:flex w-1/2 lg:w-2/5 flex-col bg-zinc-50">
              {selectedLead ? (
                <div className="flex-1 flex flex-col h-full">
                  <div className="p-6 border-b border-zinc-200 bg-white">
                    <h2 className="text-lg font-semibold mb-1">Outreach Campaign</h2>
                    <p className="text-sm text-zinc-500">Drafting email for {selectedLead.name}</p>
                  </div>
                  
                  <div className="flex-1 p-6 overflow-y-auto">
                    <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden flex flex-col h-full">
                      <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-3 flex items-center gap-3">
                        <div className="w-8 h-8 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center">
                          <Mail className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">To</div>
                          <div className="text-sm font-medium text-zinc-900">{selectedLead.name}</div>
                          <input
                            type="email"
                            value={selectedLead.email || ''}
                            onChange={(e) => setSelectedLead(prev => prev ? { ...prev, email: e.target.value } : prev)}
                            placeholder="client@business.com"
                            className="mt-2 w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                          />
                        </div>
                      </div>

                      <div className="px-5 pt-5">
                        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Subject</label>
                        <input
                          type="text"
                          value={emailSubject}
                          onChange={(e) => setEmailSubject(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                          placeholder="Subject line"
                        />
                      </div>
                      
                      <div className="flex-1 p-5 pt-4 relative">
                        {generatingEmail ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm z-10">
                            <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mb-3" />
                            <p className="text-sm font-medium text-zinc-600">AI is drafting your email...</p>
                          </div>
                        ) : null}
                        
                        <textarea
                          value={emailDraft}
                          onChange={(e) => setEmailDraft(e.target.value)}
                          className="w-full h-full resize-none border-0 focus:ring-0 p-0 text-sm text-zinc-700 leading-relaxed bg-transparent"
                          placeholder="Email draft will appear here..."
                        />
                      </div>
                      
                      <div className="p-4 border-t border-zinc-200 bg-zinc-50 flex justify-between items-center gap-3">
                        <button 
                          onClick={() => handlePlayAudio(emailDraft, 'email')}
                          className={`text-xs font-medium flex items-center gap-1 px-3 py-2 rounded-lg transition-colors ${playingAudioId === 'email' ? 'bg-indigo-100 text-indigo-700' : 'text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900'}`}
                        >
                          <Volume2 className="w-4 h-4" /> {playingAudioId === 'email' ? 'Playing...' : 'Listen'}
                        </button>
                        <button 
                          onClick={handleSendEmail}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2"
                        >
                          <Mail className="w-4 h-4" />
                          Send Real Email
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-zinc-400 p-8 text-center">
                  <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mb-4">
                    <Mail className="w-6 h-6 text-zinc-300" />
                  </div>
                  <h3 className="text-base font-medium text-zinc-900 mb-2">Select a lead to start outreach</h3>
                  <p className="text-sm text-zinc-500 max-w-xs">
                    Click on any business from the search results to automatically generate a personalized cold outreach email.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
        
        {activeTab === 'pipeline' && (
          <>
            {/* Pipeline Left Panel: List */}
            <div className="w-full md:w-1/3 border-r border-zinc-200 bg-white overflow-y-auto">
              <div className="p-4 border-b border-zinc-200 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
                <h2 className="text-lg font-semibold">Active Pipeline</h2>
              </div>
              <div className="p-4 space-y-6">
                {pipeline.length === 0 ? (
                  <div className="text-center py-8 text-zinc-500 text-sm">
                    No leads in pipeline yet.
                  </div>
                ) : (
                  STATUS_GROUPS.map(group => {
                    const leadsInGroup = pipeline.filter(l => l.status === group.status)
                      .sort((a, b) => calculateLeadScore(b) - calculateLeadScore(a));
                    
                    if (leadsInGroup.length === 0) return null;

                    return (
                      <div key={group.status} className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                          <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{group.label}</h3>
                          <span className="text-[10px] font-medium bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">{leadsInGroup.length}</span>
                        </div>
                        <div className="space-y-2">
                          {leadsInGroup.map(lead => (
                            <div 
                              key={lead.id}
                              onClick={() => setSelectedPipelineLead(lead)}
                              className={`p-3 rounded-lg border cursor-pointer transition-all ${
                                selectedPipelineLead?.id === lead.id 
                                  ? 'bg-indigo-50 border-indigo-200 shadow-sm' 
                                  : 'bg-white border-zinc-200 hover:border-indigo-200'
                              }`}
                            >
                              <div className="flex justify-between items-start mb-1">
                                <div className="font-medium text-zinc-900 text-sm">{lead.name}</div>
                                <div className="flex items-center gap-2">
                                  {lead.scheduledCall && !lead.followUpCallSummary && (
                                    <Calendar className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                  )}
                                  <div className={`flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                    calculateLeadScore(lead) >= 80 ? 'bg-orange-100 text-orange-700' :
                                    calculateLeadScore(lead) >= 40 ? 'bg-amber-100 text-amber-700' :
                                    'bg-zinc-100 text-zinc-600'
                                  }`}>
                                    <Flame className="w-3 h-3" />
                                    {calculateLeadScore(lead)}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <div className="text-xs text-zinc-500 truncate pr-2">{lead.businessType}</div>
                                {getStatusBadge(lead.status)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Pipeline Right Panel: Details & Actions */}
            <div className="w-full md:w-2/3 bg-zinc-50 flex flex-col">
              {selectedPipelineLead ? (
                <div className="flex-1 flex flex-col h-full overflow-hidden">
                  <div className="p-6 border-b border-zinc-200 bg-white flex justify-between items-start">
                    <div>
                      <h2 className="text-2xl font-bold text-zinc-900 mb-1">{selectedPipelineLead.name}</h2>
                      <div className="flex items-center gap-4 text-sm text-zinc-500">
                        <span className="flex items-center gap-1"><Phone className="w-4 h-4" /> {selectedPipelineLead.phone}</span>
                        <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {selectedPipelineLead.address}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {getStatusBadge(selectedPipelineLead.status)}
                      <div className="group relative">
                        <div className={`flex items-center gap-1 text-sm font-bold px-2 py-1 rounded cursor-help ${
                          calculateLeadScore(selectedPipelineLead) >= 80 ? 'bg-orange-100 text-orange-700' :
                          calculateLeadScore(selectedPipelineLead) >= 40 ? 'bg-amber-100 text-amber-700' :
                          'bg-zinc-100 text-zinc-600'
                        }`}>
                          <Flame className="w-4 h-4" />
                          {calculateLeadScore(selectedPipelineLead)} Score
                        </div>
                        {/* Tooltip for Score Breakdown */}
                        <div className="absolute right-0 top-full mt-2 w-64 bg-zinc-900 text-white text-xs rounded-lg p-3 shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                          <div className="font-bold mb-2 text-zinc-300 border-b border-zinc-700 pb-1">Score Breakdown</div>
                          <div className="space-y-1.5">
                            {getLeadScoreBreakdown(selectedPipelineLead).map((item, i) => (
                              <div key={i} className="flex justify-between items-center">
                                <span className="text-zinc-400">{item.label}</span>
                                <span className="font-mono text-emerald-400">+{item.score}</span>
                              </div>
                            ))}
                            {getLeadScoreBreakdown(selectedPipelineLead).reduce((sum, item) => sum + item.score, 0) > 100 && (
                              <div className="pt-2 mt-2 border-t border-zinc-700 text-zinc-500 text-[10px] text-right">
                                Score is capped at 100
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-3xl mx-auto space-y-6">
                      
                      {/* Task Manager Section */}
                      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                            <ListTodo className="w-4 h-4 text-indigo-600" /> Lead Tasks
                          </h3>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 bg-white px-2 py-0.5 rounded border border-zinc-200">
                            {selectedPipelineLead.tasks?.filter(t => t.completed).length || 0} / {selectedPipelineLead.tasks?.length || 0} Complete
                          </span>
                        </div>
                        <div className="p-6">
                          {/* Add Task Form */}
                          <div className="flex flex-col sm:flex-row gap-3 mb-6">
                            <div className="flex-1">
                              <input 
                                type="text"
                                value={newTaskTitle}
                                onChange={(e) => setNewTaskTitle(e.target.value)}
                                placeholder="Add a new task..."
                                className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                                onKeyDown={(e) => e.key === 'Enter' && handleAddTask(selectedPipelineLead.id)}
                              />
                            </div>
                            <div className="w-full sm:w-48">
                              <input 
                                type="date"
                                value={newTaskDueDate}
                                onChange={(e) => setNewTaskDueDate(e.target.value)}
                                className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                              />
                            </div>
                            <button 
                              onClick={() => handleAddTask(selectedPipelineLead.id)}
                              disabled={!newTaskTitle.trim()}
                              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                              <Plus className="w-4 h-4" /> Add
                            </button>
                          </div>

                          {/* Task List */}
                          <div className="space-y-2">
                            {(!selectedPipelineLead.tasks || selectedPipelineLead.tasks.length === 0) ? (
                              <div className="text-center py-8 bg-zinc-50 rounded-lg border border-dashed border-zinc-200">
                                <ListTodo className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
                                <p className="text-sm text-zinc-500">No tasks yet. Add one to stay organized!</p>
                              </div>
                            ) : (
                              selectedPipelineLead.tasks.sort((a, b) => {
                                if (a.completed !== b.completed) return a.completed ? 1 : -1;
                                return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                              }).map(task => (
                                <div 
                                  key={task.id}
                                  className={`flex items-center justify-between p-3 rounded-lg border transition-all ${task.completed ? 'bg-zinc-50 border-zinc-100 opacity-60' : 'bg-white border-zinc-200 hover:border-indigo-200 shadow-sm'}`}
                                >
                                  <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <button 
                                      onClick={() => handleToggleTask(selectedPipelineLead.id, task.id)}
                                      className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${task.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-zinc-300 hover:border-indigo-500'}`}
                                    >
                                      {task.completed && <CheckCircle2 className="w-3.5 h-3.5" />}
                                    </button>
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-sm font-medium truncate ${task.completed ? 'text-zinc-500 line-through' : 'text-zinc-900'}`}>
                                        {task.title}
                                      </p>
                                      {task.dueDate && (
                                        <div className="flex items-center gap-1 mt-0.5">
                                          <Clock className="w-3 h-3 text-zinc-400" />
                                          <span className={`text-[10px] font-medium ${new Date(task.dueDate) < new Date() && !task.completed ? 'text-red-500' : 'text-zinc-400'}`}>
                                            Due: {new Date(task.dueDate).toLocaleDateString()}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <button 
                                    onClick={() => handleDeleteTask(selectedPipelineLead.id, task.id)}
                                    className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all ml-2"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                      
                       {/* Stage 1: Outreach */}
                      <div className={`p-6 rounded-xl border ${['DISCOVERED', 'EMAILED'].includes(selectedPipelineLead.status) ? 'bg-white border-indigo-200 shadow-sm ring-1 ring-indigo-500/10' : 'bg-zinc-100/50 border-zinc-200 opacity-70'}`}>
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center"><Mail className="w-4 h-4" /></div>
                          <h3 className="text-lg font-semibold">1. Initial Outreach</h3>
                        </div>

                        {selectedPipelineLead.status === 'DISCOVERED' && (
                          <div className="space-y-4">
                            {!emailDraft && !generatingEmail ? (
                              <div className="space-y-3">
                                <p className="text-sm text-zinc-600">
                                  This lead is new. Generate a personalized AI outreach email to start the conversation.
                                </p>
                                <button 
                                  onClick={() => handleGeneratePipelineOutreach(selectedPipelineLead)}
                                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
                                >
                                  {generatingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                  Generate AI Outreach Draft
                                </button>
                              </div>
                            ) : (
                              <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4 space-y-4 relative overflow-hidden">
                                {generatingEmail && (
                                  <div className="absolute inset-0 bg-white/80 backdrop-blur-[1px] flex flex-col items-center justify-center z-10">
                                    <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mb-2" />
                                    <span className="text-xs font-medium text-zinc-500">Generating draft...</span>
                                  </div>
                                )}
                                <div className="space-y-3">
                                  <div>
                                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">To</label>
                                    <input
                                      type="email"
                                      value={selectedPipelineLead.email || ''}
                                      onChange={(e) => updatePipelineLead(selectedPipelineLead.id, { email: e.target.value })}
                                      className="w-full px-3 py-1.5 bg-white border border-zinc-200 rounded text-sm"
                                      placeholder="client@email.com"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Subject</label>
                                    <input
                                      type="text"
                                      value={emailSubject}
                                      onChange={(e) => setEmailSubject(e.target.value)}
                                      className="w-full px-3 py-1.5 bg-white border border-zinc-200 rounded text-sm"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Message Body</label>
                                    <textarea
                                      value={emailDraft}
                                      onChange={(e) => setEmailDraft(e.target.value)}
                                      className="w-full h-48 px-3 py-2 bg-white border border-zinc-200 rounded text-sm resize-none"
                                    />
                                  </div>
                                  <div className="flex justify-between items-center pt-2">
                                    <button 
                                      onClick={() => handleGeneratePipelineOutreach(selectedPipelineLead)}
                                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                                    >
                                      Regenerate Draft
                                    </button>
                                    <button 
                                      onClick={() => handleSendPipelineEmail(selectedPipelineLead)}
                                      disabled={pipelineActionLoading === 'emailing'}
                                      className="px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-lg hover:bg-zinc-800 transition-colors flex items-center gap-2 disabled:opacity-50"
                                    >
                                      {pipelineActionLoading === 'emailing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                                      Send Real Email
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {selectedPipelineLead.status === 'EMAILED' && (
                          <div className="space-y-4">
                            <p className="text-sm text-zinc-600">
                              Real email sent{selectedPipelineLead.email ? ` to ${selectedPipelineLead.email}` : ''}. Move the lead forward once they actually reply.
                            </p>
                            <button 
                              onClick={() => handleMarkAsResponded(selectedPipelineLead)}
                              className="px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-lg hover:bg-zinc-800 transition-colors"
                            >
                              Mark as Replied
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Stage 2: Responded & AI Call */}
                      {(['RESPONDED', 'CALL_COMPLETED', 'PREVIEW_READY', 'DELIVERED'].includes(selectedPipelineLead.status)) && (
                        <div className={`p-6 rounded-xl border ${selectedPipelineLead.status === 'RESPONDED' ? 'bg-white border-indigo-200 shadow-sm ring-1 ring-indigo-500/10' : 'bg-zinc-100/50 border-zinc-200 opacity-70'}`}>
                          <div className="flex items-center gap-3 mb-4">
                            <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center"><PhoneCall className="w-4 h-4" /></div>
                            <h3 className="text-lg font-semibold">2. Real Voice Call</h3>
                          </div>
                          
                          {selectedPipelineLead.status === 'RESPONDED' && (
                            <div className="space-y-4">
                              <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg text-sm text-purple-800">
                                Lead is marked as interested. Start a real outbound call to gather requirements and qualify the project.
                              </div>
                              {selectedPipelineLead.callStatus && (
                                <div className="text-xs font-medium text-zinc-500">
                                  Current call status: <span className="text-zinc-900">{selectedPipelineLead.callStatus}</span>
                                </div>
                              )}
                              <button 
                                onClick={() => handleInitiateCall(selectedPipelineLead)}
                                disabled={pipelineActionLoading === 'calling' || ['queued', 'ringing', 'in-progress', 'answered', 'initiated'].includes(selectedPipelineLead.callStatus || '')}
                                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-70"
                              >
                                {pipelineActionLoading === 'calling' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                Start Real Call
                              </button>
                            </div>
                          )}

                          {['CALL_COMPLETED', 'PREVIEW_READY', 'DELIVERED'].includes(selectedPipelineLead.status) && (
                            <div className="space-y-4">
                              {selectedPipelineLead.requiresAIAgent && (
                                <div className="flex items-center gap-3 text-indigo-700 bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                                  <Bot className="w-5 h-5" />
                                  <div>
                                    <p className="font-semibold text-sm">AI Upsell Successful!</p>
                                    <p className="text-xs">Client requested: {selectedPipelineLead.aiAgentType}</p>
                                  </div>
                                </div>
                              )}
                              <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                                    <FileText className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-bold text-zinc-900">Call Completed</h4>
                                    <p className="text-xs text-zinc-500 line-clamp-1">{selectedPipelineLead.callSummary?.substring(0, 60)}...</p>
                                  </div>
                                </div>
                                <button
                                  onClick={() => setShowCallDetailsModal(selectedPipelineLead)}
                                  className="px-4 py-2 bg-white border border-zinc-200 text-zinc-700 text-sm font-medium rounded-lg hover:bg-zinc-50 transition-colors flex items-center justify-center gap-2 shrink-0"
                                >
                                  <MessageSquare className="w-4 h-4" /> View Call Details
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Stage 3: AI Web Developer */}
                      {(['CALL_COMPLETED', 'PREVIEW_READY', 'DELIVERED'].includes(selectedPipelineLead.status)) && (
                        <div className={`p-6 rounded-xl border ${selectedPipelineLead.status === 'CALL_COMPLETED' ? 'bg-white border-indigo-200 shadow-sm ring-1 ring-indigo-500/10' : 'bg-zinc-100/50 border-zinc-200 opacity-70'}`}>
                          <div className="flex items-center gap-3 mb-4">
                            <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center"><Code className="w-4 h-4" /></div>
                            <h3 className="text-lg font-semibold">3. Build & Publish</h3>
                          </div>

                          {selectedPipelineLead.status === 'CALL_COMPLETED' && (
                            <div className="space-y-4">
                              <p className="text-sm text-zinc-600">
                                Requirements captured. Generate the {selectedPipelineLead.hasWebsite ? 'integration snippet' : 'live website'} now.
                              </p>
                              <button 
                                onClick={() => handleDevelopWebsite(selectedPipelineLead)}
                                disabled={pipelineActionLoading === 'developing'}
                                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-70"
                              >
                                {pipelineActionLoading === 'developing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Code className="w-4 h-4" />}
                                {selectedPipelineLead.hasWebsite ? 'Generate Integration Snippet' : 'Generate & Publish Live Website'}
                              </button>
                            </div>
                          )}

                          {selectedPipelineLead.aiAgentConfig && (
                            <div className="mt-4 p-3 bg-zinc-50 rounded-lg border border-zinc-200 text-[10px] text-zinc-600">
                              <div className="font-bold uppercase tracking-wider mb-1 flex items-center gap-1 text-zinc-400"><Bot className="w-3 h-3"/> Applied AI Config</div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                <div><span className="font-medium">Name:</span> {selectedPipelineLead.aiAgentConfig.chatbotName}</div>
                                <div><span className="font-medium">Style:</span> {selectedPipelineLead.aiAgentConfig.responseStyle}</div>
                                <div><span className="font-medium">Lang:</span> {selectedPipelineLead.aiAgentConfig.language}</div>
                                <div><span className="font-medium">Voice:</span> {selectedPipelineLead.aiAgentConfig.voiceName}</div>
                              </div>
                            </div>
                          )}

                          {['PREVIEW_READY', 'DELIVERED'].includes(selectedPipelineLead.status) && (
                            <div className="space-y-4">
                              {selectedPipelineLead.hasWebsite ? (
                                <div className="flex items-center gap-3 text-indigo-700 bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                                  <CheckCircle2 className="w-6 h-6" />
                                  <div className="flex-1">
                                    <p className="font-semibold">Integration snippet ready</p>
                                    <p className="text-sm">Share the hosted preview or copy the code for the client's existing site.</p>
                                  </div>
                                  {selectedPipelineLead.liveSiteUrl && (
                                    <a
                                      href={selectedPipelineLead.liveSiteUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="px-3 py-1.5 bg-white text-emerald-700 border border-emerald-200 text-sm font-medium rounded hover:bg-emerald-50 transition-colors flex items-center gap-1.5"
                                    >
                                      <ExternalLink className="w-4 h-4" /> Open Live
                                    </a>
                                  )}
                                  <button 
                                    onClick={() => handleCopyPreviewLink(selectedPipelineLead.id)}
                                    className="px-3 py-1.5 bg-white text-indigo-600 border border-indigo-200 text-sm font-medium rounded hover:bg-indigo-50 transition-colors flex items-center gap-1.5"
                                  >
                                    <Share2 className="w-4 h-4" /> Share Link
                                  </button>
                                </div>
                              ) : (
                                <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
                                  <div className="bg-zinc-100 px-3 py-2 border-b border-zinc-200 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <div className="flex gap-1.5">
                                        <div className="w-2.5 h-2.5 rounded-full bg-red-400"></div>
                                        <div className="w-2.5 h-2.5 rounded-full bg-amber-400"></div>
                                        <div className="w-2.5 h-2.5 rounded-full bg-green-400"></div>
                                      </div>
                                      <div className="text-xs text-zinc-500 font-mono ml-2">
                                        {selectedPipelineLead.liveSiteUrl || `preview.local/${selectedPipelineLead.name.toLowerCase().replace(/\s+/g, '-')}`}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {selectedPipelineLead.liveSiteUrl && (
                                        <a
                                          href={selectedPipelineLead.liveSiteUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-1 bg-white px-2 py-1 rounded border border-zinc-200 shadow-sm"
                                        >
                                          <ExternalLink className="w-3 h-3" /> Open Live
                                        </a>
                                      )}
                                      <button 
                                        onClick={() => handleCopyPreviewLink(selectedPipelineLead.id)}
                                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1 bg-white px-2 py-1 rounded border border-zinc-200 shadow-sm"
                                      >
                                        <Share2 className="w-3 h-3" /> Share
                                      </button>
                                    </div>
                                  </div>
                                  <iframe 
                                    srcDoc={selectedPipelineLead.websiteCode} 
                                    className="w-full h-64 bg-white"
                                    title="Website Preview"
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Stage 4: Delivery & Payment */}
                      {(['PREVIEW_READY', 'DELIVERED'].includes(selectedPipelineLead.status)) && (
                        <div className={`p-6 rounded-xl border ${selectedPipelineLead.status === 'PREVIEW_READY' ? 'bg-white border-indigo-200 shadow-sm ring-1 ring-indigo-500/10' : 'bg-emerald-50 border-emerald-200'}`}>
                          <div className="flex items-center gap-3 mb-4">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${selectedPipelineLead.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-600' : 'bg-emerald-100 text-emerald-600'}`}>
                              <CreditCard className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-semibold">4. Delivery & Payment</h3>
                          </div>

                          {selectedPipelineLead.status === 'PREVIEW_READY' && (
                            <div className="space-y-4">
                              <p className="text-sm text-zinc-600">
                                {selectedPipelineLead.hasWebsite ? 'The integration snippet is ready.' : 'The live site is published.'} Create a Stripe checkout link to collect payment.
                              </p>
                              
                              {selectedPipelineLead.websiteCode && (
                                <div className="bg-zinc-900 rounded-lg p-3">
                                  <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Code className="w-3 h-3"/> Generated Website Code</h4>
                                  <pre className="text-xs text-zinc-300 overflow-y-auto max-h-32 font-mono">{selectedPipelineLead.websiteCode}</pre>
                                </div>
                              )}

                              {selectedPipelineLead.aiAgentSnippet && (
                                <div className="bg-zinc-900 rounded-lg p-3">
                                  <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1"><Code className="w-3 h-3"/> Generated AI Agent Snippet</h4>
                                  <pre className="text-xs text-zinc-300 overflow-y-auto max-h-32 font-mono">{selectedPipelineLead.aiAgentSnippet}</pre>
                                </div>
                              )}
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs font-medium text-zinc-700 mb-1">Amount ($)</label>
                                  <input 
                                    type="number" 
                                    value={paymentAmount}
                                    onChange={(e) => setPaymentAmount(e.target.value)}
                                    className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                                  />
                                </div>
                                <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-sm text-zinc-600 flex items-center">
                                  Stripe Checkout will generate the payment link and webhook-confirm the payment automatically.
                                </div>
                              </div>

                              <button 
                                onClick={() => handleDeliverAndCollect(selectedPipelineLead)}
                                disabled={pipelineActionLoading === 'invoicing'}
                                className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2 disabled:opacity-70"
                              >
                                {pipelineActionLoading === 'invoicing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                                Create Stripe Checkout Link
                              </button>
                              {selectedPipelineLead.checkoutUrl && (
                                <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  <div className="text-sm text-zinc-600 break-all">{selectedPipelineLead.checkoutUrl}</div>
                                  <a
                                    href={selectedPipelineLead.checkoutUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-3 py-2 bg-zinc-900 text-white text-sm font-medium rounded-lg hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2"
                                  >
                                    <ExternalLink className="w-4 h-4" /> Open Checkout
                                  </a>
                                </div>
                              )}
                            </div>
                          )}

                          {selectedPipelineLead.status === 'DELIVERED' && (
                            <div className="space-y-4">
                              <div className="flex items-center gap-3 text-emerald-700 bg-emerald-100/50 p-4 rounded-lg border border-emerald-200">
                                <CheckCircle2 className="w-6 h-6" />
                                <div>
                                  <p className="font-semibold">Payment Collected & Invoiced!</p>
                                  <p className="text-sm">Amount: ${selectedPipelineLead.paymentAmount} via {selectedPipelineLead.paymentMethod} (Ref: {selectedPipelineLead.transactionId})</p>
                                </div>
                              </div>
                              <div className="bg-white border border-emerald-200 rounded-lg p-4 max-h-48 overflow-y-auto">
                                <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-2 flex items-center gap-1"><Mail className="w-3 h-3"/> Invoice Email Sent</h4>
                                <p className="text-xs text-zinc-700 whitespace-pre-wrap">{selectedPipelineLead.invoiceEmail}</p>
                              </div>
                              
                              {selectedPipelineLead.followUpEmail ? (
                                <div className="bg-white border border-indigo-200 rounded-lg p-4 max-h-48 overflow-y-auto relative">
                                  <div className="absolute top-4 right-4 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded uppercase tracking-wider">Automated</div>
                                  <h4 className="text-xs font-bold text-indigo-700 uppercase tracking-wider mb-2 flex items-center gap-1"><Mail className="w-3 h-3"/> Follow-up Email Sent</h4>
                                  <p className="text-xs text-zinc-700 whitespace-pre-wrap">{selectedPipelineLead.followUpEmail}</p>
                                </div>
                              ) : (
                                <button 
                                  onClick={() => handleSendFollowUp(selectedPipelineLead)}
                                  disabled={pipelineActionLoading === 'followup'}
                                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-70"
                                >
                                  {pipelineActionLoading === 'followup' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                  Regenerate & Resend Follow-up
                                </button>
                              )}

                              <div className="pt-4 border-t border-zinc-200 mt-6">
                                <h4 className="text-sm font-bold text-zinc-900 mb-4 flex items-center gap-2">
                                  <PhoneCall className="w-4 h-4 text-indigo-600" /> Ongoing Support & Follow-up
                                </h4>
                                
                                {!selectedPipelineLead.scheduledCall ? (
                                  <div className="bg-white border border-zinc-200 rounded-lg p-4 space-y-3">
                                    <label className="block text-xs font-medium text-zinc-700">Schedule Follow-up Call</label>
                                    <div className="flex items-center gap-2">
                                      <input 
                                        type="datetime-local" 
                                        value={scheduledCallDate}
                                        onChange={(e) => setScheduledCallDate(e.target.value)}
                                        className="flex-1 px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                                      />
                                      <button 
                                        onClick={() => handleScheduleCall(selectedPipelineLead)}
                                        disabled={!scheduledCallDate}
                                        className="px-4 py-2 bg-zinc-900 text-white text-sm font-medium rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"
                                      >
                                        Schedule
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-4">
                                    <div className="flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-lg p-4">
                                      <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                                          <Calendar className="w-4 h-4" />
                                        </div>
                                        <div>
                                          <p className="text-xs font-medium text-indigo-900">Follow-up Call Scheduled</p>
                                          <p className="text-sm text-indigo-700 font-semibold">
                                            {new Date(selectedPipelineLead.scheduledCall).toLocaleString()}
                                          </p>
                                        </div>
                                      </div>
                                      {!selectedPipelineLead.followUpCallSummary && (
                                        <button 
                                          onClick={() => updatePipelineLead(selectedPipelineLead.id, { scheduledCall: undefined })}
                                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                                        >
                                          Reschedule
                                        </button>
                                      )}
                                    </div>

                                    {!selectedPipelineLead.followUpCallSummary ? (
                                      <div className="bg-white border border-zinc-200 rounded-lg p-4 space-y-3">
                                        <label className="block text-xs font-medium text-zinc-700">Log Call Summary</label>
                                        <textarea 
                                          value={followUpSummaryInput}
                                          onChange={(e) => setFollowUpSummaryInput(e.target.value)}
                                          placeholder="How did the follow-up call go? Any new requests?"
                                          className="w-full px-3 py-2 bg-white border border-zinc-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 min-h-[80px]"
                                        />
                                        <button 
                                          onClick={() => handleLogFollowUpSummary(selectedPipelineLead)}
                                          disabled={!followUpSummaryInput}
                                          className="w-full px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                        >
                                          <Save className="w-4 h-4" /> Save Summary
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="bg-white border border-zinc-200 rounded-lg p-4">
                                        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                          <FileText className="w-3 h-3"/> Follow-up Call Notes
                                        </h4>
                                        <p className="text-sm text-zinc-700 whitespace-pre-wrap">{selectedPipelineLead.followUpCallSummary}</p>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-zinc-400 p-8 text-center">
                  <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mb-4">
                    <ListTodo className="w-6 h-6 text-zinc-300" />
                  </div>
                  <h3 className="text-base font-medium text-zinc-900 mb-2">Select a lead from the pipeline</h3>
                  <p className="text-sm text-zinc-500 max-w-xs">
                    Manage your active deals, deploy AI agents, and track website development progress.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'ai-config' && (
          <div className="flex-1 overflow-y-auto p-8">
            <div className="max-w-4xl mx-auto">
              <div className="mb-8 flex justify-between items-end">
                <div>
                  <h2 className="text-2xl font-bold text-zinc-900">AI Agent Configuration</h2>
                  <p className="text-zinc-500">Customize how your chatbots and voice agents interact with clients.</p>
                </div>
                <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-xs font-medium">Settings Auto-saved</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* General Settings */}
                <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm space-y-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <h3 className="font-semibold text-lg">General Personality</h3>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-3">Predefined Profiles</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                        {AI_PROFILES.map((profile) => (
                          <button
                            key={profile.id}
                            onClick={() => setGlobalAIConfig({ 
                              ...globalAIConfig, 
                              personality: profile.prompt,
                              responseStyle: profile.style as any
                            })}
                            className={`p-3 rounded-xl border text-left transition-all ${
                              globalAIConfig.personality === profile.prompt
                                ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-500/20'
                                : 'bg-white border-zinc-200 hover:border-indigo-200 hover:bg-zinc-50'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className={`font-semibold text-sm ${globalAIConfig.personality === profile.prompt ? 'text-indigo-700' : 'text-zinc-900'}`}>
                                {profile.name}
                              </span>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 bg-white px-1.5 py-0.5 rounded border border-zinc-200">
                                {profile.style}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-500">{profile.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-1.5">Agent Personality & Instructions</label>
                      <textarea 
                        value={globalAIConfig.personality}
                        onChange={(e) => setGlobalAIConfig({ ...globalAIConfig, personality: e.target.value })}
                        className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm min-h-[120px]"
                        placeholder="Describe how the agent should behave..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-1.5">Response Style</label>
                      <div className="grid grid-cols-2 gap-2">
                        {['Professional', 'Friendly', 'Casual', 'Humorous'].map((style) => (
                          <button
                            key={style}
                            onClick={() => setGlobalAIConfig({ ...globalAIConfig, responseStyle: style as any })}
                            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                              globalAIConfig.responseStyle === style 
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700' 
                                : 'bg-white border-zinc-200 text-zinc-600 hover:border-indigo-200'
                            }`}
                          >
                            {style}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-1.5">Primary Language</label>
                      <select 
                        value={globalAIConfig.language}
                        onChange={(e) => setGlobalAIConfig({ ...globalAIConfig, language: e.target.value })}
                        className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                      >
                        <option value="English">English</option>
                        <option value="Spanish">Spanish</option>
                        <option value="French">French</option>
                        <option value="German">German</option>
                        <option value="Italian">Italian</option>
                        <option value="Portuguese">Portuguese</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Specific Agent Settings */}
                <div className="space-y-8">
                  {/* Chatbot Settings */}
                  <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm space-y-6">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
                        <MessageSquare className="w-5 h-5" />
                      </div>
                      <h3 className="font-semibold text-lg">Chatbot Settings</h3>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-1.5">Chatbot Display Name</label>
                        <input 
                          type="text"
                          value={globalAIConfig.chatbotName}
                          onChange={(e) => setGlobalAIConfig({ ...globalAIConfig, chatbotName: e.target.value })}
                          className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                          placeholder="e.g. LeadGen Assistant"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Voice Agent Settings */}
                  <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm space-y-6">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
                        <Volume2 className="w-5 h-5" />
                      </div>
                      <h3 className="font-semibold text-lg">Voice Agent Settings</h3>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-1.5">Voice Selection</label>
                        <div className="grid grid-cols-2 gap-2">
                          {['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'].map((voice) => (
                            <button
                              key={voice}
                              onClick={() => setGlobalAIConfig({ ...globalAIConfig, voiceName: voice as any })}
                              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                                globalAIConfig.voiceName === voice 
                                  ? 'bg-amber-50 border-amber-200 text-amber-700' 
                                  : 'bg-white border-zinc-200 text-zinc-600 hover:border-amber-200'
                              }`}
                            >
                              {voice}
                            </button>
                          ))}
                        </div>
                        <p className="mt-2 text-[10px] text-zinc-500 italic">Preview these voices in the Call Simulation tool.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-12 p-6 bg-indigo-600 rounded-2xl text-white flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-lg">Ready to deploy?</h4>
                  <p className="text-indigo-100 text-sm">These settings will be applied to all new AI agents you generate for clients.</p>
                </div>
                <button 
                  onClick={() => setActiveTab('search')}
                  className="px-6 py-2.5 bg-white text-indigo-600 font-bold rounded-xl hover:bg-indigo-50 transition-all shadow-lg"
                >
                  Start Finding Leads
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'accounts' && (
          <div className="w-full flex flex-col bg-zinc-50 overflow-hidden">
            {selectedAccountClient ? (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-4xl mx-auto space-y-6">
                  <button 
                    onClick={() => {
                      setSelectedAccountClient(null);
                      setIsEditingCode(false);
                    }}
                    className="flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4 rotate-180" /> Back to Directory
                  </button>
                  
                  <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-zinc-200 bg-zinc-50/50 flex justify-between items-start">
                      <div>
                        <h2 className="text-2xl font-bold text-zinc-900">{selectedAccountClient.name}</h2>
                        <p className="text-zinc-500">{selectedAccountClient.businessType || 'Business'} • {selectedAccountClient.phone}</p>
                      </div>
                      {getStatusBadge(selectedAccountClient.status)}
                    </div>
                    
                    <div className="p-6 space-y-8">
                      {/* Project Overview */}
                      <div>
                        <h3 className="text-lg font-semibold text-zinc-900 mb-3 flex items-center gap-2">
                          <Briefcase className="w-5 h-5 text-indigo-600" /> Project Overview
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
                            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Project Type</div>
                            <div className="font-medium text-zinc-900">
                              {selectedAccountClient.requiresAIAgent ? `AI ${selectedAccountClient.aiAgentType || 'Agent'}` : 'Website Development'}
                            </div>
                            <div className="text-sm text-zinc-600 mt-1">
                              {selectedAccountClient.hasWebsite ? 'Integration into existing site' : 'New site build'}
                            </div>
                          </div>
                          <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-100">
                            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Payment Status</div>
                            {selectedAccountClient.status === 'DELIVERED' ? (
                              <div>
                                <div className="font-medium text-emerald-600">${selectedAccountClient.paymentAmount?.toLocaleString()}</div>
                                <div className="text-sm text-zinc-600 mt-1">{selectedAccountClient.paymentMethod} • {selectedAccountClient.transactionId}</div>
                              </div>
                            ) : (
                              <div className="font-medium text-zinc-400 italic">Pending</div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Notes & Requirements */}
                      {(selectedAccountClient.callSummary || selectedAccountClient.callTranscript) && (
                        <div>
                          <h3 className="text-lg font-semibold text-zinc-900 mb-3 flex items-center gap-2">
                            <FileText className="w-5 h-5 text-indigo-600" /> Notes & Requirements
                          </h3>
                          <div className="space-y-4">
                            <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                                  <FileText className="w-5 h-5" />
                                </div>
                                <div>
                                  <h4 className="text-sm font-bold text-zinc-900">Call Records</h4>
                                  <p className="text-xs text-zinc-500">Review the AI agent's conversation and summary.</p>
                                </div>
                              </div>
                              <button
                                onClick={() => setShowCallDetailsModal(selectedAccountClient)}
                                className="px-4 py-2 bg-white border border-zinc-200 text-zinc-700 text-sm font-medium rounded-lg hover:bg-zinc-50 transition-colors flex items-center justify-center gap-2 shrink-0"
                              >
                                <MessageSquare className="w-4 h-4" /> View Call Details
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Deep Analysis */}
                      <div className="bg-zinc-50 p-6 rounded-xl border border-zinc-200 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-zinc-900 flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-indigo-600" /> Deep Strategy Analysis
                          </h3>
                          <button 
                            onClick={() => handleDeepAnalysis(selectedAccountClient)}
                            disabled={analyzingLeadId === selectedAccountClient.id}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1 bg-white px-3 py-1.5 rounded-md border border-zinc-200 shadow-sm disabled:opacity-50"
                          >
                            {analyzingLeadId === selectedAccountClient.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
                            {deepAnalysis[selectedAccountClient.id] ? 'Regenerate Analysis' : 'Generate Analysis'}
                          </button>
                        </div>
                        
                        {deepAnalysis[selectedAccountClient.id] ? (
                          <div className="prose prose-sm max-w-none text-zinc-700 bg-white p-4 rounded-lg border border-zinc-200 whitespace-pre-wrap">
                            {deepAnalysis[selectedAccountClient.id]}
                          </div>
                        ) : (
                          <div className="text-center py-8 text-zinc-500 bg-white rounded-lg border border-zinc-200 border-dashed">
                            <Sparkles className="w-8 h-8 mx-auto text-zinc-300 mb-2" />
                            <p className="text-sm">Click "Generate Analysis" to get a comprehensive digital strategy for this client.</p>
                          </div>
                        )}
                      </div>

                      {/* Deliverables */}
                      {(selectedAccountClient.websiteCode || selectedAccountClient.aiAgentSnippet) && (
                        <div>
                          <h3 className="text-lg font-semibold text-zinc-900 mb-3 flex items-center gap-2">
                            <Code className="w-5 h-5 text-indigo-600" /> Deliverables
                          </h3>
                          <div className="space-y-4">
                            {selectedAccountClient.hasWebsite && selectedAccountClient.aiAgentSnippet ? (
                              <div className="bg-zinc-900 rounded-lg p-4 overflow-hidden">
                                <div className="flex items-center justify-between mb-3">
                                  <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                                    <Code className="w-3 h-3"/> AI Agent Snippet
                                  </h4>
                                  <div className="flex items-center gap-3">
                                    {selectedAccountClient.liveSiteUrl && (
                                      <a
                                        href={selectedAccountClient.liveSiteUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                                      >
                                        <ExternalLink className="w-3 h-3" /> Open Live
                                      </a>
                                    )}
                                    <button 
                                      onClick={() => handleCopyPreviewLink(selectedAccountClient.id)}
                                      className="text-xs font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                                    >
                                      <Link className="w-3 h-3" /> Copy Preview Link
                                    </button>
                                  </div>
                                </div>
                                <pre className="text-xs text-zinc-300 overflow-x-auto font-mono whitespace-pre-wrap">{selectedAccountClient.aiAgentSnippet}</pre>
                              </div>
                            ) : selectedAccountClient.websiteCode ? (
                              <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
                                <div className="bg-zinc-100 px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className="flex gap-1.5">
                                      <div className="w-3 h-3 rounded-full bg-red-400"></div>
                                      <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                                      <div className="w-3 h-3 rounded-full bg-green-400"></div>
                                    </div>
                                    <div className="text-sm text-zinc-500 font-mono ml-2">
                                      {selectedAccountClient.liveSiteUrl || `preview.local/${selectedAccountClient.name.toLowerCase().replace(/\s+/g, '-')}`}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {isEditingCode ? (
                                      <button 
                                        onClick={() => handleSaveEditedWebsite(selectedAccountClient)}
                                        className="text-xs font-medium text-emerald-600 hover:text-emerald-700 flex items-center gap-1 bg-white px-2 py-1 rounded border border-zinc-200 shadow-sm"
                                      >
                                        <Save className="w-3 h-3" /> {pipelineActionLoading === 'redeploying' ? 'Publishing...' : 'Publish Changes'}
                                      </button>
                                    ) : (
                                      <button 
                                        onClick={() => {
                                          setEditedCode(selectedAccountClient.websiteCode || '');
                                          setIsEditingCode(true);
                                        }}
                                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1 bg-white px-2 py-1 rounded border border-zinc-200 shadow-sm"
                                      >
                                        <Edit3 className="w-3 h-3" /> Edit Code
                                      </button>
                                    )}
                                    {selectedAccountClient.liveSiteUrl && (
                                      <a
                                        href={selectedAccountClient.liveSiteUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs font-medium text-emerald-600 hover:text-emerald-700 flex items-center gap-1 bg-white px-2 py-1 rounded border border-zinc-200 shadow-sm"
                                      >
                                        <ExternalLink className="w-3 h-3" /> Open Live
                                      </a>
                                    )}
                                    <button 
                                      onClick={() => handleCopyPreviewLink(selectedAccountClient.id)}
                                      className="text-xs font-medium text-zinc-600 hover:text-zinc-700 flex items-center gap-1 bg-white px-2 py-1 rounded border border-zinc-200 shadow-sm"
                                    >
                                      <Link className="w-3 h-3" /> Copy Link
                                    </button>
                                  </div>
                                </div>
                                {isEditingCode ? (
                                  <div className="w-full h-96 overflow-y-auto bg-[#f5f2f0]">
                                    <Editor
                                      value={editedCode}
                                      onValueChange={code => setEditedCode(code)}
                                      highlight={code => Prism.highlight(code, Prism.languages.markup, 'markup')}
                                      padding={15}
                                      style={{
                                        fontFamily: '"Fira code", "Fira Mono", monospace',
                                        fontSize: 12,
                                        minHeight: '100%'
                                      }}
                                      className="editor-container"
                                    />
                                  </div>
                                ) : (
                                  <iframe 
                                    srcDoc={selectedAccountClient.websiteCode} 
                                    className="w-full h-96 bg-white"
                                    title="Website Preview"
                                  />
                                )}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="p-6 border-b border-zinc-200 bg-white">
                  <h2 className="text-2xl font-bold text-zinc-900 mb-1">Client Management & Billing</h2>
                  <p className="text-sm text-zinc-500">Manage all your past and current clients, view project history, and track payments.</p>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="max-w-6xl mx-auto space-y-8">
                    
                    {/* Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
                    <div className="text-sm font-medium text-zinc-500 mb-1">Total Revenue</div>
                    <div className="text-3xl font-bold text-zinc-900">
                      ${pipeline.filter(l => l.status === 'DELIVERED').reduce((sum, l) => sum + (l.paymentAmount || 0), 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
                    <div className="text-sm font-medium text-zinc-500 mb-1">Completed Deals</div>
                    <div className="text-3xl font-bold text-zinc-900">
                      {pipeline.filter(l => l.status === 'DELIVERED').length}
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
                    <div className="text-sm font-medium text-zinc-500 mb-1">Pending in Pipeline</div>
                    <div className="text-3xl font-bold text-zinc-900">
                      {pipeline.filter(l => l.status !== 'DELIVERED').length}
                    </div>
                  </div>
                </div>

                {/* Client Directory Table */}
                <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50/50 flex items-center justify-between">
                    <h3 className="font-semibold text-zinc-900">Client Directory</h3>
                    <span className="text-xs font-medium bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full">{pipeline.length} Total Clients</span>
                  </div>
                  
                  {pipeline.length === 0 ? (
                    <div className="p-12 text-center text-zinc-500">
                      <Briefcase className="w-12 h-12 mx-auto text-zinc-300 mb-3" />
                      <p>No clients in your directory yet.</p>
                      <p className="text-sm mt-1">Start reaching out to leads to build your client base.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-zinc-50 text-zinc-500 border-b border-zinc-200">
                          <tr>
                            <th className="px-6 py-3 font-medium">Client Details</th>
                            <th className="px-6 py-3 font-medium">Project History</th>
                            <th className="px-6 py-3 font-medium">Payment Record</th>
                            <th className="px-6 py-3 font-medium">Status</th>
                            <th className="px-6 py-3 font-medium text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200">
                          {pipeline.map((client) => (
                            <tr key={client.id} className="hover:bg-zinc-50/50 transition-colors">
                              <td className="px-6 py-4">
                                <div className="font-medium text-zinc-900 flex items-center gap-2">
                                  {client.name}
                                  {client.scheduledCall && !client.followUpCallSummary && (
                                    <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                                  )}
                                </div>
                                <div className="text-xs text-zinc-500">{client.businessType || 'Business'} • {client.phone}</div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="text-sm text-zinc-700">
                                  {client.requiresAIAgent ? `AI ${client.aiAgentType || 'Agent'}` : 'Website Development'}
                                </div>
                                <div className="text-xs text-zinc-500 mt-0.5">
                                  {client.hasWebsite ? 'Integration into existing site' : 'New site build'}
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                {client.status === 'DELIVERED' ? (
                                  <div>
                                    <div className="font-medium text-emerald-600">${client.paymentAmount?.toLocaleString()}</div>
                                    <div className="text-xs text-zinc-500">{client.paymentMethod} • {client.transactionId}</div>
                                  </div>
                                ) : (
                                  <span className="text-zinc-400 italic text-xs">Pending</span>
                                )}
                              </td>
                              <td className="px-6 py-4">
                                {getStatusBadge(client.status)}
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button 
                                    onClick={() => handleCopyPreviewLink(client.id)}
                                    className="text-indigo-600 hover:text-indigo-800 font-medium text-xs flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded"
                                  >
                                    <Share2 className="w-3 h-3" /> Share
                                  </button>
                                  {client.status === 'DELIVERED' && client.invoiceEmail && (
                                    <button 
                                      onClick={() => alert(`Invoice Email Content:\n\n${client.invoiceEmail}`)}
                                      className="text-indigo-600 hover:text-indigo-800 font-medium text-xs flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded"
                                    >
                                      <Receipt className="w-3 h-3" /> Invoice
                                    </button>
                                  )}
                                  <button 
                                    onClick={() => setSelectedAccountClient(client)}
                                    className="text-indigo-600 hover:text-indigo-900 font-medium text-xs flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded"
                                  >
                                    <FileText className="w-3 h-3" /> Details
                                  </button>
                                  <button 
                                    onClick={() => {
                                      setActiveTab('pipeline');
                                      setSelectedPipelineLead(client);
                                    }}
                                    className="text-zinc-600 hover:text-zinc-900 font-medium text-xs flex items-center gap-1 bg-zinc-100 px-2 py-1 rounded"
                                  >
                                    <LayoutDashboard className="w-3 h-3" /> Pipeline
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Danger Zone */}
                <div className="mt-12 pt-8 border-t border-zinc-200">
                  <div className="bg-red-50 border border-red-100 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-red-900 mb-2 flex items-center gap-2">
                      <Trash2 className="w-5 h-5" /> Danger Zone
                    </h3>
                    <p className="text-sm text-red-700 mb-4">
                      Clearing all data will permanently delete all leads and history. This cannot be undone.
                    </p>
                    <button 
                      onClick={async () => {
                        if (!user) return;
                        if (!confirm("Are you sure you want to delete ALL data?")) return;
                        try {
                          await resetPipeline();
                          setPipeline([]);
                          setSelectedPipelineLead(null);
                          setSelectedAccountClient(null);
                          alert("Data reset successfully.");
                        } catch (e) {
                          alert("Reset failed.");
                        }
                      }}
                      className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" /> Reset Application Data
                    </button>
                  </div>
                </div>

                {/* Transactions Table */}
                <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50/50">
                    <h3 className="font-semibold text-zinc-900">Recent Transactions</h3>
                  </div>
                  
                  {pipeline.filter(l => l.status === 'DELIVERED').length === 0 ? (
                    <div className="p-12 text-center text-zinc-500">
                      <Receipt className="w-12 h-12 mx-auto text-zinc-300 mb-3" />
                      <p>No payments collected yet.</p>
                      <p className="text-sm mt-1">Deliver a website to a client to see transactions here.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-zinc-50 text-zinc-500 border-b border-zinc-200">
                          <tr>
                            <th className="px-6 py-3 font-medium">Client</th>
                            <th className="px-6 py-3 font-medium">Amount</th>
                            <th className="px-6 py-3 font-medium">Method</th>
                            <th className="px-6 py-3 font-medium">Transaction ID / UTR</th>
                            <th className="px-6 py-3 font-medium">Invoice</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200">
                          {pipeline.filter(l => l.status === 'DELIVERED').map((lead) => (
                            <tr key={lead.id} className="hover:bg-zinc-50/50 transition-colors cursor-pointer" onClick={() => setSelectedAccountClient(lead)}>
                              <td className="px-6 py-4">
                                <div className="font-medium text-zinc-900">{lead.name}</div>
                                <div className="text-xs text-zinc-500">{lead.businessType}</div>
                              </td>
                              <td className="px-6 py-4 font-medium text-emerald-600">
                                ${lead.paymentAmount?.toLocaleString()}
                              </td>
                              <td className="px-6 py-4">
                                <span className="inline-flex items-center px-2 py-1 rounded-md bg-zinc-100 text-zinc-700 text-xs font-medium">
                                  {lead.paymentMethod}
                                </span>
                              </td>
                              <td className="px-6 py-4 font-mono text-xs text-zinc-600">
                                {lead.transactionId}
                              </td>
                              <td className="px-6 py-4">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    alert(`Invoice Email Content:\n\n${lead.invoiceEmail}`);
                                  }}
                                  className="text-indigo-600 hover:text-indigo-800 font-medium text-xs flex items-center gap-1"
                                >
                                  <Download className="w-3 h-3" /> View Invoice
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
            </>
            )}
          </div>
        )}
      </main>

      {/* Manual Lead Modal */}
      {showManualAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 flex justify-between items-center">
              <h3 className="font-semibold text-lg text-zinc-900">Add Manual Lead</h3>
              <button onClick={() => setShowManualAdd(false)} className="text-zinc-400 hover:text-zinc-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleManualSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Business Name</label>
                <input required type="text" value={manualLead.name} onChange={e => setManualLead({...manualLead, name: e.target.value})} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="e.g. Acme Corp" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Business Type</label>
                <input required type="text" value={manualLead.businessType} onChange={e => setManualLead({...manualLead, businessType: e.target.value})} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="e.g. Plumber, Restaurant" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Address</label>
                <input required type="text" value={manualLead.address} onChange={e => setManualLead({...manualLead, address: e.target.value})} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="e.g. 123 Main St, City" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Phone</label>
                <input required type="text" value={manualLead.phone} onChange={e => setManualLead({...manualLead, phone: e.target.value})} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="e.g. 555-0192" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Email</label>
                <input type="email" value={manualLead.email} onChange={e => setManualLead({...manualLead, email: e.target.value})} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="e.g. hello@acme.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Website URL</label>
                <input type="url" value={manualLead.websiteUrl} onChange={e => setManualLead({...manualLead, websiteUrl: e.target.value})} className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" placeholder="https://example.com" />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input type="checkbox" id="hasWebsite" checked={manualLead.hasWebsite} onChange={e => setManualLead({...manualLead, hasWebsite: e.target.checked})} className="rounded text-indigo-600 focus:ring-indigo-500" />
                <label htmlFor="hasWebsite" className="text-sm text-zinc-700">They already have a website</label>
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setShowManualAdd(false)} className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 transition-colors">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">Add Lead</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Call Details Modal */}
      {showCallDetailsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-zinc-200 flex justify-between items-center bg-zinc-50">
              <div>
                <h2 className="text-xl font-bold text-zinc-900">Call Details: {showCallDetailsModal.name}</h2>
                <p className="text-sm text-zinc-500">Review the AI agent's conversation and summary.</p>
              </div>
              <button
                onClick={() => setShowCallDetailsModal(null)}
                className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200/50 rounded-full transition-colors"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-6">
              <div className="flex-1 space-y-4">
                <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Call Summary
                </h3>
                <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-5 text-zinc-800 text-sm leading-relaxed whitespace-pre-wrap">
                  {showCallDetailsModal.callSummary || 'No summary available.'}
                </div>
              </div>
              <div className="flex-1 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" /> Transcript
                  </h3>
                  <button
                    onClick={() => handlePlayAudio(showCallDetailsModal.callTranscript || '', 'modal-transcript')}
                    className={`text-xs font-medium flex items-center gap-1 px-3 py-1.5 rounded-md transition-colors ${playingAudioId === 'modal-transcript' ? 'bg-indigo-100 text-indigo-700' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900'}`}
                  >
                    <Volume2 className="w-3 h-3" /> {playingAudioId === 'modal-transcript' ? 'Playing...' : 'Listen'}
                  </button>
                </div>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-5 text-zinc-700 text-sm font-mono leading-relaxed whitespace-pre-wrap h-[50vh] overflow-y-auto">
                  {showCallDetailsModal.callTranscript || 'No transcript available.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chatbot Widget */}
      <div className="fixed bottom-6 right-6 z-50">
        {isChatOpen ? (
          <div className="bg-white rounded-2xl shadow-2xl border border-zinc-200 w-80 sm:w-96 flex flex-col overflow-hidden transition-all duration-300 ease-in-out h-[500px]">
            <div className="bg-indigo-600 p-4 flex justify-between items-center text-white">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                <span className="font-semibold">Agency Assistant</span>
              </div>
              <button onClick={() => setIsChatOpen(false)} className="text-white/80 hover:text-white transition-colors">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-50">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-white border border-zinc-200 text-zinc-800 rounded-bl-sm shadow-sm whitespace-pre-wrap'}`}>
                    {msg.parts[0].text}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-zinc-200 p-3 rounded-2xl rounded-bl-sm shadow-sm flex gap-1 items-center">
                    <div className="w-2 h-2 bg-zinc-300 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-zinc-300 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-zinc-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-3 bg-white border-t border-zinc-200">
              <form 
                onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
                className="flex items-center gap-2"
              >
                <input 
                  type="text" 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask me anything..."
                  className="flex-1 bg-zinc-100 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 rounded-full px-4 py-2 text-sm transition-all"
                />
                <button 
                  type="submit"
                  disabled={!chatInput.trim() || isChatLoading}
                  className="bg-indigo-600 text-white p-2 rounded-full hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        ) : (
          <button 
            onClick={() => setIsChatOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-full shadow-lg transition-transform hover:scale-105 flex items-center justify-center"
          >
            <Bot className="w-6 h-6" />
          </button>
        )}

        {/* Share Link Modal */}
        {shareLinkModal.isOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="p-6 border-b border-zinc-100 flex justify-between items-center">
                <h3 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
                  <Share2 className="w-5 h-5 text-indigo-600" /> Share Link
                </h3>
                <button 
                  onClick={() => setShareLinkModal({ ...shareLinkModal, isOpen: false })}
                  className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
                >
                  <XCircle className="w-5 h-5 text-zinc-400" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-zinc-600">
                  Send this link to <span className="font-semibold text-zinc-900">{shareLinkModal.leadName}</span> to review the live site or hosted deliverable.
                </p>
                <div className="flex items-center gap-2 p-3 bg-zinc-50 rounded-lg border border-zinc-200">
                  <Link className="w-4 h-4 text-zinc-400 shrink-0" />
                  <input 
                    type="text" 
                    readOnly 
                    value={shareLinkModal.url}
                    className="bg-transparent border-none focus:ring-0 text-sm text-zinc-600 w-full truncate"
                  />
                </div>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(shareLinkModal.url);
                    alert('Link copied to clipboard!');
                  }}
                  className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-200"
                >
                  <Copy className="w-4 h-4" /> Copy Shareable Link
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
    </AppErrorBoundary>
  );
}
