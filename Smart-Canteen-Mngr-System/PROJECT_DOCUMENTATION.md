# Smart Canteen OS - Detailed Project Documentation

## 1. Project Overview
**Smart Canteen OS** is a modern, AI-powered food ordering and queue management system designed for university and corporate cafeterias. It eliminates long physical lines, prevents lost orders, and provides intelligent analytics using Google's Gemini AI. The application features a premium, glassmorphism-styled UI and robust real-time backend processing.

## 2. Technology Stack
*   **Frontend**: React.js (Vite), Tailwind CSS (for custom glassmorphism & responsive design), Lucide-React (icons).
*   **Backend**: Node.js, Express.js.
*   **Database**: PostgreSQL (hosted on Neon Serverless Postgres).
*   **AI Engine**: Google Gemini AI (`@google/genai`).
*   **Authentication**: JSON Web Tokens (JWT) & bcrypt for password hashing.

## 3. Core Roles & Features

### 👨‍🎓 Customer (Student / Employee)
*   **Live Menu & Cart**: Browse available items, see prices, and add them to a smart cart. Unavailable items are automatically grayed out.
*   **Order Placement & Idempotency**: Places orders securely. The system uses *Idempotency Keys* to guarantee that double-clicking the checkout button won't charge the user twice.
*   **Live Order Tracking**: A real-time progress bar showing the exact state of their food (Placed ➔ Accepted ➔ Preparing ➔ Ready ➔ Collected). 
*   **Order History & 1-Click Reorder**: View past orders and click a single button to instantly rebuild the cart with the same items.
*   **Order Cancellation**: Allows cancelling an order *only* if the kitchen hasn't started preparing it yet.

### 👨‍🍳 Kitchen Staff
*   **Real-time Kitchen Queue**: A Kanban-style board that instantly displays incoming orders without refreshing.
*   **Order Lifecycle Management**: Staff can Accept, Start Prep, and Mark Ready.
*   **Intelligent Delay Detection**: Orders waiting too long are automatically flagged as `DELAYED` and bumped to the top of the queue in bright orange.
*   **Quick Stock Management**: A modal allowing staff to instantly mark an ingredient/food item as "Out of Stock", immediately removing it from the Customer menu.
*   **Secure Token Verification**: Customers are given a unique token (e.g. `C-023`). Staff type this into the Verify bar to hand over the food, preventing theft.

### 💼 Manager (Admin)
*   **Analytics Dashboard**: Visual charts showing daily revenue, total orders processed, and active customers.
*   **AI Intelligence**: Integrates with Gemini AI to analyze order history and generate predictions (e.g., predicting rush hours, suggesting menu optimizations).
*   **Full Inventory Control**: Add new menu items, update prices, and permanently manage the database catalog.

## 4. Advanced Technical Systems

### Dynamic EPT (Estimated Prep Time) Algorithm
Instead of static wait times, the system calculates exact readiness dynamically. 
`Base Time (e.g., 5 mins for a burger) + (Queue Size * Congestion Factor)`
This ensures customers are given realistic pickup windows when the canteen is swamped.

### Google Gemini AI Integration
The backend securely talks to Google Gemini to process natural language analytics. It takes the day's raw transaction logs, feeds them to the LLM, and asks the model to identify patterns, such as:
*   *"Is there a spike in coffee orders at 10 AM?"*
*   *"Are we running out of brownies too early?"*
The AI returns structured data that the dashboard renders as actionable business intelligence.

### PostgreSQL Relational Schema
*   `Users`: Stores credentials, roles (`CUSTOMER`, `STAFF`, `MANAGER`), and balances.
*   `Menu_Items`: Catalog of food, prices, prep times, and availability boolean.
*   `Orders`: Master record of a transaction, storing total amount, token number, and timestamps (placed, estimated ready, pickup).
*   `Order_Items`: Junction table linking `Orders` to `Menu_Items` to handle multiple distinct items in a single cart.

## 5. Security & Infrastructure
*   **Role-Based Access Control (RBAC)**: Express middlewares (`checkRole`) ensure that Customers cannot access the Kitchen Queue, and Staff cannot view Manager Analytics.
*   **Environment Variables**: Database strings, JWT secrets, and AI API keys are strictly kept out of the source code via `.env` files.
*   **Error Handling**: Unified `try/catch` wrappers and standard JSON error responses (`{ success: false, error: "message" }`) ensure the frontend never crashes from unhandled backend exceptions.
