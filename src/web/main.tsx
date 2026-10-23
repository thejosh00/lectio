import {createRoot} from 'react-dom/client';
import {App} from './App.tsx';

// The typefaces are served beside the bundle, not inside it (src/server/static.ts).
const fonts = document.createElement('link');
fonts.rel = 'stylesheet';
fonts.href = '/fonts/fonts.css';
document.head.append(fonts);

createRoot(document.getElementById('root')!).render(<App />);
