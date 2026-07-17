import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const ToastContext = createContext(null);

let idSeq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((msg, type = 'info', duration = 4000) => {
    const id = ++idSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const typeStyles = {
    info:    'bg-gray-800 border-gray-600 text-gray-100',
    success: 'bg-green-900/80 border-green-500 text-green-100',
    error:   'bg-red-900/80 border-red-500 text-red-100',
    rug:     'bg-red-950 border-red-600 text-red-200',
    pump:    'bg-green-950 border-green-400 text-green-100',
    new:     'bg-purple-950 border-purple-500 text-purple-100',
  };

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      {/* Toast stack */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`px-4 py-3 rounded-lg border text-sm font-medium shadow-xl cursor-pointer
              transition-all duration-300 ${typeStyles[t.type] ?? typeStyles.info}`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
