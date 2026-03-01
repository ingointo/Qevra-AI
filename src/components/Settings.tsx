import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Save } from 'lucide-react';

export default function Settings({ onNavigate }: { onNavigate: (page: string) => void }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        window.ipcRenderer.invoke('get-credentials').then((creds: { username?: string; password?: string } | null) => {
            if (creds) {
                setUsername(creds.username || '');
                setPassword(creds.password || '');
            }
        });
    }, []);

    const handleSave = async () => {
        await window.ipcRenderer.invoke('save-credentials', { username, password });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="p-8 h-full flex flex-col"
        >
            <header className="flex items-center gap-4 mb-8">
                <button
                    onClick={() => onNavigate('dashboard')}
                    className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white"
                >
                    <ArrowLeft className="w-6 h-6" />
                </button>
                <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300">
                    Configuration
                </h1>
            </header>

            <div className="glass-card p-8 flex-1">
                <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                    University Portal Credentials
                </h2>

                <div className="space-y-6">
                    <div className="flex flex-col gap-2">
                        <label className="text-sm text-slate-400 font-medium">Username / ID</label>
                        <input
                            type="text"
                            className="input-field"
                            placeholder="e.g. sue537387"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-sm text-slate-400 font-medium">Password</label>
                        <input
                            type="password"
                            className="input-field"
                            placeholder="Enter password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>

                    <div className="pt-4">
                        <button
                            className="btn-primary w-full"
                            onClick={handleSave}
                        >
                            <Save className="w-5 h-5" />
                            {saved ? 'Saved Successfully!' : 'Save Credentials'}
                        </button>
                        <p className="text-xs text-slate-500 mt-4 text-center">
                            Credentials are encrypted and stored locally on your machine.
                        </p>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
