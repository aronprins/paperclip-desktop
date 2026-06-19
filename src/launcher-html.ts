export function getLauncherHtml(): string {
  return String.raw`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Paperclip</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    min-height: 100vh;
    background: #0a0a0a;
    color: #e4e4e7;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 28px 28px 28px;
    user-select: none;
    overflow: auto;
  }

  .window {
    width: min(100%, 480px);
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    overflow: visible;
  }

  .window-close {
    position: fixed;
    top: 12px;
    right: 12px;
    width: 36px;
    height: 36px;
    border: 1px solid #27272a;
    border-radius: 999px;
    background: #111114;
    color: #71717a;
    display: none;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.35);
    z-index: 4;
  }
  .window-close.visible {
    display: inline-flex;
  }
  .window-close:hover {
    background: #18181b;
    color: #e4e4e7;
    border-color: #52525b;
  }

  .logo {
    width: 56px;
    height: 56px;
    margin-bottom: 20px;
    opacity: 0;
    animation: fadeIn 0.5s ease-out forwards;
  }

  .app-title {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin-bottom: 32px;
    opacity: 0;
    animation: fadeIn 0.5s ease-out 0.15s forwards;
  }

  .view {
    display: none;
    flex-direction: column;
    align-items: center;
    width: 100%;
    opacity: 0;
    animation: fadeIn 0.35s ease-out forwards;
  }
  .view.active { display: flex; }

  .tab-bar {
    display: flex;
    gap: 0;
    margin-bottom: 24px;
    border: 1px solid #27272a;
    border-radius: 8px;
    overflow: hidden;
    width: 280px;
  }
  .tab-btn {
    flex: 1;
    padding: 9px 0;
    font-size: 13px;
    font-family: inherit;
    border: none;
    cursor: pointer;
    background: #18181b;
    color: #71717a;
    transition: background 0.2s, color 0.2s;
  }
  .tab-btn + .tab-btn { border-left: 1px solid #27272a; }
  .tab-btn.active { background: #27272a; color: #e4e4e7; }
  .tab-btn:focus-visible { outline: 2px solid #52525b; outline-offset: -2px; }

  .tab-content { display: none; flex-direction: column; align-items: center; width: 100%; }
  .tab-content.active { display: flex; }

  .local-hero-icon {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: #111114;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 20px;
  }
  .local-hero-title {
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 6px;
  }
  .local-hero-desc {
    font-size: 12px;
    color: #52525b;
    margin-bottom: 24px;
    text-align: center;
    max-width: 300px;
  }

  .remember-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #71717a;
    margin-bottom: 20px;
  }
  .remember-row input[type="checkbox"] {
    accent-color: #a1a1aa;
  }

  .btn {
    padding: 8px 20px;
    border-radius: 6px;
    border: 1px solid #27272a;
    background: transparent;
    color: #e4e4e7;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    font-family: inherit;
  }
  .btn:hover { background: #18181b; border-color: #52525b; }
  .btn.primary {
    background: #e4e4e7;
    color: #0a0a0a;
    border-color: #e4e4e7;
    font-weight: 500;
  }
  .btn.primary:hover { background: #d4d4d8; border-color: #d4d4d8; }
  .btn.danger { color: #f87171; border-color: #7f1d1d; }
  .btn.danger:hover { background: #1c1215; border-color: #991b1b; }
  .btn:disabled { opacity: 0.35; pointer-events: none; }

  .btn-row {
    display: flex;
    gap: 10px;
    justify-content: center;
  }

  .form-group {
    width: 340px;
    margin-bottom: 16px;
    text-align: left;
  }
  .form-group label {
    display: block;
    font-size: 12px;
    color: #71717a;
    margin-bottom: 6px;
  }
  .form-group input {
    width: 100%;
    padding: 9px 12px;
    border-radius: 6px;
    border: 1px solid #27272a;
    background: #18181b;
    color: #e4e4e7;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s;
  }
  .form-group input::placeholder { color: #3f3f46; }
  .form-group input:focus { border-color: #52525b; }
  .form-group .field-hint {
    font-size: 11px;
    color: #52525b;
    margin-top: 4px;
  }
  .form-group .field-error {
    font-size: 11px;
    color: #f87171;
    margin-top: 4px;
    display: none;
  }
  .form-group .field-success {
    font-size: 11px;
    color: #4ade80;
    margin-top: 4px;
    display: none;
  }

  .form-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin-top: 8px;
    margin-bottom: 16px;
  }

  #view-remote-form .form-actions,
  #view-error .btn-row {
    width: 340px;
    flex-direction: column;
    align-items: stretch;
  }

  #view-remote-form .form-actions .btn,
  #view-error .btn-row .btn {
    width: 100%;
  }

  .back-link {
    font-size: 12px;
    color: #52525b;
    cursor: pointer;
    transition: color 0.15s;
    margin-top: 12px;
  }
  .back-link:hover { color: #a1a1aa; }


  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 20px;
    margin-bottom: 16px;
  }
  .status-badge.healthy { background: #052e16; color: #4ade80; }
  .status-badge.warning { background: #2b2110; color: #fbbf24; }
  .status-badge.unreachable { background: #2a1215; color: #f87171; }
  .status-badge.testing { background: #1c1c1f; color: #a1a1aa; }
  .status-badge .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .status-card {
    width: 340px;
    display: none;
    border: 1px solid #27272a;
    border-radius: 8px;
    padding: 14px;
    margin-bottom: 14px;
    background: #141417;
    text-align: left;
  }
  .status-card.active { display: block; }
  .status-card.warning-card {
    border-color: #3f3220;
    background: #17130d;
    padding: 10px 12px;
  }
  .status-card.warning-card .warning-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .status-card.warning-card .warning-header .status-badge {
    margin-bottom: 0;
  }
  .status-card.warning-card .warning-info {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #3f3220;
    color: #fbbf24;
    font-size: 10px;
    font-weight: 600;
    cursor: help;
    user-select: none;
  }
  .status-card.warning-card .warning-info .warning-tooltip {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    width: 260px;
    padding: 8px 10px;
    background: #0a0a0b;
    border: 1px solid #3f3220;
    border-radius: 6px;
    color: #d4d4d8;
    font-size: 11px;
    font-weight: 400;
    line-height: 1.4;
    text-align: left;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.12s ease;
    z-index: 10;
    white-space: normal;
  }
  .status-card.warning-card .warning-info:hover .warning-tooltip,
  .status-card.warning-card .warning-info:focus .warning-tooltip {
    opacity: 1;
  }
  .status-card.warning-card .remember-row {
    margin-top: 0;
    margin-bottom: 0;
    color: #d4d4d8;
    font-size: 12px;
  }
  .status-card.warning-card .remember-row label {
    color: inherit;
  }

  .step-panel {
    width: 340px;
    border: 1px solid #1f1f22;
    border-radius: 10px;
    background: #0d0d10;
    padding: 12px 14px;
    margin-bottom: 10px;
    text-align: left;
    transition: opacity 0.2s;
  }
  .step-panel.muted { opacity: 0.4; pointer-events: none; }
  .step-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    color: #a1a1aa;
    margin-bottom: 10px;
    min-height: 22px;
  }
  .step-panel-head.no-body { margin-bottom: 0; }
  .step-panel-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .step-panel .form-group { width: 100%; margin-bottom: 0; }
  .step-panel .status-card {
    width: 100%;
    margin-bottom: 0;
  }
  .step-panel #testStatus .status-badge {
    margin: 0;
  }
  .step-placeholder {
    font-size: 11px;
    color: #52525b;
    padding: 2px 0;
  }

  /* The plain status-card carries no visible UI inside the step panel;
     its contents live in the #verifyInfo tooltip. */
  .step-panel .status-card:not(.warning-card) { display: none; }

  /* Info icon in the verify step head (carries the detail text) */
  .verify-info {
    position: relative;
    display: none;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #27272a;
    color: #a1a1aa;
    font-size: 10px;
    font-weight: 600;
    cursor: help;
    user-select: none;
    flex-shrink: 0;
  }
  .verify-info.visible { display: inline-flex; }
  .verify-info:hover { background: #3f3f46; color: #e4e4e7; }
  .verify-info .verify-tooltip {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    width: 260px;
    padding: 10px;
    background: #0a0a0b;
    border: 1px solid #3f3f46;
    border-radius: 6px;
    color: #d4d4d8;
    font-size: 11px;
    font-weight: 400;
    line-height: 1.4;
    text-align: left;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.12s ease;
    z-index: 10;
    white-space: normal;
  }
  .verify-tooltip .tip-detail {
    display: block;
    margin-bottom: 8px;
  }
  .verify-tooltip .tip-meta {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 10px;
    row-gap: 3px;
    font-size: 10px;
    padding-top: 8px;
    border-top: 1px solid #27272a;
  }
  .verify-tooltip .tip-meta .k { color: #71717a; }
  .verify-tooltip .tip-meta .v { color: #d4d4d8; font-family: "SF Mono", Menlo, monospace; }
  .verify-tooltip .tip-meta:empty { display: none; }
  .verify-info:hover .verify-tooltip,
  .verify-info:focus .verify-tooltip { opacity: 1; }
  .step-panel-head .head-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-title {
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 4px;
  }
  .status-detail {
    color: #71717a;
    font-size: 11px;
    line-height: 1.4;
  }
  .status-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    border: 1px solid #27272a;
    border-radius: 4px;
    padding: 2px 7px;
    font-size: 10px;
    color: #a1a1aa;
    background: transparent;
  }

  .connections-list {
    width: 400px;
    margin-bottom: 16px;
  }

  .conn-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid #27272a;
    border-radius: 8px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
  }
  .conn-item:hover {
    border-color: #52525b;
    background: #18181b;
  }
  .conn-item.active-conn {
    border-color: #4ade80;
    background: #0a1a0f;
  }
  .conn-icon {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: #27272a;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .conn-icon svg { width: 16px; height: 16px; }
  .conn-info { flex: 1; min-width: 0; }
  .conn-name {
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .conn-url {
    font-size: 11px;
    color: #52525b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .conn-meta {
    font-size: 10px;
    color: #3f3f46;
    margin-top: 2px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .conn-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .conn-actions button {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: #52525b;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, background 0.15s;
  }
  .conn-actions button:hover { color: #e4e4e7; background: #27272a; }
  .conn-actions button.delete-btn:hover { color: #f87171; background: #1c1215; }
  .conn-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .conn-status-dot.healthy { background: #4ade80; }
  .conn-status-dot.auth-required { background: #fbbf24; }
  .conn-status-dot.unreachable { background: #f87171; }
  .conn-status-dot.unsupported { background: #9ca3af; }
  .conn-status-dot.unknown { background: #3f3f46; }
  .empty-state {
    text-align: center;
    padding: 32px 0;
    color: #3f3f46;
    font-size: 13px;
  }

  .section-title {
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 16px;
    color: #a1a1aa;
  }

  .section-subtitle {
    font-size: 12px;
    color: #52525b;
    margin-bottom: 20px;
  }

  .connecting-view {
    text-align: center;
  }
  .connecting-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid #27272a;
    border-top-color: #a1a1aa;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin: 0 auto 16px;
  }
  .connecting-label {
    font-size: 13px;
    color: #a1a1aa;
    margin-bottom: 4px;
  }
  .connecting-url {
    font-size: 11px;
    color: #52525b;
  }

  .loop-card {
    width: 360px;
    padding: 18px;
    border: 1px solid #27272a;
    border-radius: 10px;
    background: #141417;
    margin-bottom: 18px;
    text-align: left;
  }
  .loop-eyebrow {
    font-size: 11px;
    color: #fbbf24;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-bottom: 10px;
  }
  .loop-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  .loop-detail {
    font-size: 12px;
    color: #a1a1aa;
    line-height: 1.5;
    margin-bottom: 14px;
  }
  .loop-url {
    font-size: 11px;
    color: #71717a;
    word-break: break-word;
    padding: 10px 12px;
    border: 1px solid #27272a;
    border-radius: 8px;
    background: #0f0f12;
  }

  .error-box {
    width: 340px;
    padding: 16px;
    border: 1px solid #7f1d1d;
    border-radius: 8px;
    background: #1c1215;
    margin-bottom: 16px;
    text-align: center;
  }
  .error-box .error-title {
    font-size: 13px;
    font-weight: 500;
    color: #f87171;
    margin-bottom: 4px;
  }
  .error-box .error-detail {
    font-size: 11px;
    color: #71717a;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal-overlay.active { display: flex; }
  .modal {
    width: 380px;
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 12px;
    padding: 24px;
    animation: fadeIn 0.2s ease-out forwards;
  }
  .modal .modal-title {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 20px;
  }
  .modal .form-group { width: 100%; }
  .modal .form-actions { justify-content: flex-end; }
  .modal .status-card {
    width: 100%;
    margin-bottom: 16px;
  }

  .progress-track {
    width: 240px;
    height: 3px;
    background: #27272a;
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 24px;
  }
  .progress-bar {
    height: 100%;
    width: 0%;
    background: #a1a1aa;
    border-radius: 2px;
    transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .steps {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 280px;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: #52525b;
    transition: color 0.3s ease;
  }
  .step.active { color: #e4e4e7; }
  .step.done { color: #71717a; }
  .step-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .step-icon .pending { width: 6px; height: 6px; border-radius: 50%; background: #3f3f46; }
  .step-icon .spinner { width: 14px; height: 14px; border: 2px solid #3f3f46; border-top-color: #a1a1aa; border-radius: 50%; animation: spin 0.7s linear infinite; }
  .step-icon .check { color: #71717a; font-size: 14px; line-height: 1; }
  .step-detail {
    display: block;
    font-size: 11px;
    color: #52525b;
    margin-top: 2px;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .conn-item:focus-visible,
  .btn:focus-visible,
  .tab-conn-item:focus-visible {
    outline: 2px solid #52525b;
    outline-offset: 2px;
  }

  .tab-conn-list {
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 20px;
  }
  .tab-conn-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border: 1px solid #27272a;
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
  }
  .tab-conn-item:hover {
    border-color: #52525b;
    background: #18181b;
  }
  .tab-conn-icon {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: #27272a;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .tab-conn-icon svg { width: 14px; height: 14px; }
  .tab-conn-info { flex: 1; min-width: 0; }
  .tab-conn-name {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tab-conn-url {
    font-size: 10px;
    color: #52525b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tab-conn-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .tab-conn-dot.healthy { background: #4ade80; }
  .tab-conn-dot.auth-required { background: #fbbf24; }
  .tab-conn-dot.unsupported { background: #fb7185; }
  .tab-conn-dot.unreachable { background: #f87171; }
  .tab-conn-dot.unknown { background: #3f3f46; }
  .tab-conn-edit {
    padding: 4px 6px;
    border: none;
    background: transparent;
    color: #3f3f46;
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }
  .tab-conn-edit:hover { color: #a1a1aa; background: #27272a; }
  .tab-empty {
    text-align: center;
    padding: 24px 0;
    color: #3f3f46;
    font-size: 12px;
  }
</style>
</head>
<body>
<div class="window">
  <button class="window-close" id="windowCloseBtn" aria-label="Close" onclick="closeLauncherSheet()">&times;</button>
  <div class="logo">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"/></svg>
  </div>
  <div class="app-title">Paperclip</div>

  <div class="view active" id="view-chooser">
    <div class="tab-bar" role="tablist">
      <button class="tab-btn active" id="tab-btn-local" role="tab" tabindex="0" onclick="switchTab('local')">Local</button>
      <button class="tab-btn" id="tab-btn-remote" role="tab" tabindex="-1" onclick="switchTab('remote')">Remote</button>
    </div>

    <div class="tab-content active" id="tab-local" role="tabpanel">
      <div class="local-hero-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      </div>
      <div class="local-hero-title">Run Local Server</div>
      <div class="local-hero-desc">Start the embedded Paperclip server on this machine with trusted local access.</div>
      <button class="btn primary" style="min-width:180px;" onclick="launchLocal()">Launch</button>
      <div class="remember-row" style="margin-top:20px;margin-bottom:0;">
        <input type="checkbox" id="rememberLocal">
        <label for="rememberLocal">Always start local on launch</label>
      </div>
    </div>

    <div class="tab-content" id="tab-remote" role="tabpanel">
      <div class="tab-conn-list" id="tabRemoteList"></div>
      <div class="btn-row" style="gap:8px;">
        <button class="btn" onclick="openAddRemoteFromChooser()">+ Add Remote Connection</button>
      </div>
      <div class="remember-row" style="margin-top:16px;margin-bottom:0;">
        <input type="checkbox" id="rememberRemoteChooser">
        <label for="rememberRemoteChooser">Reconnect to the selected remote on launch</label>
      </div>
    </div>
  </div>

  <div class="view" id="view-remote-form">
    <div class="section-title">Connect to Remote</div>
    <div class="section-subtitle">Verify the remote before continuing. HTTP connections require explicit confirmation.</div>

    <div class="step-panel" id="stepPanelUrl">
      <div class="step-panel-head"><span>Remote URL</span></div>
      <div class="step-panel-body">
        <div class="form-group">
          <input type="text" id="remoteUrl" placeholder="https://paperclip.example.com">
          <div class="field-hint">Desktop verifies /api/health and auth readiness. HTTPS recommended; HTTP requires acknowledgment.</div>
          <div class="field-error" id="urlError">Enter a valid remote URL.</div>
          <div class="field-success" id="urlSuccess">Verified authenticated Paperclip remote detected.</div>
        </div>
      </div>
    </div>

    <div class="step-panel" id="stepPanelVerify">
      <div class="step-panel-head">
        <span>Verification</span>
        <div class="head-right">
          <div id="testStatus"></div>
          <span class="verify-info" id="verifyInfo" tabindex="0" aria-label="Verification details">i<span class="verify-tooltip"><span class="tip-detail" id="statusDetail">Run verification to inspect deployment mode, auth readiness, and sign-in state.</span><span class="tip-meta" id="statusTipMeta"></span></span></span>
        </div>
      </div>
      <div class="step-panel-body">
        <div class="status-card" id="statusCard" hidden>
          <div class="status-title" id="statusTitle" hidden>Waiting for verification</div>
          <div class="status-meta" id="statusMeta" hidden></div>
        </div>
        <div class="status-card warning-card" id="httpWarningCard">
          <div class="warning-header">
            <div class="status-badge warning"><div class="dot"></div>Insecure HTTP</div>
            <span class="warning-info" tabindex="0" aria-label="More information">?<span class="warning-tooltip" id="httpWarningDetail">This URL disables TLS. Only continue if you trust the network path to this remote. Connect and save stay disabled until you acknowledge.</span></span>
          </div>
          <div class="remember-row">
            <input type="checkbox" id="allowInsecureHttp">
            <label for="allowInsecureHttp">I understand the risk and want to allow this HTTP connection</label>
          </div>
        </div>
        <div class="step-placeholder" id="verifyPlaceholder">Run verify to inspect deployment mode, auth readiness, and sign-in state.</div>
      </div>
    </div>

    <div class="step-panel" id="stepPanelSave">
      <div class="step-panel-head"><span>Save &amp; connect</span></div>
      <div class="step-panel-body">
        <div class="form-group">
          <label for="displayName">Display name <span style="color:#3f3f46">(optional)</span></label>
          <input type="text" id="displayName" placeholder="e.g. Home Server">
        </div>
        <div class="remember-row" style="margin-bottom:0;">
          <input type="checkbox" id="rememberRemoteForm">
          <label for="rememberRemoteForm">Reconnect to this remote on launch</label>
        </div>
      </div>
    </div>

    <div class="form-actions">
      <button class="btn" id="verifyBtn" onclick="verifyRemote()">Verify Remote</button>
      <button class="btn primary" id="signinBtn" onclick="continueToSignIn()" disabled>Continue to Sign-In</button>
      <button class="btn" id="saveBtn" onclick="connectAndSave()" disabled>Connect &amp; Save</button>
    </div>

    <div class="back-link" onclick="showChooserRemoteTab()">&larr; Back to connections</div>
  </div>

  <div class="view" id="view-connecting">
    <div class="connecting-view">
      <div class="connecting-spinner"></div>
      <div class="connecting-label" id="connectingLabel">Opening verified remote...</div>
      <div class="connecting-url" id="connectingUrl"></div>
    </div>
  </div>

  <div class="view" id="view-error">
    <div class="error-box">
      <div class="error-title" id="errorTitle">Remote not eligible</div>
      <div class="error-detail" id="errorDetail">This host responded, but it is either not Paperclip or is configured in upstream local_trusted mode.</div>
    </div>

    <div class="btn-row">
      <button class="btn" id="errorRetryBtn" onclick="retryLastAction()">Retry</button>
      <button class="btn" id="errorTryDifferentBtn" onclick="showView('remote-form')">Try Different Connection</button>
      <button class="btn" id="errorSwitchRemoteBtn" onclick="showChooserRemoteTab()" style="display:none;">Switch to Remote</button>
      <button class="btn primary" id="errorSwitchLocalBtn" onclick="switchToLocal()">Switch to Local</button>
    </div>

    <div class="back-link" onclick="showChooser()">&larr; Back to chooser</div>
  </div>

  <div class="view" id="view-saved">
    <div class="section-title">Saved Connections</div>
    <div class="connections-list" id="connectionsList"></div>

    <div class="btn-row">
      <button class="btn" onclick="openAddModal()">+ Add Connection</button>
      <button class="btn" onclick="showChooser()">Back</button>
    </div>
  </div>

  <div class="view" id="view-local-boot">
    <div class="progress-track">
      <div class="progress-bar" id="localProgress"></div>
    </div>

    <div class="steps" id="localSteps">
      <div class="step" id="step-init" data-key="init">
        <div class="step-icon"><div class="pending"></div></div>
        <div><div class="step-label">Initializing</div></div>
      </div>
      <div class="step" id="step-database" data-key="database">
        <div class="step-icon"><div class="pending"></div></div>
        <div><div class="step-label">Starting database</div></div>
      </div>
      <div class="step" id="step-server" data-key="server">
        <div class="step-icon"><div class="pending"></div></div>
        <div><div class="step-label">Starting server</div></div>
      </div>
      <div class="step" id="step-ready" data-key="ready">
        <div class="step-icon"><div class="pending"></div></div>
        <div><div class="step-label">Loading interface</div></div>
      </div>
    </div>
  </div>

</div>

<div class="modal-overlay" id="editModal" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <div class="modal-title" id="modalTitle">Add Connection</div>

    <div class="form-group">
      <label for="modalName">Name</label>
      <input type="text" id="modalName" placeholder="Connection name">
    </div>
    <div class="form-group">
      <label for="modalUrl">URL</label>
      <input type="text" id="modalUrl" placeholder="https://paperclip.example.com">
      <div class="field-hint">Remote profiles are verified before use and never store raw passwords. HTTP profiles require an explicit insecure-connection acknowledgment.</div>
      <div class="field-error" id="modalError">Enter a valid remote URL.</div>
    </div>

    <div class="status-card warning-card" id="modalHttpWarningCard">
      <div class="warning-header">
        <div class="status-badge warning"><div class="dot"></div>Insecure HTTP</div>
        <span class="warning-info" tabindex="0" aria-label="More information">?<span class="warning-tooltip" id="modalHttpWarningDetail">Saving this URL means future reconnects can reuse plaintext HTTP unless you switch it back to HTTPS. Use only when you trust the network path.</span></span>
      </div>
      <div class="remember-row">
        <input type="checkbox" id="modalAllowInsecureHttp">
        <label for="modalAllowInsecureHttp">I understand the risk and want to save this HTTP connection</label>
      </div>
    </div>

    <div class="form-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveModal()">Save</button>
    </div>
  </div>
</div>

<div class="modal-overlay" id="deleteModal" onclick="if(event.target===this)cancelDelete()">
  <div class="modal">
    <div class="modal-title">Delete connection?</div>
    <div style="font-size:13px;color:#a1a1aa;margin-bottom:20px;line-height:1.5;">
      "<span id="deleteProfileName"></span>" will be removed. Session data for this connection will also be cleared. This cannot be undone.
    </div>
    <div class="form-actions" style="justify-content:flex-end;">
      <button class="btn" id="deleteCancelBtn" onclick="cancelDelete()">Cancel</button>
      <button class="btn danger" onclick="confirmDelete()">Delete</button>
    </div>
  </div>
</div>

<script>
const launcher = window.paperclipLauncher;
let selectedCard = "local";
let editingId = null;
let modalReturnView = "saved";
let lastVerification = null;
let lastErrorAction = null;
let pendingDeleteId = null;
let deleteTriggerEl = null;
let snapshot = null;
let requestContentHeightReport = () => {};

const stepElements = {
  init: document.getElementById("step-init"),
  database: document.getElementById("step-database"),
  server: document.getElementById("step-server"),
  ready: document.getElementById("step-ready"),
};
const stepOrder = ["init", "database", "server", "ready"];

function getRemoteRememberChoice() {
  return !!(
    document.getElementById("rememberRemoteForm")?.checked
    || document.getElementById("rememberRemoteChooser")?.checked
  );
}

function setRemoteRememberChoice(checked) {
  const chooser = document.getElementById("rememberRemoteChooser");
  const form = document.getElementById("rememberRemoteForm");
  if (chooser) chooser.checked = !!checked;
  if (form) form.checked = !!checked;
}

function isInsecureHttpUrl(value) {
  return String(value || "").trim().toLowerCase().startsWith("http://");
}

function getRemoteInsecureHttpChoice() {
  return !!document.getElementById("allowInsecureHttp")?.checked;
}

function setRemoteInsecureHttpChoice(checked) {
  const checkbox = document.getElementById("allowInsecureHttp");
  if (checkbox) checkbox.checked = !!checked;
}

function getModalInsecureHttpChoice() {
  return !!document.getElementById("modalAllowInsecureHttp")?.checked;
}

function setModalInsecureHttpChoice(checked) {
  const checkbox = document.getElementById("modalAllowInsecureHttp");
  if (checkbox) checkbox.checked = !!checked;
}

function setInsecureHttpUi(section, required, checked, detailText) {
  const card = document.getElementById(section === "remote" ? "httpWarningCard" : "modalHttpWarningCard");
  const detail = document.getElementById(section === "remote" ? "httpWarningDetail" : "modalHttpWarningDetail");
  const setChoice = section === "remote" ? setRemoteInsecureHttpChoice : setModalInsecureHttpChoice;

  card.classList.toggle("active", required);
  if (detail) {
    detail.textContent = detailText || (
      section === "remote"
        ? "This URL disables TLS. Only continue if you trust the network path to this remote."
        : "Saving this URL means future reconnects can reuse plaintext HTTP unless you switch it back to HTTPS."
    );
  }
  setChoice(required ? checked : false);

  if (section === "remote") {
    syncRemoteActionButtons();
  }
  requestContentHeightReport();
}

function remoteHttpVerificationRequiresAck() {
  const remoteUrl = (document.getElementById("remoteUrl")?.value || "").trim();
  return isInsecureHttpUrl(remoteUrl) && !getRemoteInsecureHttpChoice();
}

function syncRemoteActionButtons(verifying = false) {
  const verifyBtn = document.getElementById("verifyBtn");
  const signinBtn = document.getElementById("signinBtn");
  const saveBtn = document.getElementById("saveBtn");
  const placeholder = document.getElementById("verifyPlaceholder");
  if (!verifyBtn || !signinBtn || !saveBtn) {
    return;
  }

  const requiresHttpAck = remoteHttpVerificationRequiresAck();
  const canProceed = !!(
    lastVerification
    && lastVerification.ok
    && (!lastVerification.insecureTransport || getRemoteInsecureHttpChoice())
  );
  verifyBtn.disabled = verifying || requiresHttpAck;
  verifyBtn.textContent = verifying ? "Verifying..." : "Verify Remote";
  signinBtn.disabled = !canProceed;
  saveBtn.disabled = !canProceed;
  if (placeholder) {
    placeholder.style.display = (lastVerification || verifying || requiresHttpAck) ? "none" : "block";
  }
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.remove("active");
    view.style.opacity = "0";
  });

  const viewEl = document.getElementById("view-" + name);
  if (viewEl) {
    viewEl.classList.add("active");
    void viewEl.offsetWidth;
    viewEl.style.animation = "none";
    void viewEl.offsetWidth;
    viewEl.style.animation = "fadeIn 0.35s ease-out forwards";
  }

  if (name === "saved") {
    renderConnections();
  }
  if (name === "local-boot") {
    resetLocalBoot();
  }
  updateWindowClose(name);
  focusFirstInteractive(name);
  requestContentHeightReport();
}

function focusFirstInteractive(viewName) {
  requestAnimationFrame(() => {
    switch (viewName) {
      case "chooser": {
        const activeTab = selectedCard === "remote" ? "tab-btn-remote" : "tab-btn-local";
        document.getElementById(activeTab)?.focus();
        break;
      }
      case "remote-form":
        document.getElementById("remoteUrl")?.focus();
        break;
      case "saved": {
        const first = document.querySelector(".conn-item");
        if (first) { first.focus(); }
        else { document.querySelector("#view-saved .btn")?.focus(); }
        break;
      }
      case "error": {
        const firstBtn = document.querySelector("#view-error .btn-row .btn:not([style*='display:none']):not([style*='display: none'])");
        firstBtn?.focus();
        break;
      }
      default:
        break;
    }
  });
}

function switchTab(tab) {
  selectedCard = tab;
  document.getElementById("tab-btn-local").classList.toggle("active", tab === "local");
  document.getElementById("tab-btn-remote").classList.toggle("active", tab === "remote");
  document.getElementById("tab-btn-local").tabIndex = tab === "local" ? 0 : -1;
  document.getElementById("tab-btn-remote").tabIndex = tab === "remote" ? 0 : -1;
  document.getElementById("tab-local").classList.toggle("active", tab === "local");
  document.getElementById("tab-remote").classList.toggle("active", tab === "remote");
  if (tab === "remote") {
    renderTabRemoteList();
  }
  requestContentHeightReport();
}

function renderChooser() {
  const tab = snapshot && snapshot.state.chooserMode === "remote_existing" ? "remote" : "local";
  switchTab(tab);
  showView("chooser");
}

function showChooser() {
  renderChooser();
  launcher.showChooser();
}

function showChooserRemoteTab() {
  switchTab("remote");
  showView("chooser");
  launcher.setChooserMode("remote_existing");
}

function renderTabRemoteList() {
  const list = document.getElementById("tabRemoteList");
  if (!snapshot) { list.innerHTML = '<div class="tab-empty">No remote connections yet.</div>'; return; }

  const remotes = (snapshot.profiles || []).filter((p) => p.mode === "remote_existing");
  if (!remotes.length) {
    list.innerHTML = '<div class="tab-empty">No remote connections yet.</div>';
    return;
  }

  const globeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

  list.innerHTML = remotes.map((p) => {
    return '<div class="tab-conn-item" tabindex="0" onclick="quickConnect(\'' + escapeJsSingleQuote(p.id) + '\')">' +
      '<div class="tab-conn-icon">' + globeIcon + '</div>' +
      '<div class="tab-conn-info">' +
        '<div class="tab-conn-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="tab-conn-url">' + escapeHtml(p.remoteUrl || "") + '</div>' +
      '</div>' +
      '<div class="tab-conn-dot ' + statusClass(p) + '"></div>' +
      '<button class="tab-conn-edit" onclick="event.stopPropagation();openEditModal(\'' + escapeJsSingleQuote(p.id) + '\')">Edit</button>' +
    '</div>';
  }).join("");
}

async function launchLocal() {
  const rememberChoice = document.getElementById("rememberLocal").checked;
  await launcher.setChooserMode("local_embedded");
  lastErrorAction = { type: "local", rememberChoice };
  resetLocalBoot();
  showView("local-boot");
  await launcher.connectLocal({ rememberChoice });
}

function openAddRemoteFromChooser() {
  launcher.setChooserMode("remote_existing");
  setInsecureHttpUi("remote", isInsecureHttpUrl(document.getElementById("remoteUrl").value), false);
  resetVerificationUi();
  showView("remote-form");
}

function resetVerificationUi() {
  lastVerification = null;
  document.getElementById("urlError").style.display = "none";
  document.getElementById("urlSuccess").style.display = "none";
  document.getElementById("testStatus").innerHTML = "";
  document.getElementById("statusCard").classList.remove("active");
  document.getElementById("verifyInfo")?.classList.remove("visible");
  setInsecureHttpUi("remote", isInsecureHttpUrl(document.getElementById("remoteUrl").value), getRemoteInsecureHttpChoice());
  syncRemoteActionButtons();
}

function renderStatus(result) {
  const testStatus = document.getElementById("testStatus");
  const card = document.getElementById("statusCard");
  const title = document.getElementById("statusTitle");
  const detail = document.getElementById("statusDetail");
  const meta = document.getElementById("statusMeta");
  const success = document.getElementById("urlSuccess");
  const signinBtn = document.getElementById("signinBtn");
  const saveBtn = document.getElementById("saveBtn");
  const mapped = mapVerificationResult(result);

  testStatus.innerHTML = '<div class="status-badge ' + mapped.badgeClass + '"><div class="dot"></div>' + escapeHtml(mapped.badge) + "</div>";
  card.classList.add("active");
  title.textContent = mapped.title;
  detail.textContent = mapped.detail;
  meta.innerHTML = mapped.meta.map((item) => '<span class="pill">' + escapeHtml(item) + "</span>").join("");
  const tipMeta = document.getElementById("statusTipMeta");
  if (tipMeta) {
    tipMeta.innerHTML = mapped.meta.map((item) => {
      const idx = item.indexOf("=");
      const k = idx === -1 ? item : item.slice(0, idx);
      const v = idx === -1 ? "" : item.slice(idx + 1);
      return '<span class="k">' + escapeHtml(k) + '</span><span class="v">' + escapeHtml(v) + "</span>";
    }).join("");
  }
  document.getElementById("verifyInfo")?.classList.add("visible");

  success.style.display = mapped.success ? "block" : "none";
  signinBtn.textContent = mapped.actionLabel;
  saveBtn.textContent = mapped.saveLabel;
  signinBtn.disabled = !mapped.success;
  saveBtn.disabled = !mapped.success;
  setInsecureHttpUi("remote", result.insecureTransport, getRemoteInsecureHttpChoice(), result.warning);
  syncRemoteActionButtons();
}

async function verifyRemote() {
  const remoteUrl = document.getElementById("remoteUrl").value.trim();
  resetVerificationUi();

  if (!remoteUrl) {
    document.getElementById("urlError").textContent = "Enter a valid remote URL.";
    document.getElementById("urlError").style.display = "block";
    return;
  }

  if (remoteHttpVerificationRequiresAck()) {
    document.getElementById("urlError").textContent = "Confirm the insecure HTTP warning before verifying this connection.";
    document.getElementById("urlError").style.display = "block";
    return;
  }

  const verifyBtn = document.getElementById("verifyBtn");
  document.getElementById("testStatus").innerHTML = '<div class="status-badge testing"><div class="dot"></div>Verifying remote...</div>';
  syncRemoteActionButtons(true);

  try {
    const result = await launcher.verifyRemote({ remoteUrl });
    lastVerification = result;

    if (result.reason === "invalid_url") {
      document.getElementById("testStatus").innerHTML = "";
      document.getElementById("urlError").textContent = result.detail || "Enter a valid remote URL.";
      document.getElementById("urlError").style.display = "block";
      return;
    }

    setInsecureHttpUi("remote", result.insecureTransport, getRemoteInsecureHttpChoice(), result.warning);
    renderStatus(result);
  } finally {
    verifyBtn.textContent = "Verify Remote";
    syncRemoteActionButtons();
  }
}

async function continueToSignIn() {
  if (!lastVerification || !lastVerification.ok) {
    return;
  }

  const allowInsecureHttp = getRemoteInsecureHttpChoice();
  if (lastVerification.insecureTransport && !allowInsecureHttp) {
    document.getElementById("urlError").textContent = "Confirm the insecure HTTP warning before connecting.";
    document.getElementById("urlError").style.display = "block";
    return;
  }

  const rememberChoice = getRemoteRememberChoice();
  const remoteUrl = document.getElementById("remoteUrl").value.trim();
  const displayName = document.getElementById("displayName").value.trim();
  lastErrorAction = {
    type: "remote",
    saveProfile: false,
    rememberChoice,
    remoteUrl,
    displayName,
    allowInsecureHttp,
  };

  showRemoteConnectingState(lastVerification);
  await launcher.connectRemote({
    remoteUrl,
    displayName,
    saveProfile: false,
    rememberChoice,
    allowInsecureHttp,
  });
}

async function connectAndSave() {
  if (!lastVerification || !lastVerification.ok) {
    document.getElementById("urlError").style.display = "block";
    return;
  }

  const allowInsecureHttp = getRemoteInsecureHttpChoice();
  if (lastVerification.insecureTransport && !allowInsecureHttp) {
    document.getElementById("urlError").textContent = "Confirm the insecure HTTP warning before saving or connecting.";
    document.getElementById("urlError").style.display = "block";
    return;
  }

  const rememberChoice = getRemoteRememberChoice();
  const remoteUrl = document.getElementById("remoteUrl").value.trim();
  const displayName = document.getElementById("displayName").value.trim();
  lastErrorAction = {
    type: "remote",
    saveProfile: true,
    rememberChoice,
    remoteUrl,
    displayName,
    allowInsecureHttp,
  };

  showRemoteConnectingState(lastVerification);
  await launcher.connectRemote({
    remoteUrl,
    displayName,
    saveProfile: true,
    rememberChoice,
    allowInsecureHttp,
  });
}

async function retryLastAction() {
  if (!lastErrorAction) {
    return;
  }

  if (lastErrorAction.type === "local") {
    resetLocalBoot();
    showView("local-boot");
    await launcher.connectLocal({ rememberChoice: !!lastErrorAction.rememberChoice });
    return;
  }

  document.getElementById("remoteUrl").value = lastErrorAction.remoteUrl || "";
  document.getElementById("displayName").value = lastErrorAction.displayName || "";
  setInsecureHttpUi("remote", isInsecureHttpUrl(lastErrorAction.remoteUrl), !!lastErrorAction.allowInsecureHttp);
  showRemoteConnectingState(lastVerification || {
    ok: true,
    insecureTransport: isInsecureHttpUrl(lastErrorAction.remoteUrl),
    origin: "",
    paperclipDetected: true,
    deploymentMode: null,
    deploymentExposure: null,
    authReady: null,
    sessionState: "signed_out",
    bootstrapStatus: null,
    bootstrapInviteActive: null,
    normalizedUrl: lastErrorAction.remoteUrl,
    version: null,
  });
  await launcher.connectRemote({
    remoteUrl: lastErrorAction.remoteUrl,
    displayName: lastErrorAction.displayName,
    saveProfile: !!lastErrorAction.saveProfile,
    rememberChoice: !!lastErrorAction.rememberChoice,
    allowInsecureHttp: !!lastErrorAction.allowInsecureHttp,
  });
}

function configureErrorButtons() {
  const retryBtn = document.getElementById("errorRetryBtn");
  const tryDiffBtn = document.getElementById("errorTryDifferentBtn");
  const switchRemoteBtn = document.getElementById("errorSwitchRemoteBtn");
  const switchLocalBtn = document.getElementById("errorSwitchLocalBtn");

  const isLocal = lastErrorAction && lastErrorAction.type === "local";
  const hasAction = !!lastErrorAction;

  retryBtn.style.display = hasAction ? "" : "none";
  tryDiffBtn.style.display = isLocal ? "none" : "";
  switchRemoteBtn.style.display = isLocal ? "" : "none";
  switchLocalBtn.style.display = isLocal ? "none" : "";

  if (isLocal) {
    switchRemoteBtn.classList.add("primary");
  } else {
    switchRemoteBtn.classList.remove("primary");
  }
}

async function switchToLocal() {
  const rememberChoice = false;
  lastErrorAction = { type: "local", rememberChoice };
  resetLocalBoot();
  showView("local-boot");
  await launcher.connectLocal({ rememberChoice });
}

async function closeLauncherSheet() {
  await launcher.closeSheet();
}

function showRemoteConnectingState(result) {
  const loopState = result.bootstrapStatus === "bootstrap_pending"
    ? "bootstrap_pending"
    : result.sessionState === "signed_out"
      ? "signin_required"
      : null;

  document.getElementById("connectingLabel").textContent =
    loopState === "bootstrap_pending"
      ? "Opening remote setup..."
      : loopState === "signin_required"
        ? "Opening remote sign-in..."
        : "Opening verified remote...";
  document.getElementById("connectingUrl").textContent = result.normalizedUrl || document.getElementById("remoteUrl").value.trim();
  showView("connecting");
}

function updateWindowClose(viewName) {
  const button = document.getElementById("windowCloseBtn");
  const hiddenViews = new Set(["local-boot", "connecting"]);
  const visible = !!(snapshot && snapshot.isAttachedLauncher && !hiddenViews.has(viewName));
  button.classList.toggle("visible", visible);
}

function renderConnections() {
  const list = document.getElementById("connectionsList");
  const profiles = snapshot ? snapshot.profiles : [];

  if (!profiles.length) {
    list.innerHTML = '<div class="empty-state">No saved connections yet.</div>';
    return;
  }

  list.innerHTML = profiles.map((profile) => {
    const icon = profile.mode === "local_embedded"
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
    const lastConnected = profile.lastConnectedAt
      ? '<span class="pill">Last connected: ' + escapeHtml(relativeTime(profile.lastConnectedAt)) + "</span>"
      : "";
    const actions = profile.mode === "remote_existing"
      ? "<div class=\"conn-actions\" onclick=\"event.stopPropagation()\">" +
          "<button title=\"Edit\" onclick=\"openEditModal('" + escapeJsSingleQuote(profile.id) + "')\">&#9998;</button>" +
          "<button title=\"Duplicate\" onclick=\"duplicateConn('" + escapeJsSingleQuote(profile.id) + "')\">&#10697;</button>" +
          "<button class=\"delete-btn\" title=\"Delete\" onclick=\"deleteConn('" + escapeJsSingleQuote(profile.id) + "')\">&#10005;</button>" +
        "</div>"
      : "";

    return "<div class=\"conn-item " + (snapshot.activeProfileId === profile.id ? "active-conn" : "") + "\" tabindex=\"0\" onclick=\"quickConnect('" + escapeJsSingleQuote(profile.id) + "')\">" +
      '<div class="conn-icon">' + icon + "</div>" +
      '<div class="conn-info">' +
        '<div class="conn-name">' + escapeHtml(profile.name) + "</div>" +
        '<div class="conn-url">' + escapeHtml(profile.remoteUrl || "Embedded local server") + "</div>" +
        '<div class="conn-meta"><span class="pill">' + escapeHtml(capabilityLabel(profile)) + "</span>" + lastConnected + "</div>" +
      "</div>" +
      '<div class="conn-status-dot ' + statusClass(profile) + '"></div>' +
      actions +
    "</div>";
  }).join("");
}

function openAddModal() {
  modalReturnView = "saved";
  editingId = null;
  document.getElementById("modalTitle").textContent = "Add Connection";
  document.getElementById("modalName").value = "";
  document.getElementById("modalUrl").value = "";
  document.getElementById("modalError").style.display = "none";
  setInsecureHttpUi("modal", false, false);
  document.getElementById("editModal").classList.add("active");
}

function openEditModal(profileId) {
  const profile = snapshot.profiles.find((candidate) => candidate.id === profileId);
  if (!profile || profile.mode !== "remote_existing") {
    return;
  }

  const activeView = (document.querySelector(".view.active") || {}).id?.replace("view-", "");
  modalReturnView = activeView === "chooser" && selectedCard === "remote" ? "chooser-remote" : "saved";
  editingId = profileId;
  document.getElementById("modalTitle").textContent = "Edit Connection";
  document.getElementById("modalName").value = profile.name;
  document.getElementById("modalUrl").value = profile.remoteUrl || "";
  document.getElementById("modalError").style.display = "none";
  setInsecureHttpUi("modal", isInsecureHttpUrl(profile.remoteUrl), !!profile.allowInsecureHttp);
  document.getElementById("editModal").classList.add("active");
}

function closeModal() {
  editingId = null;
  setInsecureHttpUi("modal", false, false);
  document.getElementById("editModal").classList.remove("active");
}

function restoreModalReturnView() {
  if (modalReturnView === "chooser-remote") {
    showChooserRemoteTab();
    return;
  }

  showView("saved");
}

async function saveModal() {
  const name = document.getElementById("modalName").value.trim();
  const remoteUrl = document.getElementById("modalUrl").value.trim();

  try {
    const nextSnapshot = await launcher.saveRemoteProfile({
      profileId: editingId || undefined,
      name,
      remoteUrl,
      allowInsecureHttp: getModalInsecureHttpChoice(),
    });
    applySnapshot(nextSnapshot);
    closeModal();
    restoreModalReturnView();
  } catch (error) {
    document.getElementById("modalError").textContent = error && error.message ? error.message : "Enter a valid remote URL.";
    document.getElementById("modalError").style.display = "block";
  }
}

async function duplicateConn(profileId) {
  const nextSnapshot = await launcher.duplicateProfile(profileId);
  applySnapshot(nextSnapshot);
  showView("saved");
}

function deleteConn(profileId) {
  const profile = snapshot.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    return;
  }

  pendingDeleteId = profileId;
  deleteTriggerEl = document.activeElement;
  document.getElementById("deleteProfileName").textContent = profile.name;
  document.getElementById("deleteModal").classList.add("active");
  document.getElementById("deleteCancelBtn").focus();
}

async function confirmDelete() {
  if (!pendingDeleteId) {
    return;
  }

  const nextSnapshot = await launcher.deleteProfile(pendingDeleteId);
  pendingDeleteId = null;
  document.getElementById("deleteModal").classList.remove("active");
  applySnapshot(nextSnapshot);
  showView("saved");
}

function cancelDelete() {
  pendingDeleteId = null;
  document.getElementById("deleteModal").classList.remove("active");
  if (deleteTriggerEl && typeof deleteTriggerEl.focus === "function") {
    deleteTriggerEl.focus();
  }
  deleteTriggerEl = null;
}

async function quickConnect(profileId) {
  const profile = snapshot.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    return;
  }

  if (profile.mode === "local_embedded") {
    lastErrorAction = { type: "local", rememberChoice: false };
    resetLocalBoot();
    showView("local-boot");
    await launcher.connectSavedProfile({ profileId, rememberChoice: false });
    return;
  }

  const rememberChoice = getRemoteRememberChoice();
  document.getElementById("remoteUrl").value = profile.remoteUrl || "";
  document.getElementById("displayName").value = profile.name;
  setInsecureHttpUi("remote", isInsecureHttpUrl(profile.remoteUrl), !!profile.allowInsecureHttp);
  lastErrorAction = {
    type: "remote",
    saveProfile: false,
    rememberChoice,
    remoteUrl: profile.remoteUrl,
    displayName: profile.name,
    allowInsecureHttp: !!profile.allowInsecureHttp,
  };
  document.getElementById("connectingLabel").textContent = "Opening verified remote...";
  document.getElementById("connectingUrl").textContent = profile.remoteUrl || "";
  showView("connecting");
  await launcher.connectSavedProfile({ profileId, rememberChoice });
}

function resetLocalBoot() {
  document.getElementById("localProgress").style.width = "0%";
  Object.values(stepElements).forEach((step) => {
    step.classList.remove("active", "done");
    step.querySelector(".step-icon").innerHTML = '<div class="pending"></div>';
    const detail = step.querySelector(".step-detail");
    if (detail) {
      detail.remove();
    }
  });
}

function applyBootStatus(payload) {
  showView("local-boot");
  document.getElementById("localProgress").style.width = Math.min(100, Math.max(0, payload.progress || 0)) + "%";
  const currentIndex = stepOrder.indexOf(payload.step);

  stepOrder.forEach((key, index) => {
    const step = stepElements[key];
    const iconContainer = step.querySelector(".step-icon");
    step.classList.remove("active", "done");

    if (index < currentIndex) {
      step.classList.add("done");
      iconContainer.innerHTML = '<span class="check">&#10003;</span>';
      ensureStepDetail(step, "");
      return;
    }

    if (index === currentIndex) {
      step.classList.add("active");
      iconContainer.innerHTML = '<div class="spinner"></div>';
      ensureStepDetail(step, payload.detail || "");
      return;
    }

    iconContainer.innerHTML = '<div class="pending"></div>';
    const detail = step.querySelector(".step-detail");
    if (detail) {
      detail.remove();
    }
  });
}

function ensureStepDetail(step, detailText) {
  if (!detailText) {
    return;
  }

  let detail = step.querySelector(".step-detail");
  if (!detail) {
    detail = document.createElement("div");
    detail.className = "step-detail";
    step.querySelector(".step-label").parentElement.appendChild(detail);
  }
  detail.textContent = detailText;
}

function capabilityLabel(profile) {
  if (profile.mode === "local_embedded") {
    return "Local embedded";
  }

  const suffix = profile.allowInsecureHttp ? " / insecure HTTP" : "";
  switch (profile.lastHealth) {
    case "healthy":
      return "Authenticated / session active" + suffix;
    case "auth_required":
      return "Authenticated / sign-in required" + suffix;
    case "unsupported":
      return "Blocked: unsupported remote" + suffix;
    case "unreachable":
      return "Host unreachable" + suffix;
    default:
      return "Pending verification" + suffix;
  }
}

function statusClass(profile) {
  switch (profile.lastHealth) {
    case "healthy":
      return "healthy";
    case "auth_required":
      return "auth-required";
    case "unsupported":
      return "unsupported";
    case "unreachable":
      return "unreachable";
    default:
      return "unknown";
  }
}

function mapVerificationResult(result) {
  if (result.ok && result.bootstrapStatus === "bootstrap_pending") {
    return {
      success: true,
      badgeClass: "warning",
      badge: "Verified remote - setup required",
      title: "Instance setup required",
      detail: mergeDetail(
        "The host is a verified authenticated Paperclip remote, but no instance admin exists yet. Connect Remote to continue through Paperclip's setup flow in-app.",
        result.warning,
      ),
      meta: buildResultMeta(result),
      actionLabel: "Connect Remote",
      saveLabel: "Save Connection",
    };
  }

  if (result.ok && result.sessionState === "signed_in") {
    return {
      success: true,
      badgeClass: "healthy",
      badge: "Authenticated Paperclip detected",
      title: "Verified remote ready",
      detail: mergeDetail(
        "The host looks like a Paperclip instance in authenticated mode, and an active session was found.",
        result.warning,
      ),
      meta: buildResultMeta(result),
      actionLabel: "Connect Remote",
      saveLabel: "Connect & Save",
    };
  }

  if (result.ok && result.sessionState === "signed_out") {
    return {
      success: true,
      badgeClass: "warning",
      badge: "Verified remote - sign-in required",
      title: "Verified remote, no active session",
      detail: mergeDetail(
        "The host looks like an authenticated Paperclip instance. Connect Remote to continue through Paperclip's sign-in flow in-app.",
        result.warning,
      ),
      meta: buildResultMeta(result),
      actionLabel: "Connect Remote",
      saveLabel: "Save Connection",
    };
  }

  const detail = mergeDetail(result.detail || "Could not verify remote.", result.warning);
  if (result.reason === "unsupported_local_trusted") {
    return {
      success: false,
      badgeClass: "unreachable",
      badge: "Unsupported remote deployment",
      title: "Paperclip detected but not eligible",
      detail,
      meta: buildResultMeta(result),
      actionLabel: "Continue to Sign-In",
      saveLabel: "Connect & Save",
    };
  }

  if (result.reason === "not_paperclip") {
    return {
      success: false,
      badgeClass: "unreachable",
      badge: "Host reachable, not Paperclip",
      title: "Non-Paperclip endpoint",
      detail,
      meta: buildResultMeta(result),
      actionLabel: "Continue to Sign-In",
      saveLabel: "Connect & Save",
    };
  }

  if (result.reason === "tls_error") {
    return {
      success: false,
      badgeClass: "unreachable",
      badge: "TLS validation failed",
      title: "Remote certificate rejected",
      detail,
      meta: buildResultMeta(result),
      actionLabel: "Continue to Sign-In",
      saveLabel: "Connect & Save",
    };
  }

  return {
    success: false,
    badgeClass: "unreachable",
    badge: "Host unreachable",
    title: "Could not verify remote",
    detail,
    meta: buildResultMeta(result),
    actionLabel: "Continue to Sign-In",
    saveLabel: "Connect & Save",
  };
}

function buildResultMeta(result) {
  const meta = [];
  if (result.deploymentMode) meta.push("deploymentMode=" + result.deploymentMode);
  if (result.deploymentExposure) meta.push("deploymentExposure=" + result.deploymentExposure);
  if (result.authReady !== null && result.authReady !== undefined) meta.push("authReady=" + result.authReady);
  if (result.bootstrapStatus) meta.push("bootstrapStatus=" + result.bootstrapStatus);
  if (result.bootstrapInviteActive !== null && result.bootstrapInviteActive !== undefined) meta.push("bootstrapInviteActive=" + result.bootstrapInviteActive);
  if (result.sessionState) meta.push("session=" + result.sessionState);
  if (result.version) meta.push("version=" + result.version);
  return meta;
}

function mergeDetail(detail, warning) {
  return warning ? detail + " " + warning : detail;
}

function relativeTime(timestamp) {
  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) {
    return timestamp;
  }

  const diff = Date.now() - value;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return Math.round(diff / 60_000) + " min ago";
  if (diff < 86_400_000) return Math.round(diff / 3_600_000) + " hr ago";
  return Math.round(diff / 86_400_000) + " day(s) ago";
}

function applySnapshot(nextSnapshot) {
  snapshot = nextSnapshot;
  const activeView = (document.querySelector(".view.active") || {}).id?.replace("view-", "");
  if (activeView === "chooser" || !activeView) {
    switchTab(nextSnapshot.state.chooserMode === "remote_existing" ? "remote" : "local");
  }
  setRemoteRememberChoice(
    !nextSnapshot.state.alwaysShowChooser
    && nextSnapshot.state.autoConnectLastProfile
    && nextSnapshot.state.activeProfileId
    && nextSnapshot.state.activeProfileId !== "local_embedded",
  );
  document.getElementById("rememberLocal").checked =
    !nextSnapshot.state.alwaysShowChooser && nextSnapshot.state.autoConnectLastProfile
    && nextSnapshot.state.chooserMode !== "remote_existing";
  renderConnections();
  renderTabRemoteList();
  updateWindowClose(activeView || nextSnapshot.initialView || "chooser");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function escapeJsSingleQuote(value) {
  return escapeAttr(
    String(value)
      .replaceAll("\\", "\\\\")
      .replaceAll("'", "\\'")
      .replaceAll("\n", "\\n")
      .replaceAll("\r", "\\r")
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029"),
  );
}

function measureLauncherHeight(windowEl) {
  const styles = window.getComputedStyle(document.body);
  const verticalPadding = Number.parseFloat(styles.paddingTop || "0")
    + Number.parseFloat(styles.paddingBottom || "0");
  // Extra pixels compensate for macOS sheet frame chrome / rounded-corner insets
  return windowEl.getBoundingClientRect().height + verticalPadding + 8;
}

function installContentResizeReporting() {
  const windowEl = document.querySelector(".window");
  if (!windowEl || !launcher.reportContentHeight) {
    return;
  }

  let lastReportedHeight = 0;
  const report = () => {
    const height = Math.ceil(measureLauncherHeight(windowEl));
    if (Math.abs(height - lastReportedHeight) < 2) {
      return;
    }

    lastReportedHeight = height;
    launcher.reportContentHeight(height);
  };

  let settleFrameId = 0;
  let settleTimeoutIds = [];
  const scheduleReport = () => {
    report();

    if (settleFrameId) {
      cancelAnimationFrame(settleFrameId);
    }
    settleTimeoutIds.forEach((timeoutId) => clearTimeout(timeoutId));
    settleTimeoutIds = [];

    settleFrameId = requestAnimationFrame(() => {
      settleFrameId = requestAnimationFrame(() => {
        settleFrameId = 0;
        report();
      });
    });
    settleTimeoutIds = [
      window.setTimeout(report, 80),
      window.setTimeout(report, 220),
    ];
  };

  requestContentHeightReport = scheduleReport;
  new ResizeObserver(report).observe(windowEl);
  scheduleReport();
  window.addEventListener("load", scheduleReport, { once: true });
}

window.paperclipLauncher.onStateChanged((nextSnapshot) => {
  applySnapshot(nextSnapshot);
});

window.paperclipLauncher.onRequestContentHeightSync(() => {
  requestContentHeightReport();
});

window.paperclipLauncher.onNavigate((payload) => {
  if (payload.view === "saved") {
    showView("saved");
    return;
  }

  if (payload.view === "chooser") {
    renderChooser();
    return;
  }

  if (payload.view === "remote-form") {
    if (payload.profile) {
      document.getElementById("remoteUrl").value = payload.profile.remoteUrl || "";
      document.getElementById("displayName").value = payload.profile.name || "";
      setInsecureHttpUi("remote", isInsecureHttpUrl(payload.profile.remoteUrl), !!payload.profile.allowInsecureHttp);
    }
    resetVerificationUi();
    showView("remote-form");
    return;
  }

  if (payload.view === "connecting") {
    document.getElementById("connectingLabel").textContent = payload.label || "Opening verified remote...";
    document.getElementById("connectingUrl").textContent = payload.url || "";
    showView("connecting");
    return;
  }

  if (payload.view === "local-boot") {
    resetLocalBoot();
    showView("local-boot");
  }
});

window.paperclipLauncher.onBootStatus((payload) => {
  applyBootStatus(payload);
});

window.paperclipLauncher.onConnectionError((payload) => {
  document.getElementById("errorTitle").textContent = payload.title;
  document.getElementById("errorDetail").textContent = payload.detail;
  configureErrorButtons();
  showView("error");
});

// ---------------------------------------------------------------------------
// Keyboard handling
// ---------------------------------------------------------------------------

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const deleteModal = document.getElementById("deleteModal");
    if (deleteModal.classList.contains("active")) {
      cancelDelete();
      return;
    }

    const editModal = document.getElementById("editModal");
    if (editModal.classList.contains("active")) {
      closeModal();
      return;
    }

    if (snapshot && snapshot.isAttachedLauncher) {
      const activeView = (document.querySelector(".view.active") || {}).id?.replace("view-", "");
      if (activeView !== "local-boot" && activeView !== "connecting") {
        closeLauncherSheet();
      }
    }
    return;
  }

  const activeView = (document.querySelector(".view.active") || {}).id?.replace("view-", "");

  if (activeView === "chooser") {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const next = selectedCard === "local" ? "remote" : "local";
      switchTab(next);
      document.getElementById("tab-btn-" + next).focus();
    } else if (event.key === "Enter" && document.activeElement?.classList.contains("tab-conn-item")) {
      event.preventDefault();
      document.activeElement.click();
    } else if (event.key === "ArrowDown" && selectedCard === "remote") {
      event.preventDefault();
      const items = Array.from(document.querySelectorAll(".tab-conn-item"));
      const idx = items.indexOf(document.activeElement);
      if (items.length) items[Math.min(idx + 1, items.length - 1)].focus();
    } else if (event.key === "ArrowUp" && selectedCard === "remote") {
      event.preventDefault();
      const items = Array.from(document.querySelectorAll(".tab-conn-item"));
      const idx = items.indexOf(document.activeElement);
      if (items.length) items[Math.max(idx - 1, 0)].focus();
    }
    return;
  }

  if (activeView === "saved") {
    const items = Array.from(document.querySelectorAll(".conn-item"));
    const focusedIndex = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown" && items.length) {
      event.preventDefault();
      items[Math.min(focusedIndex + 1, items.length - 1)].focus();
    } else if (event.key === "ArrowUp" && items.length) {
      event.preventDefault();
      items[Math.max(focusedIndex - 1, 0)].focus();
    } else if (event.key === "Enter" && focusedIndex >= 0) {
      event.preventDefault();
      items[focusedIndex].click();
    }
    return;
  }

  if (activeView === "remote-form") {
    if (event.key === "Enter" && document.activeElement?.id === "remoteUrl") {
      event.preventDefault();
      verifyRemote();
    }
    return;
  }
});

// ---------------------------------------------------------------------------
// Modal focus trap
// ---------------------------------------------------------------------------

function trapFocusInModal(modalEl, event) {
  const focusable = modalEl.querySelectorAll("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])");
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;

  const deleteModal = document.getElementById("deleteModal");
  if (deleteModal.classList.contains("active")) {
    trapFocusInModal(deleteModal, event);
    return;
  }

  const editModal = document.getElementById("editModal");
  if (editModal.classList.contains("active")) {
    trapFocusInModal(editModal, event);
    return;
  }
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("remoteUrl")?.addEventListener("input", (event) => {
    const remoteUrl = event.target.value;
    setInsecureHttpUi("remote", isInsecureHttpUrl(remoteUrl), getRemoteInsecureHttpChoice());
    resetVerificationUi();
  });
  document.getElementById("allowInsecureHttp")?.addEventListener("change", () => {
    document.getElementById("urlError").style.display = "none";
    syncRemoteActionButtons();
  });
  document.getElementById("modalUrl")?.addEventListener("input", (event) => {
    setInsecureHttpUi("modal", isInsecureHttpUrl(event.target.value), getModalInsecureHttpChoice());
    document.getElementById("modalError").style.display = "none";
  });
  document.getElementById("modalAllowInsecureHttp")?.addEventListener("change", () => {
    document.getElementById("modalError").style.display = "none";
  });

  const initialSnapshot = await launcher.bootstrap();
  applySnapshot(initialSnapshot);
  showView(initialSnapshot.initialView || "chooser");
  installContentResizeReporting();
});
</script>
</body>
</html>`;
}
