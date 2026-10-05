import React, { useState, useEffect } from 'react';
import { Users, Shield, Settings, Activity, ListTree, Database, XCircle } from 'lucide-react';
import supabase from '../utils/supabase';

export default function AdminDashboard() {
  const [activeModal, setActiveModal] = useState(null);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [canteenStats, setCanteenStats] = useState(null);
  const [activityLogs, setActivityLogs] = useState([]);

  const loadUsers = async () => {
    try {
      const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setUsers(data || []);
    } catch (err) { console.error(err.message); }
  };

  const updateRole = async (userId, newRole) => {
    try {
      const { error } = await supabase.from('users').update({ role: newRole }).eq('id', userId);
      if (error) throw error;
      alert('Role updated successfully!');
      loadUsers();
    } catch (err) { alert('Failed to update role: ' + err.message); }
  };

  const toggleBan = async (userId) => {
    try {
      const user = users.find(u => u.id === userId);
      const { error } = await supabase.from('users').update({ is_banned: !user?.is_banned }).eq('id', userId);
      if (error) throw error;
      loadUsers();
    } catch (err) { alert('Failed to toggle ban: ' + err.message); }
  };

  const loadCategories = async () => {
    try {
      const { data, error } = await supabase.from('menu_items').select('category').order('category');
      if (error) throw error;
      const cats = [...new Set((data || []).map(i => i.category).filter(Boolean))].map(c => ({ name: c }));
      setCategories(cats);
    } catch (err) { console.error(err.message); }
  };

  const handleRenameCategory = async (oldName, newName) => {
    if (!newName || newName === oldName) return;
    try {
      const { error } = await supabase.from('menu_items').update({ category: newName }).eq('category', oldName);
      if (error) throw error;
      alert(`Category renamed: "${oldName}" → "${newName}"`);
      loadCategories();
    } catch (err) { alert('Failed to rename category: ' + err.message); }
  };

  const loadCanteenStats = async () => {
    try {
      const [usersRes, ordersRes, menuRes] = await Promise.all([
        supabase.from('users').select('role, is_banned'),
        supabase.from('orders').select('order_status, total_amount'),
        supabase.from('menu_items').select('item_id'),
      ]);
      const usrs = usersRes.data || [];
      const ords = ordersRes.data || [];
      const menu = menuRes.data || [];
      const revenue = ords.filter(o => o.order_status === 'COLLECTED').reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);
      setCanteenStats({
        totalUsers: usrs.length,
        customers: usrs.filter(u => u.role === 'CUSTOMER').length,
        staff: usrs.filter(u => u.role === 'STAFF').length,
        managers: usrs.filter(u => u.role === 'MANAGER').length,
        admins: usrs.filter(u => u.role === 'ADMIN').length,
        suspended: usrs.filter(u => u.is_banned).length,
        totalRevenue: revenue.toFixed(2),
        totalOrders: ords.length,
        activeOrders: ords.filter(o => ['PLACED','ACCEPTED','PREPARING','READY'].includes(o.order_status)).length,
        completedOrders: ords.filter(o => o.order_status === 'COLLECTED').length,
        totalMenuItems: menu.length,
      });
    } catch (err) {
      console.error(err.message);
      setCanteenStats({ totalUsers: 0, customers: 0, staff: 0, managers: 0, admins: 0, suspended: 0, totalRevenue: 0, totalOrders: 0, activeOrders: 0, completedOrders: 0, totalMenuItems: 0 });
    }
  };

  const loadLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setActivityLogs(data || []);
    } catch (err) {
      console.error('Failed to load logs', err.message);
    }
  };

  useEffect(() => { loadLogs(); }, []);

  const timeAgo = (dateStr) => {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div className="max-w-6xl mx-auto p-6 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-text-main">System Administration</h1>
        <p className="text-text-muted mt-2">Manage global settings, user accounts, and system health</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {/* Users Card */}
        <div onClick={() => { setActiveModal('USERS'); loadUsers(); }} className="bg-primary border border-border p-5 rounded-lg flex items-start gap-4 hover:border-accent-cyan transition-colors cursor-pointer">
          <div className="p-3 bg-accent-cyan/10 text-accent-cyan rounded-lg">
            <Users size={24} />
          </div>
          <div>
            <h3 className="font-bold text-text-main">User Management</h3>
            <p className="text-sm text-text-muted mt-1">Manage accounts, ban users, reset passwords</p>
          </div>
        </div>

        {/* Roles & Permissions */}
        <div onClick={() => { setActiveModal('ROLES'); loadUsers(); }} className="bg-primary border border-border p-5 rounded-lg flex items-start gap-4 hover:border-accent-purple transition-colors cursor-pointer">
          <div className="p-3 bg-accent-purple/10 text-accent-purple rounded-lg">
            <Shield size={24} />
          </div>
          <div>
            <h3 className="font-bold text-text-main">Roles & Permissions</h3>
            <p className="text-sm text-text-muted mt-1">Assign staff and manager roles</p>
          </div>
        </div>

        {/* Categories */}
        <div onClick={() => { setActiveModal('CATEGORIES'); loadCategories(); }} className="bg-primary border border-border p-5 rounded-lg flex items-start gap-4 hover:border-accent-neon transition-colors cursor-pointer">
          <div className="p-3 bg-accent-neon/10 text-accent-neon rounded-lg">
            <ListTree size={24} />
          </div>
          <div>
            <h3 className="font-bold text-text-main">Manage Categories</h3>
            <p className="text-sm text-text-muted mt-1">Create or edit food menu categories</p>
          </div>
        </div>

        {/* Database Settings */}
        <div onClick={() => { setActiveModal('CANTEEN'); loadCanteenStats(); }} className="bg-primary border border-border p-5 rounded-lg flex items-start gap-4 hover:border-accent-red transition-colors cursor-pointer">
          <div className="p-3 bg-accent-red/10 text-accent-red rounded-lg">
            <Database size={24} />
          </div>
          <div>
            <h3 className="font-bold text-text-main">Canteen Accounts</h3>
            <p className="text-sm text-text-muted mt-1">Revenue overview and account statistics</p>
          </div>
        </div>

        {/* System Config */}
        <div onClick={() => setActiveModal('CONFIG')} className="bg-primary border border-border p-5 rounded-lg flex items-start gap-4 hover:border-blue-400 transition-colors cursor-pointer">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-lg">
            <Settings size={24} />
          </div>
          <div>
            <h3 className="font-bold text-text-main">System Config</h3>
            <p className="text-sm text-text-muted mt-1">Global platform settings and variables</p>
          </div>
        </div>
      </div>

      <div className="bg-primary border border-border rounded-lg p-6">
        <h2 className="text-xl font-bold text-text-main mb-4 flex items-center gap-2">
          <Activity size={20} className="text-accent-cyan"/> System Activity Logs
        </h2>
        <div className="space-y-3">
          {activityLogs.length > 0 ? activityLogs.map(log => (
            <div key={log.log_id} className="flex justify-between p-3 bg-secondary rounded border border-border/50">
              <div>
                <span className={`text-sm font-bold ${
                  log.action.includes('STATUS') ? 'text-accent-neon' :
                  log.action.includes('ORDER') ? 'text-accent-purple' :
                  log.action.includes('UPDATE') ? 'text-accent-cyan' :
                  'text-accent-red'
                }`}>[{log.entity || 'SYSTEM'}]</span>
                <span className="text-sm text-text-main ml-2">
                  {log.action.replace(/_/g, ' ')} {log.staff_name ? `by ${log.staff_name}` : ''}
                </span>
              </div>
              <span className="text-xs text-text-muted whitespace-nowrap ml-4">{timeAgo(log.created_at)}</span>
            </div>
          )) : (
            <div className="text-center py-6 text-text-muted text-sm">No activity logs recorded yet. Logs are generated when staff update orders or menu items.</div>
          )}
        </div>
      </div>

      {/* Dynamic Modals */}
      {activeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setActiveModal(null)}>
          <div className="bg-secondary border border-border rounded-xl w-full max-w-4xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-border flex justify-between items-center bg-primary">
              <h2 className="font-bold text-lg text-text-main flex items-center gap-2">
                {activeModal === 'USERS' && <><Users size={20} className="text-accent-cyan"/> User Management</>}
                {activeModal === 'ROLES' && <><Shield size={20} className="text-accent-purple"/> Roles & Permissions</>}
                {activeModal === 'CATEGORIES' && <><ListTree size={20} className="text-accent-neon"/> Manage Categories</>}
                {activeModal === 'CANTEEN' && <><Database size={20} className="text-accent-red"/> Canteen Account Overview</>}
                {activeModal === 'CONFIG' && <><Settings size={20} className="text-blue-400"/> System Configuration</>}
              </h2>
              <button onClick={() => setActiveModal(null)} className="text-text-muted hover:text-text-main transition-colors"><XCircle size={20}/></button>
            </div>
            
            <div className="p-6 max-h-[70vh] overflow-y-auto">

              {/* ── USER MANAGEMENT MODAL ── */}
              {activeModal === 'USERS' && (
                <div className="space-y-4">
                  <p className="text-sm text-text-muted mb-4">View all registered accounts, monitor status, and suspend or restore access.</p>
                  
                  <div className="bg-primary border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-secondary border-b border-border text-text-muted">
                        <tr>
                          <th className="p-3">User</th>
                          <th className="p-3">Email</th>
                          <th className="p-3">Joined</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map(u => (
                          <tr key={u.user_id} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                            <td className="p-3 font-medium text-text-main">{u.name}</td>
                            <td className="p-3 text-text-muted">{u.email}</td>
                            <td className="p-3 text-text-muted">{new Date(u.created_at).toLocaleDateString()}</td>
                            <td className="p-3">
                              <span className={`px-2 py-1 rounded text-xs font-bold ${u.account_status === 'SUSPENDED' ? 'bg-red-500/20 text-red-500' : 'bg-accent-neon/10 text-accent-neon'}`}>
                                {u.account_status || 'ACTIVE'}
                              </span>
                            </td>
                            <td className="p-3">
                              <button 
                                onClick={() => toggleBan(u.user_id)}
                                className={`text-xs btn-outline py-1.5 px-3 ${u.account_status === 'SUSPENDED' ? 'border-accent-cyan/50 text-accent-cyan' : 'border-red-500/50 text-red-500'}`}
                              >
                                {u.account_status === 'SUSPENDED' ? 'Restore Access' : 'Suspend Account'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {users.length === 0 && <div className="p-8 text-center text-text-muted">Loading users...</div>}
                  </div>
                </div>
              )}

              {/* ── ROLES & PERMISSIONS MODAL ── */}
              {activeModal === 'ROLES' && (
                <div className="space-y-4">
                  <p className="text-sm text-text-muted mb-4">Promote or demote users by updating their system role. Changes take effect on their next login.</p>
                  
                  <div className="bg-primary border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-secondary border-b border-border text-text-muted">
                        <tr>
                          <th className="p-3">User</th>
                          <th className="p-3">Email</th>
                          <th className="p-3">Current Role</th>
                          <th className="p-3">Change To</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map(u => (
                          <tr key={u.user_id} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                            <td className="p-3 font-medium text-text-main">{u.name}</td>
                            <td className="p-3 text-text-muted">{u.email}</td>
                            <td className="p-3">
                              <span className={`px-2 py-1 rounded text-xs font-bold
                                ${u.role === 'ADMIN' ? 'bg-white/10 text-white' : ''}
                                ${u.role === 'MANAGER' ? 'bg-accent-neon/10 text-accent-neon' : ''}
                                ${u.role === 'STAFF' ? 'bg-accent-purple/10 text-accent-purple' : ''}
                                ${u.role === 'CUSTOMER' ? 'bg-accent-cyan/10 text-accent-cyan' : ''}
                              `}>
                                {u.role}
                              </span>
                            </td>
                            <td className="p-3 flex items-center gap-2">
                              <select 
                                defaultValue={u.role} 
                                id={`role_${u.user_id}`}
                                className="bg-secondary border border-border text-xs text-text-main rounded p-1.5 outline-none"
                              >
                                <option value="CUSTOMER">CUSTOMER</option>
                                <option value="STAFF">STAFF</option>
                                <option value="MANAGER">MANAGER</option>
                                <option value="ADMIN">ADMIN</option>
                              </select>
                              <button 
                                onClick={() => updateRole(u.user_id, document.getElementById(`role_${u.user_id}`).value)}
                                className="text-xs btn-primary bg-accent-purple hover:bg-purple-500 py-1.5 px-3"
                              >
                                Assign
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {users.length === 0 && <div className="p-8 text-center text-text-muted">Loading users...</div>}
                  </div>
                </div>
              )}

              {/* ── CATEGORIES MODAL ── */}
              {activeModal === 'CATEGORIES' && (
                <div className="space-y-4">
                  <p className="text-sm text-text-muted mb-4">View all food categories derived from your menu. Rename a category to update it across all associated items.</p>
                  
                  <div className="bg-primary border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-secondary border-b border-border text-text-muted">
                        <tr>
                          <th className="p-3">Category Name</th>
                          <th className="p-3">Items</th>
                          <th className="p-3">Rename To</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categories.map(c => (
                          <tr key={c.category} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                            <td className="p-3 font-medium text-text-main">
                              <span className="px-2 py-1 bg-accent-neon/10 text-accent-neon rounded text-xs font-bold">{c.category}</span>
                            </td>
                            <td className="p-3 text-text-muted">{c.item_count} item{c.item_count !== 1 ? 's' : ''}</td>
                            <td className="p-3 flex items-center gap-2">
                              <input 
                                type="text" 
                                defaultValue={c.category}
                                id={`cat_${c.category}`}
                                className="bg-secondary border border-border focus:border-accent-neon text-xs text-text-main rounded px-2 py-1.5 outline-none w-32"
                              />
                              <button 
                                onClick={() => handleRenameCategory(c.category, document.getElementById(`cat_${c.category}`).value)}
                                className="text-xs btn-primary bg-accent-neon hover:bg-green-500 py-1.5 px-3"
                              >
                                Rename
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {categories.length === 0 && <div className="p-8 text-center text-text-muted">No categories found.</div>}
                  </div>
                </div>
              )}

              {/* ── CANTEEN ACCOUNTS MODAL ── */}
              {activeModal === 'CANTEEN' && (
                <div className="space-y-6">
                  <p className="text-sm text-text-muted">Live canteen statistics pulled from the database.</p>
                  
                  {canteenStats ? (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-primary border border-border rounded-lg p-4 text-center">
                          <div className="text-2xl font-bold text-accent-cyan">{canteenStats.totalUsers}</div>
                          <div className="text-xs text-text-muted mt-1">Total Users</div>
                        </div>
                        <div className="bg-primary border border-border rounded-lg p-4 text-center">
                          <div className="text-2xl font-bold text-accent-neon">PKR {Number(canteenStats.totalRevenue).toLocaleString()}</div>
                          <div className="text-xs text-text-muted mt-1">Total Revenue</div>
                        </div>
                        <div className="bg-primary border border-border rounded-lg p-4 text-center">
                          <div className="text-2xl font-bold text-accent-purple">{canteenStats.totalOrders}</div>
                          <div className="text-xs text-text-muted mt-1">Total Orders</div>
                        </div>
                        <div className="bg-primary border border-border rounded-lg p-4 text-center">
                          <div className="text-2xl font-bold text-text-main">{canteenStats.totalMenuItems}</div>
                          <div className="text-xs text-text-muted mt-1">Menu Items</div>
                        </div>
                      </div>

                      <div className="bg-primary border border-border rounded-lg p-5">
                        <h3 className="font-bold text-text-main mb-4">User Breakdown</h3>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-text-muted">Customers</span>
                            <span className="text-sm font-bold text-accent-cyan">{canteenStats.customers}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-text-muted">Kitchen Staff</span>
                            <span className="text-sm font-bold text-accent-purple">{canteenStats.staff}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-text-muted">Managers</span>
                            <span className="text-sm font-bold text-accent-neon">{canteenStats.managers}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-text-muted">Administrators</span>
                            <span className="text-sm font-bold text-white">{canteenStats.admins}</span>
                          </div>
                          <div className="flex justify-between items-center border-t border-border pt-3">
                            <span className="text-sm text-red-400">Suspended Accounts</span>
                            <span className="text-sm font-bold text-red-500">{canteenStats.suspended}</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-primary border border-border rounded-lg p-5">
                        <h3 className="font-bold text-text-main mb-3">Platform Info</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between"><span className="text-text-muted">Categories</span><span className="text-text-main">{canteenStats.totalCategories}</span></div>
                          <div className="flex justify-between"><span className="text-text-muted">Database</span><span className="text-accent-cyan">Neon PostgreSQL</span></div>
                          <div className="flex justify-between"><span className="text-text-muted">Platform Version</span><span className="text-text-main">v1.0.0</span></div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="py-8 text-center text-text-muted">Loading statistics...</div>
                  )}
                </div>
              )}

              {/* ── SYSTEM CONFIG MODAL ── */}
              {activeModal === 'CONFIG' && (
                <div className="space-y-4">
                  <p className="text-sm text-text-muted mb-4">Core platform settings. Changes may require a server restart.</p>
                  <div className="bg-primary border border-border rounded-lg divide-y divide-border">
                    <div className="flex justify-between items-center p-4">
                      <div><div className="font-medium text-text-main">JWT Token Expiry</div><div className="text-xs text-text-muted">Session duration for all users</div></div>
                      <select className="bg-secondary border border-border text-xs text-text-main rounded p-1.5 outline-none"><option>7 days</option><option>1 day</option><option>30 days</option></select>
                    </div>
                    <div className="flex justify-between items-center p-4">
                      <div><div className="font-medium text-text-main">Max Order Limit</div><div className="text-xs text-text-muted">Default max orders per 15-min slot</div></div>
                      <input type="number" defaultValue={20} className="w-20 bg-secondary border border-border text-sm text-text-main p-1.5 rounded outline-none text-center" />
                    </div>
                    <div className="flex justify-between items-center p-4">
                      <div><div className="font-medium text-text-main">Auto-Cancel Timeout</div><div className="text-xs text-text-muted">Minutes before uncollected orders auto-cancel</div></div>
                      <input type="number" defaultValue={30} className="w-20 bg-secondary border border-border text-sm text-text-main p-1.5 rounded outline-none text-center" />
                    </div>
                    <div className="flex justify-between items-center p-4">
                      <div><div className="font-medium text-text-main">Maintenance Mode</div><div className="text-xs text-text-muted">Temporarily disable public ordering</div></div>
                      <button className="text-xs btn-outline border-red-500/50 text-red-500 py-1.5 px-4">Enable</button>
                    </div>
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
