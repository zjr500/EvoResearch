import { openDatabase } from '../dist/infrastructure/database.js';
const store = openDatabase();
try { console.log('EvoResearch migrations ready:', store.databasePath); } finally { store.close(); }
