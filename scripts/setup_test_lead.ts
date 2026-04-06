import { adminDb } from '../server/firebaseAdmin';

async function setupTestLead() {
  const uid = 'test-ai-user';
  const leadId = 'test-lead-id';
  
  try {
    console.log('Setting up test lead in Firestore...');
    const leadRef = adminDb.doc(`users/${uid}/leads/${leadId}`);
    await leadRef.set({
      name: 'Test Prospect',
      phone: '+15550001234',
      status: 'DISCOVERED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    console.log(`Test lead created: users/${uid}/leads/${leadId}`);
    
    // Now instructions for curling
    console.log('\nTo test the TwiML endpoint, run:');
    console.log(`curl -X POST "http://localhost:8787/api/calls/twiml?uid=${uid}&leadId=${leadId}"`);
  } catch (error) {
    console.error('Error setting up test lead:', error);
  } finally {
    process.exit(0);
  }
}

setupTestLead();
