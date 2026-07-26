import { createRoot } from 'react-dom/client';
import { App } from '../pages/App';
import '../layout/index.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<App />);
}
