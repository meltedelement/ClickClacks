import { createRoot } from 'react-dom/client';
import { TeamPage } from './TeamPage.tsx';
import { AdminPage } from './AdminPage.tsx';
import { PresenterPage } from './PresenterPage.tsx';
import './styles.css';

const path = location.pathname;
const page = path.startsWith('/admin') ? <AdminPage /> : path.startsWith('/present') ? <PresenterPage /> : <TeamPage />;
createRoot(document.getElementById('root')!).render(page);
