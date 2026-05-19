import { ChromaClient } from 'chromadb';

// Single shared client — avoids opening multiple TCP connections to ChromaDB
const client = new ChromaClient({ path: 'http://localhost:8000' });

export default client;
