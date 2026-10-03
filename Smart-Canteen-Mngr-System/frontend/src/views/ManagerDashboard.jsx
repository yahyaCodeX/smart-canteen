import React, { useState, useEffect } from 'react';
import { LayoutDashboard, TrendingUp, Clock, AlertTriangle, PackageOpen, Users, Banknote, Settings, Coffee, Plus, Trash2 } from 'lucide-react';
import api from '../utils/api';

export default function ManagerDashboard() {
  const [stats, setStats] = useState(null);
  const [aiInsights, setAiInsights] = useState(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [activeModal, setActiveModal] = useState(null);
  const [menuItems, setMenuItems] = useState([]);
  const [staffUsers, setStaffUsers] = useState([]);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadStats = async () => {
    try {
      const res = await api.get('/analytics/dashboard');
      if (res.data.success) setStats(res.data.stats);
    } catch (err) {
      console.error(err);
    }
  };

  const generateAiInsights = async () => {
    setLoadingAi(true);
    try {
      const res = await api.get('/intelligence/ai-insights');
      if (res.data.success) setAiInsights(res.data.insights);
    } catch (err) {
      alert('Failed to generate insights');
    } finally {
      setLoadingAi(false);
    }
  };

  const handleSaveMenuItem = async (item) => {
    const nameInput = document.getElementById(`name_${item.item_id}`).value;
    const catInput = document.getElementById(`cat_${item.item_id}`).value;
    const priceInput = document.getElementById(`price_${item.item_id}`).value;
    const statusInput = document.getElementById(`status_${item.item_id}`).value;

    if (!nameInput || !priceInput) return alert('Name and Price are required.');

    const payload = {
      item_name: nameInput,
      category: catInput,
      price: parseFloat(priceInput),
      status: statusInput
    };

    try {
      if (item.item_id.startsWith('new_')) {
        const res = await api.post('/menu', payload);
        if (res.data.success) {
          setMenuItems(menuItems.map(m => m.item_id === item.item_id ? res.data.item : m));
          alert('Item added successfully!');
        }
      } else {
        const res = await api.put(`/menu/${item.item_id}`, payload);
        if (res.data.success) {
          setMenuItems(menuItems.map(m => m.item_id === item.item_id ? res.data.item : m));
          alert('Item updated successfully!');
        }
      }
    } catch (err) {
      alert('Failed to save menu item');
    }
  };

  const handleDeleteMenuItem = async (item_id) => {
    if (item_id.startsWith('new_')) {
      setMenuItems(menuItems.filter(m => m.item_id !== item_id));
      return;
    }
    
    if (!confirm('Are you sure you want to delete this item?')) return;
    
    try {
      const res = await api.delete(`/menu/${item_id}`);
      if (res.data.success) {
        if (res.data.message) {
          // It was a soft delete, just change status in UI
          setMenuItems(menuItems.map(m => m.item_id === item_id ? { ...m, status: 'UNAVAILABLE' } : m));
          alert(res.data.message);
        } else {
          setMenuItems(menuItems.filter(m => m.item_id !== item_id));
          alert('Item deleted permanently!');
        }
      }
    } catch (err) {
      alert('Failed to delete item');
    }
  };

  const loadStaffUsers = async () => {
    try {
      const res = await api.get('/auth/users');
      if (res.data.success) {
        setStaffUsers(res.data.users.filter(u => ['STAFF', 'MANAGER'].includes(u.role)));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const toggleStaffBan = async (userId) => {
    try {
      const res = await api.patch(`/auth/users/${userId}/ban`);
      if (res.data.success) loadStaffUsers();
    } catch (err) {
      alert('Failed to toggle staff ban status');
    }
  };

  // Derive unique categories for the datalist dropdown
  const uniqueCategories = [...new Set(menuItems.map(m => m.category).filter(Boolean))];

  if (!stats) return <div className="p-8 text-text-muted">Loading analytics...</div>;

  const StatCard = ({ title, value, icon: Icon, colorClass, subtitle }) => (
    <div className="card border-t-2" style={{ borderTopColor: colorClass }}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-sm font-medium text-text-muted mb-1">{title}</h3>
          <div className="text-3xl font-display font-bold text-text-main">{value}</div>
        </div>
        <div className={`p-2 rounded bg-secondary`} style={{ color: colorClass }}>
          <Icon size={20} />
        </div>
      </div>
      {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto min-h-screen space-y-8">
      <div className="flex justify-between items-center pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="text-accent-cyan" size={28} />
          <div>
            <h1 className="text-2xl font-bold text-text-main">Management Analytics</h1>
            <p className="text-text-muted text-sm">Real-time overview of today's operations</p>
          </div>
        </div>
        <button onClick={loadStats} className="btn-outline text-sm py-1.5">Refresh Data</button>
      </div>
      
      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Revenue" value={`PKR ${stats.total_revenue || 0}`} icon={Banknote} colorClass="#22D3EE" />
        <StatCard title="Completed Orders" value={stats.completed_orders || 0} icon={CheckCircle} colorClass="#4ADE80" />
        <StatCard title="Active Queue" value={stats.active_orders || 0} icon={Users} colorClass="#06B6D4" />
        <StatCard title="Avg Prep Time" value={`${stats.avg_preparation_time || 0}m`} icon={Clock} colorClass="#A855F7" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Delayed Orders" value={stats.delayed_orders || 0} icon={AlertTriangle} colorClass="#F59E0B" />
        <StatCard title="Cancelled Orders" value={stats.cancelled_orders || 0} icon={XCircle} colorClass="#F43F5E" />
        <StatCard title="Peak Ordering Time" value={stats.peak_ordering_time || 'N/A'} icon={TrendingUp} colorClass="#F9A8D4" />
        
        <div className="card p-4">
          <h3 className="text-sm font-medium text-text-muted mb-2 flex items-center gap-2"><TrendingUp size={16} className="text-accent-cyan"/> Top 5 Most Ordered</h3>
          <ul className="space-y-2">
            {stats.top_5_ordered?.map((item, idx) => (
              <li key={idx} className="flex justify-between items-center text-sm">
                <span className="text-text-main font-medium">{idx + 1}. {item.name}</span>
                <span className="text-accent-cyan bg-accent-cyan/10 px-2 py-0.5 rounded">{item.qty}</span>
              </li>
            ))}
            {(!stats.top_5_ordered || stats.top_5_ordered.length === 0) && (
              <li className="text-sm text-text-muted">No orders today</li>
            )}
          </ul>
        </div>
      </div>
      
      {/* Capacity Limits Control (UI Only for Hackathon) */}
      <div className="bg-primary border border-border p-5 rounded-lg flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h3 className="text-md font-bold text-text-main flex items-center gap-2"><PackageOpen size={18} className="text-accent-neon"/> Order Capacity Limits</h3>
          <p className="text-xs text-text-muted mt-1">Maximum allowed orders per 15-minute pickup slot.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-main">Current Limit:</span>
          <span className="font-bold text-accent-neon bg-accent-neon/10 px-3 py-1 rounded">20 Orders / 15 min</span>
          <button className="btn-outline py-1.5 px-3 text-xs" onClick={() => setActiveModal('SLOTS')}>Adjust Limit</button>
        </div>
      </div>

      {/* Manager Specific Actions */}
      <div className="mt-8">
        <h2 className="text-xl font-bold text-text-main mb-4 flex items-center gap-2">
          <Settings size={22} className="text-accent-cyan"/> Canteen Management Hub
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <button onClick={() => {
            setActiveModal('MENU');
            api.get('/menu').then(res => setMenuItems(res.data.items || []));
          }} className="bg-primary border border-border p-4 rounded-lg flex flex-col items-center text-center gap-2 hover:border-accent-cyan hover:bg-secondary transition-all group">
            <div className="p-3 bg-accent-cyan/10 rounded-full text-accent-cyan group-hover:scale-110 transition-transform"><Coffee size={24}/></div>
            <span className="font-bold text-text-main text-sm">Manage Menu</span>
            <span className="text-xs text-text-muted">Update prices & availability</span>
          </button>
          
          <button onClick={() => {
            setActiveModal('STAFF');
            loadStaffUsers();
          }} className="bg-primary border border-border p-4 rounded-lg flex flex-col items-center text-center gap-2 hover:border-accent-purple hover:bg-secondary transition-all group">
            <div className="p-3 bg-accent-purple/10 rounded-full text-accent-purple group-hover:scale-110 transition-transform"><Users size={24}/></div>
            <span className="font-bold text-text-main text-sm">Manage Staff</span>
            <span className="text-xs text-text-muted">Kitchen staff accounts</span>
          </button>
          
          <button onClick={() => setActiveModal('SLOTS')} className="bg-primary border border-border p-4 rounded-lg flex flex-col items-center text-center gap-2 hover:border-accent-neon hover:bg-secondary transition-all group">
            <div className="p-3 bg-accent-neon/10 rounded-full text-accent-neon group-hover:scale-110 transition-transform"><Clock size={24}/></div>
            <span className="font-bold text-text-main text-sm">Pickup Slots</span>
            <span className="text-xs text-text-muted">Define time boundaries</span>
          </button>

          <button onClick={() => setActiveModal('REPORTS')} className="bg-primary border border-border p-4 rounded-lg flex flex-col items-center text-center gap-2 hover:border-accent-red hover:bg-secondary transition-all group">
            <div className="p-3 bg-accent-red/10 rounded-full text-accent-red group-hover:scale-110 transition-transform"><TrendingUp size={24}/></div>
            <span className="font-bold text-text-main text-sm">Sales Reports</span>
            <span className="text-xs text-text-muted">Export daily revenue</span>
          </button>
        </div>
      </div>


      {/* Gemini AI Insights Section */}
      <div className="mt-12 bg-primary border border-accent-purple/30 rounded-xl p-1 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent-purple/10 to-transparent pointer-events-none"></div>
        <div className="bg-secondary rounded-lg p-6 relative z-10 border border-border">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-text-main flex items-center gap-2">
              <span className="text-accent-purple">✨</span> Gemini AI Operations Intelligence
            </h2>
            <button 
              onClick={generateAiInsights}
              disabled={loadingAi}
              className="btn-primary bg-accent-purple hover:bg-purple-500 py-1.5 text-sm shadow-[0_0_15px_rgba(168,85,247,0.3)]"
            >
              {loadingAi ? 'Analyzing Data...' : 'Generate Live Insights'}
            </button>
          </div>
          
          {aiInsights ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="p-4 rounded bg-primary border-l-2 border-accent-cyan">
                <div className="text-xs text-text-muted uppercase mb-1">Demand Forecast</div>
                <div className="text-sm text-text-main">{aiInsights.food_demand_prediction}</div>
              </div>
              <div className="p-4 rounded bg-primary border-l-2 border-accent-neon">
                <div className="text-xs text-text-muted uppercase mb-1">Peak Time Prediction</div>
                <div className="text-sm text-text-main">{aiInsights.peak_time_prediction}</div>
              </div>
              <div className="p-4 rounded bg-primary border-l-2 border-accent-purple">
                <div className="text-xs text-text-muted uppercase mb-1">Kitchen Workload</div>
                <div className="text-sm text-text-main">{aiInsights.order_delay_prediction}</div>
              </div>
              <div className="col-span-full p-4 rounded bg-accent-purple/10 border border-accent-purple/30 text-center mt-2">
                <div className="font-medium text-text-main">"{aiInsights.sales_insights}"</div>
              </div>
              
              <div className="col-span-full mt-6 p-4 rounded bg-primary border border-border">
                <h3 className="text-sm font-bold text-text-main mb-4 flex items-center gap-2">
                  <span className="text-accent-purple">📊</span> Projected Demand Volume (Next 3 Hours)
                </h3>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-xs text-text-main mb-1">
                      <span>Chocolate Brownie</span>
                      <span className="text-text-muted">High Demand (85%)</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-2 border border-border overflow-hidden">
                      <div className="bg-accent-cyan h-full rounded-full transition-all duration-1000" style={{ width: '85%' }}></div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-xs text-text-main mb-1">
                      <span>Classic Burger</span>
                      <span className="text-text-muted">Moderate Demand (45%)</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-2 border border-border overflow-hidden">
                      <div className="bg-accent-neon h-full rounded-full transition-all duration-1000" style={{ width: '45%' }}></div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-xs text-text-main mb-1">
                      <span>Veggie Bowl</span>
                      <span className="text-text-muted">Low Demand (15%)</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-2 border border-border overflow-hidden">
                      <div className="bg-red-500 h-full rounded-full transition-all duration-1000" style={{ width: '15%' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-text-muted border border-dashed border-border rounded">
              Click generate to run predictive models on today's sales data.
            </div>
          )}
        </div>
      </div>

      {/* Dynamic Modals */}
      {activeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setActiveModal(null)}>
          <div className="bg-secondary border border-border rounded-xl w-full max-w-3xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-border flex justify-between items-center bg-primary">
              <h2 className="font-bold text-lg text-text-main flex items-center gap-2">
                {activeModal === 'MENU' && <><Coffee size={20} className="text-accent-cyan"/> Manage Menu Inventory</>}
                {activeModal === 'STAFF' && <><Users size={20} className="text-accent-purple"/> Kitchen Staff Roster</>}
                {activeModal === 'SLOTS' && <><Clock size={20} className="text-accent-neon"/> Pickup Slot Configuration</>}
                {activeModal === 'REPORTS' && <><TrendingUp size={20} className="text-accent-red"/> Financial Reports</>}
              </h2>
              <button onClick={() => setActiveModal(null)} className="text-text-muted hover:text-text-main transition-colors"><XCircle size={20}/></button>
            </div>
            
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              {activeModal === 'MENU' && (
                <div className="space-y-3">
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-sm text-text-muted">Update prices and toggle availability of your menu items in real-time.</p>
                    <button className="btn-primary flex items-center gap-1 text-xs py-1.5 px-3" onClick={() => {
                      setMenuItems([{ item_id: 'new_' + Date.now(), item_name: '', category: '', price: 0, status: 'AVAILABLE' }, ...menuItems]);
                    }}>
                      <Plus size={14} /> Add Item
                    </button>
                  </div>
                  
                  <datalist id="categories-list">
                    {uniqueCategories.map(cat => <option key={cat} value={cat} />)}
                  </datalist>

                  {menuItems.map(item => (
                    <div key={item.item_id} className={`flex flex-col sm:flex-row sm:justify-between items-start sm:items-center p-3 border rounded gap-3 transition-colors ${item.status === 'UNAVAILABLE' ? 'bg-secondary/50 border-red-500/30' : 'bg-primary border-border'}`}>
                      <div className="flex-1 mr-4 w-full sm:w-auto">
                        <div className="font-medium text-text-main mb-1">
                          <input type="text" id={`name_${item.item_id}`} defaultValue={item.item_name} placeholder="Item Name" className="bg-secondary border border-border focus:border-accent-cyan rounded px-2 py-1 outline-none w-full text-sm" />
                        </div>
                        <div className="text-xs text-text-muted">
                          <input type="text" id={`cat_${item.item_id}`} list="categories-list" defaultValue={item.category} placeholder="Select or type category..." className="bg-secondary border border-border focus:border-accent-cyan rounded px-2 py-1 outline-none w-full" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        <div className="flex items-center bg-secondary border border-border rounded px-2">
                          <span className="text-xs text-text-muted">PKR</span>
                          <input type="number" id={`price_${item.item_id}`} defaultValue={item.price} className="w-16 bg-transparent text-sm text-text-main p-1 outline-none text-right" />
                        </div>
                        <select id={`status_${item.item_id}`} defaultValue={item.status} className="bg-secondary border border-border text-xs text-text-main rounded p-1.5 outline-none">
                          <option value="AVAILABLE">Available</option>
                          <option value="LIMITED">Limited</option>
                          <option value="SOLD_OUT">Sold Out</option>
                          <option value="UNAVAILABLE">Disabled</option>
                        </select>
                        <button className="text-xs btn-primary bg-accent-cyan hover:bg-cyan-500 py-1.5 px-3" onClick={() => handleSaveMenuItem(item)}>Save</button>
                        <button className="text-text-muted hover:text-red-500 transition-colors p-1" onClick={() => handleDeleteMenuItem(item.item_id)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {menuItems.length === 0 && <div className="text-center text-text-muted">Loading menu...</div>}
                </div>
              )}

              {activeModal === 'STAFF' && (
                <div className="space-y-3">
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-sm text-text-muted">Manage kitchen and delivery staff accounts.</p>
                  </div>
                  
                  {staffUsers.map(u => (
                    <div key={u.user_id} className={`flex justify-between items-center p-3 border rounded transition-colors ${u.account_status === 'SUSPENDED' ? 'bg-secondary/50 border-red-500/30' : 'bg-primary border-border'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                          u.role === 'MANAGER' ? 'bg-accent-neon/20 text-accent-neon' : 'bg-accent-purple/20 text-accent-purple'
                        }`}>
                          {u.name.substring(0,2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-text-main flex items-center gap-2">
                            {u.name} 
                            <span className="text-xs font-normal px-1.5 py-0.5 rounded bg-secondary text-text-muted border border-border/50">{u.role}</span>
                          </div>
                          <div className="text-xs text-text-muted">{u.email} • {u.account_status}</div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => toggleStaffBan(u.user_id)}
                          className={`text-xs py-1.5 px-3 rounded font-bold transition-colors ${
                            u.account_status === 'SUSPENDED'
                              ? 'bg-green-500/10 text-green-500 hover:bg-green-500/20'
                              : 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                          }`}
                        >
                          {u.account_status === 'SUSPENDED' ? 'Unsuspend' : 'Suspend'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {staffUsers.length === 0 && <div className="text-center text-text-muted py-8">No staff found.</div>}
                </div>
              )}

              {activeModal === 'SLOTS' && (
                <div className="space-y-4">
                  <p className="text-sm text-text-muted mb-4">Set maximum order limits for specific peak windows to prevent kitchen overload.</p>
                  
                  <div className="flex justify-between items-center p-4 bg-primary border border-border rounded gap-4">
                    <div className="flex-1">
                      <div className="font-bold text-text-main mb-1">Global 15-Min Slot Limit</div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-muted">Max Orders per 15 min:</span>
                        <input type="number" id="global-slot-limit" defaultValue={20} className="w-16 bg-secondary border border-border text-sm text-text-main p-1 rounded outline-none text-center" />
                      </div>
                    </div>
                    <button className="btn-primary bg-accent-neon hover:bg-neon-500 text-xs py-1.5 px-3" onClick={async () => {
                      const limit = document.getElementById('global-slot-limit').value;
                      try {
                        const res = await api.patch('/menu/slots/limit', { newLimit: limit });
                        if (res.data.success) {
                          alert(`Successfully updated capacity limit to ${res.data.newLimit} orders / 15 min!`);
                        }
                      } catch (err) {
                        alert('Failed to update slot limit');
                      }
                    }}>Update</button>
                  </div>
                </div>
              )}

              {activeModal === 'REPORTS' && (
                <div className="text-center py-10">
                  <TrendingUp size={48} className="mx-auto text-accent-red mb-4"/>
                  <h3 className="text-text-main font-bold mb-2">Generate Financial Report</h3>
                  <p className="text-sm text-text-muted mb-6">Export today's revenue breakdown in PDF or CSV format.</p>
                  <div className="flex justify-center gap-3">
                    <button className="btn-primary bg-accent-red hover:bg-red-500 text-sm py-2" onClick={() => {
                      alert('PDF Exports require a premium reporting add-on. Use CSV for free.');
                    }}>Export PDF</button>
                    <button className="btn-outline text-sm py-2" onClick={async () => {
                      try {
                        const response = await api.get('/analytics/export/csv', { responseType: 'blob' });
                        const url = window.URL.createObjectURL(new Blob([response.data]));
                        const link = document.createElement('a');
                        link.href = url;
                        link.setAttribute('download', `Sales_Report_${new Date().toISOString().split('T')[0]}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        link.remove();
                        setActiveModal(null);
                      } catch (err) {
                        alert('Failed to export CSV');
                      }
                    }}>Export CSV</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Quick icons
const CheckCircle = ({size}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
const XCircle = ({size}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>;
