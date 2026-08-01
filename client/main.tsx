import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

// No StrictMode: it double-invokes effects in development, which would create
// and tear down a WebGL context twice and fire two race requests on every load.
createRoot(container).render(<App />);
