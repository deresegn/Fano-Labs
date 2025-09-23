import React from 'react';
import './EditorContainer.css';

interface EditorContainerProps {
  children: React.ReactNode;
}

export const EditorContainer: React.FC<EditorContainerProps> = ({ children }) => {
  return (
    <div className="EditorContainer">
      {children}
    </div>
  );
}; 