<div align="center">
  <img src="https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/chef-hat.svg" alt="Smart Canteen OS Logo" width="100" />
  <h1>Smart Canteen OS</h1>
  <p>A modern, AI-powered food ordering and queue management system designed for university and corporate cafeterias.</p>

  <h3>🚀 Live Demo: <a href="https://smart-canteen-production-16b1.up.railway.app/">https://smart-canteen-production-16b1.up.railway.app/</a></h3>

  <!-- Badges -->
  <p>
    <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
    <img src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
    <img src="https://img.shields.io/badge/Google%20Gemini-8E75B2?style=for-the-badge&logo=google&logoColor=white" alt="Gemini AI" />
    <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind" />
  </p>
</div>

<br/>

## ✨ Overview

**Smart Canteen OS** eliminates long physical lines, prevents lost orders, and provides intelligent analytics using Google's Gemini AI. The application features a premium, glassmorphism-styled UI and robust real-time backend processing, bringing the chaotic cafeteria environment into the digital age.

---

## 🚀 Key Features

### 👨‍🎓 For Customers (Students / Employees)
- **Live Menu & Smart Cart**: Browse items, view live availability, and add to your cart seamlessly. Unavailable items automatically dim.
- **Idempotent Checkout**: Double-click protection ensures you're never charged twice.
- **Live Order Tracking**: Real-time progress bar from *Placed* ➔ *Preparing* ➔ *Ready*.
- **1-Click Reorder**: Easily duplicate past orders in a single tap.
- **Smart Estimated Prep Time (EPT)**: Wait times dynamically scale based on the live kitchen queue and congestion.

### 👨‍🍳 For Kitchen Staff
- **Live Kanban Queue**: A real-time board that instantly displays incoming orders without refreshing.
- **Intelligent Delay Detection**: Orders waiting too long automatically flag as `DELAYED` and bump to the top in warning colors.
- **1-Click Stock Management**: Instantly toggle items as "Out of Stock", hiding them from the live customer menu immediately.
- **Secure Token Verification**: Validate customer pickup using unique generated order tokens (e.g., `C-023`).

### 💼 For Managers (Admins)
- **AI-Powered Analytics**: Integrates with Google Gemini to identify sales trends, predict peak hours, and suggest menu optimizations.
- **Rich Dashboard**: Visualize daily revenue, completed orders, and active users.
- **Inventory Control**: Full CRUD management over the canteen catalog.

---

## 🛠️ Technology Stack

| Architecture | Technologies |
| --- | --- |
| **Frontend** | React (Vite), Tailwind CSS, Lucide-React Icons |
| **Backend** | Node.js, Express.js |
| **Database** | PostgreSQL (Neon Serverless) |
| **AI Engine** | Google Gemini (`@google/generative-ai`) |
| **Security** | JSON Web Tokens (JWT), bcrypt, Role-Based Access Control |

---

## 💻 Local Development Setup

Follow these steps to run the application locally.

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- A [Neon PostgreSQL](https://neon.tech/) database (or local Postgres instance)
- A [Google Gemini API Key](https://aistudio.google.com/)

### 2. Clone & Install
```bash
# Clone the repository
git clone <your-repo-url>
cd Smart-Canteen-Mngr-System

# Install backend dependencies
npm install

# Install frontend dependencies (automatically handled by our postinstall script, but if not:)
cd frontend
npm install
cd ..
```

### 3. Environment Configuration
Copy `.env.example` to `.env` in the root folder:
```bash
cp .env.example .env
```
Fill out the variables in `.env`:
```ini
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"
JWT_SECRET="your_super_secret_key"
GEMINI_API_KEY="your_gemini_key"
PORT=5000
```

### 4. Database Initialization
Run the migrations to create all necessary tables:
```bash
npm run db:push
```

### 5. Start the Application
Start the frontend and backend simultaneously:

**Terminal 1 (Backend API):**
```bash
npm run dev
```

**Terminal 2 (Frontend UI):**
```bash
cd frontend
npm run dev
```
*Your application is now running on `http://localhost:5173` (Frontend) and `http://localhost:5000` (API).*



<div align="center">
  <p>Built for the Hackathon 🚀 • Elevating the Canteen Experience</p>
</div>
