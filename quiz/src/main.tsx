import { createRoot } from 'react-dom/client';
import { TeamPage } from './TeamPage.tsx';
import { AdminPage } from './AdminPage.tsx';
import './styles.css';

const isAdmin = location.pathname.startsWith('/admin');
createRoot(document.getElementById('root')!).render(isAdmin ? <AdminPage /> : <TeamPage />);
