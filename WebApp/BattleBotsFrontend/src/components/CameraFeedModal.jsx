import React, { useEffect, useState } from 'react';
import { CAMERA_PROXY_URL, normalizeCameraUrl } from '../constants/gameSettings';
import '../css/CameraFeedModal.css';

const CameraFeedModal = ({ gameSettings, updateGameSettings, onClose }) => {
  const [draftUrl, setDraftUrl] = useState(gameSettings?.camera?.url ?? '');
  const [streamKey, setStreamKey] = useState(0);
  const [streamStatus, setStreamStatus] = useState('connecting');

  useEffect(() => {
    setDraftUrl(gameSettings?.camera?.url ?? '');
  }, [gameSettings?.camera?.url]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleBackdropClick = (e) => {
    if (e.target.className === 'camera-feed-overlay') {
      onClose();
    }
  };

  const handleUpdateUrl = () => {
    const normalizedUrl = normalizeCameraUrl(draftUrl);
    if (!normalizedUrl) return;

    setDraftUrl(normalizedUrl);
    updateGameSettings({ camera: { url: normalizedUrl } });
    setStreamStatus('connecting');
    setStreamKey((prev) => prev + 1);
  };

  const activeUrl = gameSettings?.camera?.url ?? '';
  const isDirty = normalizeCameraUrl(draftUrl) !== activeUrl;

  const statusMessage =
    streamStatus === 'connected'
      ? 'Live feed from backend proxy'
      : streamStatus === 'error'
        ? 'Camera unreachable — check IP, Wi-Fi, and that location.py is running'
        : 'Connecting to camera via backend...';

  return (
    <div className="camera-feed-overlay" onClick={handleBackdropClick}>
      <div className="camera-feed-container">
        <button
          type="button"
          className="camera-feed-close"
          onClick={onClose}
          aria-label="Close Camera Feed"
        >
          &times;
        </button>

        <div className="camera-feed-header">
          <h2 className="camera-feed-title">CAMERA FEED</h2>
          <p className="camera-feed-subtitle">
            Update the IP camera stream URL when your device or Wi-Fi changes
          </p>
        </div>

        <div className="camera-feed-controls">
          <label className="camera-feed-label" htmlFor="camera-url-input">
            Stream URL
          </label>
          <div className="camera-feed-input-row">
            <input
              id="camera-url-input"
              type="url"
              className="camera-feed-input"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="http://192.168.1.100:8080/video"
            />
            <button
              type="button"
              className="camera-feed-update-btn"
              onClick={handleUpdateUrl}
              disabled={!draftUrl.trim() || !isDirty}
            >
              Update URL
            </button>
          </div>
          <p className="camera-feed-hint">
            Example: <code>http://10.18.205.90:8080/video</code> or{' '}
            <code>10.18.205.90:8080</code>
          </p>
        </div>

        <div className={`camera-feed-status camera-feed-status--${streamStatus}`}>
          {statusMessage}
        </div>

        <div className="camera-feed-preview">
          <img
            key={`${activeUrl}-${streamKey}`}
            src={CAMERA_PROXY_URL}
            alt="Live camera feed"
            className="camera-feed-stream"
            onLoad={() => setStreamStatus('connected')}
            onError={() => setStreamStatus('error')}
          />
          {streamStatus !== 'connected' && (
            <div className="camera-feed-empty">
              {streamStatus === 'error'
                ? 'No video from backend proxy'
                : 'Waiting for camera stream...'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CameraFeedModal;
