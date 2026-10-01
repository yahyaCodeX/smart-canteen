import React, { useState, useEffect, useMemo } from 'react';
import { ShoppingCart, Plus, Minus, Clock, MapPin, Search } from 'lucide-react';
import api from '../utils/api';

export default function CustomerPortal() {
  const [menuItems, setMenuItems] = useState([]);
  const [cart, setCart] = useState([]);
  const [activeOrders, setActiveOrders] = useState([]);
  const [orderHistory, setOrderHistory] = useState([]);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [sortBy, setSortBy] = useState('none');
  const [pickupSlot, setPickupSlot] = useState('');
  const [pickupSlots, setPickupSlots] = useState([]);

  useEffect(() => {
    loadMenu();
    loadOrders();
    loadPickupSlots();
    const interval = setInterval(() => {
      loadMenu();
      loadOrders();
      loadPickupSlots();
    }, 15000);
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

  const loadOrders = async () => {
    try {
      const res = await api.get('/orders/my');
      if (res.data.success) {
        const allOrders = res.data.orders;
        setActiveOrders(allOrders.filter(o => !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(o.order_status)));
        setOrderHistory(allOrders.filter(o => ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(o.order_status)));
      }
    } catch (err) {
      console.error(err);
    }
  };
  
  const loadPickupSlots = async () => {
    try {
      const now = new Date();
      now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
      const slots = [];
      for (let i = 0; i < 4; i++) {
        const slotStart = new Date(now.getTime() + i * 15 * 60 * 1000);
        const slotEnd = new Date(now.getTime() + (i+1) * 15 * 60 * 1000);
        const format = (d) => d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        slots.push(`${format(slotStart)} - ${format(slotEnd)}`);
      }
      setPickupSlots(slots);
      setPickupSlot(slots[0]);
    } catch (err) {
      console.error(err);
    }
  };

  const addToCart = (item) => {
    const existing = cart.find(i => i.item_id === item.item_id);
    if (existing) {
      setCart(cart.map(i => i.item_id === item.item_id ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      setCart([...cart, { ...item, quantity: 1, instructions: '' }]);
    }
  };

  const updateQuantity = (id, delta) => {
    setCart(cart.map(i => {
      if (i.item_id === id) {
        const newQty = i.quantity + delta;
        return newQty > 0 ? { ...i, quantity: newQty } : null;
      }
      return i;
    }).filter(Boolean));
  };
  
  const updateInstruction = (id, text) => {
    setCart(cart.map(i => i.item_id === id ? { ...i, instructions: text } : i));
  };

  const placeOrder = async () => {
    if (!cart.length) return;
    try {
      const items = cart.map(i => ({ item_id: i.item_id, quantity: i.quantity, special_instruction: i.instructions }));
      
      let scheduledTime = new Date();
      if (pickupSlot) {
        const timeString = pickupSlot.split(' - ')[0]; // e.g. "01:30 PM"
        const [time, modifier] = timeString.split(' ');
        let [hours, minutes] = time.split(':');
        if (hours === '12') hours = '00';
        if (modifier === 'PM') hours = parseInt(hours, 10) + 12;
        scheduledTime.setHours(hours, minutes, 0, 0);
      }

      const res = await api.post('/orders', 
        { items, scheduled_pickup_time: scheduledTime.toISOString() },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } }
      );
      if (res.data.success) {
        alert(res.data.message || 'Order placed successfully!');
        setCart([]);
        loadOrders();
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Order failed');
    }
  };

  const cancelOrder = async (orderId) => {
    if (!confirm('Are you sure you want to cancel this order?')) return;
    try {
      const res = await api.patch(`/orders/${orderId}/status`, { status: 'CANCELLED', reason: 'Customer requested cancellation' });
      if (res.data.success) {
        alert('Order cancelled successfully.');
        loadOrders();
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to cancel order.');
    }
  };

  const reorder = (orderItems) => {
    // orderItems looks like: [{ item_name: 'Burger', quantity: 2, price: 500, item_id: 'if available' }, ...]
    // We need to match with menuItems to get the actual item objects
    const newCart = [...cart];
    orderItems.forEach(oi => {
      const menuItem = menuItems.find(m => m.item_name === oi.item_name);
      if (menuItem) {
        const existing = newCart.find(i => i.item_id === menuItem.item_id);
        if (existing) {
          existing.quantity += oi.quantity;
        } else {
          newCart.push({ ...menuItem, quantity: oi.quantity, instructions: '' });
        }
      }
    });
    setCart(newCart);
    alert('Items added to cart!');
  };

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const getStatusColor = (status) => {
    switch (status) {
      case 'PLACED': return 'text-text-muted border-border';
      case 'ACCEPTED': return 'text-accent-cyan border-accent-cyan/30';
      case 'PREPARING': return 'text-accent-neon border-accent-neon/30';
      case 'READY': return 'text-green-400 border-green-400/30';
      case 'COLLECTED': return 'text-accent-purple border-accent-purple/30';
      case 'DELAYED': return 'text-amber-400 border-amber-400/30';
      default: return 'text-text-muted border-border';
    }
  };
  
  const categories = ['All', ...new Set(menuItems.map(item => item.category))];
  
  const filteredAndSortedItems = useMemo(() => {
    let result = [...menuItems];
    if (activeCategory !== 'All') result = result.filter(i => i.category === activeCategory);
    if (searchQuery) result = result.filter(i => i.item_name.toLowerCase().includes(searchQuery.toLowerCase()));
    
    if (sortBy === 'price_asc') result.sort((a,b) => a.price - b.price);
    if (sortBy === 'price_desc') result.sort((a,b) => b.price - a.price);
    if (sortBy === 'time_asc') result.sort((a,b) => a.preparation_time - b.preparation_time);
    
    return result;
  }, [menuItems, activeCategory, searchQuery, sortBy]);

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-6 max-w-7xl mx-auto min-h-screen">
      <div className="flex-1 space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-text-main">Today's Menu</h2>
            <p className="text-text-muted text-sm mt-1">Select items to add to your order.</p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
              <input 
                type="text" 
                placeholder="Search menu..." 
                className="input-field pl-9 py-1.5 text-sm w-48 bg-secondary"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <select 
              className="input-field py-1.5 text-sm w-36 bg-secondary"
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
            >
              <option value="none">Sort By...</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="time_asc">Prep Time: Quickest</option>
            </select>
          </div>
        </div>
        
        <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                activeCategory === cat ? 'bg-accent-cyan text-white shadow-[0_0_10px_rgba(34,211,238,0.4)] border-transparent' : 'bg-secondary border border-border text-text-muted hover:border-accent-cyan hover:text-accent-cyan'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredAndSortedItems.map(item => {
            const isSoldOut = item.status === 'SOLD_OUT' || item.status === 'TEMPORARILY_UNAVAILABLE' || item.available_quantity === 0;
            const isLimited = item.available_quantity > 0 && item.available_quantity < 10;
            
            return (
            <div key={item.item_id} className={`card p-0 group transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${isSoldOut ? 'opacity-60 grayscale' : 'hover:border-accent-cyan/50'}`}>
              <div className="relative h-40 w-full bg-primary overflow-hidden border-b border-border">
                <img 
                  src={item.image || 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=500&q=60'} 
                  alt={item.item_name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div className="absolute top-2 right-2">
                  {isSoldOut ? (
                    <span className="bg-gray-800/90 text-white text-xs font-bold px-2 py-1 rounded border border-gray-600 backdrop-blur-md">Sold Out</span>
                  ) : isLimited ? (
                    <span className="bg-amber-500/90 text-white text-xs font-bold px-2 py-1 rounded border border-amber-400 backdrop-blur-md">Limited: {item.available_quantity}</span>
                  ) : (
                    <span className="bg-green-500/90 text-white text-xs font-bold px-2 py-1 rounded border border-green-400 backdrop-blur-md">Available</span>
                  )}
                </div>
              </div>
              <div className="p-4 flex flex-col justify-between h-[calc(100%-10rem)]">
                <div>
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="font-semibold text-text-main leading-tight">{item.item_name}</h3>
                    <span className="text-accent-cyan font-bold whitespace-nowrap ml-2">PKR {item.price}</span>
                  </div>
                  <p className="text-xs text-text-muted line-clamp-2 mb-3">{item.description || 'Delicious freshly prepared item.'}</p>
                </div>
                
                <div className="flex justify-between items-center mt-auto">
                  <span className="flex items-center gap-1 text-xs text-text-muted"><Clock size={12}/> {item.preparation_time}m</span>
                  <button 
                    onClick={() => addToCart(item)}
                    disabled={isSoldOut}
                    className="btn-outline text-xs px-3 py-1.5"
                  >
                    {isSoldOut ? 'Sold Out' : 'Add to Order'}
                  </button>
                </div>
              </div>
            </div>
          )})}
        </div>
        
        {activeOrders.length > 0 && (
          <div className="mt-12 pt-8 border-t border-border/50">
            <h2 className="text-xl font-bold text-text-main mb-4">Active Orders</h2>
            <div className="space-y-4">
              {activeOrders.map(order => (
                <div key={order.order_id} className={`card border-l-4 ${getStatusColor(order.order_status).split(' ')[0].replace('text-', 'border-')}`}>
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <div className="text-xs text-text-muted uppercase tracking-wider mb-1">Digital Token</div>
                      <div className="text-3xl font-display font-bold tracking-tight text-text-main">{order.token_number}</div>
                    </div>
                    <div className="text-right">
                      <div className={`status-badge ${getStatusColor(order.order_status)} bg-secondary`}>
                        {order.order_status}
                      </div>
                      {order.estimated_ready_time && (
                        <div className="text-xs text-text-muted mt-2">
                          Ready approx. {new Date(order.estimated_ready_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </div>
                      )}
                      {(order.order_status === 'PLACED' || order.order_status === 'ACCEPTED') && (
                        <button 
                          onClick={() => cancelOrder(order.order_id)}
                          className="text-xs text-accent-red hover:underline mt-2 block ml-auto"
                        >
                          Cancel Order
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className="w-full bg-primary rounded-full h-1.5 mt-2 overflow-hidden border border-border/50">
                    <div 
                      className="bg-accent-cyan h-1.5 transition-all duration-500 ease-out"
                      style={{ 
                        width: order.order_status === 'PLACED' ? '20%' : 
                               order.order_status === 'ACCEPTED' ? '40%' : 
                               order.order_status === 'PREPARING' ? '60%' : 
                               order.order_status === 'READY' ? '80%' : 
                               order.order_status === 'COLLECTED' ? '100%' : '10%'
                      }}
                    ></div>
                  </div>
                  
                  <div className="mt-4 text-sm text-text-muted">
                    {order.items?.map(i => `${i.quantity}x ${i.item_name}`).join(', ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {orderHistory.length > 0 && (
          <div className="mt-12 pt-8 border-t border-border/50">
            <h2 className="text-xl font-bold text-text-main mb-4">Order History</h2>
            <div className="space-y-4">
              {orderHistory.map(order => (
                <div key={order.order_id} className="card p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-bold text-text-main">Token: {order.token_number}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${order.order_status === 'COMPLETED' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                        {order.order_status}
                      </span>
                    </div>
                    <div className="text-xs text-text-muted mb-2">
                      {new Date(order.order_time).toLocaleDateString()} at {new Date(order.order_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </div>
                    <div className="text-sm text-text-muted">
                      {order.items?.map(i => `${i.quantity}x ${i.item_name}`).join(', ')}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0 w-full md:w-auto border-t border-border/50 md:border-0 pt-3 md:pt-0">
                    <span className="text-accent-cyan font-bold">PKR {order.total_amount}</span>
                    <button 
                      onClick={() => reorder(order.items)}
                      className="btn-outline text-xs px-3 py-1.5"
                    >
                      Reorder
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="w-full lg:w-96 shrink-0">
        <div className="sticky top-6 card border-border/50 shadow-2xl bg-secondary/80 backdrop-blur-md">
          <div className="flex items-center gap-2 mb-6 text-text-main font-semibold pb-4 border-b border-border/50">
            <ShoppingCart size={20} className="text-accent-cyan" />
            <span>Current Order</span>
          </div>
          
          {cart.length === 0 ? (
            <div className="text-center py-12 text-text-muted text-sm">
              Your cart is empty. <br/><span className="text-xs mt-2 block">Select items from the menu to start your order.</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="max-h-[50vh] overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                {cart.map(item => (
                  <div key={item.item_id} className="flex flex-col gap-2 pb-4 border-b border-border/30 last:border-0 text-sm">
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center gap-2 bg-primary border border-border rounded px-2 py-1 h-fit">
                        <button onClick={() => updateQuantity(item.item_id, 1)} className="text-text-muted hover:text-accent-cyan transition-colors"><Plus size={14}/></button>
                        <span className="font-medium w-4 text-center text-text-main">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.item_id, -1)} className="text-text-muted hover:text-accent-cyan transition-colors"><Minus size={14}/></button>
                      </div>
                      <div className="flex-1 pt-1">
                        <div className="flex justify-between text-text-main font-medium mb-1">
                          <span>{item.item_name}</span>
                          <span className="text-accent-cyan font-bold">PKR {item.price * item.quantity}</span>
                        </div>
                        <input 
                          type="text" 
                          placeholder="Special instructions..." 
                          className="w-full bg-primary border border-border rounded px-2 py-1 text-xs text-text-main placeholder:text-text-muted/50 focus:outline-none focus:border-accent-cyan/50 mt-1"
                          value={item.instructions}
                          onChange={(e) => updateInstruction(item.item_id, e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="pt-4 border-t border-border/50 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs text-text-muted uppercase tracking-wider font-semibold">Select Pickup Slot</label>
                  <select 
                    className="input-field py-2 text-sm w-full bg-primary"
                    value={pickupSlot}
                    onChange={e => setPickupSlot(e.target.value)}
                  >
                    {pickupSlots.map(slot => (
                      <option key={slot} value={slot}>{slot}</option>
                    ))}
                  </select>
                </div>
                
                <div className="flex justify-between text-lg font-bold text-text-main pt-2">
                  <span>Total Amount</span>
                  <span className="text-accent-cyan">PKR {total.toFixed(2)}</span>
                </div>
                
                <button 
                  onClick={placeOrder}
                  className="btn-primary w-full flex justify-center items-center gap-2 py-3 shadow-[0_0_20px_rgba(34,211,238,0.25)] font-bold text-base tracking-wide"
                >
                  <MapPin size={18} /> Place Pre-Order
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
