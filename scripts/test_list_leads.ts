import { adminDb } from '../server/firebaseAdmin';

async function listLeads() {
  try {
    console.log('Fetching users...');
    const usersSnap = await adminDb.collection('users').get();
    console.log(`Found ${usersSnap.docs.length} users.`);
    for (const userDoc of usersSnap.docs) {
      console.log(`User: ${userDoc.id}`);
      const leadsSnap = await adminDb.collection(`users/${userDoc.id}/leads`).limit(5).get();
      console.log(`  Found ${leadsSnap.docs.length} leads for this user.`);
      leadsSnap.docs.forEach(lead => {
        console.log(`    Lead ID: ${lead.id}, Name: ${lead.data().name}, Phone: ${lead.data().phone || 'No phone'}`);
      });
    }
  } catch (error) {
    console.error('Error listing leads:', error);
  } finally {
    process.exit(0);
  }
}

listLeads();
