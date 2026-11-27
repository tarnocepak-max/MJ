import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { MoraJawsErrorBoundary } from './components/common/MoraJawsErrorBoundary';
import { registerVitePreloadErrorHandler } from './utils/lazyChunkRecovery';

registerVitePreloadErrorHandler();

createRoot(document.getElementById('root')!).render(
  <MoraJawsErrorBoundary>
    <App />
  </MoraJawsErrorBoundary>
);
