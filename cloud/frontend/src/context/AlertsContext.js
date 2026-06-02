import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { fetchAlerts, getNotificationPrefs, setNotificationPref as apiSetPref } from '../api';
import { useAuth } from './AuthContext';
import { formatTime } from '../utils/time';

const AlertsContext = createContext(null);

const NOTIF_ENABLED_KEY = 'sos_notifications_enabled';

export function AlertsProvider({ children }) {
    const { token } = useAuth();

    const [alerts, setAlerts] = useState([]);
    const [prefs, setPrefs]   = useState({});  // { [device_id]: bool }

    // Master notifications toggle — persisted in localStorage, default true
    const [notificationsEnabled, setNotificationsEnabledState] = useState(() => {
        const stored = localStorage.getItem(NOTIF_ENABLED_KEY);
        return stored === null ? true : stored === 'true';
    });

    function setNotificationsEnabled(val) {
        localStorage.setItem(NOTIF_ENABLED_KEY, String(val));
        setNotificationsEnabledState(val);
    }

    // Baseline: id of the newest alert already present at load time.
    // null  = initial load not yet complete (any WS event is genuinely new → push).
    // 0     = load complete, no historic alerts (every WS event is new → push).
    // n > 0 = only WS events with id > n trigger a push.
    const baselineIdRef = useRef(null);

    // Refs that stay in sync with state so WS closure always reads current values.
    const prefsRef = useRef({});
    useEffect(() => { prefsRef.current = prefs; }, [prefs]);

    const notificationsEnabledRef = useRef(notificationsEnabled);
    useEffect(() => { notificationsEnabledRef.current = notificationsEnabled; }, [notificationsEnabled]);

    // ── Initial data load ────────────────────────────────────────────────────────
    useEffect(() => {
        if (!token) {
            setAlerts([]);
            setPrefs({});
            baselineIdRef.current = null;
            return;
        }

        fetchAlerts()
            .then(data => {
                setAlerts(data);
                baselineIdRef.current = data[0]?.id ?? 0;
            })
            .catch(() => {});

        getNotificationPrefs().then(setPrefs).catch(() => {});
    }, [token]);

    // ── WebSocket (one connection, lives while logged in) ────────────────────────
    useEffect(() => {
        if (!token) return;

        let ws;
        let retryTimeout;
        let destroyed = false;

        function connect() {
            if (destroyed) return;
            clearTimeout(retryTimeout);
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(
                `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
            );

            ws.onclose = () => {
                if (!destroyed) retryTimeout = setTimeout(connect, 3000);
            };

            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type !== 'sos') return;

                    const event = msg.event;
                    setAlerts(prev => [event, ...prev]);

                    // Push gate 1: only events newer than the initial load
                    if (baselineIdRef.current !== null && event.id <= baselineIdRef.current) return;

                    // Push gate 2: browser permission
                    if (Notification.permission !== 'granted') return;

                    // Push gate 3: master toggle
                    if (!notificationsEnabledRef.current) return;

                    // Push gate 4: user opted in for this device
                    if (!prefsRef.current[event.device_db_id]) return;

                    new Notification(`SOS: ${event.device_name || 'Unknown device'}`, {
                        body: formatTime(event.timestamp),
                    });
                } catch (err) {
                    console.error('[WS] Failed to parse message:', err);
                }
            };
        }

        window.addEventListener('online', connect);
        window.addEventListener('offline', () => ws?.close());

        connect();
        return () => {
            destroyed = true;
            clearTimeout(retryTimeout);
            window.removeEventListener('online', connect);
            ws?.close();
        };
    }, [token]);

    // ── Manual refresh — replaces alert list, does NOT touch baseline ───────────
    const refresh = useCallback(() =>
        fetchAlerts().then(setAlerts).catch(() => {}),
    []);

    // ── Pref updater exposed to UI ───────────────────────────────────────────────
    async function updatePref(deviceId, enabled) {
        await apiSetPref(deviceId, enabled);
        setPrefs(prev => ({ ...prev, [deviceId]: enabled }));
    }

    return (
        <AlertsContext.Provider value={{ alerts, prefs, refresh, updatePref, notificationsEnabled, setNotificationsEnabled }}>
            {children}
        </AlertsContext.Provider>
    );
}

export function useAlertsContext() {
    const ctx = useContext(AlertsContext);
    if (!ctx) throw new Error('useAlertsContext must be used inside AlertsProvider');
    return ctx;
}
