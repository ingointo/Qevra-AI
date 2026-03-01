import { useState } from 'react';
import Dashboard from './components/Dashboard';
import Settings from './components/Settings';
import './index.css';

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');

  return (
    <div className="flex justify-center items-center min-h-screen bg-[var(--background)] p-0 sm:p-4">
      {/* App Window Container to ensure standard proportions even in dev server view */}
      <div className="w-full h-screen sm:h-[calc(100vh-2rem)] sm:max-w-2xl bg-slate-900 sm:shadow-2xl overflow-hidden sm:rounded-3xl sm:border border-slate-700/50 flex flex-col relative transition-all">
        <div className="flex-1 overflow-y-auto">
          {currentPage === 'dashboard' ? (
            <Dashboard onNavigate={setCurrentPage} />
          ) : currentPage === 'settings' ? (
            <Settings onNavigate={setCurrentPage} />
          ) : (
            <Dashboard onNavigate={setCurrentPage} />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
