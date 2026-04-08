import React from "react";

export default function BrowserTile({
  windowName,
  role,
  status,
  message,
  lineClasses,
}) {
  return (
    <div className="browser">
      <div className="browser-head">
        <div className={`status ${status}`} />
        <strong>{windowName}</strong>
        <span>{role}</span>
      </div>
      <div className="browser-view">
        {lineClasses.map((lineClass, index) => (
          <div key={`${windowName}-${index}`} className={`line ${lineClass}`} />
        ))}
      </div>
      <div className="browser-foot">
        <span>{message}</span>
      </div>
    </div>
  );
}
