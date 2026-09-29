import { createRoot } from 'react-dom/client';
import { TeamPage } from './TeamPage.tsx';
import { AdminPage } from './AdminPage.tsx';
import { ScreenPage } from './ScreenPage.tsx';
import './styles.css';

// /admin: the host. /screen: the big screen (/present is its old address). Anything else: a team's phone.
const path = location.pathname;
const page = path.startsWith('/admin') ? <AdminPage /> : path.startsWith('/screen') || path.startsWith('/present') ? <ScreenPage /> : <TeamPage />;
createRoot(document.getElementById('root')!).render(page);
