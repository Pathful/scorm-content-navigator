import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initializeMockSCORMAPI } from './lib/mock-scorm-api'

// Initialize the mock SCORM API handler
initializeMockSCORMAPI();

createRoot(document.getElementById("root")!).render(<App />);
