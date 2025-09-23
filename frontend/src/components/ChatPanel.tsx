import React, { useState, useRef, useEffect } from 'react';
import { GenerateRequest, GenerateResponse } from '../../shared/types';
import { generateCode, streamGenerate } from '../api';
import './ChatPanel.css';

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  currentCode: string;
  currentLanguage: string;
  selectedModel: string;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ 
  isOpen, 
  onToggle, 
  currentCode, 
  currentLanguage, 
  selectedModel 
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      type: 'assistant',
      content: 'Hello! I\'m your AI coding assistant. How can I help you today?',
      timestamp: new Date()
    }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isGenerating) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: inputMessage,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsGenerating(true);

    try {
      // Start a new assistant message and append deltas as they arrive
      const msgId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, { id: msgId, type: 'assistant', content: '', timestamp: new Date() }]);

      await streamGenerate(
        { prompt: inputMessage, model: selectedModel, language: currentLanguage },
        (delta) => {
          setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: (m.content || '') + delta } : m));
        }
      );
    } catch (error) {
      console.error('Failed to generate response:', error);
      
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: 'Sorry, I encountered an error while processing your request. Please try again.',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isOpen) {
    return (
      <div className="ChatPanel-toggle">
        <button onClick={onToggle} className="ChatPanel-toggle-btn">
          💬
        </button>
      </div>
    );
  }

  return (
    <div className="ChatPanel">
      <div className="ChatPanel-header">
        <h3>AI Chat</h3>
        <button onClick={onToggle} className="ChatPanel-close-btn">
          ×
        </button>
      </div>
      
      <div className="ChatPanel-messages">
        {messages.map((message) => (
          <div key={message.id} className={`ChatPanel-message ${message.type}`}>
            <div className="ChatPanel-message-content">
              {message.type === 'assistant' ? (
                <pre className="ChatPanel-code">{message.content}</pre>
              ) : (
                <p>{message.content}</p>
              )}
            </div>
            <div className="ChatPanel-message-time">
              {formatTimestamp(message.timestamp)}
            </div>
          </div>
        ))}
        {isGenerating && (
          <div className="ChatPanel-message assistant">
            <div className="ChatPanel-message-content">
              <div className="ChatPanel-typing">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <div className="ChatPanel-input">
        <textarea
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask me anything about your code... (Enter to send, Shift+Enter for new line)"
          disabled={isGenerating}
          className="ChatPanel-textarea"
        />
        <button
          onClick={handleSendMessage}
          disabled={!inputMessage.trim() || isGenerating}
          className="ChatPanel-send-btn"
        >
          {isGenerating ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
};

export default ChatPanel; 