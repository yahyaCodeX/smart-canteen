import React, { useState } from 'react';
import { LogIn, UserPlus, AlertCircle, Info } from 'lucide-react';
import api from '../utils/api';
import logo from '../assets/logo.jpeg';

export default function AuthView({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showJudgeGuide, setShowJudgeGuide] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'CUSTOMER'
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const payload = isLogin 
        ? { email: formData.email, password: formData.password }
        : { name: formData.name, email: formData.email, password: formData.password, role: formData.role };
        
      const res = await api.post(endpoint, payload);
      
      if (res.data.success) {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        onLogin(res.data.user);
      } else {
        setError(res.data.error || 'Authentication failed');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Server error. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-primary flex items-center justify-center p-4 bg-grid-pattern relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent-cyan/20 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-purple/20 rounded-full blur-3xl pointer-events-none"></div>
      
      <div className="absolute inset-0 bg-primary/60 backdrop-blur-[2px] pointer-events-none"></div>
      
      <div className="card w-full max-w-md z-10 border border-border/30 bg-secondary/80 backdrop-blur-xl shadow-2xl p-8 rounded-2xl relative overflow-hidden">
        
        {/* Shine effect on card */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-accent-cyan/50 to-transparent"></div>

        {/* Judge Guide Button */}
        <button 
          type="button"
          onClick={() => setShowJudgeGuide(true)}
          className="absolute top-4 right-4 text-accent-cyan hover:text-accent-neon transition-colors flex flex-col items-center gap-1 group z-20"
          title="Judge's Guide"
        >
          <Info size={24} className="group-hover:scale-110 transition-transform drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]"/>
          <span className="text-[9px] font-bold uppercase tracking-wider opacity-80 group-hover:opacity-100">Guide</span>
        </button>

        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-accent-cyan to-accent-purple rounded-full blur opacity-40 group-hover:opacity-60 transition duration-500"></div>
              <img 
                src={logo} 
                alt="Smart Canteen Logo" 
                className="relative w-24 h-24 object-cover rounded-full border-4 border-secondary shadow-xl transition transform hover:scale-105 duration-300"
              />
            </div>
          </div>
          
          <h1 className="text-3xl font-display font-bold text-text-main mb-2 tracking-tight">Smart Canteen OS</h1>
          <p className="text-sm text-text-muted">
            {isLogin ? 'Welcome back, please sign in' : 'Join us and order smarter'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {!isLogin && (
            <div className="group">
              <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider group-focus-within:text-accent-cyan transition-colors">Full Name</label>
              <div className="relative">
                <input 
                  type="text" 
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  className="w-full bg-primary/50 border border-border/50 focus:border-accent-cyan rounded-lg px-4 py-2.5 outline-none text-text-main transition-all focus:bg-primary shadow-inner"
                  placeholder="John Doe"
                />
              </div>
            </div>
          )}
          
          <div className="group">
            <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider group-focus-within:text-accent-cyan transition-colors">Email Address</label>
            <input 
              type="email" 
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              className="w-full bg-primary/50 border border-border/50 focus:border-accent-cyan rounded-lg px-4 py-2.5 outline-none text-text-main transition-all focus:bg-primary shadow-inner"
              placeholder="user@example.com"
            />
          </div>

          <div className="group">
            <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider group-focus-within:text-accent-cyan transition-colors">Password</label>
            <input 
              type="password" 
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              className="w-full bg-primary/50 border border-border/50 focus:border-accent-cyan rounded-lg px-4 py-2.5 outline-none text-text-main transition-all focus:bg-primary shadow-inner"
              placeholder="••••••••"
            />
          </div>

          {!isLogin && (
            <div className="group">
              <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider group-focus-within:text-accent-cyan transition-colors">Account Type</label>
              <select
                name="role"
                value={formData.role}
                onChange={handleChange}
                className="w-full bg-primary/50 border border-border/50 focus:border-accent-cyan rounded-lg px-4 py-2.5 outline-none text-text-main appearance-none transition-all focus:bg-primary shadow-inner"
              >
                <option value="CUSTOMER">Student / Customer</option>
                <option value="STAFF">Kitchen Staff</option>
                <option value="MANAGER">Manager</option>
              </select>
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full relative group overflow-hidden rounded-lg mt-8"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-accent-cyan to-accent-purple opacity-90 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative py-3 px-4 flex items-center justify-center gap-2 font-bold text-white shadow-lg">
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>
                  {isLogin ? <LogIn size={18} /> : <UserPlus size={18} />}
                  <span>{isLogin ? 'Sign In' : 'Create Account'}</span>
                </>
              )}
            </div>
          </button>
        </form>

        <div className="mt-8 text-center border-t border-border/50 pt-6">
          <p className="text-sm text-text-muted">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <button 
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
              }}
              className="ml-2 text-accent-cyan font-semibold hover:underline"
            >
              {isLogin ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>

      {/* Judge's Guide Modal */}
      {showJudgeGuide && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowJudgeGuide(false)}>
          <div className="bg-secondary border border-border rounded-xl w-full max-w-lg overflow-hidden shadow-2xl p-6 relative" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-accent-cyan mb-4 flex items-center gap-2"><Info size={24}/> Hackathon Judge's Guide</h2>
            <div className="space-y-4 text-sm text-text-main">
              <p>Welcome! Here is how to test the full system effectively:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li><b>Customers:</b> Create an account as "Student/Customer" to place pre-orders, view dynamic AI wait times, and talk to the Gemini AI Chatbot.</li>
                <li><b>Kitchen Staff:</b> Create an account as "Kitchen Staff" to view the live kitchen queue and manage incoming orders.</li>
                <li><b>Managers:</b> Create an account as "Manager" to view the Analytics Dashboard and generate Gemini Demand Insights.</li>
              </ul>
              <div className="bg-accent-cyan/10 border border-accent-cyan/30 p-3 rounded-lg text-accent-cyan mt-4">
                <p className="font-semibold italic">Pro Tip: Open multiple browser tabs or incognito windows to log in as different roles simultaneously. You'll see the system sync in real-time!</p>
              </div>
            </div>
            <button onClick={() => setShowJudgeGuide(false)} className="mt-6 w-full btn-primary py-2 font-bold">Got it, let's go!</button>
          </div>
        </div>
      )}
    </div>
  );
}
