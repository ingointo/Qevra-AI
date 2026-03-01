import { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
import { Play, Settings as SettingsIcon, Activity, CheckCircle2, Clock, Terminal, XCircle, Calendar, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ClassSchedule {
    subject: string;
    startTime: string;
    endTime: string;
    link: string;
    day: 'today' | 'tomorrow';
}

const parseTime = (t: string) => {
    const m = t.trim().match(/(\d{1,2})[.:](\d{2})\s*([AP]M)/i);
    if (!m) return new Date(0);
    let h = parseInt(m[1]); const min = parseInt(m[2]);
    if (m[3].toUpperCase() === 'PM' && h < 12) h += 12;
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    const d = new Date(); d.setHours(h, min, 0, 0); return d;
};

const ClassCard = memo(({ cls, isActive }: { cls: ClassSchedule; isActive: boolean }) => {
    const isPast = parseTime(cls.endTime) < new Date();
    return (
        <div className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${isActive ? 'bg-blue-500/10 border-blue-500/40 shadow-md shadow-blue-500/10'
            : isPast ? 'opacity-50 bg-slate-900/20 border-slate-800/30'
                : 'bg-slate-900/40 border-slate-700/40 hover:bg-slate-800/60'
            }`}>
            <div className={`w-1 h-full min-h-[36px] rounded-full flex-shrink-0 mt-0.5 ${isActive ? 'bg-blue-400 shadow shadow-blue-400/50' : isPast ? 'bg-slate-700' : 'bg-cyan-500'
                }`} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    {isActive && (
                        <span className="text-[10px] font-bold bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded-full animate-pulse shrink-0">
                            LIVE
                        </span>
                    )}
                    {isPast && !isActive && (
                        <span className="text-[10px] text-slate-500 shrink-0">Ended</span>
                    )}
                    <h4 className="font-semibold text-slate-100 text-xs leading-tight" title={cls.subject}>
                        {cls.subject}
                    </h4>
                </div>
                <div className="flex items-center gap-1 mt-1 text-[11px] text-slate-400">
                    <Clock className="w-2.5 h-2.5 text-cyan-400 flex-shrink-0" />
                    {cls.startTime} – {cls.endTime}
                    {cls.day === 'tomorrow' && (
                        <span className="ml-2 flex items-center gap-1 text-violet-400">
                            <Calendar className="w-2.5 h-2.5" /> Tomorrow
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
});
ClassCard.displayName = 'ClassCard';

const LogLine = memo(({ log }: { log: string }) => (
    <div className={`leading-relaxed ${log.includes('ERROR') || log.includes('FATAL') ? 'text-red-400'
        : log.includes('Step 1') || log.includes('Step 2') ? 'text-blue-300'
            : log.includes('Found') || log.includes('LIVE') || log.includes('Joining') ? 'text-emerald-300'
                : 'text-slate-300'
        }`}>
        <span className="text-slate-600 mr-1 select-none">›</span>{log}
    </div>
));
LogLine.displayName = 'LogLine';

type Status = 'idle' | 'running' | 'success' | 'error';
type UpdateState = 'idle' | 'available' | 'downloaded';

export default function Dashboard({ onNavigate }: { onNavigate: (page: string) => void }) {
    const [status, setStatus] = useState<Status>('idle');
    const [logs, setLogs] = useState<string[]>([]);
    const [schedule, setSchedule] = useState<ClassSchedule[]>([]);
    const [updateState, setUpdateState] = useState<UpdateState>('idle');
    const [updateVersion, setUpdateVersion] = useState('');
    const logEndRef = useRef<HTMLDivElement>(null);

    const { todayClasses, tomorrowClasses, activeClass } = useMemo(() => {
        const now = new Date();
        let active: ClassSchedule | null = null;
        for (const cls of schedule) {
            if (cls.day !== 'today') continue;
            const start = parseTime(cls.startTime);
            const end = parseTime(cls.endTime);
            if (now >= new Date(start.getTime() - 10 * 60_000) && now < end) {
                active = cls; break;
            }
        }
        return {
            todayClasses: schedule.filter(c => c.day === 'today'),
            tomorrowClasses: schedule.filter(c => c.day === 'tomorrow'),
            activeClass: active,
        };
    }, [schedule]);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    useEffect(() => {
        const handleLog = (_: Electron.IpcRendererEvent, msg: string) => setLogs(prev => [...prev.slice(-60), msg]);
        const handleSchedule = (_: Electron.IpcRendererEvent, data: ClassSchedule[]) => setSchedule(data);
        const handleUpdateAvailable = (_: Electron.IpcRendererEvent, version: string) => {
            setUpdateVersion(version);
            setUpdateState('available');
        };
        const handleUpdateDownloaded = () => setUpdateState('downloaded');

        window.ipcRenderer.on('automation-log', handleLog);
        window.ipcRenderer.on('schedule-update', handleSchedule);
        window.ipcRenderer.on('update-available', handleUpdateAvailable);
        window.ipcRenderer.on('update-downloaded', handleUpdateDownloaded);
        return () => {
            window.ipcRenderer.off('automation-log', handleLog);
            window.ipcRenderer.off('schedule-update', handleSchedule);
            window.ipcRenderer.off('update-available', handleUpdateAvailable);
            window.ipcRenderer.off('update-downloaded', handleUpdateDownloaded);
        };
    }, []);

    const handleStart = useCallback(async () => {
        setStatus('running');
        setLogs([]);
        try {
            const ok = await window.ipcRenderer.invoke('start-automation');
            setStatus(ok ? 'success' : 'error');
        } catch {
            setStatus('error');
        }
    }, []);

    const handleStop = useCallback(async () => {
        await window.ipcRenderer.invoke('stop-automation').catch(() => { });
        setStatus('idle');
    }, []);

    const allClasses = [...todayClasses, ...tomorrowClasses];

    return (
        <div className="h-full flex flex-col overflow-hidden bg-[var(--background)]">

            {/* Update Banner */}
            <AnimatePresence>
                {updateState !== 'idle' && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="flex-shrink-0 overflow-hidden"
                    >
                        <div className={`flex items-center justify-between px-4 py-2 text-xs ${updateState === 'downloaded'
                                ? 'bg-emerald-500/20 border-b border-emerald-500/30 text-emerald-300'
                                : 'bg-violet-500/20 border-b border-violet-500/30 text-violet-300'
                            }`}>
                            <span>
                                {updateState === 'downloaded'
                                    ? '✅ Update ready! Restart to install.'
                                    : `⬇️ Downloading Qevra AI v${updateVersion}...`}
                            </span>
                            {updateState === 'downloaded' && (
                                <button
                                    onClick={() => window.ipcRenderer.send('install-update')}
                                    className="ml-3 px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-white rounded-full font-semibold transition-colors"
                                >
                                    Restart &amp; Install
                                </button>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Header */}
            <div className="flex justify-between items-center px-5 pt-5 pb-3 flex-shrink-0">
                <div>
                    <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300">
                        Qevra AI
                    </h1>
                    <p className="text-slate-500 text-xs">AI-Powered Class Automation</p>
                </div>
                <button
                    id="settings-btn"
                    onClick={() => onNavigate('settings')}
                    aria-label="Settings"
                    className="p-2 bg-slate-800/50 hover:bg-slate-700/80 rounded-full transition-colors border border-slate-700/50"
                >
                    <SettingsIcon className="w-4 h-4 text-slate-300" />
                </button>
            </div>

            {/* Action Card */}
            <div className="glass-card mx-4 p-5 flex-shrink-0">
                <div className="flex items-center gap-4">
                    <motion.div
                        animate={{ scale: status === 'running' ? [1, 1.06, 1] : 1 }}
                        transition={{ repeat: status === 'running' ? Infinity : 0, duration: 1.8 }}
                        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg flex-shrink-0 ${status === 'running' ? 'bg-blue-500/20 shadow-blue-500/40 text-blue-400'
                            : status === 'success' ? 'bg-emerald-500/20 text-emerald-400'
                                : status === 'error' ? 'bg-red-500/20 text-red-400'
                                    : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                    >
                        {status === 'success' ? <CheckCircle2 className="w-7 h-7" />
                            : status === 'running' ? <Activity className="w-7 h-7 animate-pulse" />
                                : status === 'error' ? <XCircle className="w-7 h-7" />
                                    : <Play className="w-7 h-7 ml-0.5" />}
                    </motion.div>
                    <div className="flex-1 min-w-0">
                        <h2 className="font-semibold text-slate-100 text-sm">
                            {status === 'idle' ? 'Ready to Automate'
                                : status === 'running' ? 'Automation Running…'
                                    : status === 'success' ? 'Session Complete!'
                                        : 'Error — Check Logs'}
                        </h2>
                        <p className="text-slate-400 text-xs mt-0.5">
                            {status === 'running'
                                ? 'Monitoring schedule & joining meetings'
                                : 'Auto-login, scrape schedule & join classes'}
                        </p>
                        <div className="flex gap-2 mt-2">
                            <button
                                id="start-automation-btn"
                                className="btn-primary text-xs py-1.5 px-3"
                                onClick={handleStart}
                                disabled={status === 'running'}
                            >
                                <Play className="w-3 h-3" />
                                {status === 'running' ? 'Running…' : 'Start'}
                            </button>
                            {status === 'running' && (
                                <button
                                    id="stop-automation-btn"
                                    className="flex items-center gap-1.5 text-xs py-1.5 px-3 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 rounded-lg transition-colors"
                                    onClick={handleStop}
                                >
                                    <Square className="w-3 h-3" /> Stop
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Logs */}
                <AnimatePresence>
                    {logs.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="mt-3 bg-slate-950/80 rounded-lg border border-slate-800 overflow-hidden"
                        >
                            <div className="flex items-center gap-1.5 px-3 py-1.5 text-slate-500 text-[10px] font-bold uppercase tracking-wider border-b border-slate-800">
                                <Terminal className="w-2.5 h-2.5" /> Logs
                            </div>
                            <div className="px-3 py-2 space-y-0.5 font-mono text-[11px] max-h-24 overflow-y-auto">
                                {logs.map((log, i) => <LogLine key={i} log={log} />)}
                                <div ref={logEndRef} />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Schedule Card — flex-1 so it fills remaining height */}
            <div className="glass-card mx-4 mt-3 mb-4 flex flex-col flex-1 min-h-0 overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        Schedule
                        <span className="ml-1 text-slate-600">({allClasses.length})</span>
                    </h3>
                    {activeClass && (
                        <span className="text-[10px] font-bold text-blue-400 animate-pulse">● Live Now</span>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2 min-h-0">
                    {schedule.length > 0 ? (
                        <>
                            {todayClasses.length > 0 && (
                                <>
                                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider pt-1">Today</div>
                                    {todayClasses.map((cls, i) => (
                                        <ClassCard key={i} cls={cls} isActive={activeClass?.startTime === cls.startTime} />
                                    ))}
                                </>
                            )}
                            {tomorrowClasses.length > 0 && (
                                <>
                                    <div className="flex items-center gap-2 mt-2">
                                        <div className="flex-1 h-px bg-slate-700/40" />
                                        <span className="text-[10px] text-slate-500 font-semibold flex items-center gap-1">
                                            <Calendar className="w-2.5 h-2.5 text-violet-400" /> Tomorrow
                                        </span>
                                        <div className="flex-1 h-px bg-slate-700/40" />
                                    </div>
                                    {tomorrowClasses.map((cls, i) => (
                                        <ClassCard key={'tmr-' + i} cls={cls} isActive={false} />
                                    ))}
                                </>
                            )}
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-8 text-center">
                            <Clock className="w-8 h-8 text-slate-700 mb-2" />
                            <p className="text-slate-500 text-xs">
                                {status === 'running'
                                    ? '⏳ Scanning portal for schedule…'
                                    : 'Start automation to load your class schedule.'}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
