import React, { useState, useEffect } from 'react';
import { ChefHat, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import api from '../utils/api';

export default function KitchenPortal() {
  const [queue, setQueue] = useState({ PREPARING: [], ACCEPTED: [], PLACED: [], READY: [], DELAYED: [] });
  const [verifyTokenStr, setVerifyTokenStr] = useState('');
  const [showInventory, setShowInventory] = useState(false);
  const [menuItems, setMenuItems] = useState([]);
  
  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadMenu = async () => {
    try {
      const res = await api.get('/menu');
      if (res.data.success) setMenuItems(res.data.items);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (showInventory) loadMenu();
  }, [showInventory]);

  const toggleItemStatus = async (item) => {
    const newStatus = item.status === 'AVAILABLE' ? 'SOLD_OUT' : 'AVAILABLE';
    try {
      const res = await api.patch(`/menu/${item.item_id}/status`, { status: newStatus });
      if (res.data.success) {
        setMenuItems(menuItems.map(m => m.item_id === item.item_id ? { ...m, status: newStatus } : m));
      }
    } catch (err) {
      alert('Failed to update item status');
    }
  };

  const loadQueue = async () => {
    try {
      const res = await api.get('/orders/queue/live');
      if (res.data.success) {
        // Group by status
        const grouped = { PREPARING: [], ACCEPTED: [], PLACED: [], READY: [], DELAYED: [] };
        // Combine active and scheduled if you want to see them all, but active is what matters for the queue.
        const ordersToDisplay = [...(res.data.active || []), ...(res.data.scheduled || [])];
        ordersToDisplay.forEach(item => {
          if (grouped[item.order_status]) {
            grouped[item.order_status].push(item);
          } else if (item.order_status === 'DELAYED') {
             grouped['DELAYED'].push(item);
          }
        });
        setQueue(grouped);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const updateStatus = async (orderId, newStatus) => {
    try {
      await api.patch(`/orders/${orderId}/status`, { status: newStatus });
      loadQueue();
    } catch (err) {
      alert('Failed to update status: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleVerifyToken = async (e) => {
    e.preventDefault();
    if (!verifyTokenStr.trim()) return;
    try {
      const res = await api.post('/orders/verify-token', { token_number: verifyTokenStr });
      if (res.data.success) {
        alert(res.data.message);
        setVerifyTokenStr('');
        loadQueue();
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Verification failed');
    }
  };

  const OrderCard = ({ order }) => {
    const isDelayed = order.order_status === 'DELAYED' || order.should_be_delayed;
    
    return (
      <div className={`card p-4 border-l-4 ${isDelayed ? 'border-amber-500 bg-amber-500/5' : 'border-border'}`}>
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl font-display font-bold text-text-main">{order.token_number}</span>
            {isDelayed && <span className="flex items-center gap-1 text-xs text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded"><AlertTriangle size={12}/> Delayed</span>}
          </div>
          <div className="text-right text-xs text-text-muted">
            {new Date(order.order_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
          </div>
        </div>
        
        <div className="space-y-2 mb-4 text-sm text-text-main">
          {order.items?.map((item, idx) => (
            <div key={idx} className="flex flex-col pb-2 border-b border-border/30 last:border-0 last:pb-0">
              <div className="flex justify-between">
                <span><span className="text-accent-cyan font-bold mr-1">{item.quantity}x</span> {item.item_name}</span>
              </div>
              {item.special_instruction && (
                <div className="text-xs text-amber-400 mt-1 pl-4 italic">Note: {item.special_instruction}</div>
              )}
            </div>
          ))}
        </div>
        
        <div className="flex gap-2 mt-4 pt-3 border-t border-border/50 flex-wrap">
          {order.order_status === 'PLACED' && (
            <>
              <button onClick={() => updateStatus(order.order_id, 'ACCEPTED')} className="btn-outline flex-1 py-1.5 text-xs border-accent-cyan text-accent-cyan">Accept</button>
              <button onClick={() => updateStatus(order.order_id, 'REJECTED')} className="btn-outline flex-1 py-1.5 text-xs border-accent-red text-accent-red">Reject</button>
            </>
          )}
          {order.order_status === 'ACCEPTED' && (
            <>
              <button onClick={() => updateStatus(order.order_id, 'PREPARING')} className="btn-outline flex-1 py-1.5 text-xs border-accent-neon text-accent-neon">Start Prep</button>
              <button onClick={() => updateStatus(order.order_id, 'DELAYED')} className="btn-outline flex-1 py-1.5 text-xs border-amber-500 text-amber-500">Report Delay</button>
            </>
          )}
          {(order.order_status === 'PREPARING' || order.order_status === 'DELAYED') && (
            <button onClick={() => updateStatus(order.order_id, 'READY')} className="btn-primary flex-1 py-1.5 text-xs flex justify-center items-center gap-1"><CheckCircle size={14}/> Mark Ready</button>
          )}
          {order.order_status === 'READY' && (
            <div className="text-center w-full text-xs text-text-muted">Awaiting Customer Collection...</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto min-h-screen">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-8 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <ChefHat className="text-accent-purple" size={28} />
          <div>
            <h1 className="text-2xl font-bold text-text-main">Live Kitchen Queue</h1>
            <p className="text-text-muted text-sm">Real-time order synchronization</p>
          </div>
        </div>
        <div className="flex gap-4 items-center">
          <button 
            onClick={() => setShowInventory(true)} 
            className="btn-outline py-1.5 px-4 text-sm font-semibold whitespace-nowrap"
          >
            Manage Stock
          </button>
          <form onSubmit={handleVerifyToken} className="flex items-center gap-2 bg-secondary p-2 rounded-lg border border-border">
            <input 
              type="text" 
              placeholder="Enter Token (e.g. C-023)" 
              className="input-field py-1.5 px-3 text-sm w-48 uppercase"
              value={verifyTokenStr}
              onChange={(e) => setVerifyTokenStr(e.target.value.toUpperCase())}
            />
            <button type="submit" className="btn-primary py-1.5 px-4 text-sm font-semibold whitespace-nowrap">
              Verify & Collect
            </button>
          </form>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
        {/* Placed Column */}
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-primary p-3 rounded border border-border">
            <h2 className="font-semibold text-text-muted uppercase text-xs tracking-wider">New (Placed)</h2>
            <span className="bg-secondary px-2 py-0.5 rounded text-xs text-text-main font-bold">{queue.PLACED.length}</span>
          </div>
          {queue.PLACED.map(order => <OrderCard key={order.order_id} order={order} />)}
          {queue.PLACED.length === 0 && <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border rounded">No new orders</div>}
        </div>
        
        {/* Accepted Column */}
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-primary p-3 rounded border border-accent-cyan/30">
            <h2 className="font-semibold text-accent-cyan uppercase text-xs tracking-wider">Accepted / Queue</h2>
            <span className="bg-accent-cyan/10 px-2 py-0.5 rounded text-xs text-accent-cyan font-bold">{queue.ACCEPTED.length}</span>
          </div>
          {queue.ACCEPTED.map(order => <OrderCard key={order.order_id} order={order} />)}
          {queue.ACCEPTED.length === 0 && <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border rounded">Queue empty</div>}
        </div>
        
        {/* Preparing & Delayed Column */}
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-primary p-3 rounded border border-accent-neon/30">
            <h2 className="font-semibold text-accent-neon uppercase text-xs tracking-wider">Prep & Delayed</h2>
            <span className="bg-accent-neon/10 px-2 py-0.5 rounded text-xs text-accent-neon font-bold">{queue.PREPARING.length + queue.DELAYED.length}</span>
          </div>
          {queue.DELAYED.map(order => <OrderCard key={order.order_id} order={order} />)}
          {queue.PREPARING.map(order => <OrderCard key={order.order_id} order={order} />)}
          {(queue.PREPARING.length === 0 && queue.DELAYED.length === 0) && <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border rounded">Kitchen is clear</div>}
        </div>
        
        {/* Ready Column */}
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-primary p-3 rounded border border-green-500/30">
            <h2 className="font-semibold text-green-500 uppercase text-xs tracking-wider">Ready for Pickup</h2>
            <span className="bg-green-500/10 px-2 py-0.5 rounded text-xs text-green-500 font-bold">{queue.READY.length}</span>
          </div>
          {queue.READY.map(order => <OrderCard key={order.order_id} order={order} />)}
          {queue.READY.length === 0 && <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border rounded">No ready orders</div>}
        </div>
      </div>

      {showInventory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center p-6 border-b border-border bg-primary/50">
              <h2 className="text-xl font-bold text-text-main">Quick Stock Management</h2>
              <button onClick={() => setShowInventory(false)} className="text-text-muted hover:text-text-main">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar">
              <div className="space-y-2">
                {menuItems.map(item => (
                  <div key={item.item_id} className="flex justify-between items-center p-3 border border-border/50 rounded hover:bg-primary/50 transition-colors">
                    <div>
                      <h3 className="font-semibold text-text-main">{item.item_name}</h3>
                      <span className="text-xs text-text-muted">{item.category} • PKR {item.price}</span>
                    </div>
                    <button 
                      onClick={() => toggleItemStatus(item)}
                      className={`text-xs px-3 py-1.5 rounded-full font-bold transition-colors ${
                        item.status === 'AVAILABLE' 
                          ? 'bg-green-500/20 text-green-400 hover:bg-red-500/20 hover:text-red-400' 
                          : 'bg-red-500/20 text-red-400 hover:bg-green-500/20 hover:text-green-400'
                      }`}
                    >
                      {item.status === 'AVAILABLE' ? 'Available (Click to mark Sold Out)' : 'Sold Out (Click to mark Available)'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
