import React, { useState, useEffect } from 'react';
import AuthView from './views/AuthView';
import CustomerPortal from './views/CustomerPortal';
import KitchenPortal from './views/KitchenPortal';
import ManagerDashboard from './views/ManagerDashboard';
import AdminDashboard from './views/AdminDashboard';
import { LogOut, Sun, Moon, Utensils } from 'lucide-react';

function App() {
  const [user, setUser] = useState(null);

  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch(e) {}
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  if (!user) {
    return <AuthView onLogin={setUser} />;
  }

  return (
    <div className="min-h-screen bg-primary">
      {/* Universal Navbar */}
      <nav className="sticky top-0 z-50 bg-secondary/80 backdrop-blur-md border-b border-border px-6 py-3 flex justify-between items-center shadow-lg">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent-cyan/20 border border-accent-cyan/30 flex items-center justify-center text-accent-cyan shadow-[0_0_15px_rgba(0,242,254,0.2)]">
            <Utensils size={18} />
          </div>
          <span className="font-display font-bold tracking-tight hidden sm:block text-text-main">Smart Canteen</span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="text-sm text-text-muted hidden sm:block">
            Logged in as <span className="font-semibold text-text-main">{user.role}</span>
          </div>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded text-text-muted hover:text-accent-cyan hover:bg-primary transition-colors"
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-accent-cyan transition-colors px-3 py-1.5 rounded hover:bg-primary"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </nav>

      {/* Role-based Routing */}
      <main>
        {user.role === 'CUSTOMER' && <CustomerPortal />}
        {user.role === 'STAFF' && <KitchenPortal />}
        {user.role === 'MANAGER' && <ManagerDashboard />}
        {user.role === 'ADMIN' && <AdminDashboard />}
      </main>
    </div>
  );
}

export default App;
