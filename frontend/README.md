# Naavik Unified UX Prototype - Frontend

Claude-like AI chatbot interface for network intelligence.

## Features

- ✅ Clean, modern chat interface (Claude-inspired)
- ✅ Real-time intent parsing
- ✅ 4-agent workflow visualization
- ✅ Natural language queries
- ✅ Responsive design
- ✅ Authentication

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## Tech Stack

- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Lucide React** - Icons
- **Axios** - API client

## Default Credentials

- Username: `admin`
- Password: `admin123`

## API Integration

Frontend connects to backend at `http://localhost:3000/api`

Make sure backend is running before starting frontend.

## Structure

```
src/
├── components/       # React components
│   ├── LoginPage.tsx
│   ├── Sidebar.tsx
│   ├── ChatInterface.tsx
│   ├── ChatMessage.tsx
│   ├── TypingIndicator.tsx
│   └── AgentWorkflowDisplay.tsx
├── context/          # React context
│   └── AuthContext.tsx
├── services/         # API services
│   └── api.ts
├── types/            # TypeScript types
│   └── index.ts
├── App.tsx           # Main app component
└── main.tsx          # Entry point
```

## Status

✅ Chatbot interface complete
🚧 Network map view - coming next
🚧 Dashboard - coming next
🚧 App store UI - coming next
🚧 Provisioning UI - coming next
