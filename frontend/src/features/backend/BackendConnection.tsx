import React, { useEffect, useState } from 'react';
import { checkHealth } from '../../api';
import './BackendConnection.css';

interface BackendConnectionProps {
  children: React.ReactNode;
}

export const BackendConnection: React.FC<BackendConnectionProps> = ({ children }) => {
  const [connectionState, setConnectionState] = useState<'checking' | 'connected' | 'failed'>('checking');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    let checkCount = 0;
    
    const checkBackendHealth = async () => {
      try {
        console.log('🔍 Checking backend health... (attempt', checkCount + 1, ')');
        const isHealthy = await checkHealth();
        console.log('✅ Backend health check result:', isHealthy);
        
        if (!isMounted) return;
        
        if (isHealthy) {
          setConnectionState('connected');
          setErrorMessage('');
        } else {
          setConnectionState('failed');
          setErrorMessage('Backend server is not responding');
        }
      } catch (error) {
        console.error('❌ Backend health check failed:', error);
        if (!isMounted) return;
        
        setConnectionState('failed');
        setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      }
    };

    // Initial check
    checkBackendHealth();

    // Check every 10 seconds, but only if not connected and less than 3 attempts
    const interval = setInterval(() => {
      if (connectionState !== 'connected' && checkCount < 3) {
        checkCount++;
        checkBackendHealth();
      }
    }, 10000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []); // Remove connectionState from dependencies to prevent re-runs

  const handleRetry = () => {
    setConnectionState('checking');
    setErrorMessage('');
  };

  if (connectionState === 'checking') {
    return (
      <div className="BackendConnection-loading">
        <div className="BackendConnection-spinner"></div>
        <p>Checking backend connection...</p>
      </div>
    );
  }

  if (connectionState === 'failed') {
    return (
      <div className="BackendConnection-error">
        <div className="BackendConnection-error-content">
          <h2>⚠️ Backend Connection Failed</h2>
          <p>The FANO-LABS backend server is not running or not accessible.</p>
          
          {errorMessage && (
            <div className="BackendConnection-error-details">
              <strong>Error:</strong> {errorMessage}
            </div>
          )}
          
          <div className="BackendConnection-steps">
            <h3>To fix this:</h3>
            <ol>
              <li>Open Terminal</li>
              <li>Navigate to your project: <code>cd /Users/dawitderessegne/FANO-LABS</code></li>
              <li>Start the backend: <code>npm run dev:backend</code></li>
              <li>Make sure Ollama is running: <code>ollama run codellama:7b-code</code></li>
              <li>Click "Check Again" below</li>
            </ol>
          </div>
          
          <div className="BackendConnection-actions">
            <button 
              onClick={handleRetry}
              className="BackendConnection-retry-btn"
            >
              🔍 Check Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="BackendConnection-success">
      {children}
    </div>
  );
}; 