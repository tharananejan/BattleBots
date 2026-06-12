import React, { useEffect, useState } from 'react';
import { CAMERA_PROXY_URL, normalizeCameraUrl } from '../constants/gameSettings';
import '../css/CameraFeedModal.css';

const CORNER_BUTTONS = [
  { id: 'top_left', label: 'Top Left' },
  { id: 'top_right', label: 'Top Right' },
  { id: 'bottom_right', label: 'Bottom Right' },
  { id: 'bottom_left', label: 'Bottom Left' },
];

const CameraFeedModal = ({
  gameSettings,
  updateGameSettings,
  calibration,
  telemetry,
  sendCalibrationMessage,
  setCalibrationMode,
  onClose,
}) => {
  const [draftUrl, setDraftUrl] = useState(gameSettings?.camera?.url ?? '');
  const [streamKey, setStreamKey] = useState(0);
  const [streamStatus, setStreamStatus] = useState('connecting');

  const isCalibrating = calibration?.calibrationMode ?? false;
  const corners = calibration?.corners ?? {};
  const allCornersCaptured = CORNER_BUTTONS.every((corner) => corners[corner.id]);

  useEffect(() => {
    setDraftUrl(gameSettings?.camera?.url ?? '');
  }, [gameSettings?.camera?.url]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      setCalibrationMode(false);
    };
  }, [setCalibrationMode]);

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

  const handleToggleCalibration = () => {
    setCalibrationMode(!isCalibrating);
  };

  const handleCaptureCorner = (cornerId) => {
    sendCalibrationMessage({ type: 'CALIBRATE_POINT', corner: cornerId });
  };

  const handleFinishCalibration = () => {
    sendCalibrationMessage({ type: 'CALIBRATE_FINISH' });
  };

  const handleResetCalibration = () => {
    sendCalibrationMessage({ type: 'CALIBRATE_RESET' });
  };

  const activeUrl = gameSettings?.camera?.url ?? '';
  const isDirty = normalizeCameraUrl(draftUrl) !== activeUrl;

  const statusMessage =
    streamStatus === 'connected'
      ? isCalibrating
        ? 'Calibration mode — raw camera feed (not warped)'
        : calibration?.homographyReady
          ? 'Live feed — bird\'s-eye view active'
          : 'Live feed from backend proxy'
      : streamStatus === 'error'
        ? 'Camera unreachable — check IP, Wi-Fi, and that location.py is running'
        : 'Connecting to camera via backend...';

  const targetDetected =
    telemetry?.red_x != null && telemetry?.red_y != null;

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
            Calibrate the battleground bird&apos;s-eye view or update the camera stream URL
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

        <div className="camera-feed-calibration">
          <div className="camera-feed-calibration-header">
            <div>
              <h3 className="camera-feed-calibration-title">Battleground Calibration</h3>
              <p className="camera-feed-calibration-desc">
                Use the range bot (target) to map the physical arena to the web app bird&apos;s-eye view
              </p>
            </div>
            <button
              type="button"
              className={`camera-feed-calibration-toggle ${isCalibrating ? 'active' : ''}`}
              onClick={handleToggleCalibration}
            >
              {isCalibrating ? 'Exit Calibration' : 'Start Calibration'}
            </button>
          </div>

          {isCalibrating && (
            <div className="camera-feed-calibration-steps">
              <div className="calibration-step">
                <span className="calibration-step-number">1</span>
                <div className="calibration-step-content">
                  <strong>Capture corners</strong>
                  <p>
                    Place the range bot (target) at each corner of the battleground, then press
                    the matching button.
                  </p>
                  <div className="calibration-corner-grid">
                    {CORNER_BUTTONS.map((corner) => (
                      <button
                        key={corner.id}
                        type="button"
                        className={`calibration-corner-btn ${
                          corners[corner.id] ? 'captured' : ''
                        }`}
                        onClick={() => handleCaptureCorner(corner.id)}
                      >
                        {corners[corner.id] ? '✓ ' : ''}
                        {corner.label}
                      </button>
                    ))}
                  </div>
                  <div className="calibration-marker-status">
                    Target:{' '}
                    {targetDetected
                      ? `detected at (${telemetry.red_x}, ${telemetry.red_y})`
                      : 'not visible — place range bot in camera view'}
                  </div>
                </div>
              </div>

              <div className="calibration-step">
                <span className="calibration-step-number">2</span>
                <div className="calibration-step-content">
                  <strong>Finish</strong>
                  <p>Apply the perspective transform to warp the feed and bot positions.</p>
                  <div className="calibration-finish-row">
                    <button
                      type="button"
                      className="calibration-finish-btn"
                      onClick={handleFinishCalibration}
                      disabled={!allCornersCaptured}
                    >
                      Finish Calibration
                    </button>
                    <button
                      type="button"
                      className="calibration-reset-btn"
                      onClick={handleResetCalibration}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(calibration?.lastMessage || calibration?.lastError) && (
            <div
              className={`camera-feed-calibration-feedback ${
                calibration?.lastError ? 'error' : 'success'
              }`}
            >
              {calibration?.lastError || calibration?.lastMessage}
            </div>
          )}

          {!isCalibrating && calibration?.homographyReady && (
            <div className="camera-feed-calibration-feedback success">
              Bird&apos;s-eye calibration is active
            </div>
          )}
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
