// Speexx Helper - Content Script
// ช่วยทำแบบฝึกหัด Speexx ด้วยวิธี Correction → จำคำตอบ → Repeat → ลากใส่ช่อง
//
// แผนที่สำหรับแก้ไขโค้ด:
// - ปุ่ม/แผงลอยและรีเซ็ตสถิติ: createLogPanel()
// - ตัวเลือกหน้า Speexx และการหาโจทย์: findExercise(), getExerciseType()
// - ขั้นตอนทำโจทย์หลัก: solveCurrentExercise()
// - ทำต่อข้ามหน้า “เรียนรู้ต่อ”: clickContinueLearningIfPresent()
// - โหมดต่อเนื่องและเวลาทบทวน: startSolving(), reviewCurrentExercise()
// - โหมดจับเวลา: startTimedAll(), waitWithCountdown()
// - การลากคำตอบ: applyDragDropAnswers(), simulateDragDrop()

(function () {
  'use strict';

  if (window.__speexxHelperLoaded) return;
  window.__speexxHelperLoaded = true;

  console.log('🎓 Speexx Helper loaded!');

  // ============================================================
  // CONFIG & STATE
  // ============================================================
  let delayBetween = 2;
  let isRunning = false;
  let isStopping = false;
  let shouldStop = false;
  let exerciseCount = 0;
  let runStartCount = 0;
  let currentPage = 1;
  let courseTransitionCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let logPanel = null;
  let logContainer = null;
  let reopenButton = null;
  let floatingTimer = null;
  // สรุปเซสชัน: เก็บใน storage เพื่อให้โหมดต่อเนื่องที่โหลดหน้าใหม่ไม่สูญสถิติ
  let sessionStats = { startedAt: 0, endedAt: 0, completedCount: 0, reviewCount: 0, reviewMs: 0 };
  let sessionSummaryTimer = null;
  // รายการ Debug ล่าสุดสำหรับปุ่ม “ส่งออก Debug” (เก็บสูงสุด 150 เหตุการณ์)
  const debugEntries = [];
  // ผลตรวจหน้าล่าสุด: เก็บไว้รวมใน Debug report เพื่อวิเคราะห์โดยไม่ต้องขอ HTML เพิ่ม
  let latestPageDiagnostics = null;
  // ป้องกันการเพิ่ม log “ไม่รองรับ” ซ้ำระหว่างหน้า Speexx กำลัง re-render
  let unsupportedNoticeSignature = '';
  // Snapshot ก่อนเริ่มใส่คำตอบ: ใช้เทียบกับ DOM หลังเกิดปัญหาโดยไม่ต้องขอ HTML เพิ่ม
  let preApplyExerciseSnapshot = null;
  const pendingSleepCancellers = new Set();

  class StopRequestedError extends Error {
    constructor() {
      super('หยุดการทำงานตามคำขอของผู้ใช้');
      this.name = 'StopRequestedError';
    }
  }

  function throwIfStopRequested() {
    if (shouldStop) throw new StopRequestedError();
  }

  // ============================================================
  // LOG PANEL (Floating UI)
  // ============================================================
  function createLogPanel() {
    if (logPanel) return;

    logPanel = document.createElement('div');
    logPanel.id = 'speexx-helper-panel';
    const brandIconUrl = chrome.runtime.getURL('icons/graduation-cap.png');
    logPanel.innerHTML = `
      <div id="speexx-helper-main">
        <div id="speexx-helper-header">
          <div class="sh-heading"><span class="sh-title"><img class="sh-brand-icon" src="${brandIconUrl}" alt="" aria-hidden="true">Speexx Helper</span><span id="speexx-helper-status" class="sh-status">พร้อมใช้งาน</span><span id="speexx-helper-compact-status" class="sh-compact-status">พร้อมเริ่ม</span><span id="speexx-helper-timer" class="sh-timer" hidden></span></div>
          <div class="sh-controls">
            <button id="speexx-helper-toggle-debug" type="button" title="ซ่อน Debug" aria-pressed="false">⌘</button>
            <button id="speexx-helper-minimize" type="button" title="ย่อ/ขยาย">−</button>
            <button id="speexx-helper-close" type="button" title="ปิด">✕</button>
          </div>
        </div>
        <div id="speexx-helper-content">
          <div class="sh-status-card">
            <div class="sh-status-card-top"><span class="sh-status-label">สถานะล่าสุด</span><span id="speexx-helper-progress">รอเริ่มงาน</span></div>
            <div id="speexx-helper-current" class="sh-current">เลือกโหมดการทำงานด้านล่างเพื่อเริ่ม</div>
          </div>
          <!-- สรุปเซสชัน: อัปเดตจาก updateSessionSummary() ด้านล่าง -->
          <div id="speexx-helper-session" class="sh-session-summary" aria-live="polite">
            <span class="sh-session-title">สรุปเซสชัน</span><span id="sh-session-completed">✅ 0 ข้อ</span><span id="sh-session-time">⏱ 0 นาที</span><span id="sh-session-reviews">📖 0 ครั้ง</span><button id="speexx-helper-reset-session" class="sh-session-reset" type="button" title="รีเซ็ตสถิติเซสชัน">↺</button>
          </div>
          <!-- Debug Toolkit: ตรวจสภาพหน้า, คัดลอกรายงาน และล้างบันทึกได้จากจุดเดียว -->
          <div class="sh-debug-heading"><span>Debug Toolkit</span><div class="sh-debug-actions"><button id="speexx-helper-diagnose-page" type="button" title="ตรวจโครงสร้างข้อปัจจุบัน">⌕ ตรวจ</button><button id="speexx-helper-copy-html" type="button" title="คัดลอก HTML หน้าปัจจุบันแบบปกปิดช่องกรอก">&lt;/&gt; HTML</button><button id="speexx-helper-export-debug" type="button" title="คัดลอกรายงาน Debug">⧉ คัดลอก</button><button id="speexx-helper-clear-debug" type="button" title="ล้างบันทึก Debug">↺ ล้าง</button></div></div>
          <div id="speexx-helper-diagnostic-summary" class="sh-diagnostic-summary">กด “ตรวจ” เพื่อสรุปโครงสร้างข้อปัจจุบัน</div>
          <!-- แจ้งโจทย์ที่ไม่รองรับ: ให้ส่งข้อมูลที่จำเป็นได้จากการ์ดเดียวทันที -->
          <div id="speexx-helper-unsupported" class="sh-unsupported" hidden>
            <strong>⚠️ ยังไม่รองรับโจทย์นี้</strong>
            <span id="speexx-helper-unsupported-detail">ตรวจพบชนิด: unknown</span>
            <div><button id="speexx-helper-unsupported-debug" type="button">⧉ คัดลอก Debug</button><button id="speexx-helper-unsupported-html" type="button">&lt;/&gt; คัดลอก HTML</button></div>
          </div>
          <!-- แจ้งอัปเดต: แสดงเฉพาะเมื่อ GitHub มี Release ใหม่กว่าเวอร์ชันที่ติดตั้ง -->
          <div id="speexx-helper-update" class="sh-update" hidden><span id="speexx-helper-update-text">มีเวอร์ชันใหม่</span><button id="speexx-helper-update-open" type="button">ดูอัปเดต</button></div>
          <div id="speexx-helper-log">
            <div class="sh-empty">กดปุ่มด้านล่างเพื่อเริ่มทำแบบฝึกหัด</div>
          </div>
          <div id="speexx-helper-buttons">
            <button id="speexx-helper-solve-all" type="button">✨ ทำทั้งหมด</button>
            <button id="speexx-helper-solve-one" type="button">⚡ ทำข้อนี้</button>
            <button id="speexx-helper-repeat" type="button">⏱ ทำทั้งหมดแบบจับเวลา</button>
            <button id="speexx-helper-continuous" type="button">🔁 ทำอัตโนมัติต่อเนื่อง</button>
            <button id="speexx-helper-stop" type="button" style="display: none;">⏹ หยุด</button>
          </div>
          <div id="speexx-helper-stop-confirm" class="sh-confirm" hidden>
            <div class="sh-confirm-card" role="dialog" aria-modal="true" aria-labelledby="sh-confirm-title">
              <strong id="sh-confirm-title">หยุดการทำงานตอนนี้?</strong>
              <p>ระบบจะหยุดทันทีและเก็บสถานะปัจจุบันไว้</p>
              <div class="sh-confirm-actions">
                <button id="speexx-helper-keep-running" type="button">ทำต่อ</button>
                <button id="speexx-helper-confirm-stop" type="button">หยุดเลย</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(logPanel);
    logContainer = document.getElementById('speexx-helper-log');
    const statusBadge = document.getElementById('speexx-helper-status');

    reopenButton = document.createElement('button');
    reopenButton.id = 'speexx-helper-reopen';
    reopenButton.type = 'button';
    reopenButton.title = 'เปิด Speexx Helper';
    reopenButton.innerHTML = `<img src="${brandIconUrl}" alt="เปิด Speexx Helper">`;
    reopenButton.addEventListener('click', () => {
      logPanel.style.display = '';
      reopenButton.style.display = 'none';
    });
    document.body.appendChild(reopenButton);

    floatingTimer = document.createElement('div');
    floatingTimer.id = 'speexx-helper-floating-timer';
    floatingTimer.setAttribute('role', 'status');
    floatingTimer.setAttribute('aria-live', 'polite');
    floatingTimer.hidden = true;
    document.body.appendChild(floatingTimer);

    const mainPanel = document.getElementById('speexx-helper-main');
    // ตั้งค่าหน้าตาแผงลอยจาก Popup ทุกครั้งที่สร้าง และฟังการเปลี่ยนค่าเพื่ออัปเดตโดยไม่ต้องรีเฟรชหน้า
    const applyPanelAppearance = ({ uiAccent = 'violet', panelSize = 'normal' }) => {
      mainPanel.dataset.uiAccent = ['violet', 'blue', 'green', 'rose'].includes(uiAccent) ? uiAccent : 'violet';
      mainPanel.dataset.panelSize = ['compact', 'normal', 'large'].includes(panelSize) ? panelSize : 'normal';
    };
    chrome.storage.sync.get(['uiAccent', 'panelSize'], applyPanelAppearance);
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || (!changes.uiAccent && !changes.panelSize)) return;
      applyPanelAppearance({
        uiAccent: changes.uiAccent?.newValue ?? mainPanel.dataset.uiAccent,
        panelSize: changes.panelSize?.newValue ?? mainPanel.dataset.panelSize
      });
    });
    const debugToggleBtn = document.getElementById('speexx-helper-toggle-debug');
    const setDebugVisibility = (hidden) => {
      mainPanel.classList.toggle('sh-debug-hidden', hidden);
      debugToggleBtn.setAttribute('aria-pressed', String(hidden));
      debugToggleBtn.title = hidden ? 'แสดง Debug' : 'ซ่อน Debug';
      debugToggleBtn.textContent = hidden ? '☷' : '⌘';
      chrome.storage.local.set({ speexxDebugHidden: hidden });
    };
    chrome.storage.local.get(['speexxDebugHidden'], ({ speexxDebugHidden = true }) => {
      setDebugVisibility(Boolean(speexxDebugHidden));
    });
    debugToggleBtn.addEventListener('click', () => {
      setDebugVisibility(!mainPanel.classList.contains('sh-debug-hidden'));
    });

    // ปุ่มส่งออก Debug: คัดลอกรายงานเพื่อส่งให้ผู้พัฒนา โดยไม่ดาวน์โหลดไฟล์
    document.getElementById('speexx-helper-export-debug').addEventListener('click', exportDebugReport);
    // เครื่องมือ Debug: ตรวจหน้าและล้างเฉพาะบันทึกในหน่วยความจำ ไม่กระทบคำตอบหรือการตั้งค่า
    document.getElementById('speexx-helper-diagnose-page').addEventListener('click', diagnoseCurrentPage);
    document.getElementById('speexx-helper-copy-html').addEventListener('click', copySanitizedPageHtml);
    document.getElementById('speexx-helper-clear-debug').addEventListener('click', clearDebugLog);
    document.getElementById('speexx-helper-unsupported-debug').addEventListener('click', exportDebugReport);
    document.getElementById('speexx-helper-unsupported-html').addEventListener('click', copySanitizedPageHtml);
    document.getElementById('speexx-helper-update-open').addEventListener('click', () => {
      const url = document.getElementById('speexx-helper-update').dataset.releaseUrl;
      if (url) chrome.runtime.sendMessage({ action: 'openRelease', url });
    });
    // ปุ่มรีเซ็ตสถิติ: ใช้ได้เฉพาะตอนระบบหยุด เพื่อไม่ให้ข้อมูลของงานที่กำลังทำหายโดยไม่ตั้งใจ
    document.getElementById('speexx-helper-reset-session').addEventListener('click', resetSessionStats);

    document.getElementById('speexx-helper-close').addEventListener('click', () => {
      logPanel.style.display = 'none';
      reopenButton.style.display = 'flex';
    });

    // Minimize/Maximize (toggle class on main panel; CSS handles the rest)
    const minimizeBtn = document.getElementById('speexx-helper-minimize');
    minimizeBtn.addEventListener('click', () => {
      const isMinimized = mainPanel.classList.toggle('sh-minimized');
      minimizeBtn.textContent = isMinimized ? '+' : '−';
      chrome.storage.local.set({ speexxMinimized: isMinimized });
    });

    // ปรับข้อความหรือเพิ่มปุ่มควบคุมใหม่ในส่วน HTML ด้านบนและ listener ตรงนี้
    document.getElementById('speexx-helper-solve-all').addEventListener('click', () => startSolving(true));
    document.getElementById('speexx-helper-solve-one').addEventListener('click', () => startSolving(false));
    document.getElementById('speexx-helper-repeat').addEventListener('click', () => startTimedAll());
    document.getElementById('speexx-helper-continuous').addEventListener('click', () => startSolving(true, true));
    const stopConfirm = document.getElementById('speexx-helper-stop-confirm');
    document.getElementById('speexx-helper-stop').addEventListener('click', () => { stopConfirm.hidden = false; });
    document.getElementById('speexx-helper-keep-running').addEventListener('click', () => { stopConfirm.hidden = true; });
    document.getElementById('speexx-helper-confirm-stop').addEventListener('click', () => {
      stopConfirm.hidden = true;
      stopSolving();
    });

    chrome.storage.local.get(['speexxPanelPosition', 'speexxMinimized'], ({ speexxPanelPosition, speexxMinimized }) => {
      if (speexxPanelPosition) {
        mainPanel.style.top = `${Math.max(8, Math.min(window.innerHeight - 80, speexxPanelPosition.top))}px`;
        mainPanel.style.left = `${Math.max(8, Math.min(window.innerWidth - 80, speexxPanelPosition.left))}px`;
        mainPanel.style.right = 'auto';
      }
      if (speexxMinimized) {
        mainPanel.classList.add('sh-minimized');
        minimizeBtn.textContent = '+';
      }
    });

    makeDraggable(document.getElementById('speexx-helper-header'));
    updateSessionSummary();
    checkForUpdate();
    // Speexx อาจสร้างโจทย์ช้าหลังหน้าโหลด จึงตรวจซ้ำอีกครั้งเพื่อให้การ์ดแจ้งเตือนปรากฏทันเวลา
    setTimeout(refreshUnsupportedExerciseNotice, 700);
    setTimeout(refreshUnsupportedExerciseNotice, 2200);
  }

  // ============================================================
  // SESSION SUMMARY
  // แก้รูปแบบ/ข้อมูลที่สรุปในแผงลอยได้ในฟังก์ชันชุดนี้
  // ============================================================
  function sessionElapsedMinutes() {
    const endTime = sessionStats.endedAt || Date.now();
    return sessionStats.startedAt ? Math.max(0, Math.floor((endTime - sessionStats.startedAt) / 60000)) : 0;
  }

  function updateSessionSummary() {
    const completed = document.getElementById('sh-session-completed');
    const elapsed = document.getElementById('sh-session-time');
    const reviews = document.getElementById('sh-session-reviews');
    if (!completed || !elapsed || !reviews) return;
    completed.textContent = `✅ ${sessionStats.completedCount} ข้อ`;
    elapsed.textContent = `⏱ ${sessionElapsedMinutes()} นาที`;
    reviews.textContent = `📖 ${sessionStats.reviewCount} ครั้ง`;
    updateCompactStatus();
  }

  // สถานะย่อ: แสดงเฉพาะตอนย่อแผง เพื่อเห็นข้อปัจจุบันและเวลารวมโดยไม่ต้องขยายกลับ
  function updateCompactStatus() {
    const compact = document.getElementById('speexx-helper-compact-status');
    if (!compact) return;
    const pageText = isRunning ? `ข้อ ${currentPage || 1}` : 'พร้อมเริ่ม';
    compact.textContent = `${pageText} · ${sessionElapsedMinutes()} นาที`;
  }

  // ขอข้อมูล Release ล่าสุดผ่าน background; หากไม่มีอินเทอร์เน็ตหรือไม่มีเวอร์ชันใหม่จะไม่แสดงการ์ด
  function checkForUpdate() {
    chrome.runtime.sendMessage({ action: 'checkForUpdate' }, response => {
      if (chrome.runtime.lastError || !response?.ok || !response.updateAvailable) return;
      const update = document.getElementById('speexx-helper-update');
      const text = document.getElementById('speexx-helper-update-text');
      if (!update || !text) return;
      update.dataset.releaseUrl = response.url;
      text.textContent = `มีเวอร์ชันใหม่ ${response.version} พร้อมดาวน์โหลด`;
      update.hidden = false;
    });
  }

  function saveSessionStats() {
    updateSessionSummary();
    chrome.storage.local.set({ speexxSessionStats: sessionStats });
  }

  async function startNewSession() {
    sessionStats = { startedAt: Date.now(), endedAt: 0, completedCount: 0, reviewCount: 0, reviewMs: 0 };
    saveSessionStats();
    if (sessionSummaryTimer) clearInterval(sessionSummaryTimer);
    sessionSummaryTimer = setInterval(updateSessionSummary, 15000);
  }

  // รีเซ็ตเฉพาะสรุปเซสชันในเครื่อง ไม่เปลี่ยนการตั้งค่าเวลาและไม่ยุ่งกับประวัติของ Speexx
  async function resetSessionStats() {
    if (isRunning) {
      addLog('หยุดการทำงานก่อนจึงจะรีเซ็ตสถิติเซสชันได้', 'warning');
      return;
    }
    sessionStats = { startedAt: 0, endedAt: 0, completedCount: 0, reviewCount: 0, reviewMs: 0 };
    if (sessionSummaryTimer) clearInterval(sessionSummaryTimer);
    sessionSummaryTimer = null;
    await new Promise(resolve => chrome.storage.local.remove(['speexxSessionStats'], resolve));
    updateSessionSummary();
    addLog('รีเซ็ตสถิติเซสชันแล้ว', 'success');
  }

  async function restoreSessionStats() {
    const stored = await new Promise(resolve => chrome.storage.local.get(['speexxSessionStats'], resolve));
    const saved = stored.speexxSessionStats;
    if (saved?.startedAt) {
      sessionStats = {
        startedAt: Number(saved.startedAt),
        endedAt: Math.max(0, Number(saved.endedAt) || 0),
        completedCount: Math.max(0, Number(saved.completedCount) || 0),
        reviewCount: Math.max(0, Number(saved.reviewCount) || 0),
        reviewMs: Math.max(0, Number(saved.reviewMs) || 0)
      };
    }
    updateSessionSummary();
    if (!sessionSummaryTimer) sessionSummaryTimer = setInterval(updateSessionSummary, 15000);
  }

  function recordCompletedExercise() {
    sessionStats.completedCount++;
    saveSessionStats();
  }

  function recordReviewPause(ms) {
    if (!ms) return;
    sessionStats.reviewCount++;
    sessionStats.reviewMs += ms;
    saveSessionStats();
  }

  // ปิดเวลาเซสชันเมื่อทำเสร็จหรือกดหยุด เพื่อไม่ให้นาทีเพิ่มต่อในหน้าสรุป
  function finishSession() {
    sessionStats.endedAt = Date.now();
    saveSessionStats();
    if (sessionSummaryTimer) {
      clearInterval(sessionSummaryTimer);
      sessionSummaryTimer = null;
    }
  }

  function makeDraggable(element) {
    let dragState = null;
    let animationFrame = null;

    // ใช้จุดเดียวในการวางตำแหน่ง เพื่อให้ pointerup ที่เกิดก่อน frame สุดท้ายไม่ทำให้ตำแหน่งค้าง
    const renderDragPosition = () => {
      if (!dragState) return;
      const panel = element.parentElement;
      const deltaX = (dragState.currentX - dragState.startX) / dragState.zoom;
      const deltaY = (dragState.currentY - dragState.startY) / dragState.zoom;
      panel.style.left = `${dragState.startLeft + deltaX}px`;
      panel.style.top = `${dragState.startTop + deltaY}px`;
    };

    // ใช้ Pointer Events และวาดตำแหน่งผ่าน requestAnimationFrame เพื่อให้ลากลื่นแม้หน้าเว็บมีงานหนัก
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button, a, input, select, textarea, label')) return;
      const panel = element.parentElement;
      const panelRect = panel.getBoundingClientRect();
      const zoom = panel.offsetWidth ? panelRect.width / panel.offsetWidth : 1;
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: panel.offsetLeft,
        startTop: panel.offsetTop,
        zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
        currentX: event.clientX,
        currentY: event.clientY
      };
      panel.style.right = 'auto';
      panel.style.willChange = 'left, top';
      element.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    element.addEventListener('pointermove', event => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      dragState.currentX = event.clientX;
      dragState.currentY = event.clientY;
      if (animationFrame !== null) return;
      animationFrame = requestAnimationFrame(() => {
        if (!dragState) return;
        renderDragPosition();
        animationFrame = null;
      });
      event.preventDefault();
    });

    // บันทึกครั้งเดียวเมื่อวางเมาส์ แทนการเขียน Chrome Storage ทุก frame ที่ลาก
    const finishDragging = event => {
      // window blur ไม่มี pointerId จึงใช้เพื่อปลดการลากฉุกเฉินได้
      if (!dragState || (event?.pointerId !== undefined && event.pointerId !== dragState.pointerId)) return;
      if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
        dragState.currentX = event.clientX;
        dragState.currentY = event.clientY;
        renderDragPosition();
      }
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      const panel = element.parentElement;
      panel.style.willChange = '';
      chrome.storage.local.set({ speexxPanelPosition: { top: panel.offsetTop, left: panel.offsetLeft } });
      const pointerId = dragState.pointerId;
      dragState = null;
      animationFrame = null;
      try { element.releasePointerCapture(pointerId); } catch (_) { /* pointer อาจถูกปล่อยไปแล้ว */ }
    };
    element.addEventListener('pointerup', finishDragging);
    element.addEventListener('pointercancel', finishDragging);
    // สำรองเหตุการณ์: mouseup นอกแผง, capture หลุด, หรือหน้าต่างเสียโฟกัสต้องปลดสถานะลากเสมอ
    document.addEventListener('pointerup', finishDragging);
    element.addEventListener('lostpointercapture', finishDragging);
    window.addEventListener('blur', () => finishDragging());
  }

  // แปลงข้อความภายในให้เป็นภาษาที่อ่านง่ายในแผงรายละเอียด
  // ข้อความเต็มยังเก็บไว้ใน title ของแต่ละแถวสำหรับการตรวจบั๊ก
  function formatLogMessage(text) {
    const raw = String(text ?? '').trim();
    const withoutEmoji = raw.replace(/[📋✅❌⚠️💡▶️⏹⏳📝📌🔄🚀🎯📖📚📊⏱]/gu, '').trim();
    const replacements = [
      [/ขั้นตอน 1: กด Correction/i, 'ตรวจคำตอบเพื่อหาเฉลย'],
      [/ขั้นตอน 2: กด Solution/i, 'เปิดเฉลย'],
      [/ขั้นตอน 3: จำคำตอบ/i, 'บันทึกเฉลย'],
      [/ขั้นตอน 4: กด Repeat/i, 'เตรียมทำข้อใหม่'],
      [/ขั้นตอน 5: ใส่คำตอบ/i, 'ใส่คำตอบ'],
      [/ขั้นตอน 5\.5: กด Correction เพื่อ submit/i, 'ส่งคำตอบ'],
      [/กด Correction \(submit\) แล้ว/i, 'ส่งคำตอบแล้ว'],
      [/กด Correction แล้ว/i, 'ตรวจคำตอบแล้ว'],
      [/กด Solution และพบข้อมูลเฉลยแล้ว/i, 'พบเฉลยแล้ว'],
      [/กด Repeat แล้ว/i, 'พร้อมใส่คำตอบ'],
      [/พิมพ์ ".*" ใน input (\d+)/i, 'ใส่คำตอบในช่องที่ $1'],
      [/ลาก ".*" ไปช่องที่ (\d+)/i, 'วางคำตอบในช่องที่ $1'],
      [/สำเร็จ: ช่องที่ (\d+)/i, 'วางคำตอบช่องที่ $1 สำเร็จ'],
      [/ทำเสร็จแล้ว! \(รวม \d+ ข้อ\)/i, 'ทำข้อนี้เสร็จแล้ว'],
      [/รอ exercise reinitialize/i, 'กำลังเตรียมข้อใหม่']
    ];
    const matched = replacements.find(([pattern]) => pattern.test(withoutEmoji));
    const friendly = matched
      ? withoutEmoji.replace(matched[0], matched[1])
      : withoutEmoji;
    return friendly.length > 88 ? `${friendly.slice(0, 85)}…` : friendly;
  }

  function addLog(text, type = 'info') {
    if (!logContainer) return;

    const icons = {
      info: '📋',
      success: '✅',
      error: '❌',
      warning: '⚠️',
      answer: '💡',
      step: '▶️'
    };

    const safeType = icons[type] ? type : 'info';
    // เก็บข้อความเต็มไว้ในรายงาน แม้ UI จะแสดงข้อความย่อเพื่อไม่ให้แผงรก
    debugEntries.push({ at: new Date().toISOString(), type: safeType, text: String(text ?? '') });
    if (debugEntries.length > 150) debugEntries.shift();

    // Remove empty placeholder if present
    const empty = logContainer.querySelector('.sh-empty');
    if (empty) empty.remove();

    const row = document.createElement('div');
    row.className = 'sh-log-row';
    row.dataset.type = safeType;

    const icon = document.createElement('span');
    icon.className = 'sh-log-icon';
    icon.textContent = icons[safeType];

    const textNode = document.createElement('span');
    textNode.className = 'sh-log-text';
    const rawText = String(text ?? '');
    const displayText = formatLogMessage(rawText);
    textNode.textContent = ` ${displayText}`;
    textNode.title = rawText;

    row.append(icon, textNode);
    logContainer.appendChild(row);
    logContainer.scrollTop = logContainer.scrollHeight;
    const statusBadge = document.getElementById('speexx-helper-status');
    if (statusBadge) {
      const cleanText = displayText;
      statusBadge.textContent = cleanText.slice(0, 32) || 'กำลังทำงาน';
      statusBadge.dataset.type = safeType;
      const currentStatus = document.getElementById('speexx-helper-current');
      const progressStatus = document.getElementById('speexx-helper-progress');
      if (currentStatus) currentStatus.textContent = cleanText || 'กำลังทำงาน';
      if (progressStatus) progressStatus.textContent = isRunning ? `กำลังทำ · ข้อ ${currentPage}` : 'พร้อมใช้งาน';
      updateCompactStatus();
    }

    // Sync latest status to storage so popup can display it
    syncTaskStatus(displayText, type);
  }

  // ============================================================
  // DEBUG EXPORT
  // รายงานประกอบด้วย error/warning ทั้งหมดและเหตุการณ์ล่าสุดสำหรับตามบั๊ก
  // ============================================================
  function buildDebugReport() {
    const importantEntries = debugEntries.filter(entry => entry.type === 'error' || entry.type === 'warning');
    const formatEntries = entries => entries.length
      ? entries.map(entry => `[${entry.at}] ${entry.type.toUpperCase()}: ${entry.text}`).join('\n')
      : '(ไม่มี)';
    const currentSnapshot = captureExerciseDebugSnapshot(findExercise());
    return [
      'Speexx Helper — Debug Report',
      `สร้างเมื่อ: ${new Date().toLocaleString('th-TH')}`,
      `URL: ${location.href}`,
      `Exercise type: ${getExerciseType() || 'unknown'}`,
      `Session: ทำสำเร็จ ${sessionStats.completedCount} ข้อ | เวลา ${sessionElapsedMinutes()} นาที | ทบทวน ${sessionStats.reviewCount} ครั้ง`,
      `สถานะ: ${isRunning ? 'กำลังทำงาน' : 'หยุดอยู่'} | หน้าในชุด: ${currentPage}`,
      '',
      `=== ข้อผิดพลาด / คำเตือน (${importantEntries.length}) ===`,
      formatEntries(importantEntries),
      '',
      '=== เหตุการณ์ล่าสุด (30 รายการ) ===',
      formatEntries(debugEntries.slice(-30)),
      '',
      '=== DOM ก่อนเริ่มใส่คำตอบ (อัตโนมัติ) ===',
      preApplyExerciseSnapshot ? JSON.stringify(preApplyExerciseSnapshot, null, 2) : '(ยังไม่มีข้อมูล)',
      '',
      '=== DOM ปัจจุบันตอนส่งออก Debug ===',
      currentSnapshot ? JSON.stringify(currentSnapshot, null, 2) : '(ไม่พบ exercise)',
      '',
      '=== ผลตรวจหน้าล่าสุด ===',
      latestPageDiagnostics ? JSON.stringify(latestPageDiagnostics, null, 2) : '(ยังไม่ได้กดตรวจหน้า)'
    ].join('\n');
  }

  // ตรวจเฉพาะโครงสร้างที่จำเป็นต่อการทำงาน โดยไม่คลิกหรือแก้ไขแบบฝึกหัด
  function collectPageDiagnostics() {
    const exercise = findExercise();
    const countUsable = selector => Array.from(document.querySelectorAll(selector)).filter(isUsableAction).length;
    return {
      checkedAt: new Date().toISOString(),
      url: location.href,
      exerciseFound: Boolean(exercise),
      exerciseType: getExerciseType() || 'unknown',
      exerciseClass: exercise ? String(exercise.className || '') : null,
      controls: {
        correction: countUsable('button.action-exercise-button.correct, .action-exercise-button.correct'),
        next: countUsable('button.action-exercise-button.next, .action-exercise-button.next, .nxt-exercise'),
        repeat: countUsable('button.repeat, .repeat button, button[class*="repeat"]'),
        start: countUsable('button.start, .start button, button[class*="start"]')
      },
      fields: exercise ? {
        textInputs: exercise.querySelectorAll('input[type="text"], textarea').length,
        gaps: exercise.querySelectorAll('.gap, .drag-drop-placeholder').length,
        draggableItems: exercise.querySelectorAll('.draggable, [draggable="true"], .draggable-container').length,
        scrambledCells: exercise.querySelectorAll('.scrambled-cell, .scrambled-block').length
      } : null
    };
  }

  // ปุ่ม “ตรวจ”: แสดงสรุปสั้นในแผงและเพิ่มข้อมูลละเอียดให้ Export Debug อัตโนมัติ
  function diagnoseCurrentPage() {
    latestPageDiagnostics = collectPageDiagnostics();
    const diagnostic = latestPageDiagnostics;
    const summary = document.getElementById('speexx-helper-diagnostic-summary');
    const typeLabel = diagnostic.exerciseType;
    const controlText = `Correction ${diagnostic.controls.correction} · Next ${diagnostic.controls.next}`;
    if (summary) summary.textContent = diagnostic.exerciseFound
      ? `พบ ${typeLabel} · ${controlText}`
      : 'ไม่พบพื้นที่แบบฝึกหัดในหน้าปัจจุบัน';
    if (!diagnostic.exerciseFound || !diagnostic.controls.correction) {
      addLog(`ตรวจหน้า: ${typeLabel} — ไม่พบปุ่ม Correction ที่พร้อมใช้`, 'warning');
      return;
    }
    addLog(`ตรวจหน้า: ${typeLabel} · ${controlText} · ช่อง ${diagnostic.fields.gaps}`, 'success');
  }

  // แสดงการ์ดช่วยรายงานเฉพาะเมื่อพบ exercise แต่ตัวตรวจชนิดยังระบุไม่ได้
  function refreshUnsupportedExerciseNotice() {
    const card = document.getElementById('speexx-helper-unsupported');
    const detail = document.getElementById('speexx-helper-unsupported-detail');
    const exercise = findExercise();
    const type = getExerciseType();
    const unsupported = Boolean(exercise) && (!type || type === 'unknown');
    if (card) card.hidden = !unsupported;
    if (!unsupported) {
      unsupportedNoticeSignature = '';
      return;
    }
    const signature = getExerciseSignature() || `${location.pathname}:${String(exercise.className || '')}`;
    if (detail) detail.textContent = `ตรวจพบชนิด: ${type || 'unknown'} · กดคัดลอกเพื่อส่งให้ผู้พัฒนา`;
    if (unsupportedNoticeSignature === signature) return;
    unsupportedNoticeSignature = signature;
    addLog('ไม่รองรับโจทย์นี้ — ใช้ปุ่มคัดลอก Debug หรือ HTML เพื่อส่งข้อมูลแก้ไข', 'warning');
  }

  // ปุ่ม “ล้าง”: ล้างเฉพาะเหตุการณ์ Debug บนหน้านี้ แล้วคงข้อความยืนยันหนึ่งรายการไว้
  function clearDebugLog() {
    debugEntries.length = 0;
    preApplyExerciseSnapshot = null;
    latestPageDiagnostics = null;
    if (logContainer) logContainer.replaceChildren();
    const summary = document.getElementById('speexx-helper-diagnostic-summary');
    if (summary) summary.textContent = 'ล้างบันทึกแล้ว · กด “ตรวจ” เพื่อเก็บข้อมูลใหม่';
    addLog('ล้างบันทึก Debug แล้ว', 'info');
  }

  // เก็บโครงสร้างสำคัญแบบย่อ โดยเน้น Scrambled เพื่อใช้แก้บั๊กจากรายงานเพียงชุดเดียว
  function captureExerciseDebugSnapshot(exercise) {
    if (!exercise) return null;
    const itemsRoot = exercise.querySelector('.exercise-items');
    const rows = itemsRoot
      ? Array.from(itemsRoot.children).filter(item => item.matches('.item')).map((item, index) => {
        const container = item.querySelector('.scrambled-cell-container');
        const cell = container?.querySelector('.scrambled-cell');
        return {
          row: index + 1,
          text: normalizeAnswer(cell?.textContent || ''),
          cellId: cell?.getAttribute('data-scrambled-cell-id') || null,
          className: cell?.className || null,
          containerHtml: container?.outerHTML.slice(0, 3500) || null
        };
      })
      : [];
    return {
      capturedAt: new Date().toISOString(),
      exerciseClass: String(exercise.className || ''),
      detectedType: getExerciseType() || 'unknown',
      itemCount: rows.length,
      scrambledCellCount: rows.filter(row => row.cellId).length,
      rows
    };
  }

  async function exportDebugReport() {
    const report = buildDebugReport();
    try {
      await navigator.clipboard.writeText(report);
    } catch (_) {
      // fallback สำหรับหน้า/เบราว์เซอร์ที่ไม่อนุญาต Clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = report;
      textarea.setAttribute('readonly', '');
      textarea.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) {
        addLog('❌ คัดลอก Debug ไม่สำเร็จ', 'error');
        return;
      }
    }
    addLog('📋 คัดลอกรายงาน Debug แล้ว — วางส่งเพื่อแจ้งปัญหาได้เลย', 'success');
  }

  // สร้าง HTML สำหรับการวิเคราะห์: เก็บโครงสร้างหน้าไว้ แต่ล้างค่าที่ผู้ใช้อาจกรอกและตัด UI ของส่วนขยายออก
  function buildSanitizedPageHtml() {
    const pageCopy = document.documentElement.cloneNode(true);
    pageCopy.querySelectorAll('script, style, noscript, #speexx-helper-panel, #speexx-helper-reopen, #speexx-helper-floating-timer').forEach(node => node.remove());
    pageCopy.querySelectorAll('input, textarea, select').forEach(field => {
      field.removeAttribute('value');
      field.removeAttribute('checked');
      field.removeAttribute('selected');
      if (field.tagName === 'TEXTAREA') field.textContent = '';
      if (field.tagName === 'SELECT') field.selectedIndex = -1;
    });
    return `<!-- Speexx Helper sanitized HTML | ${new Date().toISOString()} | ${location.href} -->\n<!DOCTYPE html>\n${pageCopy.outerHTML}`;
  }

  // ปุ่ม HTML: คัดลอกตามคำสั่งผู้ใช้เท่านั้น และแจ้งให้ตรวจข้อมูลส่วนบุคคลก่อนแชร์ทุกครั้ง
  async function copySanitizedPageHtml() {
    const html = buildSanitizedPageHtml();
    try {
      await navigator.clipboard.writeText(html);
      addLog(`คัดลอก HTML หน้าเว็บแล้ว (${Math.round(html.length / 1024)} KB) — ตรวจข้อมูลส่วนบุคคลก่อนแชร์`, 'success');
    } catch (_) {
      addLog('คัดลอก HTML หน้าเว็บไม่สำเร็จ', 'error');
    }
  }

  // Persist task progress so the popup can show it
  function syncTaskStatus(latestText, latestType) {
    try {
      chrome.storage.local.set({
        taskCount: exerciseCount,
        taskPage: currentPage,
        taskLatest: latestText.slice(0, 140),
        taskRunning: isRunning,
        taskLatestType: latestType
      });
    } catch (_) {
      // storage may be unavailable in some contexts; ignore
    }
  }

  function setButtonState(running) {
    const solveAllBtn = document.getElementById('speexx-helper-solve-all');
    const solveOneBtn = document.getElementById('speexx-helper-solve-one');
    const repeatBtn = document.getElementById('speexx-helper-repeat');
    const continuousBtn = document.getElementById('speexx-helper-continuous');
    const stopBtn = document.getElementById('speexx-helper-stop');

    if (running) {
      solveAllBtn.style.display = 'none';
      solveOneBtn.style.display = 'none';
      repeatBtn.style.display = 'none';
      continuousBtn.style.display = 'none';
      stopBtn.style.display = 'inline-flex';
    } else {
      solveAllBtn.style.display = 'inline-flex';
      solveOneBtn.style.display = 'inline-flex';
      repeatBtn.style.display = 'inline-flex';
      continuousBtn.style.display = 'inline-flex';
      stopBtn.style.display = 'none';
    }

    // Keep popup in sync about running state
    try {
      chrome.storage.local.set({ taskRunning: running });
    } catch (_) { }
  }

  function stopSolving() {
    if (!isRunning) return;
    shouldStop = true;
    isStopping = true;
    isRunning = false;
    // เปลี่ยน UI ทันที เพื่อไม่ให้ผู้ใช้กดเริ่มซ้ำระหว่างที่ async เดิมกำลังคืนตัว
    setButtonState(false);
    // ยกเลิก sleep ที่กำลังรออยู่ทันที ไม่ต้องรอ timeout เดิม
    Array.from(pendingSleepCancellers).forEach(cancel => cancel());
    chrome.storage.local.remove(['speexxResumeContinuous']);
    addLog('⏹ กำลังหยุด...', 'warning');
  }

  // ============================================================
  // EXERCISE DETECTION
  // ============================================================
  function getExerciseType() {
    const exercise = findExercise();
    if (!exercise) return null;

    const classes = exercise.className || '';

    // 1. ตรวจจาก class name
    if (classes.includes('type-drag-drop')) return 'drag-drop';
    if (classes.includes('type-fill-text-toggle')) return 'fill-text-toggle';
    if (classes.includes('type-toggle-solution')) return 'toggle-solution';
    if (classes.includes('type-multiple-choice')) return 'multiple-choice';
    if (classes.includes('type-single-choice')) return 'single-choice';
    if (classes.includes('type-answer')) return 'answer';
    if (classes.includes('type-scrambled-sentence')) return 'scrambled-sentence';
    if (classes.includes('type-mark-text')) return 'mark-text';
    if (classes.includes('type-picture-choice')) return 'picture-choice';
    if (classes.includes('type-fill-text')) return 'fill-text';

    // 2. ตรวจจาก element ภายใน (ถ้า class ไม่มี type-)
    if (exercise.querySelector('.draggable-container')) return 'drag-drop';
    if (exercise.querySelector('.fill-text-toggle')) return 'fill-text-toggle';
    if (exercise.querySelector('.gap.form-control')) return 'toggle-solution';
    if (exercise.querySelector('.gap')) return 'toggle-solution';
    if (exercise.querySelector('.input-group-addon button')) return 'toggle-solution';
    if (exercise.querySelector('[class*="toggle"]')) return 'fill-text-toggle';
    if (exercise.querySelector('.drag-drop-placeholder')) return 'drag-drop';
    if (exercise.querySelector('.scrambled-cell, .scrambled-block')) return 'scrambled-sentence';
    if (exercise.querySelector('input[type="text"]')) return 'answer';
    if (exercise.querySelector('input[type="radio"]')) return 'single-choice';
    if (exercise.querySelector('input[type="checkbox"]')) return 'multiple-choice';
    if (exercise.querySelector('.scrambled-sentence')) return 'scrambled-sentence';
    if (exercise.querySelector('.mark-text')) return 'mark-text';
    if (exercise.querySelector('.picture-choice')) return 'picture-choice';

    // static-before เป็น wrapper ของ exercise จริง ให้ตรวจชนิดด้านในก่อน
    if (classes.includes('type-static-before')) return 'static-before';

    // 3. ตรวจจาก exercise-items
    const items = exercise.querySelectorAll('.exercise-items .item');
    if (items.length > 0) {
      // ดูว่า item มี element อะไร
      const firstItem = items[0];
      if (firstItem.querySelector('.drag-drop-placeholder')) return 'drag-drop';
      if (firstItem.querySelector('.fill-text-toggle')) return 'fill-text-toggle';
      if (firstItem.querySelector('input')) return 'answer';
      if (firstItem.querySelector('[class*="toggle"]')) return 'fill-text-toggle';
    }

    return 'unknown';
  }

  function findExercise() {
    const exercises = Array.from(document.querySelectorAll('.exercise'));
    const visibleExercises = exercises.filter(exercise => {
      const style = window.getComputedStyle(exercise);
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        exercise.getClientRects().length > 0;
    });

    const matchedExercise = visibleExercises.find(exercise =>
      /(^|\s)(active|current|selected)(\s|$)/i.test(exercise.className)
    ) || visibleExercises[0] || null;

    if (matchedExercise) return matchedExercise;

    // หน้าบางชุดของ Speexx ไม่ห่อเนื้อหาด้วย .exercise แต่มีปุ่ม Correction
    // ให้ใช้ body เป็นขอบเขตของข้อปัจจุบัน เพื่อให้ตัวตรวจชนิดและขั้นตอน
    // Correction ทำงานต่อได้
    const visibleCorrection = Array.from(
      document.querySelectorAll('button.action-exercise-button.correct, .action-exercise-button.correct')
    ).find(isUsableAction);
    return visibleCorrection ? document.body : null;
  }

  // ============================================================
  // ค้นหาปุ่มต่างๆ
  // ============================================================
  function isUsableAction(element) {
    if (!element || element.disabled || element.classList.contains('disabled')) return false;
    if (element.getAttribute('aria-disabled') === 'true') return false;

    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      element.getClientRects().length > 0;
  }

  // กดปุ่มด้วยหลายวิธี เพื่อให้ผ่าน modal/blocking overlay
  async function forceClick(element) {
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // วิธี 1: click ปกติ
    element.click();
    await sleep(200);

    // วิธี 2: focus แล้วกด Enter
    try {
      element.focus();
      await sleep(100);
      element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
      await sleep(200);
    } catch (_) { }

    // วิธี 3: PointerEvents (ใช้กับ modern frameworks)
    try {
      const ptrOpts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, pointerId: 1, pointerType: 'mouse' };
      element.dispatchEvent(new PointerEvent('pointerdown', ptrOpts));
      element.dispatchEvent(new PointerEvent('pointerup', ptrOpts));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 }));
      await sleep(200);
    } catch (_) { }

    // วิธี 4: mousedown + mouseup + click
    const mouseOpts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
    element.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
    element.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
    element.dispatchEvent(new MouseEvent('click', mouseOpts));
    await sleep(200);

    // วิธี 5: jQuery (ถ้ามี)
    if (window.jQuery) {
      try { window.jQuery(element).trigger('click'); } catch (_) { }
      await sleep(200);
    }

    // วิธี 6: เรียก onclick โดยตรง
    if (typeof element.onclick === 'function') {
      try { element.onclick(); } catch (_) { }
    }

    // วิธี 7: React synthetic event (ถ้ามี)
    try {
      const reactKey = Object.keys(element).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (reactKey) {
        const reactProps = Object.keys(element).find(k => k.startsWith('__reactProps'));
        if (reactProps && element[reactProps] && element[reactProps].onClick) {
          element[reactProps].onClick({ target: element, preventDefault() { }, stopPropagation() { } });
        }
      }
    } catch (_) { }
  }

  function findActionButton(exercise, selectors, textMatcher) {
    const roots = exercise ? [exercise, document] : [document];
    const seen = new Set();

    for (const root of roots) {
      for (const selector of selectors) {
        for (const element of root.querySelectorAll(selector)) {
          const button = element.closest('button, [role="button"], a') || element;
          if (seen.has(button) || !isUsableAction(button)) continue;
          seen.add(button);
          return button;
        }
      }

      if (textMatcher) {
        for (const button of root.querySelectorAll('button, [role="button"], a')) {
          if (seen.has(button) || !isUsableAction(button)) continue;
          seen.add(button);
          if (textMatcher(normalizeAnswer(button.textContent).toLowerCase())) {
            return button;
          }
        }
      }
    }

    return null;
  }

  function findCorrectionButton(exercise = findExercise()) {
    return findActionButton(
      exercise,
      [
        '.action-exercise-button.correct',
        '.btn.correct',
        'button.correct',
        'button[class*="correct"]'
      ],
      text => text === 'correction' || text.includes('correction')
    );
  }

  function findSolutionButton(exercise = findExercise()) {
    return findActionButton(
      exercise,
      [
        'button.solution',
        '[data-original-title="Solution"]',
        '[aria-label*="เฉลย"]',
        '.glyphicons.magic-wand'
      ],
      text => text === 'solution' || text.includes('solution') || text.includes('เฉลย')
    );
  }

  function findRepeatButton(exercise = findExercise()) {
    return findActionButton(
      exercise,
      [
        '.action-exercise-button.repeat',
        '.btn.repeat',
        'button.repeat'
      ],
      text => text === 'repeat' || text.includes('repeat')
    );
  }

  function findNextButton(exercise = findExercise()) {
    return findActionButton(
      exercise,
      [
        '.nxt-exercise',
        '.action-exercise-button.next',
        '.btn.next'
      ],
      text => text === 'next' || text.includes('next')
    );
  }

  // Popup สรุปหลังจบชุดแบบฝึกหัดของ Speexx ใช้ได้ทั้ง id เดิมและข้อความ
  // ภาษาไทย/อังกฤษ เพื่อรองรับหน้าที่ popup โหลดช้าหรือเปลี่ยน layout เล็กน้อย
  function findContinueLearningButton() {
    // หาก Speexx เปลี่ยนปุ่ม “เรียนรู้ต่อ” ให้แก้ selector หรือข้อความในฟังก์ชันนี้
    // โครงสร้างที่ยืนยันจากหน้า Speexx:
    // <button class="btn block-button btn-primary next" id="nextButton">เรียนรู้ต่อ</button>
    const directButton = document.querySelector('button#nextButton.btn.next');
    if (directButton && isUsableAction(directButton)) return directButton;

    return findActionButton(
      null,
      [
        '#nextButton',
        '[data-action="continue-learning"]',
        '.continue-learning',
        '.btn-continue-learning'
      ],
      text => text === 'เรียนรู้ต่อ' || text.includes('เรียนรู้ต่อ') ||
        text === 'continue learning' || text.includes('continue learning')
    );
  }

  function getExerciseSignature() {
    const exercise = findExercise();
    if (!exercise) return '';
    const explicitId = exercise.getAttribute('data-exercise-id') || exercise.id || '';
    const title = normalizeAnswer(
      exercise.querySelector('h1, h2, h3, .exercise-title, .title')?.textContent || ''
    );
    const firstItem = normalizeAnswer(exercise.querySelector('.exercise-items .item')?.textContent || '');
    return `${explicitId}|${title}|${firstItem}`;
  }

  async function waitForNextExercise(previousSignature, maxWait = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWait) {
      throwIfStopRequested();
      if (findContinueLearningButton()) {
        await sleep(250);
        continue;
      }
      // Speexx บางแบบไม่มี .exercise-items .item แต่มี Correction ทันที
      // ใช้ปุ่มนี้เป็นสัญญาณว่าหน้าใหม่พร้อมเริ่มทำได้
      if (findCorrectionButton()) return true;
      const exercise = findExercise();
      const signature = getExerciseSignature();
      if (exercise && signature && signature !== previousSignature) {
        return true;
      }
      await sleep(250);
    }
    addLog('⚠️ หน้าแบบฝึกหัดใหม่ยังโหลดไม่เสร็จ', 'warning');
    return false;
  }

  async function clickContinueLearningIfPresent() {
    // จุดเชื่อมระหว่างหน้าสรุปผลกับหน้าแบบฝึกหัดถัดไป
    const continueButton = findContinueLearningButton();
    if (!continueButton) return false;
    if (courseTransitionCount >= 20) {
      addLog('⚠️ หยุดที่ 20 ชุดเพื่อป้องกันการวนซ้ำผิดปกติ', 'warning');
      return false;
    }
    const previousSignature = getExerciseSignature();
    addLog('🎯 ทำครบชุดแล้ว — กด “เรียนรู้ต่อ” อัตโนมัติ', 'step');
    showTimerReminder('กำลังเปิดชุดใหม่', 0);
    // ปุ่มนี้อาจเปลี่ยนหน้าเต็มหน้า ทำให้ Content Script ปัจจุบันถูกทำลาย
    // เก็บสถานะไว้เพื่อให้ script ของหน้าใหม่เริ่มโหมดต่อเนื่องต่อเอง
    chrome.storage.local.set({ speexxResumeContinuous: true });
    continueButton.click();
    const nextExerciseReady = await waitForNextExercise(previousSignature);
    if (!nextExerciseReady) return false;
    chrome.storage.local.remove(['speexxResumeContinuous']);
    currentPage = 1;
    courseTransitionCount++;
    addLog('🚀 หน้าใหม่พร้อม — เริ่ม Correction อัตโนมัติ', 'step');
    addLog('✅ เปิดชุดแบบฝึกหัดถัดไปแล้ว', 'success');
    return true;
  }

  async function continueAfterCompletion() {
    // รอ popup สรุปผล render สูงสุด 10 วินาที
    for (let attempt = 0; attempt < 20; attempt++) {
      throwIfStopRequested();
      if (await clickContinueLearningIfPresent()) return true;
      await sleep(500);
    }
    return false;
  }

  async function proceedToFollowingExercise() {
    // Popup สรุปอยู่เหนือหน้าแบบฝึกหัด: ต้องกด “เรียนรู้ต่อ” ก่อนเสมอ
    // มิฉะนั้นจะเผลอคลิก Next ที่มองไม่เห็นอยู่ด้านหลัง popup
    if (await clickContinueLearningIfPresent()) return true;
    const movedToNext = await clickNext();
    if (movedToNext) {
      // หลังคลิก Next บางชุดจะ render popup สรุปผลแบบหน่วงเวลา
      // ตรวจซ้ำอีกครั้งก่อนเริ่มแก้ข้อถัดไป
      await sleep(700);
      if (await clickContinueLearningIfPresent()) return true;
      return true;
    }

    return continueAfterCompletion();
  }

  async function reviewCurrentExercise(ms) {
    if (!ms) return;
    recordReviewPause(ms);
    addLog(`📖 ทบทวนข้อ ${currentPage} · ${Math.ceil(ms / 60000)} นาที`, 'step');
    await waitWithCountdown(ms, 'ทบทวนข้อนี้');
    throwIfStopRequested();
    addLog('✅ ทบทวนครบแล้ว — ทำข้อต่อไปอัตโนมัติ', 'success');
  }

  // ============================================================
  // MAIN SOLVING FLOW
  // ============================================================
  async function startSolving(solveAll, continuous = false, resumeSession = false) {
    // continuous = true ใช้เฉพาะปุ่ม “ทำอัตโนมัติต่อเนื่อง”
    if (isRunning || isStopping) {
      addLog(isStopping ? 'กำลังหยุดงานเดิมอยู่...' : 'กำลังทำงานอยู่...', 'warning');
      return;
    }

    await loadSettings();
    // เริ่มจากปุ่มใหม่ = ล้างสถิติเดิม; กลับมาจาก “เรียนรู้ต่อ” = ใช้สถิติเดิม
    if (resumeSession) await restoreSessionStats();
    else await startNewSession();
    const continuousSettings = continuous
      ? await new Promise(resolve => chrome.storage.sync.get(['manualReviewBeforeContinue', 'continuousReviewMinutes'], resolve))
      : {};
    const manualReviewMs = continuous && continuousSettings.manualReviewBeforeContinue !== false
      ? Math.min(120, Math.max(1, Number.parseInt(continuousSettings.continuousReviewMinutes, 10) || 5)) * 60 * 1000
      : 0;

    isRunning = true;
    isStopping = false;
    shouldStop = false;
    currentPage = 1;
    courseTransitionCount = 0;
    runStartCount = exerciseCount;
    failedCount = 0;
    skippedCount = 0;

    setButtonState(true);

    addLog(continuous
      ? `🔁 เริ่มทำอัตโนมัติต่อเนื่อง · ทบทวนก่อนเรียนรู้ต่อ ${Math.ceil(manualReviewMs / 60000) || 0} นาที`
      : '🚀 เริ่มทำแบบฝึกหัด...', 'info');

    let failed = false;

    try {
      await solveCurrentExercise();
      if (continuous) await reviewCurrentExercise(manualReviewMs);

      if (solveAll) {
        let hasMore = true;
        while (hasMore && isRunning && !shouldStop) {
          addLog('🔄 กำลังไปข้อถัดไป...', 'info');
          hasMore = continuous
            ? await proceedToFollowingExercise()
            : await clickNext();
          addLog(`  📊 clickNext คืนค่า: ${hasMore}`, 'info');

          if (hasMore && isRunning && !shouldStop) {
            addLog('  ⏳ รอ 2 วินาทีให้ exercise ใหม่โหลด...', 'info');
            await sleep(2000);
            throwIfStopRequested();
            addLog('  🚀 เริ่มทำข้อถัดไป...', 'info');
            await solveCurrentExercise();
            if (continuous) await reviewCurrentExercise(manualReviewMs);
            addLog('  ✅ ทำข้อถัดไปเสร็จแล้ว', 'success');
          }
        }
        if (!hasMore) {
          addLog('ℹ️ ไม่มีข้อถัดไปแล้ว (หน้าสุดท้าย)', 'info');
        }
      }
    } catch (error) {
      // การกดหยุดเป็นการจบงานตามปกติ ไม่ควรแจ้งเป็น error
      if (!(shouldStop && error?.name === 'StopRequestedError')) {
        failed = true;
        failedCount++;
        addLog(`❌ ผิดพลาด: ${error.message}`, 'error');
      }
    }

    isRunning = false;
    isStopping = false;
    setButtonState(false);
    finishSession();

    if (shouldStop) {
      addLog('⏹ หยุดแล้ว!', 'warning');
    } else if (failed) {
      addLog('❌ หยุดการทำงานเนื่องจากเกิดข้อผิดพลาด', 'error');
    } else {
      addLog('✅ เสร็จสิ้น!', 'success');
    }
    if (continuous) chrome.storage.local.remove(['speexxResumeContinuous']);
    addLog(`📊 สรุป: สำเร็จ ${exerciseCount - runStartCount} ข้อ · ข้าม ${skippedCount} · ผิดพลาด ${failedCount}`, failedCount ? 'warning' : 'success');
  }

  // โหมดจับเวลา: ทำแต่ละข้อให้ครบเวลาที่ตั้งไว้ แล้วทบทวนก่อนกด Next
  async function startTimedAll() {
    if (isRunning || isStopping) {
      addLog(isStopping ? 'กำลังหยุดงานเดิมอยู่...' : 'กำลังทำงานอยู่...', 'warning');
      return;
    }
    const settings = await new Promise(resolve => chrome.storage.sync.get(['questionMinutes', 'reviewMinutes', 'reminderMinutes'], resolve));
    const questionMinutes = Math.min(120, Math.max(1, Number.parseInt(settings.questionMinutes, 10) || 5));
    const reviewMinutes = Math.min(120, Math.max(1, Number.parseInt(settings.reviewMinutes, 10) || 2));
    const reminderMinutes = Math.min(30, Math.max(1, Number.parseInt(settings.reminderMinutes, 10) || 1));
    const questionMs = questionMinutes * 60 * 1000;
    const reviewMs = reviewMinutes * 60 * 1000;
    await startNewSession();
    isRunning = true;
    isStopping = false;
    shouldStop = false;
    failedCount = 0;
    skippedCount = 0;
    setButtonState(true);
    currentPage = 1;
    courseTransitionCount = 0;
    addLog(`⏱ เริ่มจับเวลา: ข้อละ ${questionMinutes} นาที · ทบทวน ${reviewMinutes} นาที · เตือนก่อนหมด ${reminderMinutes} นาที`, 'step');
    try {
      let hasMore = true;
      while (hasMore && isRunning && !shouldStop) {
        throwIfStopRequested();
        const questionStartedAt = Date.now();
        addLog(`📚 ข้อที่ ${currentPage}: เริ่มทำ`, 'info');
        await solveCurrentExercise();
        const remainingQuestionMs = Math.max(0, questionMs - (Date.now() - questionStartedAt));
        if (remainingQuestionMs > 0) {
          addLog(`⏳ รอให้ครบเวลาข้อละ ${questionMinutes} นาที...`, 'info');
          await waitWithCountdown(remainingQuestionMs, 'เวลาข้อนี้', reminderMinutes * 60 * 1000);
        }
        if (reviewMs > 0) {
          recordReviewPause(reviewMs);
          addLog(`📝 ทบทวนข้อนี้ ${reviewMinutes} นาที...`, 'info');
          await waitWithCountdown(reviewMs, 'ทบทวน', reminderMinutes * 60 * 1000);
        }
        throwIfStopRequested();
        // โหมดจับเวลาจบเมื่อครบชุดปัจจุบัน; การข้ามไปชุดใหม่ใช้ปุ่มต่อเนื่องเท่านั้น
        hasMore = await clickNext();
        if (hasMore) await sleep(2000);
      }
    } catch (error) {
      if (!(shouldStop && error?.name === 'StopRequestedError')) {
        failedCount++;
        addLog(`❌ โหมดฝึกซ้ำหยุด: ${error.message}`, 'error');
      }
    }
    isRunning = false;
    isStopping = false;
    setButtonState(false);
    finishSession();
    addLog(shouldStop ? '⏹ หยุดโหมดจับเวลาแล้ว' : '✅ ทำครบทุกข้อแล้ว', shouldStop ? 'warning' : 'success');
  }

  async function solveCurrentExercise() {
    throwIfStopRequested();
    await waitForExercise();
    throwIfStopRequested();

    const type = getExerciseType();
    addLog(`📋 พบแบบฝึกหัด: ${type} (หน้าที่ ${currentPage})`, 'info');
    refreshUnsupportedExerciseNotice();

    if (!type || type === 'unknown') {
      addLog('⚠️ ไม่รู้จักประเภทแบบฝึกหัด - ข้ามไป', 'warning');
      return;
    }

    let exercise = findExercise();
    if (!exercise) return;

    // ขั้นตอน 0: ตรวจสอบประเภทและข้ามถ้าเป็น pronunciation
    const classes = exercise.className || '';
    if (classes.includes('type-multiple-item-pronunciation') || classes.includes('pronunciation')) {
      skippedCount++;
      addLog('⏩ ข้ามแบบฝึกหัด Pronunciation...', 'warning');
      return;
    }

    // ขั้นตอน 0.5: กด Start (ถ้ามี)
    const startBtn = exercise.querySelector('.start-exercise, button.start-exercise, [class*="start"]');
    if (startBtn) {
      addLog('📌 ขั้นตอน 0: กด Start...', 'step');
      throwIfStopRequested();
      startBtn.click();
      await sleep(2000);
      throwIfStopRequested();
      addLog('✅ กด Start แล้ว', 'success');

      const exerciseAfterStart = findExercise();
      if (exerciseAfterStart) {
        exercise = exerciseAfterStart;
      }
    }

    // ขั้นตอน 1: กด Correction
    addLog('📌 ขั้นตอน 1: กด Correction...', 'step');
    const correctionBtn = findCorrectionButton(exercise);
    if (correctionBtn) {
      throwIfStopRequested();
      correctionBtn.click();
      await sleep(1500);
      throwIfStopRequested();
      addLog('✅ กด Correction แล้ว', 'success');
    } else {
      addLog('❌ ไม่พบปุ่ม Correction', 'error');
      return;
    }

    // Correction บาง layout แสดงกรอบเฉลยไว้ช่วงนี้ แต่กด Solution แล้ว
    // จะล้าง class correct/should-be-checked ออก จึงต้องจำไว้ก่อน
    const exerciseAfterCorrection = findExercise();
    if (exerciseAfterCorrection) {
      exercise = exerciseAfterCorrection;
    }
    let correctionAnswers = [];
    if (type === 'single-choice' || type === 'multiple-choice') {
      correctionAnswers = memorizeAnswers(exercise, type);
      if (Object.keys(correctionAnswers).length > 0) {
        addLog(
          `✅ จำเฉลยจากกรอบหลัง Correction ได้ ${Object.keys(correctionAnswers).length} ข้อ`,
          'success'
        );
      }
    }

    // ขั้นตอน 2: กด Solution (magic-wand) เพื่อดูเฉลย
    addLog('📌 ขั้นตอน 2: กด Solution...', 'step');
    const solutionBtn = findSolutionButton(exercise);
    if (!solutionBtn) {
      addLog('❌ ไม่พบปุ่ม Solution ของข้อปัจจุบัน - ยกเลิกเพื่อไม่ให้จำคำตอบผิด', 'error');
      return;
    }

    const choiceStateBeforeSolution = type === 'single-choice' || type === 'multiple-choice'
      ? captureChoiceStates(exercise)
      : null;
    const solutionSnapshot = getSolutionSnapshot(exercise, type);
    throwIfStopRequested();
    solutionBtn.click();
    const solutionResult = await waitForSolutionUpdate(solutionSnapshot, type);
    throwIfStopRequested();
    if (!solutionResult.changed) {
      addLog('❌ หน้าเว็บไม่แสดงการเปลี่ยนแปลงหลัง Solution - ยกเลิกข้อนี้', 'error');
      return;
    }
    if (solutionResult.exercise) {
      exercise = solutionResult.exercise;
    }

    addLog('✅ กด Solution และพบข้อมูลเฉลยแล้ว', 'success');

    // Solution อาจ re-render exercise ใหม่ ต้องใช้ DOM ตัวล่าสุดก่อนอ่านเฉลย
    const exerciseAfterSolution = findExercise();
    if (exerciseAfterSolution) {
      exercise = exerciseAfterSolution;
    }

    // รอให้คำตอบโหลดครบทุก gap-container (สำคัญสำหรับ toggle-solution)
    addLog('⏳ รอคำตอบโหลดครบทุกช่อง...', 'info');
    await waitForAllAnswers(exercise, type);
    throwIfStopRequested();

    // ขั้นตอน 3: จำคำตอบ
    addLog('📌 ขั้นตอน 3: จำคำตอบ...', 'step');
    let answers = memorizeAnswers(exercise, type, { choiceStateBeforeSolution });

    // ให้ marker ที่ได้หลัง Correction มีสิทธิ์เหนือกว่า DOM หลัง Solution
    // เพราะเป็นเฉลยของตัวเลือกโดยตรง ไม่ใช่สถานะที่ผู้ใช้เคยเลือกไว้
    if (
      (type === 'single-choice' || type === 'multiple-choice') &&
      Object.keys(correctionAnswers).length > 0
    ) {
      answers = correctionAnswers;
      addLog('✅ ใช้เฉลยจากกรอบสีเขียวหลัง Correction', 'success');
    }

    // บาง single-choice ไม่แสดง marker หรือ checked ตอนกด Solution
    // จึงใช้คะแนนจาก Correction ทดลองหาคำตอบแทน
    if (Object.keys(answers).length === 0 && type === 'single-choice') {
      addLog('⚠️ Solution ไม่แสดง marker - ลองหาคำตอบจากคะแนน Correction...', 'warning');
      answers = await discoverSingleChoiceAnswers(exercise);
    }

    if (Object.keys(answers).length === 0) {
      addLog('⚠️ ไม่พบคำตอบจากเฉลย', 'warning');
      return;
    }

    // ขั้นตอน 4: กด Repeat
    addLog('📌 ขั้นตอน 4: กด Repeat...', 'step');
    const repeatBtn = findRepeatButton(exercise);
    if (repeatBtn) {
      throwIfStopRequested();
      repeatBtn.click();
      addLog('✅ กด Repeat แล้ว', 'success');
    } else {
      addLog('⚠️ ไม่พบปุ่ม Repeat', 'warning');
    }

    // รอให้ exercise reinitialize หลัง Repeat
    addLog('⏳ รอ exercise reinitialize...', 'info');
    await sleep(3000);
    await waitForExercise();
    throwIfStopRequested();

    // ขั้นตอน 4.5: กด Start อีกครั้ง (ถ้ามี)
    const exerciseAfterRepeat = findExercise();
    if (exerciseAfterRepeat) {
      exercise = exerciseAfterRepeat;
      const startBtnAgain = exerciseAfterRepeat.querySelector('.start-exercise, button.start-exercise, [class*="start"]');
      if (startBtnAgain) {
        addLog('📌 ขั้นตอน 4.5: กด Start อีกครั้ง...', 'step');
        throwIfStopRequested();
        startBtnAgain.click();
        await sleep(2000);
        throwIfStopRequested();
        addLog('✅ กด Start แล้ว', 'success');

        const exerciseAfterSecondStart = findExercise();
        if (exerciseAfterSecondStart) {
          exercise = exerciseAfterSecondStart;
        }
      }
    }

    // ขั้นตอน 5: ใส่คำตอบ
    addLog('📌 ขั้นตอน 5: ใส่คำตอบ...', 'step');
    throwIfStopRequested();
    // Scrambled บางหน้า render cell ไม่ครบในทันทีหลัง Start; ห้ามสลับก่อนครบ
    // เพราะการย้ายขณะมีช่องว่างทำให้ node ของประโยคอื่นหายจาก DOM ได้
    if (type === 'scrambled-sentence') {
      // บันทึก DOM ก่อนขยับ cell ทุกครั้ง เพื่อให้ Debug report แก้ปัญหาได้จากชุดเดียว
      preApplyExerciseSnapshot = captureExerciseDebugSnapshot(exercise);
      const expectedCellCount = answers.reduce((count, row) =>
        count + (row?.slots?.filter(Boolean).length || 0), 0);
      const cellsReady = await waitForScrambledCells(exercise, expectedCellCount);
      if (!cellsReady) {
        addLog(`❌ Scrambled โหลดไม่ครบ (${expectedCellCount} ประโยค) — ยกเลิกเพื่อป้องกันคำตอบหาย`, 'error');
        return;
      }
      exercise = findExercise() || exercise;
    }
    await applyAnswers(exercise, type, answers);
    throwIfStopRequested();

    // ไม่กดส่งถ้าคำตอบยังไม่ตรงกับสิ่งที่จำไว้ ป้องกันการส่งคำตอบผิดซ้ำ
    if (!verifyAnswersApplied(exercise, type, answers)) {
      addLog('⚠️ ใส่คำตอบไม่ตรงกับเฉลยที่จำไว้ - ยกเลิกการส่งข้อนี้', 'error');
      return;
    }

    // ขั้นตอน 5.5: กด Correction อีกครั้งเพื่อ submit
    addLog('📌 ขั้นตอน 5.5: กด Correction เพื่อ submit...', 'step');
    await sleep(1000);
    throwIfStopRequested();
    const correctionBtnAgain = findCorrectionButton(exercise);
    if (correctionBtnAgain) {
      throwIfStopRequested();
      correctionBtnAgain.click();
      await sleep(2000);
      throwIfStopRequested();
      addLog('✅ กด Correction (submit) แล้ว', 'success');
    } else {
      addLog('⚠️ ไม่พบปุ่ม Correction สำหรับ submit', 'warning');
    }

    exerciseCount++;
    recordCompletedExercise();
    addLog(`✅ ทำเสร็จแล้ว! (รวม ${exerciseCount} ข้อ)`, 'success');
  }

  // ============================================================
  // ANSWER HELPERS
  // ============================================================
  function normalizeAnswer(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  // Speexx บางหน้าใช้ placeholder ซ้อนกันหลายชั้น เช่น
  // .drag-drop-placeholder > .placeholder ทำให้ selector เดิมนับ 1 ช่องเป็น 2 ช่อง
  function getDragDropPlaceholders(exercise) {
    if (!exercise) return [];

    const withoutDraggables = elements => elements.filter(element =>
      !element.closest('.draggable-container')
    );

    const exactPlaceholders = withoutDraggables(
      Array.from(exercise.querySelectorAll('.drag-drop-placeholder'))
    );

    // ถ้ามี class หลัก ให้ใช้เฉพาะ class หลักก่อน เพื่อไม่เก็บ wrapper .placeholder ซ้ำ
    if (exactPlaceholders.length > 0) {
      return exactPlaceholders.filter((element, index, elements) =>
        !elements.some((parent, parentIndex) =>
          parentIndex !== index && parent.contains(element)
        )
      );
    }

    const candidates = withoutDraggables(
      Array.from(exercise.querySelectorAll('[class*="placeholder"]'))
    );

    // กรณีไม่มี .drag-drop-placeholder ให้เลือกเฉพาะ placeholder ชั้นนอกสุด
    return candidates.filter((element, index, elements) =>
      !elements.some((parent, parentIndex) =>
        parentIndex !== index && parent.contains(element)
      )
    );
  }

  function getImageSources(element) {
    if (!element) return [];

    const sources = [];
    const addSource = value => {
      const source = String(value || '').trim();
      if (source && !sources.includes(source)) sources.push(source);
    };

    const images = element.matches('img')
      ? [element]
      : Array.from(element.querySelectorAll('img'));

    images.forEach(image => {
      addSource(image.getAttribute('src'));
      addSource(image.currentSrc);
      addSource(image.getAttribute('data-src'));
      addSource(image.getAttribute('data-original'));
    });

    // บางเวอร์ชันแสดงรูปเป็น background-image แทน <img>
    const styledNodes = element.matches('[style*="background-image"]')
      ? [element]
      : Array.from(element.querySelectorAll('[style*="background-image"]'));
    styledNodes.forEach(node => {
      const style = node.getAttribute('style') || '';
      const matches = style.matchAll(/url\((?:"|')?([^"')]+)(?:"|')?\)/gi);
      for (const match of matches) addSource(match[1]);
    });

    return sources;
  }

  function getImageName(source) {
    const rawSource = String(source || '').trim();
    if (!rawSource) return '';

    try {
      const url = new URL(rawSource, document.baseURI);
      const pathname = decodeURIComponent(url.pathname).replace(/\\/g, '/');
      return pathname.split('/').filter(Boolean).pop()?.toLowerCase() || '';
    } catch (error) {
      return rawSource
        .split(/[?#]/, 1)[0]
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .pop()
        ?.toLowerCase() || '';
    }
  }

  function getDropAnswerElements(element) {
    if (!element) return [];

    const elements = [];
    const addElement = candidate => {
      if (!candidate || elements.includes(candidate)) return;
      if (candidate.matches('.drag-drop, img')) elements.push(candidate);
    };

    addElement(element);
    element.querySelectorAll?.('.drag-drop, img').forEach(addElement);
    addElement(element.nextElementSibling);
    addElement(element.previousElementSibling);
    return elements;
  }

  function imageSourceMatches(actualSource, expectedSource) {
    const actual = String(actualSource || '').trim();
    const expected = String(expectedSource || '').trim();
    if (!actual || !expected) return false;
    if (actual === expected) return true;

    const actualName = getImageName(actual);
    const expectedName = getImageName(expected);
    return Boolean(actualName && expectedName && actualName === expectedName);
  }

  function getDragLabel(element) {
    const imageName = getImageName(getImageSources(element)[0]);
    return imageName || getAnswerValue(element);
  }

  function getScrambledRows(exercise) {
    const itemsRoot = exercise?.querySelector('.exercise-items');
    if (!itemsRoot) return [];

    return Array.from(itemsRoot.children)
      .filter(item => item.matches('.item'))
      .flatMap(item => {
        // Structure 1: .scrambled-cell-container > .scrambled-cell (column-based)
        const containers = Array.from(
          item.querySelectorAll('.scrambled-cell-container')
        );
        const cells = containers
          .map(container => container.querySelector('.scrambled-cell'))
          .filter(Boolean);

        if (cells.length > 0) {
          return [{ item, containers, cells }];
        }

        // Structure 2: .scrambled-sentence > .scrambled-block (sentence-based)
        // ★ รองรับหลาย .scrambled-sentence ต่อ 1 .item (เช่น 2 แถว: ถาม + ตอบ)
        const sentences = Array.from(item.querySelectorAll('.scrambled-sentence'));
        if (sentences.length > 0) {
          return sentences.map(sentence => {
            const blocks = Array.from(sentence.querySelectorAll('.scrambled-block'));
            return { item, containers: [sentence], cells: blocks, sentenceBased: true };
          }).filter(row => row.cells.length > 0);
        }

        return [];
      })
      .filter(row => row.cells.length > 0);
  }

  // รอให้ Scrambled render cell ครบตามเฉลยก่อนเริ่มย้าย
  // ปรับ maxWait ได้ที่นี่ หากหน้า Speexx โหลดช้ากว่าปกติ
  async function waitForScrambledCells(exercise, expectedCount, maxWait = 12000) {
    const startedAt = Date.now();
    let lastCount = -1;
    while (Date.now() - startedAt < maxWait) {
      throwIfStopRequested();
      const currentExercise = findExercise() || exercise;
      const currentCount = getScrambledRows(currentExercise)
        .reduce((count, row) => count + row.cells.length, 0);
      if (currentCount >= expectedCount) return true;
      if (currentCount !== lastCount) {
        addLog(`⏳ รอ Scrambled โหลดครบ: พบ ${currentCount}/${expectedCount} ประโยค`, 'info');
        lastCount = currentCount;
      }
      await sleep(500);
    }
    return false;
  }

  function getScrambledCellAnswer(cell) {
    if (!cell) return null;

    const ids = Array.from(cell.querySelectorAll('[data-word-id]'))
      .map(element => element.getAttribute('data-word-id'))
      .filter(Boolean);
    // ใช้ data-word-id เป็นหลักสำหรับจับคู่คำ
    // data-scrambled-block-id / data-scrambled-cell-id เป็นแค่ ID ตำแหน่ง ไม่ใช่ ID คำ
    const ownId = cell.getAttribute('data-word-id') ||
      cell.getAttribute('data-word');
    if (ownId && !ids.includes(ownId)) ids.unshift(ownId);

    // เก็บ block-id แยกไว้สำหรับ fallback matching (ไม่ใช่ ID หลัก)
    const blockId = cell.getAttribute('data-scrambled-block-id') ||
      cell.getAttribute('data-scrambled-cell-id') || '';

    // อ่านค่าจากหลายแหล่ง เพื่อให้ได้ข้อความแม้ cell มีโครงสร้างซับซ้อน
    let value = normalizeAnswer(cell.textContent);
    if (!value) {
      // ลองอ่านจาก .word หรือ .scrambled-word
      const wordEl = cell.querySelector('.word, .scrambled-word, [data-word]');
      value = normalizeAnswer(wordEl?.textContent || '');
    }
    if (!value) {
      // ลองอ่านจาก attribute ที่อาจเก็บคำตอบ
      value = normalizeAnswer(
        cell.getAttribute('data-word') ||
        cell.getAttribute('data-answer') ||
        cell.getAttribute('data-value') ||
        ''
      );
    }

    // ถ้าไม่มี id และไม่มี value จริงๆ ให้คืน null
    if (ids.length === 0 && !value) return null;

    return {
      id: ids[0] || null,
      ids,
      val: value,
      blockId: blockId || null
    };
  }

  function scrambledCellMatches(cell, expected) {
    if (!cell || !expected) return false;

    const actual = getScrambledCellAnswer(cell);
    return scrambledAnswersMatch(actual, expected);
  }

  function scrambledAnswersMatch(actual, expected) {
    if (!actual || !expected) return false;

    // ประโยคหนึ่งมีหลาย word-id และคำทั่วไปอย่าง I / Oh / the ซ้ำกันได้
    // จึงต้องเทียบข้อความเต็มก่อน มิฉะนั้นจะหยิบ cell ของอีกประโยคไปวางผิดแถว
    const expectedText = normalizeAnswer(expected.val).toLowerCase();
    const actualText = normalizeAnswer(actual.val).toLowerCase();
    if (expectedText && actualText) return actualText === expectedText;

    // ID ใช้เป็น fallback เฉพาะกรณีที่หน้าเว็บไม่ให้ข้อความมาเท่านั้น
    return Boolean(expected.id && actual.id === expected.id);
  }

  function getScrambledCellLabel(cell) {
    const answer = getScrambledCellAnswer(cell);
    if (!answer) return '(ว่าง)';
    return `${answer.val || '(ไม่มีข้อความ)'} [${answer.id || '-'}]`;
  }

  function getScrambledCellContainer(cell) {
    return cell?.closest('.scrambled-cell-container') ||
      cell?.closest('.scrambled-sentence') ||
      cell?.parentElement || null;
  }

  function notifyScrambledCellChanged(cell) {
    if (!cell) return;

    cell.dispatchEvent(new Event('input', { bubbles: true }));
    cell.dispatchEvent(new Event('change', { bubbles: true }));

    const container = getScrambledCellContainer(cell);
    container?.dispatchEvent(new Event('input', { bubbles: true }));
    container?.dispatchEvent(new Event('change', { bubbles: true }));

    if (window.jQuery) {
      window.jQuery(cell).trigger('change');
      if (container) window.jQuery(container).trigger('change');
    }
  }

  function swapScrambledCellNodes(source, target) {
    if (!source || !target || source === target) return true;

    const sourceContainer = getScrambledCellContainer(source);
    const targetContainer = getScrambledCellContainer(target);
    if (!sourceContainer || !targetContainer || sourceContainer === targetContainer) {
      return false;
    }

    // ย้าย node จริง ไม่ใช่แค่ innerHTML เพื่อให้ data-scrambled-cell-id
    // และ state ของ draggable เดิมเดินทางไปพร้อมกับคำตอบ
    const sourceMarker = document.createElement('span');
    const targetMarker = document.createElement('span');
    sourceMarker.hidden = true;
    targetMarker.hidden = true;

    sourceContainer.replaceChild(sourceMarker, source);
    targetContainer.replaceChild(targetMarker, target);
    sourceContainer.replaceChild(target, sourceMarker);
    targetContainer.replaceChild(source, targetMarker);

    notifyScrambledCellChanged(source);
    notifyScrambledCellChanged(target);
    return true;
  }

  function memorizeScrambledAnswers(exercise) {
    const answers = [];
    const rows = getScrambledRows(exercise);

    if (rows.length === 0) {
      addLog('  ⚠️ ไม่พบ scrambled rows - ลองอ่านแบบกว้างๆ...', 'warning');
      // Fallback: ลอกอ่านเฉลยจาก cell แบบกว้างๆ ถ้า getScrambledRows ไม่เจอ
      // (หน้าเว็บอาจใช้ selector อื่นหลัง Solution)
      const allCells = Array.from(exercise.querySelectorAll(
        '.scrambled-cell, .scrambled-word, [data-word-id], .word'
      ));
      addLog(`  📋 พบ ${allCells.length} cells แบบกว้าง`, 'info');
      return answers;
    }

    rows.forEach((row, rowIndex) => {
      const slots = row.cells.map(getScrambledCellAnswer);
      // ใช้ some แทน every - ถ้ามี cell ว่างบางช่อง ยังเก็บแถวที่มีเฉลยได้
      // โดยใส่ null ในช่องที่ไม่มีเฉลย
      const validSlots = slots.filter(Boolean);
      if (validSlots.length > 0) {
        answers[rowIndex] = { slots };
        addLog(
          `  📝 จำเฉลย scrambled แถวที่ ${rowIndex + 1}: ${validSlots.map(slot => slot.val).join(' | ')} (${validSlots.length}/${slots.length} ช่อง)`,
          'answer'
        );
      } else {
        addLog(`  ⚠️ แถวที่ ${rowIndex + 1} ไม่พบเฉลยเลย`, 'warning');
      }
    });

    return answers;
  }

  function getChoiceLabel(input) {
    if (!input) return '';
    const associatedLabel = input.id
      ? Array.from(document.querySelectorAll('label')).find(label => label.htmlFor === input.id)
      : null;
    const labelElement = associatedLabel ||
      input.closest('label') ||
      input.parentElement;
    return normalizeAnswer(labelElement?.textContent);
  }

  function getChoiceOptionId(input) {
    return input?.getAttribute('data-choice-option-id') || input?.value || '';
  }

  function getChoiceWordId(input) {
    return input?.closest('label')?.querySelector('.word')?.getAttribute('data-word-id') || '';
  }

  function getChoiceStateKey(input) {
    return input?.getAttribute('data-choice-option-id') ||
      `${input?.name || ''}:${input?.value || ''}`;
  }

  function captureChoiceStates(exercise) {
    return new Map(
      Array.from(exercise.querySelectorAll('input[type="radio"], input[type="checkbox"]'))
        .map(input => [getChoiceStateKey(input), {
          checked: input.checked,
          disabled: input.disabled
        }])
    );
  }

  function getAnswerValue(element, options = {}) {
    if (!element) return '';

    if (element.matches('input, textarea, select')) {
      return normalizeAnswer(element.value);
    }

    // สำหรับ drag-drop เราต้องการวลีเต็ม (เช่น "at an airport") ไม่ใช่แค่
    // ข้อความใน .word ที่อาจเป็นเพียงส่วนหนึ่งของวลี (เช่น "at") จึงข้ามการ
    // อ่าน .word.textContent และอ่านข้อความทั้งหมดของ element แทน
    if (!options.fullText) {
      const word = element.querySelector('.word');
      if (word) {
        return normalizeAnswer(word.textContent);
      }
    }

    return normalizeAnswer(element.textContent);
  }

  // ช่องแบบ toggle อาจมี .word เก็บเพียงคำแรก เช่น "want" แต่คำตอบจริง
  // คือทั้งวลี "want to do" จึงต้องอ่าน text ทั้งช่องเสมอ
  function getToggleGapValue(gap) {
    return getAnswerValue(gap, { fullText: true });
  }

  function getSolutionSnapshot(exercise, type) {
    if (!exercise) return '';

    if (type === 'drag-drop' || type === 'picture-choice') {
      return getDragDropPlaceholders(exercise)
        .map(element => element.outerHTML)
        .join('|');
    }

    if (type === 'scrambled-sentence') {
      // ใช้เฉพาะเนื้อหา (text + word-id + class marker) แทน outerHTML ทั้งหมด
      // เพราะ outerHTML รวม style ที่อาจเปลี่ยนจาก hover/focus ทำให้ snapshot
      // ไม่คงที่ และบางครั้ง Solution แค่เพิ่ม class marker โดยไม่ย้าย cell
      return getScrambledRows(exercise)
        .map(row => row.cells.map(cell => {
          const answer = getScrambledCellAnswer(cell);
          const marker = [
            cell.classList.contains('correct') ? 'correct' : '',
            cell.classList.contains('should-be-checked') ? 'should-be-checked' : '',
            cell.classList.contains('wrong') ? 'wrong' : '',
            cell.getAttribute('data-correct') || ''
          ].filter(Boolean).join(',');
          return `${answer?.id || ''}:${answer?.val || ''}:${marker}:${cell.className}`;
        }).join('|'))
        .join('||');
    }

    if (type === 'fill-text-toggle' || type === 'toggle-solution') {
      return Array.from(exercise.querySelectorAll('.gap.form-control, .gap'))
        .map(element => element.outerHTML)
        .join('|');
    }

    if (type === 'answer' || type === 'fill-text') {
      return Array.from(exercise.querySelectorAll(
        'input[type="text"], input:not([type]), textarea'
      )).map(input => `${input.value}|${input.className}|${input.outerHTML}`).join('|');
    }

    if (type === 'single-choice' || type === 'multiple-choice') {
      return Array.from(exercise.querySelectorAll(
        'input[type="radio"], input[type="checkbox"]'
      )).map(input => {
        const label = getChoiceLabel(input);
        const labelElement = input.id
          ? Array.from(document.querySelectorAll('label')).find(item => item.htmlFor === input.id)
          : input.closest('label') || input.parentElement;
        return `${input.checked}|${getChoiceOptionId(input)}|${getChoiceWordId(input)}|${input.className}|${labelElement?.className || ''}|${label}`;
      }).join('|');
    }

    if (type === 'mark-text') {
      const markedGroups = exercise.querySelectorAll('.mark-text.marked-text');
      return Array.from(markedGroups).map(group => {
        const words = group.querySelectorAll('.word');
        const wordIds = Array.from(words).map(w => w.getAttribute('data-word-id') || w.textContent).join(',');
        return `marked:${wordIds}|${group.className}`;
      }).join('||');
    }

    return exercise.innerHTML;
  }

  async function waitForSolutionUpdate(previousSnapshot, type, maxWait = 12000) {
    const start = Date.now();
    // รอให้หน้าเว็บเริ่มประมวลผล Solution
    await sleep(800);

    while (Date.now() - start < maxWait) {
      const exercise = findExercise();
      if (exercise) {
        const currentSnapshot = getSolutionSnapshot(exercise, type);
        // ตรวจ snapshot เนื้อหาก่อน
        if (currentSnapshot !== previousSnapshot) {
          return { changed: true, exercise };
        }
        // ตรวจสัญญาณอื่นๆ ที่บอกว่า Solution แสดงเฉลยแล้ว (สำหรับกรณี
        // ที่เนื้อหาไม่เปลี่ยนแต่หน้าเว็บเพิ่ม marker/ไฮไลต์)
        if (hasSolutionMarkers(exercise, type)) {
          return { changed: true, exercise };
        }
      }
      await sleep(300);
    }

    return { changed: false, exercise: findExercise() };
  }

  // ตรวจสอบสัญญาณว่า Solution แสดงเฉลยแล้ว (marker/ไฮไลต์/class)
  function hasSolutionMarkers(exercise, type) {
    if (!exercise) return false;

    // ตรวจ class markers ที่ Speexx ใช้บ่อย
    const solutionMarkers = exercise.querySelectorAll(
      '.correct, .should-be-checked, .correct-answer, .wrong, .is-correct, .solution-shown, .show-solution'
    );
    if (solutionMarkers.length > 0) return true;

    // ตรวจ attributes ที่บอกว่าถูกต้อง
    const correctAttrs = exercise.querySelectorAll('[data-correct="true"], [data-correct="1"]');
    if (correctAttrs.length > 0) return true;

    // ตรวจ disabled state (Solution มักจะ lock การป้อนข้อมูล)
    if (type === 'scrambled-sentence') {
      const cells = exercise.querySelectorAll('.scrambled-cell, .scrambled-block');
      if (cells.length > 0) {
        const anyDisabled = Array.from(cells).some(cell =>
          cell.classList.contains('disabled') ||
          cell.classList.contains('ui-draggable-disabled') ||
          cell.classList.contains('ui-sortable-disabled') ||
          cell.getAttribute('aria-disabled') === 'true'
        );
        if (anyDisabled) return true;
      }
    }

    // ตรวจ mark-text (words ที่ถูก mark จะมี class marked-text)
    if (type === 'mark-text') {
      const markedGroups = exercise.querySelectorAll('.mark-text.marked-text');
      if (markedGroups.length > 0) return true;
    }

    // ตรวจ disabled backdrop (Speexx มักใช้หลัง Solution/Correction)
    if (exercise.querySelector('.disabled-backdrop, .exercise-items.disabled, .exercise.disabled')) {
      return true;
    }

    return false;
  }

  function getPlacedAnswer(element) {
    if (!element) return null;

    const answerElement = getDropAnswerElements(element)[0];
    if (!answerElement) return null;

    const word = answerElement.querySelector('.word');
    const wordId = word?.getAttribute('data-word-id') ||
      answerElement.getAttribute('data-word-id');
    const imageSources = getImageSources(answerElement);
    const imageSrc = imageSources.find(source =>
      !source.toLowerCase().startsWith('data:')
    ) || imageSources[0] || '';
    // อ่านวลีเต็มของคำตอบ (fullText) แทนที่จะเป็นแค่ข้อความใน .word
    // ตัวอย่าง: placeholder อาจมี .word ที่บรรจุเฉพาะคำว่า "at"
    // แต่คำตอบจริงคือวลีเต็ม "at an airport"
    const value = getAnswerValue(answerElement, { fullText: true });
    // สำรอง: ถ้า fullText กลับมาเป็นค่าว่าง ให้ลองอ่านจาก .word
    const fallbackValue = (!value && word)
      ? normalizeAnswer(word.textContent)
      : value;

    if (!wordId && !imageSrc && !fallbackValue) return null;

    return {
      type: imageSrc ? 'img' : 'text',
      id: wordId || null,
      src: imageSrc || null,
      imageName: getImageName(imageSrc) || null,
      val: fallbackValue
    };
  }

  // ============================================================
  // MEMORIZE ANSWERS - เก็บคำตอบจากหน้าที่กด Solution
  // ============================================================
  function memorizeAnswers(exercise, type, options = {}) {
    const answers = [];

    if (type === 'scrambled-sentence') {
      return memorizeScrambledAnswers(exercise);
    }

    if (type === 'drag-drop' || type === 'picture-choice') {
      const placeholders = getDragDropPlaceholders(exercise);

      placeholders.forEach((placeholder, index) => {
        const answer = getPlacedAnswer(placeholder);
        if (answer) {
          answers[index] = answer;
          addLog(`  📝 จำคำตอบช่องที่ ${index + 1}: "${answer.imageName || answer.val || answer.src}"`, 'answer');
        }
      });

      // บางรูปแบบไม่มี class placeholder แต่ยังมีคำตอบอยู่ใน item
      if (answers.length === 0) {
        const items = exercise.querySelectorAll('.exercise-items .item');
        items.forEach(item => {
          item.querySelectorAll('.drag-drop:not(.draggable-container)').forEach(element => {
            if (element.closest('.draggable-container')) return;
            const answer = getPlacedAnswer(element);
            if (answer) answers.push(answer);
          });
        });
      }
      return answers;
    }

    if (type === 'fill-text-toggle' || type === 'toggle-solution') {
      const gaps = exercise.querySelectorAll('.gap-container .gap, .gap.form-control, .gap');
      gaps.forEach((gap, index) => {
        const answer = getToggleGapValue(gap);
        if (answer && answer.length < 100) {
          answers[index] = answer;
          addLog(`  📝 จำคำตอบช่องที่ ${index + 1}: "${answer}"`, 'answer');
        }
      });
      return answers;
    }

    if (type === 'answer' || type === 'fill-text') {
      const inputs = exercise.querySelectorAll('input[type="text"], input:not([type]), textarea');
      inputs.forEach((input, index) => {
        const answer = getAnswerValue(input) ||
          normalizeAnswer(input.getAttribute('data-answer'));
        if (answer) {
          answers[index] = answer;
          addLog(`  📝 จำคำตอบช่องที่ ${index + 1}: "${answer}"`, 'answer');
        }
      });
      return answers;
    }

    if (type === 'single-choice' || type === 'multiple-choice') {
      const inputs = exercise.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      const choiceItems = Array.from(exercise.querySelectorAll('.choice-item'));
      const isSolutionState = Boolean(
        exercise.querySelector('.exercise-items.disabled, .disabled-backdrop') ||
        Array.from(inputs).some(input => input.disabled)
      );

      inputs.forEach((input, index) => {
        const label = input.id
          ? Array.from(document.querySelectorAll('label')).find(label => label.htmlFor === input.id)
          : null;
        const labelElement = label || input.closest('label') || input.parentElement;
        const rowIndex = choiceItems.indexOf(input.closest('.choice-item'));
        const isMarkedCorrect = labelElement?.matches(
          'label.should-be-checked, label.correct-answer, label.correct'
        ) ||
          input.matches('.should-be-checked, .correct, [data-correct="true"]') ||
          input.getAttribute('data-correct') === 'true' ||
          labelElement?.classList.contains('correct-answer') ||
          labelElement?.classList.contains('correct');
        // บางหน้าไม่มี marker ใน HTML แต่ Solution จะเปลี่ยน property checked
        // และเติม .disabled/.disabled-backdrop แทน จึงใช้ checked เฉพาะตัวที่
        // เปลี่ยนจากสถานะก่อนกด Solution ป้องกันการนำคำตอบเดิมมาใช้เป็นเฉลย
        const beforeSolution = options.choiceStateBeforeSolution?.get(
          getChoiceStateKey(input)
        );
        const checkedChangedBySolution = Boolean(
          isSolutionState &&
          beforeSolution &&
          beforeSolution.checked !== input.checked
        );
        const isCorrect = isMarkedCorrect || (checkedChangedBySolution && input.checked);

        if (isCorrect) {
          // ★ เก็บ image src สำหรับ picture-choice (label เป็นรูป ไม่ใช่ text)
          const pictureImg = labelElement?.querySelector('img');
          const imageSrc = pictureImg?.getAttribute('src') || '';
          answers.push({
            index,
            rowIndex,
            name: input.name,
            value: input.value,
            optionId: getChoiceOptionId(input),
            wordId: getChoiceWordId(input),
            label: normalizeAnswer(labelElement?.textContent),
            imageSrc
          });
          addLog(`  📝 จำเฉลยตัวเลือก: "${getChoiceLabel(input)}" [${getChoiceOptionId(input)} / word ${getChoiceWordId(input)}]${imageSrc ? ' 📷' : ''}${isMarkedCorrect ? '' : ' (checked เปลี่ยนหลัง Solution)'}`, 'answer');
        }
      });
      return answers;
    }

    if (type === 'mark-text') {
      // หา grouped ที่ถูก mark แล้ว (.mark-text.marked-text)
      const markedGroups = exercise.querySelectorAll('.mark-text.marked-text');
      addLog(`📋 พบ ${markedGroups.length} กลุ่มคำที่ถูก mark`, 'info');

      markedGroups.forEach((group, groupIndex) => {
        const words = Array.from(group.querySelectorAll('.word'));
        const wordIds = words.map(w => w.getAttribute('data-word-id')).filter(Boolean);
        const wordTexts = words.map(w => w.textContent).filter(Boolean);
        answers.push({
          groupIndex,
          wordIds,
          wordTexts,
          text: wordTexts.join(' ')
        });
        addLog(`  📝 จำเฉลย mark กลุ่ม ${groupIndex + 1}: "${wordTexts.join(' ')}" [word-ids: ${wordIds.join(',')}`, 'answer');
      });
      return answers;
    }

    addLog(`⚠️ ยังไม่มีตัวอ่านเฉลยสำหรับประเภท ${type}`, 'warning');
    return answers;
  }

  // ============================================================
  // APPLY ANSWERS
  // ============================================================
  async function applyAnswers(exercise, type, answers) {
    if (type === 'drag-drop' || type === 'picture-choice') {
      await applyDragDropAnswers(exercise, answers);
      return;
    }

    if (type === 'scrambled-sentence') {
      await applyScrambledAnswers(exercise, answers);
      return;
    }

    if (type === 'fill-text-toggle' || type === 'toggle-solution') {
      await applyFillTextToggleAnswers(exercise, answers);
      return;
    }

    if (type === 'answer' || type === 'fill-text') {
      await applyAnswerTypeAnswers(exercise, answers);
      return;
    }

    if (type === 'single-choice' || type === 'multiple-choice') {
      await applyChoiceAnswers(exercise, answers);
      return;
    }

    if (type === 'mark-text') {
      await applyMarkTextAnswers(exercise, answers);
      return;
    }

    addLog(`⚠️ ยังไม่มีวิธีใส่คำตอบสำหรับประเภท ${type}`, 'warning');
  }

  async function applyChoiceAnswers(exercise, answers) {
    const inputs = Array.from(
      exercise.querySelectorAll('input[type="radio"], input[type="checkbox"]')
    );
    const wanted = Array.isArray(answers) ? answers : Object.values(answers || {});
    const choiceItems = Array.from(exercise.querySelectorAll('.choice-item'));
    const rowIndexByInput = new Map(
      inputs.map(input => [
        input,
        choiceItems.indexOf(input.closest('.choice-item'))
      ])
    );

    addLog(`📋 พบ ${inputs.length} ตัวเลือก`, 'info');

    inputs.forEach((input, index) => {
      const label = getChoiceLabel(input);
      const optionId = getChoiceOptionId(input);
      const wordId = getChoiceWordId(input);
      const rowIndex = rowIndexByInput.get(input);
      const shouldBeChecked = wanted.some(answer => {
        if (
          answer.rowIndex !== undefined &&
          answer.rowIndex !== rowIndex
        ) {
          return false;
        }
        if (answer.optionId) {
          // optionId เป็น ID เฉพาะของตัวเลือก ห้ามใช้ wordId มารวมกัน
          // เพราะคำว่า True/False ใช้ wordId เดิมซ้ำทุกข้อ
          if (answer.optionId === optionId) return true;
          // หลัง Repeat เว็บอาจสร้าง optionId ใหม่ จึงใช้ลำดับข้อ
          // และ wordId/ข้อความ/imageSrc เป็น fallback เฉพาะแถวเดียวกัน
          if (answer.rowIndex === rowIndex) {
            // label เต็มแยกตัวเลือกได้ เช่น because it's quiet.
            if (answer.label) {
              return normalizeAnswer(answer.label) === label;
            }
            // ★ picture-choice: จับคู่ด้วย image src
            if (answer.imageSrc) {
              const currentImg = input.closest('label')?.querySelector('img');
              const currentSrc = currentImg?.getAttribute('src') || '';
              if (currentSrc && currentSrc === answer.imageSrc) return true;
            }
            return Boolean(answer.wordId && answer.wordId === wordId);
          }
          return false;
        }
        if (answer.wordId) return answer.wordId === wordId;
        if (answer.name && answer.value) {
          return answer.name === input.name && answer.value === input.value;
        }
        if (answer.label) return normalizeAnswer(answer.label) === label;
        return answer.index === index;
      });

      if (input.type === 'radio') {
        // Radio ห้ามคลิกตัวเลือกผิด เพราะ event ของหน้าเว็บอาจเปลี่ยนคำตอบทันที
        if (shouldBeChecked && !input.checked) {
          input.click();
          if (!input.checked) input.closest('label')?.click();
        }
      } else if (input.checked !== shouldBeChecked) {
        // Checkbox ต้องสลับสถานะเฉพาะตัวที่ไม่ตรงกับเฉลย
        input.click();
        if (input.checked !== shouldBeChecked) input.closest('label')?.click();
      }

      // ตรวจซ้ำและแจ้ง framework หาก browser ไม่เปลี่ยน native state
      if (input.checked !== shouldBeChecked) {
        input.checked = shouldBeChecked;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (shouldBeChecked) {
        addLog(`✅ เลือก: "${label || input.value}" [${optionId} / word ${wordId}]`, 'success');
      }
    });

    await sleep(300);
  }

  function getChoiceRows(exercise) {
    return Array.from(exercise?.querySelectorAll('.choice-item') || [])
      .map(item => ({
        item,
        inputs: Array.from(item.querySelectorAll(
          'input[type="radio"], input[type="checkbox"]'
        ))
      }))
      .filter(row => row.inputs.length > 0);
  }

  function getVisibleCorrectionResult(exercise = findExercise()) {
    return Array.from(exercise?.querySelectorAll(
      '.result-badge-text[data-result], .result-badge-text'
    ) || []).find(element => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        element.getClientRects().length > 0;
    });
  }

  function getCorrectionScore(exercise) {
    const resultElement = getVisibleCorrectionResult(exercise);
    if (!resultElement) return null;

    const rawScore = resultElement.getAttribute('data-result') ||
      resultElement.textContent;
    const score = Number.parseFloat(
      String(rawScore || '').replace(',', '.')
    );
    return Number.isFinite(score) ? score : null;
  }

  function getCorrectionResultState(element) {
    if (!element) return null;
    return {
      element,
      score: getCorrectionScore(element.closest('.exercise') || findExercise()),
      dataResult: element.getAttribute('data-result') || '',
      text: normalizeAnswer(element.textContent),
      className: element.className || ''
    };
  }

  async function waitForCorrectionScore(previousState = null, maxWait = 9000) {
    const start = Date.now();

    // หลัง Correction หน้าเว็บอาจยังแสดง badge เก่าชั่วคราว
    await sleep(750);

    while (Date.now() - start < maxWait) {
      throwIfStopRequested();
      const exercise = findExercise();
      const resultElement = getVisibleCorrectionResult(exercise);
      const state = getCorrectionResultState(resultElement);
      const isNewResult = Boolean(
        state &&
        (!previousState ||
          state.element !== previousState.element ||
          state.dataResult !== previousState.dataResult ||
          state.text !== previousState.text ||
          state.className !== previousState.className)
      );

      if (isNewResult && state.score !== null) {
        return { exercise, score: state.score };
      }
      await sleep(250);
    }

    // ถ้าเว็บใช้ element เดิมและคะแนนเดิมจริง ๆ จะไม่มีสัญญาณว่า DOM เปลี่ยน
    // แต่ยังคืนคะแนนล่าสุดได้ พร้อมแจ้ง log เพื่อไม่ให้เดาเป็น False เงียบ ๆ
    const exercise = findExercise();
    const score = getCorrectionScore(exercise);
    if (score !== null) {
      addLog('⚠️ คะแนน Correction ไม่ส่งสัญญาณ DOM ใหม่ ใช้คะแนนล่าสุดหลังรอครบเวลา', 'warning');
    }
    return { exercise, score };
  }

  async function waitForChoiceReady(maxWait = 12000) {
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      throwIfStopRequested();
      const exercise = findExercise();
      const rows = getChoiceRows(exercise);
      const hasEnabledInput = rows.some(row =>
        row.inputs.some(input => !input.disabled)
      );
      const isLocked = Boolean(
        exercise?.querySelector('.exercise-items.disabled, .disabled-backdrop')
      );
      const hasCorrection = Boolean(findCorrectionButton(exercise));
      if (rows.length > 0 && hasEnabledInput && !isLocked && hasCorrection) {
        return exercise;
      }
      await sleep(300);
    }

    addLog('❌ รอ radio กลับมาใช้งานไม่สำเร็จ', 'error');
    return null;
  }

  async function resetChoiceForTrial(exercise) {
    throwIfStopRequested();
    const repeatBtn = findRepeatButton(exercise);
    if (!repeatBtn) {
      // บาง single-choice แบบไม่มีปุ่ม Repeat หลัง Solution
      // radio ยังอยู่ในข้อเดิมและ Correction สามารถตรวจซ้ำได้
      const currentExercise = await waitForChoiceReady();
      if (currentExercise) {
        addLog('ℹ️ ไม่มีปุ่ม Repeat - ทดลองคำตอบบนข้อเดิม', 'info');
        return currentExercise;
      }
      addLog('❌ ไม่พบปุ่ม Repeat และ radio ยังไม่พร้อมทดลอง', 'error');
      return null;
    }

    repeatBtn.click();
    await sleep(1500);
    await waitForExercise();
    throwIfStopRequested();

    let currentExercise = await waitForChoiceReady();
    const startBtn = currentExercise?.querySelector(
      '.start-exercise, button.start-exercise, [class*="start"]'
    );
    if (startBtn) {
      startBtn.click();
      await sleep(1000);
      currentExercise = await waitForChoiceReady();
    }

    return currentExercise;
  }

  async function submitChoiceTrial(exercise, answers) {
    const currentExercise = findExercise() || exercise;
    await applyChoiceAnswers(currentExercise, answers);
    throwIfStopRequested();

    addLog(
      `  🧪 สถานะทดลอง: ${getChoiceRows(currentExercise).map((row, index) => {
        const selected = row.inputs.find(input => input.checked);
        return `${index + 1}=${selected ? getChoiceLabel(selected) : '-'}`;
      }).join(' | ')}`,
      'info'
    );

    const correctionBtn = findCorrectionButton(currentExercise);
    if (!correctionBtn) {
      addLog('❌ ไม่พบปุ่ม Correction สำหรับทดลองคำตอบ', 'error');
      return { exercise: currentExercise, score: null };
    }

    const previousState = getCorrectionResultState(
      getVisibleCorrectionResult(currentExercise)
    );
    correctionBtn.click();
    return waitForCorrectionScore(previousState);
  }

  async function discoverSingleChoiceAnswers(exercise) {
    let currentExercise = await resetChoiceForTrial(exercise);
    if (!currentExercise) return [];

    let rows = getChoiceRows(currentExercise);
    if (rows.length === 0 || rows.some(row => row.inputs.length < 2)) {
      addLog('⚠️ ไม่พบ single-choice ที่มีตัวเลือกอย่างน้อย 2 ตัวเลือกต่อข้อ', 'warning');
      return [];
    }

    const optionLabels = rows.map(row => row.inputs.map(getChoiceLabel));
    const baselineOptionIndexes = optionLabels.map(labels => labels.length - 1);
    const baselineAnswers = optionLabels.map((labels, index) => ({
      index,
      rowIndex: index,
      optionIndex: baselineOptionIndexes[index],
      label: labels[baselineOptionIndexes[index]]
    }));

    addLog(
      `🧪 ทดลองเลือกตัวเลือกท้ายสุดเป็นค่าพื้นฐาน (${baselineOptionIndexes.map((index, rowIndex) =>
        `${rowIndex + 1}:${optionLabels[rowIndex][index]}`
      ).join(' | ')})...`,
      'info'
    );
    let result = await submitChoiceTrial(currentExercise, baselineAnswers);
    if (result.score === null) {
      addLog('❌ อ่านคะแนนจาก Correction ไม่ได้ จึงไม่เดาคำตอบ', 'error');
      return [];
    }

    const baselineScore = result.score;
    addLog(`📊 คะแนนพื้นฐาน: ${baselineScore}`, 'info');
    const discoveredAnswers = [];

    for (let rowIndex = 0; rowIndex < optionLabels.length; rowIndex++) {
      throwIfStopRequested();
      const baselineOptionIndex = baselineOptionIndexes[rowIndex];
      let answerFound = false;

      // ทดลองตัวเลือกอื่นทีละตัว เมื่อเทียบกับ baseline ตัวท้าย
      for (let optionIndex = 0; optionIndex < optionLabels[rowIndex].length; optionIndex++) {
        if (optionIndex === baselineOptionIndex) continue;
        throwIfStopRequested();

        // Correction ทำให้บางเว็บล็อก exercise จึงต้อง Repeat ใหม่
        // ก่อนทดลองตัวเลือกถัดไปทุกครั้ง
        currentExercise = await resetChoiceForTrial(result.exercise || currentExercise);
        if (!currentExercise) return [];

        const trialAnswers = optionLabels.map((labels, index) => ({
          index,
          rowIndex: index,
          optionIndex: baselineOptionIndexes[index],
          label: labels[baselineOptionIndexes[index]]
        }));
        trialAnswers[rowIndex] = {
          index: rowIndex,
          rowIndex,
          optionIndex,
          label: optionLabels[rowIndex][optionIndex]
        };

        addLog(`🧪 ทดลองข้อที่ ${rowIndex + 1}: "${optionLabels[rowIndex][optionIndex]}"`, 'info');
        result = await submitChoiceTrial(currentExercise, trialAnswers);
        if (result.score === null) {
          addLog(`❌ อ่านคะแนนทดลองข้อที่ ${rowIndex + 1} ไม่ได้`, 'error');
          return [];
        }

        if (result.score > baselineScore) {
          discoveredAnswers.push({
            index: rowIndex,
            rowIndex,
            optionIndex,
            label: optionLabels[rowIndex][optionIndex]
          });
          addLog(`✅ เฉลยข้อที่ ${rowIndex + 1}: "${optionLabels[rowIndex][optionIndex]}"`, 'success');
          answerFound = true;
          break;
        }

        if (result.score < baselineScore) {
          discoveredAnswers.push({
            index: rowIndex,
            rowIndex,
            optionIndex: baselineOptionIndex,
            label: optionLabels[rowIndex][baselineOptionIndex]
          });
          addLog(`✅ เฉลยข้อที่ ${rowIndex + 1}: "${optionLabels[rowIndex][baselineOptionIndex]}"`, 'success');
          answerFound = true;
          break;
        }

        // คะแนนเท่ากันยังสรุปไม่ได้ ให้ทดลองตัวเลือกถัดไปของข้อเดียวกัน
        currentExercise = result.exercise || currentExercise;
      }

      if (!answerFound) {
        addLog(`❌ คะแนนข้อที่ ${rowIndex + 1} ไม่เปลี่ยน จึงยืนยันเฉลยไม่ได้`, 'error');
        return [];
      }
    }

    return discoveredAnswers;
  }

  function verifyAnswersApplied(exercise, type, answers) {
    if (!exercise || !answers || Object.keys(answers).length === 0) return false;

    if (type === 'scrambled-sentence') {
      const rows = getScrambledRows(exercise);
      return Object.entries(answers).every(([rowIndex, answer]) => {
        const row = rows[Number(rowIndex)];
        return Boolean(
          row &&
          answer.slots.length === row.cells.length &&
          answer.slots.every((expected, slotIndex) =>
            scrambledCellMatches(row.cells[slotIndex], expected)
          )
        );
      });
    }

    if (type === 'drag-drop' || type === 'picture-choice') {
      const blanks = getDragDropPlaceholders(exercise);

      return Object.entries(answers).every(([index, answer]) => {
        const blank = blanks[Number(index)];
        return Boolean(blank && targetContainsAnswer(blank, answer));
      });
    }

    if (type === 'fill-text-toggle' || type === 'toggle-solution') {
      const gaps = Array.from(exercise.querySelectorAll('.gap.form-control, .gap'));
      return Object.entries(answers).every(([index, answer]) => {
        const gap = gaps[Number(index)];
        return Boolean(
          gap &&
          normalizeAnswer(getToggleGapValue(gap)).toLowerCase() === normalizeAnswer(answer).toLowerCase()
        );
      });
    }

    if (type === 'answer' || type === 'fill-text') {
      const inputs = Array.from(
        exercise.querySelectorAll('input[type="text"], input:not([type]), textarea')
      );
      return Object.entries(answers).every(([index, answer]) => {
        const input = inputs[Number(index)];
        return Boolean(
          input &&
          normalizeAnswer(input.value).toLowerCase() === normalizeAnswer(answer).toLowerCase()
        );
      });
    }

    if (type === 'single-choice' || type === 'multiple-choice') {
      const inputs = Array.from(
        exercise.querySelectorAll('input[type="radio"], input[type="checkbox"]')
      );
      const choiceItems = Array.from(exercise.querySelectorAll('.choice-item'));
      return inputs.every((input, index) => {
        const rowIndex = choiceItems.indexOf(input.closest('.choice-item'));
        const selected = answers.some(answer => {
          if (
            answer.rowIndex !== undefined &&
            answer.rowIndex !== rowIndex
          ) {
            return false;
          }
          if (answer.optionId) {
            if (answer.optionId === getChoiceOptionId(input)) return true;
            if (answer.rowIndex === rowIndex) {
              if (answer.label) {
                return normalizeAnswer(answer.label) === getChoiceLabel(input);
              }
              // ★ picture-choice: จับคู่ด้วย image src
              if (answer.imageSrc) {
                const currentImg = input.closest('label')?.querySelector('img');
                const currentSrc = currentImg?.getAttribute('src') || '';
                if (currentSrc && currentSrc === answer.imageSrc) return true;
              }
              return Boolean(answer.wordId && answer.wordId === getChoiceWordId(input));
            }
            return false;
          }
          if (answer.wordId) return answer.wordId === getChoiceWordId(input);
          if (answer.name && answer.value) {
            return answer.name === input.name && answer.value === input.value;
          }
          if (answer.label) return normalizeAnswer(answer.label) === getChoiceLabel(input);
          return answer.index === index;
        });
        return input.checked === selected;
      });
    }

    if (type === 'mark-text') {
      const wanted = Array.isArray(answers) ? answers : Object.values(answers || {});
      const markedGroups = exercise.querySelectorAll('.mark-text.marked-text');
      // ตรวจสอบว่าจำนวนกลุ่มตรงกัน
      if (markedGroups.length !== wanted.length) {
        addLog(`  ⚠️ mark-text: จำนวนกลุ่มไม่ตรง (มี ${markedGroups.length} ต้องการ ${wanted.length})`, 'warning');
        return false;
      }
      // ตรวจสอบ word-ids ในแต่ละกลุ่ม
      return wanted.every((answer, i) => {
        const group = markedGroups[i];
        if (!group) return false;
        const groupWordIds = Array.from(group.querySelectorAll('.word')).map(w => w.getAttribute('data-word-id')).filter(Boolean);
        return answer.wordIds.every(id => groupWordIds.includes(id));
      });
    }

    return false;
  }

  async function applyDragDropAnswers(exercise, answers) {
    // หากคำตอบลากไม่ลง ให้ตรวจ selector ของ draggable/blanks และ simulateDragDrop()
    throwIfStopRequested();
    // Re-query elements ใหม่หลัง Repeat (DOM ถูกสร้างใหม่)
    addLog('  ⏳ รอ jQuery UI reinitialize...', 'info');

    // รอ jQuery UI พร้อม
    let jQueryReady = false;
    for (let i = 0; i < 25; i++) {
      throwIfStopRequested();
      const testDraggable = document.querySelector('.draggable-container .drag-drop');
      if (testDraggable && window.jQuery && window.jQuery(testDraggable).data('uiDraggable')) {
        jQueryReady = true;
        addLog('  ✅ jQuery UI พร้อมแล้ว', 'success');
        break;
      }
      await sleep(200);
    }

    if (!jQueryReady) {
      addLog('  ⚠️ jQuery UI ยังไม่พร้อม - ลอง mouse events', 'warning');
    }

    // Re-query draggable words ใหม่
    const draggables = Array.from(
      exercise.querySelectorAll('.draggable-container .drag-drop')
    );

    if (draggables.length === 0) {
      addLog('⚠️ ไม่พบ draggable words', 'warning');
      return;
    }

    addLog(`📋 พบ ${draggables.length} draggable words`, 'info');

    draggables.forEach((draggable, i) => {
      addLog(`  📦 Draggable ${i + 1}: "${getDragLabel(draggable)}"`, 'info');
    });

    // คำตอบบางข้อซ้ำกัน เช่น Could/could หรือ should จึงต้องกันไม่ให้
    // source node เดิมถูกเลือกซ้ำหลังจากลากไปแล้ว
    const usedDraggables = new Set();

    // ค้นหาทุก placeholder ใน exercise
    const blanks = getDragDropPlaceholders(exercise);
    addLog(`📋 พบ ${blanks.length} blanks ทั้งหมด`, 'info');

    // ลากแต่ละคำตอบ
    for (const [index, answerData] of Object.entries(answers)) {
      throwIfStopRequested();
      if (index >= blanks.length) {
        addLog(`⚠️ ไม่มีช่องว่างสำหรับคำตอบที่ ${parseInt(index) + 1}`, 'warning');
        continue;
      }

      const targetPlaceholder = blanks[index];

      // Pre-flight check: ถ้าช่องนี้มีคำตอบที่ตรงอยู่แล้ว ให้ข้ามไป
      // (ป้องกันการลากซ้อนซ้ำ และประหยัดเวลา)
      if (targetContainsAnswer(targetPlaceholder, answerData)) {
        addLog(`⏭️ ช่องที่ ${parseInt(index) + 1} มีคำตอบที่ถูกต้องอยู่แล้ว - ข้าม`, 'info');
        continue;
      }

      const availableDraggables = draggables.filter(draggable =>
        !usedDraggables.has(draggable) && draggable.isConnected
      );

      // หา draggable ที่ตรงที่สุดโดยใช้ระบบให้คะแนน (scoring)
      // แทนการ find แบบเดิมที่อาจเลือกตัวแรกที่ match ซึ่งอาจจะผิด
      const sourceElement = findBestDraggableMatch(availableDraggables, answerData);

      if (!sourceElement) {
        addLog(`⚠️ ไม่พบ "${answerData.type === 'img'
          ? (answerData.imageName || getImageName(answerData.src) || answerData.src)
          : answerData.val}" ใน draggable`, 'warning');
        continue;
      }

      // ลากไปวาง (มี retry ภายใน simulateDragDropWithRetry)
      const answerLabel = answerData.type === 'img'
        ? (answerData.imageName || getImageName(answerData.src) || answerData.src)
        : answerData.val;
      addLog(`🔄 ลาก "${answerLabel}" ไปช่องที่ ${parseInt(index) + 1}...`, 'info');

      const success = await simulateDragDropWithRetry(sourceElement, targetPlaceholder, answerData);
      throwIfStopRequested();

      if (success) {
        usedDraggables.add(sourceElement);
        addLog(`✅ สำเร็จ: ช่องที่ ${parseInt(index) + 1}`, 'success');
      } else {
        // Rollback: ถ้าลากไม่สำเร็จ อย่า mark usedDraggables
        // เพื่อให้ draggable ตัวนี้ยังใช้กับช่องอื่นได้
        addLog(`❌ ล้มเหลว: ช่องที่ ${parseInt(index) + 1} (ลองหลายวิธีแล้ว)`, 'warning');
      }

      await sleep(delayBetween * 300);
    }

    reportIncompleteDragDrop(exercise, blanks, answers);
  }

  // รายงานสำหรับแก้บั๊ก Drag & Drop: แสดงเฉพาะช่องที่ยังไม่มีคำตอบตรงกับเฉลย
  // HTML เต็มถูกเก็บไว้ใน tooltip ของบรรทัด Debug เพื่อไม่ให้แผงยาวเกินไป
  function reportIncompleteDragDrop(exercise, blanks, answers) {
    const incomplete = blanks.map((blank, index) => {
      const answerData = answers[index];
      if (!answerData) {
        return { index, answerLabel: '(ไม่พบข้อมูลเฉลย)', blank };
      }
      if (targetContainsAnswer(blank, answerData)) return null;
      return {
        index,
        answerLabel: answerData.type === 'img'
          ? (answerData.imageName || getImageName(answerData.src) || answerData.src || '(รูปภาพ)')
          : (answerData.val || '(ไม่มีข้อความ)'),
        blank
      };
    }).filter(Boolean);

    if (incomplete.length === 0) return;

    addLog(`⚠️ Drag & Drop ยังไม่ครบ: ${incomplete.length} ช่อง`, 'warning');
    incomplete.forEach(({ index, answerLabel, blank }) => {
      const htmlSnippet = normalizeAnswer(blank.outerHTML).slice(0, 500);
      addLog(
        `❌ ช่องที่ ${index + 1} ยังว่าง · ต้องวาง "${answerLabel}" · HTML: ${htmlSnippet}`,
        'error'
      );
    });
  }

  function targetContainsAnswer(target, answer) {
    const answerData = answer && typeof answer === 'object'
      ? answer
      : { type: 'text', val: answer };

    // ไม่ใช้ sibling ทุกตัวในการตรวจ เพราะ placeholder ที่อยู่ติดกันอาจทำให้
    // ช่องถัดไปถูกนับว่ามีคำตอบแล้ว ทั้งที่ยังว่างอยู่จริง
    const targetStyle = window.getComputedStyle(target);
    const targetIsHidden = targetStyle.display === 'none' ||
      targetStyle.visibility === 'hidden' ||
      target.getClientRects().length === 0;
    const answerElements = getDropAnswerElements(target).filter(element =>
      element === target || target.contains(element) ||
      (targetIsHidden && element === target.nextElementSibling)
    );

    return answerElements.some(answerElement => {
      const expectedImage = answerData.src || answerData.imageName || '';
      if (expectedImage && getImageSources(answerElement).some(source =>
        imageSourceMatches(source, expectedImage)
      )) {
        return true;
      }

      if (answerData.id) {
        const matchingId = answerElement.matches('[data-word-id]') &&
          answerElement.getAttribute('data-word-id') === answerData.id;
        const matchingChildId = Array.from(
          answerElement.querySelectorAll('[data-word-id]')
        ).some(element => element.getAttribute('data-word-id') === answerData.id);
        if (matchingId || matchingChildId) return true;
      }

      const expectedText = normalizeAnswer(answerData.val).toLowerCase();
      const actualText = normalizeAnswer(answerElement.textContent).toLowerCase();
      if (!expectedText || !actualText) return false;
      // exact match ก่อน (คำตอบเต็มๆ)
      if (actualText === expectedText) return true;
      // ถ้าไม่ exact ให้ใช้ word boundary แทน includes
      // ป้องกัน "at" match "bat" หรือ "at" match ในวลีอื่น
      try {
        const wordBoundaryRegex = new RegExp(`\\b${escapeRegExp(expectedText)}\\b`, 'i');
        return wordBoundaryRegex.test(actualText);
      } catch (_) {
        // fallback: includes แบบเดิม ถ้า regex มีปัญหา
        return actualText.includes(expectedText);
      }
    });
  }

  // ============================================================
  // DRAG MATCHING - ระบบให้คะแนนการจับคู่ (scoring)
  // แทนการ find แบบเดิมที่อาจเลือกตัวแรกที่ match ซึ่งอาจจะผิด
  // ============================================================
  function scoreDraggableMatch(draggable, answerData) {
    if (!draggable || !answerData) return 0;

    let score = 0;

    // 1. จับคู่ด้วยรูปภาพ (คะแนนสูงสุด เพราะตรงเฉพาะ)
    if ((answerData.src || answerData.imageName) && answerData.type === 'img') {
      const expectedImg = answerData.src || answerData.imageName || '';
      if (expectedImg && getImageSources(draggable).some(source =>
        imageSourceMatches(source, expectedImg)
      )) {
        score += 1000;
      }
    }

    // อ่านข้อความเต็มของ draggable (วลีเต็ม เช่น "at an airport")
    const dragText = normalizeAnswer(getAnswerValue(draggable, { fullText: true }) || draggable.textContent);
    const dragTextLower = dragText.toLowerCase();

    // อ่านข้อความจาก .word (อาจเป็นส่วนหนึ่งของวลี)
    const wordEl = draggable.querySelector('.word, [data-word-id]');
    const wordText = wordEl ? normalizeAnswer(wordEl.textContent).toLowerCase() : '';
    const wordId = wordEl?.getAttribute('data-word-id') ||
      draggable.getAttribute('data-word-id') || '';

    if (answerData.val && answerData.type !== 'img') {
      const expectedExact = normalizeAnswer(answerData.val);
      const expectedLower = expectedExact.toLowerCase();

      // 2. exact match ทั้งวลี (คะแนนสูง) - ตรงตัวพิมพ์
      if (dragText === expectedExact) {
        score += 500;
      }
      // 3. exact match ทั้งวลี (case-insensitive)
      else if (dragTextLower === expectedLower) {
        score += 450;
      }
      // 4. word-id ตรงกัน (คะแนนปานกลาง) - ใช้เมื่อข้อความไม่พอ
      else if (answerData.id && wordId === answerData.id) {
        score += 300;
      }
      // 5. .word text ตรงกับคำตอบ (คะแนนปานกลาง)
      //    ใช้ได้เฉพาะเมื่อคำตอบเป็นคำเดียว ไม่ใช่วลี
      else if (wordText && wordText === expectedLower && !expectedLower.includes(' ')) {
        score += 250;
      }
      // 6. fuzzy match แบบ word boundary (คะแนนต่ำ)
      //    ตรวจด้วย regex word boundary ป้องกัน "at" match "bat"
      else if (expectedLower && dragTextLower) {
        // ถ้า dragText มีคำตอบเป็นคำเต็มๆ (word boundary)
        const wordBoundaryRegex = new RegExp(`\\b${escapeRegExp(expectedLower)}\\b`, 'i');
        if (wordBoundaryRegex.test(dragTextLower)) {
          score += 100;
        }
        // ถ้าคำตอบเป็นวลีและ dragText เป็นส่วนหนึ่ง (word boundary)
        else if (expectedLower.split(/\\s+/).some(word =>
          word.length >= 3 && new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(dragTextLower)
        )) {
          score += 50;
        }
        // Fallback สุดท้าย: includes แบบเดิม (คะแนนต่ำสุด)
        // กรองคำสั้นๆ (<= 2 ตัว) เพื่อไม่ให้ "a" หรือ "an" match ผิด
        else if (expectedLower.length > 2 &&
          (dragTextLower.includes(expectedLower) || expectedLower.includes(dragTextLower))) {
          score += 10;
        }
      }
    }

    return score;
  }

  function escapeRegExp(string) {
    return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // เลือก draggable ที่ได้คะแนนสูงสุด (ถ้าคะแนนเท่ากัน เลือกตัวแรก)
  function findBestDraggableMatch(draggables, answerData) {
    let bestElement = null;
    let bestScore = 0;
    let bestDebug = '';

    for (const draggable of draggables) {
      const score = scoreDraggableMatch(draggable, answerData);
      const dragLabel = getDragLabel(draggable);
      if (score > bestScore) {
        bestScore = score;
        bestElement = draggable;
        bestDebug = `"${dragLabel}" (score: ${score})`;
      }
    }

    if (bestElement && bestScore > 0) {
      addLog(`  🎯 เลือก: ${bestDebug}`, 'info');
    }

    return bestScore > 0 ? bestElement : null;
  }

  // ============================================================
  // DRAG WITH RETRY - ลองหลายวิธี ถ้าทั้งหมดล้มเหลว คืน false
  // ============================================================
  async function simulateDragDropWithRetry(source, target, answerData) {
    throwIfStopRequested();

    // ลอง simulateDragDrop หลายรอบ (เพราะ Speexx บางครั้ง jQuery UI ยังไม่พร้อม)
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      throwIfStopRequested();
      if (attempt > 1) {
        addLog(`  🔁 retry ครั้งที่ ${attempt}...`, 'info');
        await sleep(500);
      }
      const success = await simulateDragDrop(source, target, answerData);
      if (success) return true;
      throwIfStopRequested();
    }

    return false;
  }

  async function simulateDragDrop(source, target, answerData) {
    throwIfStopRequested();
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    const startX = sourceRect.left + sourceRect.width / 2;
    const startY = sourceRect.top + sourceRect.height / 2;
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;

    // วิธี 1: jQuery UI internal methods (re-query data ใหม่)
    try {
      if (window.jQuery) {
        const $ = window.jQuery;
        // Re-query element data ใหม่เสมอ
        const $source = $(source);
        const draggableInstance = $source.data('uiDraggable');

        if (draggableInstance && draggableInstance._mouseStart) {
          addLog('  📌 ใช้ jQuery UI internal methods', 'info');

          const sourceOffset = $source.offset();
          const $target = $(target);
          const targetOffset = $target.offset();

          // 1. _mouseStart
          draggableInstance._mouseStart({
            which: 1, button: 0,
            pageX: sourceOffset.left + sourceRect.width / 2,
            pageY: sourceOffset.top + sourceRect.height / 2,
            clientX: sourceOffset.left + sourceRect.width / 2,
            clientY: sourceOffset.top + sourceRect.height / 2,
            target: source,
            preventDefault: function () { }
          });
          await sleep(100);

          // 2. _mouseDrag - ค่อยๆ ลากไปทีละจุด
          const dragSteps = 15;
          for (let i = 1; i <= dragSteps; i++) {
            throwIfStopRequested();
            const progress = i / dragSteps;
            const currentX = sourceOffset.left + (targetOffset.left - sourceOffset.left) * progress;
            const currentY = sourceOffset.top + (targetOffset.top - sourceOffset.top) * progress;

            draggableInstance._mouseDrag({
              which: 1, button: 0,
              pageX: currentX,
              pageY: currentY,
              clientX: currentX,
              clientY: currentY,
              target: document.elementFromPoint(currentX, currentY) || document.body,
              preventDefault: function () { }
            });
            await sleep(40);
          }

          // 3. _mouseStop
          draggableInstance._mouseStop({
            which: 1, button: 0,
            pageX: targetOffset.left + targetRect.width / 2,
            pageY: targetOffset.top + targetRect.height / 2,
            clientX: targetOffset.left + targetRect.width / 2,
            clientY: targetOffset.top + targetRect.height / 2,
            target: target,
            preventDefault: function () { }
          });
          await sleep(300);

          // ตรวจสอบผลลัพธ์
          if (targetContainsAnswer(target, answerData)) {
            return true;
          }
        }
      }
    } catch (e) {
      if (e?.name === 'StopRequestedError') throw e;
      console.log('jQuery UI internal methods failed:', e);
    }

    // วิธี 2: Mouse events with proper delay (250ms) and distance (25px)
    try {
      addLog('  📌 ใช้ mouse events + delay/distance', 'info');

      // mousedown บน source
      source.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, view: window,
        clientX: startX, clientY: startY, button: 0
      }));

      // รอ 350ms (เกิน delay: 250ms)
      await sleep(350);

      // ขยับ 30px ก่อน (เกิน distance: 25px)
      const moveDistance = 35;
      const moveSteps = 15;
      for (let i = 1; i <= moveSteps; i++) {
        throwIfStopRequested();
        const x = startX + (moveDistance * i / moveSteps);
        document.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, view: window,
          clientX: x, clientY: startY, button: 0
        }));
        await sleep(15);
      }

      // ขยับไปที่ target
      const currentX = startX + moveDistance;
      for (let i = 1; i <= moveSteps; i++) {
        throwIfStopRequested();
        const progress = i / moveSteps;
        const x = currentX + ((endX - currentX) * progress);
        const y = startY + ((endY - startY) * progress);
        document.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, view: window,
          clientX: x, clientY: y, button: 0
        }));
        await sleep(20);
      }

      // mouseup บน target
      target.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, view: window,
        clientX: endX, clientY: endY, button: 0
      }));
      await sleep(300);

      if (targetContainsAnswer(target, answerData)) {
        return true;
      }
    } catch (e) {
      if (e?.name === 'StopRequestedError') throw e;
      console.log('Mouse events failed:', e);
    }

    // วิธี 3: ย้าย DOM โดยตรง ( cheating - เล่น DOM เอง)
    try {
      addLog('  📌 ย้าย DOM โดยตรง', 'info');

      // เว็บวางคำตอบเป็น sibling ถัดจาก placeholder ไม่ได้ใส่ไว้ข้างใน
      // จึงย้าย node จริงไปไว้ตำแหน่งเดียวกัน และซ่อน placeholder
      // เพื่อให้โครงสร้าง DOM เหมือนผลลัพธ์หลัง Solution
      const targetParent = target.parentNode;
      if (!targetParent) return false;

      source.style.display = '';
      source.style.removeProperty('left');
      source.style.removeProperty('top');
      source.style.removeProperty('position');
      source.style.removeProperty('transform');
      source.classList.remove('ui-draggable-dragging');

      target.style.display = 'none';
      targetParent.insertBefore(source, target.nextSibling);

      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      targetParent.dispatchEvent(new Event('change', { bubbles: true }));
      if (window.jQuery) {
        window.jQuery(target).trigger('change');
        window.jQuery(targetParent).trigger('change');
      }

      await sleep(200);

      if (targetContainsAnswer(target, answerData)) {
        return true;
      }
    } catch (e) {
      if (e?.name === 'StopRequestedError') throw e;
      console.log('DOM manipulation failed:', e);
    }

    return false;
  }

  // ============================================================
  // APPLY SCRAMBLED SENTENCE ANSWERS (horizontal sort)
  // ============================================================
  async function applyScrambledSentenceAnswers(exercise, answers, initialRows) {
    addLog(`📋 พบ scrambled-sentence ${initialRows.length} แถว (เรียงแนวนอน)`, 'info');

    for (let rowIndex = 0; rowIndex < answers.length; rowIndex++) {
      throwIfStopRequested();
      const expected = answers[rowIndex];
      if (!expected || !expected.slots) continue;

      const rows = getScrambledRows(exercise);
      const row = rows[rowIndex];
      if (!row || !row.containers[0]) continue;

      const sentence = row.containers[0]; // .scrambled-sentence
      const targetSlots = expected.slots.filter(Boolean);

      addLog(`  ↕️ เริ่มเรียงแถวที่ ${rowIndex + 1}: ${targetSlots.map(s => s.val).join(' ')}`, 'info');

      // Build lookup maps from current blocks (ใช้ array เพื่อรองรับ word-id ซ้ำ)
      const currentBlocks = Array.from(sentence.querySelectorAll('.scrambled-block'));
      const blocksByWordId = new Map();
      const blocksByText = new Map();
      currentBlocks.forEach(block => {
        const w = block.querySelector('.word');
        const wordId = w?.getAttribute('data-word-id') || '';
        const text = normalizeAnswer(block.textContent).toLowerCase();
        if (wordId) {
          if (!blocksByWordId.has(wordId)) blocksByWordId.set(wordId, []);
          blocksByWordId.get(wordId).push(block);
        }
        if (text) {
          if (!blocksByText.has(text)) blocksByText.set(text, []);
          blocksByText.get(text).push(block);
        }
      });

      // ★ ติดตาม block ที่ย้ายแล้ว (ป้องกันย้ายซ้ำ)
      const usedBlocks = new Set();

      addLog(`  📊 พบ ${currentBlocks.length} blocks: ${currentBlocks.map(b => {
        const w = b.querySelector('.word');
        return `${w?.getAttribute('data-word-id') || '?'}:${normalizeAnswer(b.textContent)}`;
      }).join(', ')}`, 'info');

      // Rearrange: append blocks in target order (appendChild moves element)
      let movedCount = 0;
      for (const slot of targetSlots) {
        let block = null;
        // Match by word ID first (ใช้ตัวที่ยังไม่ได้ใช้)
        if (slot.id) {
          const candidates = blocksByWordId.get(slot.id) || [];
          block = candidates.find(b => !usedBlocks.has(b));
        }
        // Fallback: match by text (ใช้ตัวที่ยังไม่ได้ใช้)
        if (!block && slot.val) {
          const candidates = blocksByText.get(normalizeAnswer(slot.val).toLowerCase()) || [];
          block = candidates.find(b => !usedBlocks.has(b));
        }

        if (block) {
          usedBlocks.add(block);
          sentence.appendChild(block); // moves to end = correct position
          movedCount++;
        } else {
          addLog(`  ⚠️ หา "${slot.val}" (id=${slot.id || '-'}) ไม่เจอ`, 'warning');
        }
      }

      addLog(`  📦 ย้าย ${movedCount}/${targetSlots.length} blocks`, movedCount === targetSlots.length ? 'success' : 'warning');

      // Notify sortable of changes
      sentence.dispatchEvent(new Event('sortupdate', { bubbles: true }));
      if (window.jQuery) {
        try { window.jQuery(sentence).sortable('refresh'); } catch (_) { }
      }
      await sleep(300);
    }

    // Verify
    const finalRows = getScrambledRows(exercise);
    let allCorrect = true;
    for (let rowIndex = 0; rowIndex < answers.length; rowIndex++) {
      const answer = answers[rowIndex];
      if (!answer || !answer.slots) continue;
      const row = finalRows[rowIndex];
      if (!row) { allCorrect = false; continue; }
      for (let slotIndex = 0; slotIndex < answer.slots.length; slotIndex++) {
        if (!scrambledCellMatches(row.cells[slotIndex], answer.slots[slotIndex])) {
          allCorrect = false;
          addLog(`  ↪️ ผิดที่แถว ${rowIndex + 1}, ตำแหน่ง ${slotIndex + 1}: ต้องเป็น "${answer.slots[slotIndex]?.val}" แต่เป็น "${getScrambledCellLabel(row.cells[slotIndex])}"`, 'warning');
        }
      }
    }

    if (allCorrect) {
      addLog('✅ เรียง scrambled ครบทุกแถวแล้ว', 'success');
    } else {
      addLog('⚠️ scrambled ยังเรียงไม่ครบ', 'warning');
    }
  }

  async function moveScrambledBlockInSentence(sentence, sourceBlock, targetBlock, expected) {
    if (!sourceBlock || !targetBlock) return false;
    if (sourceBlock === targetBlock) return true;
    if (scrambledCellMatches(sourceBlock, expected)) return true;

    const $ = window.jQuery;
    const sourceRect = sourceBlock.getBoundingClientRect();
    const targetRect = targetBlock.getBoundingClientRect();
    const startX = sourceRect.left + sourceRect.width / 2;
    const startY = sourceRect.top + sourceRect.height / 2;
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;

    // Try jQuery UI Sortable first
    if ($) {
      const $sentence = $(sentence);
      const sortableInstance = $sentence.data('uiSortable');

      if (sortableInstance && sortableInstance._mouseStart) {
        try {
          sortableInstance._mouseStart({
            which: 1, button: 0,
            pageX: startX + window.pageXOffset,
            pageY: startY + window.pageYOffset,
            clientX: startX, clientY: startY,
            target: sourceBlock,
            preventDefault() { }
          });
          await sleep(100);

          for (let step = 1; step <= 15; step++) {
            throwIfStopRequested();
            const progress = step / 15;
            const x = startX + (endX - startX) * progress;
            const y = startY + (endY - startY) * progress;
            sortableInstance._mouseDrag({
              which: 1, button: 0,
              pageX: x + window.pageXOffset,
              pageY: y + window.pageYOffset,
              clientX: x, clientY: y,
              target: document.elementFromPoint(x, y) || targetBlock,
              preventDefault() { }
            });
            await sleep(25);
          }

          sortableInstance._mouseStop({
            which: 1, button: 0,
            pageX: endX + window.pageXOffset,
            pageY: endY + window.pageYOffset,
            clientX: endX, clientY: endY,
            target: targetBlock,
            preventDefault() { }
          });
          await sleep(250);

          if (scrambledCellMatches(sourceBlock, expected) ||
            scrambledCellMatches(targetBlock, expected)) {
            return true;
          }
        } catch (error) {
          if (error?.name === 'StopRequestedError') throw error;
          console.log('Scrambled sentence sortable move failed:', error);
        }
      }
    }

    // Fallback: mouse events
    try {
      sourceBlock.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, view: window,
        clientX: startX, clientY: startY, button: 0
      }));
      await sleep(350);

      for (let step = 1; step <= 15; step++) {
        throwIfStopRequested();
        const progress = step / 15;
        const x = startX + (endX - startX) * progress;
        const y = startY + (endY - startY) * progress;
        document.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, cancelable: true, view: window,
          clientX: x, clientY: y, button: 0
        }));
        await sleep(20);
      }

      document.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, view: window,
        clientX: endX, clientY: endY, button: 0
      }));
      await sleep(250);

      return true;
    } catch (error) {
      if (error?.name === 'StopRequestedError') throw error;
      console.log('Scrambled sentence mouse move failed:', error);
    }

    return false;
  }

  // ============================================================
  // APPLY MARK-TEXT ANSWERS
  // ============================================================
  async function applyMarkTextAnswers(exercise, answers) {
    const wanted = Array.isArray(answers) ? answers : Object.values(answers || {});
    if (wanted.length === 0) {
      addLog('⚠️ ไม่มีเฉลย mark-text ให้ใส่', 'warning');
      return;
    }

    addLog(`📋 เริ่มใส่เฉลย mark-text: ${wanted.length} กลุ่ม`, 'info');

    // ★ รอให้ exercise พร้อม
    for (let w = 0; w < 10; w++) {
      const backdrop = exercise.querySelector('.disabled-backdrop');
      if (!backdrop) break;
      addLog(`  ⏳ รอ disabled-backdrop หาย... (${w + 1})`, 'info');
      await sleep(500);
    }

    // ★ โครงสร้าง DOM หลัง Start:
    //   <span class="mark-text">  ← ยังไม่มี marked-text = ยังไม่ได้ mark
    //     <span class="word" data-word-id="10005">'ve</span>
    //     <span class="word" data-word-id="12182">been</span>
    //   </span>
    //   ต้องคลิกที่ .mark-text container เพื่อ toggle marked-text class
    const markTextContainers = Array.from(
      exercise.querySelectorAll('.exercise-items .item .mark-text')
    );
    addLog(`  📊 พบ ${markTextContainers.length} .mark-text containers`, 'info');

    // ★ สร้าง array ของ containers ที่เรียงตาม DOM order (พร้อม word-ids)
    const containerEntries = markTextContainers.map(container => {
      const words = Array.from(container.querySelectorAll('.word'));
      const sortedIds = words.map(w => w.getAttribute('data-word-id')).filter(Boolean).sort().join(',');
      const wordTexts = words.map(w => w.textContent.trim());
      return { container, sortedIds, wordTexts };
    });
    addLog(`  📊 พบ ${containerEntries.length} .mark-text containers (DOM order)`, 'info');

    // ★ ติดตาม container ที่คลิกแล้ว (ป้องกันคลิกซ้ำ)
    const usedContainers = new Set();

    // ★ คลิกแต่ละกลุ่มเฉลย — match ด้วย word-ids + DOM position
    for (let i = 0; i < wanted.length; i++) {
      const answer = wanted[i];
      const sortedIds = (answer.wordIds || []).sort().join(',');
      const wordTexts = answer.wordTexts || [];

      if (!sortedIds && wordTexts.length === 0) continue;

      // หา container ที่ยังไม่ได้ใช้ + word-ids ตรงกัน
      let found = null;
      for (const entry of containerEntries) {
        if (usedContainers.has(entry.container)) continue;
        if (entry.sortedIds === sortedIds) {
          found = entry;
          break;
        }
      }

      // fallback: หาด้วย text
      if (!found && wordTexts.length > 0) {
        for (const entry of containerEntries) {
          if (usedContainers.has(entry.container)) continue;
          if (wordTexts.every(t => entry.wordTexts.includes(t.trim()))) {
            found = entry;
            break;
          }
        }
      }

      if (!found) {
        addLog(`  ⚠️ หา container สำหรับ "${wordTexts.join(' ')}" ไม่เจอ`, 'warning');
        continue;
      }

      usedContainers.add(found.container);
      addLog(`  🖱️ คลิก mark กลุ่ม ${i + 1}: "${wordTexts.join(' ')}"`, 'info');

      // ★ คลิก container ครั้งเดียว เพื่อ toggle marked-text class
      found.container.click();
      await sleep(500);
    }

    addLog(`✅ ใส่เฉลย mark-text เสร็จแล้ว`, 'success');
  }

  async function applyScrambledAnswers(exercise, answers) {
    const initialRows = getScrambledRows(exercise);

    // Detect sentence-based structure (all blocks in one .scrambled-sentence per row)
    const isSentenceBased = initialRows.length > 0 &&
      initialRows.every(row => row.sentenceBased);

    if (isSentenceBased) {
      return applyScrambledSentenceAnswers(exercise, answers, initialRows);
    }

    // Column-based structure (original logic)
    const columnCount = Math.max(
      0,
      ...initialRows.map(row => row.cells.length)
    );
    // เก็บ node ต้นฉบับก่อนลองลาก: jQuery UI บางหน้าทำ cell หายจากรายการชั่วคราว
    // fallback จึงต้องอ้างอิง snapshot นี้ ไม่ใช่ DOM ที่ถูกแก้ไขระหว่างทาง
    const originalColumnCells = Array.from({ length: columnCount }, (_, columnIndex) =>
      initialRows.map(row => row.cells[columnIndex]).filter(Boolean)
    );

    addLog(
      `📋 พบ scrambled ${initialRows.length} แถว, ${columnCount} คอลัมน์ (ลากขึ้นลง)`,
      'info'
    );

    // สำคัญ: บางหน้าของ Speexx ถอน node ออกจาก DOM เมื่อจำลองการลากไม่สำเร็จ
    // จึงจัดเรียงจาก snapshot ที่สมบูรณ์ก่อนเสมอ เพื่อไม่ให้คำตอบหายระหว่างทดลองลาก
    addLog('  🛠️ จัดเรียง scrambled จากข้อมูลก่อนเริ่มลาก...', 'info');
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      throwIfStopRequested();
      await forceArrangeScrambledColumn(exercise, answers, columnIndex, originalColumnCells[columnIndex]);
    }
    let finalRows = getScrambledRows(exercise);
    let complete = answers.every((answer, rowIndex) =>
      answer?.slots?.every((expected, columnIndex) =>
        scrambledCellMatches(finalRows[rowIndex]?.cells?.[columnIndex], expected)
      )
    );
    if (complete) {
      addLog('✅ เรียง scrambled ครบทุกแถวแล้ว', 'success');
      return;
    }
    addLog('⚠️ จัดเรียงแบบปลอดภัยยังไม่ครบ — ลองใช้การลากเป็นทางเลือกสุดท้าย', 'warning');

    // เรียงทีละคอลัมน์ เพราะหน้าเว็บอนุญาตให้ลากขึ้นลงภายในคอลัมน์เดียว
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      throwIfStopRequested();
      addLog(`  ↕️ เริ่มเรียงคอลัมน์ที่ ${columnIndex + 1}`, 'info');

      for (let rowIndex = 0; rowIndex < answers.length; rowIndex++) {
        throwIfStopRequested();
        const expected = answers[rowIndex]?.slots?.[columnIndex];
        if (!expected) continue;

        const rows = getScrambledRows(exercise);
        const target = rows[rowIndex]?.cells?.[columnIndex];
        if (!target) {
          addLog(
            `⚠️ ไม่มีช่อง scrambled แถวที่ ${rowIndex + 1} คอลัมน์ที่ ${columnIndex + 1}`,
            'warning'
          );
          continue;
        }

        if (scrambledCellMatches(target, expected)) continue;

        const columnCells = rows
          .map(row => row.cells[columnIndex])
          .filter(Boolean);
        const source = columnCells.find(cell =>
          scrambledCellMatches(cell, expected)
        );

        if (!source) {
          addLog(
            `⚠️ จับคู่ scrambled แถวที่ ${rowIndex + 1} คอลัมน์ที่ ${columnIndex + 1} ไม่ได้: "${expected.val}"`,
            'warning'
          );
          continue;
        }

        addLog(
          `  ↕️ ย้าย "${expected.val}" ไปแถวที่ ${rowIndex + 1} คอลัมน์ที่ ${columnIndex + 1}`,
          'info'
        );

        const success = await moveScrambledCell(source, target, expected);
        throwIfStopRequested();
        if (!success) {
          addLog(
            `⚠️ ย้าย scrambled แถวที่ ${rowIndex + 1} คอลัมน์ที่ ${columnIndex + 1} ไม่สำเร็จ`,
            'warning'
          );
        }
      }
    }

    finalRows = getScrambledRows(exercise);
    complete = answers.every((answer, rowIndex) =>
      answer?.slots?.every((expected, columnIndex) =>
        scrambledCellMatches(finalRows[rowIndex]?.cells?.[columnIndex], expected)
      )
    );

    // หาก event ของ jQuery UI ไม่สลับตำแหน่งจริง ให้จัดเรียงเนื้อหาในแต่ละคอลัมน์
    // จาก snapshot ปัจจุบันโดยตรงเป็น fallback สุดท้าย
    if (!complete) {
      addLog('  🛠️ ใช้ fallback จัดเรียง scrambled ตามเฉลยโดยตรง...', 'warning');
      for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
        throwIfStopRequested();
        await forceArrangeScrambledColumn(exercise, answers, columnIndex, originalColumnCells[columnIndex]);
      }

      finalRows = getScrambledRows(exercise);
      complete = answers.every((answer, rowIndex) =>
        answer?.slots?.every((expected, columnIndex) =>
          scrambledCellMatches(finalRows[rowIndex]?.cells?.[columnIndex], expected)
        )
      );
    }

    if (complete) {
      addLog('✅ เรียง scrambled ครบทุกแถวแล้ว', 'success');
    } else {
      addLog('⚠️ scrambled ยังเรียงไม่ครบ', 'warning');
      answers.forEach((answer, rowIndex) => {
        answer?.slots?.forEach((expected, columnIndex) => {
          const actual = finalRows[rowIndex]?.cells?.[columnIndex];
          if (!scrambledCellMatches(actual, expected)) {
            addLog(
              `  ↪️ ผิดที่แถว ${rowIndex + 1}, คอลัมน์ ${columnIndex + 1}: ต้องเป็น "${expected.val}" แต่เป็น "${getScrambledCellLabel(actual)}"`,
              'warning'
            );
          }
        });
      });
    }
  }

  // Fallback สำหรับ scrambled แนวตั้ง: ใช้ทั้ง node ที่แสดงอยู่และ snapshot ก่อนลาก
  // เพราะ jQuery UI บางเวอร์ชัน clone node แล้วทำให้ reference เดิมไม่ใช่ตัวบนหน้า
  async function forceArrangeScrambledColumn(exercise, answers, columnIndex, originalCells = []) {
    const rows = getScrambledRows(exercise);
    const columnCells = rows.map(row => row.cells[columnIndex]).filter(Boolean);
    const columnContainers = rows
      .map(row => row.containers[columnIndex])
      .filter(Boolean);
    const sourceCells = [...columnCells, ...originalCells]
      .filter(cell => cell && cell.nodeType === Node.ELEMENT_NODE)
      .filter((cell, index, cells) => cells.indexOf(cell) === index);
    const available = sourceCells.map(cell => ({
      cell,
      answer: getScrambledCellAnswer(cell)
    }));
    addLog(`  📌 fallback ใช้ cell ปัจจุบัน + snapshot รวม ${sourceCells.length} cell สำหรับคอลัมน์ ${columnIndex + 1}`, 'info');
    const used = new Set();
    const arrangedCells = [];

    for (let rowIndex = 0; rowIndex < answers.length; rowIndex++) {
      const expected = answers[rowIndex]?.slots?.[columnIndex];
      if (!expected || !columnCells[rowIndex]) continue;

      const sourceIndex = available.findIndex((entry, index) =>
        !used.has(index) && scrambledAnswersMatch(entry.answer, expected)
      );
      if (sourceIndex < 0) {
        addLog(
          `  ⚠️ fallback หา "${expected.val}" ไม่เจอในคอลัมน์ ${columnIndex + 1}`,
          'warning'
        );
        continue;
      }

      used.add(sourceIndex);
      arrangedCells[rowIndex] = available[sourceIndex].cell;
    }

    arrangedCells.forEach((cell, rowIndex) => {
      const container = columnContainers[rowIndex];
      if (!cell || !container) return;
      if (container.firstElementChild !== cell) {
        container.replaceChildren(cell);
      }
      notifyScrambledCellChanged(cell);
    });

    await sleep(100);
    const finalRows = getScrambledRows(exercise);
    return answers.every((answer, rowIndex) =>
      !answer?.slots?.[columnIndex] ||
      scrambledCellMatches(finalRows[rowIndex]?.cells?.[columnIndex], answer.slots[columnIndex])
    );
  }

  async function moveScrambledCell(source, target, expected) {
    if (!source || !target) return false;
    if (source === target || scrambledCellMatches(target, expected)) return true;

    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const startX = sourceRect.left + sourceRect.width / 2;
    const startY = sourceRect.top + sourceRect.height / 2;
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;

    // ใช้ jQuery UI ก่อน โดยลากตามแนวตั้งของคอลัมน์
    try {
      if (window.jQuery) {
        const $ = window.jQuery;
        const $source = $(source);
        const instance = $source.data('uiDraggable');

        if (instance && instance._mouseStart) {
          const sourceOffset = $source.offset();
          const targetOffset = $(target).offset();
          instance._mouseStart({
            which: 1,
            button: 0,
            pageX: sourceOffset.left + sourceRect.width / 2,
            pageY: sourceOffset.top + sourceRect.height / 2,
            clientX: startX,
            clientY: startY,
            target: source,
            preventDefault() { }
          });
          await sleep(100);

          for (let step = 1; step <= 15; step++) {
            throwIfStopRequested();
            const progress = step / 15;
            const x = sourceOffset.left +
              (targetOffset.left - sourceOffset.left) * progress;
            const y = sourceOffset.top +
              (targetOffset.top - sourceOffset.top) * progress;
            instance._mouseDrag({
              which: 1,
              button: 0,
              pageX: x,
              pageY: y,
              clientX: x,
              clientY: y,
              target: document.elementFromPoint(x, y) || target,
              preventDefault() { }
            });
            await sleep(25);
          }

          instance._mouseStop({
            which: 1,
            button: 0,
            pageX: targetOffset.left + targetRect.width / 2,
            pageY: targetOffset.top + targetRect.height / 2,
            clientX: endX,
            clientY: endY,
            target,
            preventDefault() { }
          });
          await sleep(250);

          if (scrambledCellMatches(target, expected)) return true;
        }
      }
    } catch (error) {
      if (error?.name === 'StopRequestedError') throw error;
      console.log('Scrambled jQuery UI move failed:', error);
    }

    // fallback: mouse events แนวตั้ง
    try {
      source.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: startX,
        clientY: startY,
        button: 0
      }));
      await sleep(350);

      for (let step = 1; step <= 15; step++) {
        throwIfStopRequested();
        const progress = step / 15;
        const x = startX + (endX - startX) * progress;
        const y = startY + (endY - startY) * progress;
        document.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          button: 0
        }));
        await sleep(20);
      }

      target.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: endX,
        clientY: endY,
        button: 0
      }));
      await sleep(250);

      if (scrambledCellMatches(target, expected)) return true;
    } catch (error) {
      if (error?.name === 'StopRequestedError') throw error;
      console.log('Scrambled mouse move failed:', error);
    }

    // fallback สุดท้าย: ย้าย cell node จริง เพื่อคง identity/state ของ draggable
    try {
      const swapped = swapScrambledCellNodes(source, target);
      if (!swapped) return false;

      await sleep(100);
      return scrambledCellMatches(target, expected);
    } catch (error) {
      if (error?.name === 'StopRequestedError') throw error;
      console.log('Scrambled DOM swap failed:', error);
    }

    return false;
  }

  // ============================================================
  // APPLY FILL-TEXT-TOGGLE ANSWERS
  // ============================================================
  async function applyFillTextToggleAnswers(exercise, answers) {
    throwIfStopRequested();
    // ใช้ selector เดียวกันกับที่ใช้จำคำตอบ
    const gaps = exercise.querySelectorAll('.gap.form-control, .gap');

    for (const [index, answer] of Object.entries(answers)) {
      throwIfStopRequested();
      const gapIndex = parseInt(index);
      if (gapIndex >= gaps.length) continue;

      const gap = gaps[gapIndex];

      // หา toggle button - โดยดูจาก parent หรือ sibling
      const parent = gap.parentElement;
      const toggleBtn = parent.querySelector('.input-group-addon button') ||
        parent.querySelector('.fill-text-toggle') ||
        parent.querySelector('[class*="toggle-btn"]') ||
        parent.querySelector('[class*="refresh"]');

      if (toggleBtn) {
        addLog(`🔄 คลิก toggle ข้อ ${gapIndex + 1}: "${answer}"`, 'info');

        // คลิก toggle จนกว่าจะเจอคำตอบ
        let found = false;
        let lastText = '';
        let consecutiveSame = 0;

        for (let i = 0; i < 50; i++) {
          throwIfStopRequested();
          const currentText = normalizeAnswer(getToggleGapValue(gap));

          // เจอคำตอบแล้ว
          if (currentText.toLowerCase() === normalizeAnswer(answer).toLowerCase()) {
            addLog(`✅ สำเร็จ: ข้อ ${gapIndex + 1} = "${answer}"`, 'success');
            found = true;
            break;
          }

          if (currentText === lastText) {
            consecutiveSame++;
          } else {
            consecutiveSame = 1;
          }
          lastText = currentText;

          if (consecutiveSame >= 3) break;

          toggleBtn.click();
          await sleep(200);
        }

        if (!found) {
          addLog(`❌ ไม่เจอคำตอบ "${answer}" หลังคลิก 50 ครั้ง (ลองใส่ตรง)`, 'error');
          if (gap.matches('input, textarea, select')) {
            gap.value = answer;
          } else {
            gap.textContent = answer;
          }
          gap.dispatchEvent(new Event('input', { bubbles: true }));
          gap.dispatchEvent(new Event('change', { bubbles: true }));
          addLog(`📝 Fallback: ใส่คำตอบ "${answer}" โดยตรง`, 'info');
        }
      } else {
        // ไม่มี toggle - ลองใส่ text โดยตรง
        if (gap.matches('input, textarea, select')) {
          gap.value = answer;
        } else {
          gap.textContent = answer;
        }
        gap.dispatchEvent(new Event('input', { bubbles: true }));
        gap.dispatchEvent(new Event('change', { bubbles: true }));
        addLog(`📝 ใส่ text ตรง: ข้อ ${gapIndex + 1} = "${answer}"`, 'info');
      }

      await sleep(delayBetween * 300);
    }
  }

  // ============================================================
  // APPLY ANSWER TYPE - พิมพ์คำตอบลง input
  // ============================================================
  async function applyAnswerTypeAnswers(exercise, answers) {
    throwIfStopRequested();
    const inputs = exercise.querySelectorAll('input[type="text"], input:not([type]), textarea');

    addLog(`📋 พบ ${inputs.length} inputs`, 'info');

    for (const [index, answer] of Object.entries(answers)) {
      throwIfStopRequested();
      const inputIndex = parseInt(index);
      if (inputIndex >= inputs.length) continue;

      const input = inputs[inputIndex];

      addLog(`📝 พิมพ์ "${answer}" ใน input ${inputIndex + 1}...`, 'info');

      // คลิก input ก่อน
      throwIfStopRequested();
      input.focus();
      input.click();
      await sleep(200);

      // ใส่ค่า
      throwIfStopRequested();
      input.value = answer;

      // Trigger events เพื่อให้ Backbone รู้ว่ามีการเปลี่ยนแปลง
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
      await sleep(200);

      // กด Tab ไป input ถัดไป
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }));
      await sleep(100);
    }

    addLog(`✅ พิมพ์คำตอบเสร็จแล้ว`, 'success');
  }

  async function clickNext() {
    throwIfStopRequested();
    addLog('📌 ขั้นตอน 6: กด Next...', 'step');

    // หน้าสรุปผลอาจมีปุ่ม Next ของข้อเดิมอยู่ด้านหลัง popup
    if (findContinueLearningButton()) {
      addLog('ℹ️ พบหน้าสรุปผล — รอคำสั่ง “เรียนรู้ต่อ”', 'info');
      return false;
    }

    // === หาปุ่ม Next ปกติ ===
    const nextBtn = findNextButton();
    if (!nextBtn || nextBtn.disabled || nextBtn.classList.contains('disabled')) {
      addLog('⚠️ ไม่พบปุ่ม Next', 'warning');
      return false;
    }

    throwIfStopRequested();
    nextBtn.click();
    await sleep(2500);
    throwIfStopRequested();

    currentPage++;
    addLog('✅ กด Next แล้ว', 'success');
    return true;
  }

  async function waitForExercise(maxWait = 15000) {
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      throwIfStopRequested();
      if (findCorrectionButton()) return true;
      const exercise = findExercise();
      if (exercise) {
        const items = exercise.querySelectorAll('.exercise-items .item');
        if (items.length > 0) {
          await sleep(500);
          return true;
        }
      }
      await sleep(500);
    }

    addLog('⚠️ รอ exercise ไม่ทันเวลา', 'warning');
    return false;
  }

  // รอให้คำตอบโหลดครบทุก gap-container (สำหรับ toggle-solution)
  async function waitForAllAnswers(exercise, type, maxWait = 45000) {
    throwIfStopRequested();
    if (type !== 'toggle-solution' && type !== 'fill-text-toggle') return true;

    const getGapElements = () => {
      const containers = Array.from(exercise.querySelectorAll('.gap-container'));
      if (containers.length > 0) {
        return containers
          .map(container => container.querySelector('.gap.form-control, .gap') || container)
          .filter(Boolean);
      }
      return Array.from(exercise.querySelectorAll('.gap.form-control, .gap'));
    };

    const totalGaps = getGapElements().length;
    if (totalGaps === 0) {
      addLog('ℹ️ ไม่พบช่อง gap ที่ต้องรอ', 'info');
      return true;
    }

    const start = Date.now();
    let filledCount = 0;
    let lastFilledCount = -1;
    let stagnantCount = 0;

    addLog(`📋 รอคำตอบ ${totalGaps} ช่อง (รอสูงสุด ${maxWait / 1000} วิ)...`, 'info');

    while (Date.now() - start < maxWait) {
      throwIfStopRequested();
      const gaps = getGapElements();
      filledCount = 0;

      gaps.forEach(gap => {
        const text = getAnswerValue(gap);
        if (text && text !== ' ') {
          filledCount++;
        }
      });

      if (filledCount >= totalGaps && totalGaps > 0) {
        addLog(`✅ คำตอบครบ ${filledCount}/${totalGaps} ช่อง - รอเพิ่ม 2 วิเพื่อความมั่นใจ`, 'success');
        await sleep(2000); // เพิ่มเวลา safety
        return true;
      }

      // ถ้าโหลดค้างนาน 6 รอบ (3 วิ) ลองกด Solution อีกครั้ง
      if (filledCount === lastFilledCount) {
        stagnantCount++;
        if (stagnantCount >= 6) {
          addLog(`🔄 ค้างที่ ${filledCount}/${totalGaps} - กด Solution อีกครั้ง...`, 'warning');
          const solutionBtn = findSolutionButton(exercise);
          if (solutionBtn) {
            throwIfStopRequested();
            solutionBtn.click();
            await sleep(2000);
          }
          stagnantCount = 0;
        }
      } else {
        stagnantCount = 0;
      }
      lastFilledCount = filledCount;

      addLog(`⏳ โหลดแล้ว ${filledCount}/${totalGaps} ช่อง...`, 'info');
      await sleep(500);
    }

    addLog(`⚠️ รอคำตอบไม่ทัน (${filledCount}/${totalGaps}) - ทำต่อด้วยที่มี`, 'warning');
    return filledCount > 0; // คืน true ถ้ามีบ้าง
  }

  async function loadSettings() {
    return new Promise(resolve => {
      chrome.storage.sync.get(['delay'], (result) => {
        const savedDelay = Number.parseInt(result.delay, 10);
        delayBetween = Number.isFinite(savedDelay)
          ? Math.min(10, Math.max(1, savedDelay))
          : 2;
        resolve();
      });
    });
  }

  function sleep(ms) {
    if (shouldStop) {
      return Promise.reject(new StopRequestedError());
    }

    return new Promise((resolve, reject) => {
      let timerId = null;
      let settled = false;

      const cleanup = () => {
        if (timerId !== null) clearTimeout(timerId);
        pendingSleepCancellers.delete(cancel);
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const cancel = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new StopRequestedError());
      };

      timerId = setTimeout(finish, ms);
      pendingSleepCancellers.add(cancel);
    });
  }

  function showTimerReminder(label, remainingMs) {
    document.getElementById('speexx-helper-timer-reminder')?.remove();
    const reminder = document.createElement('div');
    reminder.id = 'speexx-helper-timer-reminder';
    reminder.setAttribute('role', 'alertdialog');
    reminder.setAttribute('aria-live', 'assertive');
    const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
    const message = remainingMs > 0
      ? `เหลือเวลาประมาณ ${minutes} นาที`
      : 'กำลังเปิดชุดแบบฝึกหัดถัดไป';
    reminder.innerHTML = `<div class="sh-reminder-card"><span aria-hidden="true">⏰</span><div><strong>${remainingMs > 0 ? `${label} ใกล้หมดแล้ว` : label}</strong><p>${message}</p></div><button type="button" aria-label="ปิดการแจ้งเตือน">✕</button></div>`;
    reminder.querySelector('button').addEventListener('click', () => reminder.remove());
    document.body.appendChild(reminder);
    setTimeout(() => reminder.remove(), 10000);
  }

  function waitWithCountdown(ms, label, reminderMs = 0) {
    const startedAt = Date.now();
    let reminderShown = false;
    const update = () => {
      const elapsed = Math.min(ms, Date.now() - startedAt);
      const remaining = Math.max(0, ms - elapsed);
      const elapsedMinutes = Math.floor(elapsed / 60000);
      const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);
      const remainingMinutes = Math.floor(remaining / 60000);
      const remainingSeconds = Math.floor((remaining % 60000) / 1000);
      if (floatingTimer) {
        floatingTimer.hidden = false;
        floatingTimer.innerHTML = `<span class="sh-floating-timer-label">${label}</span><strong>เหลือ ${String(remainingMinutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}</strong><span class="sh-floating-timer-elapsed">ผ่าน ${String(elapsedMinutes).padStart(2, '0')}:${String(elapsedSeconds).padStart(2, '0')}</span>`;
      }
      if (!reminderShown && reminderMs > 0 && ms > reminderMs && remaining <= reminderMs && remaining > 0) {
        reminderShown = true;
        showTimerReminder(label, remaining);
        addLog(`⏰ ${label} เหลือประมาณ ${Math.ceil(remaining / 60000)} นาที`, 'warning');
      }
    };
    update();
    const interval = setInterval(update, 250);
    return sleep(ms).finally(() => {
      clearInterval(interval);
      if (floatingTimer) { floatingTimer.hidden = true; floatingTimer.textContent = ''; }
    });
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    createLogPanel();

    chrome.storage.local.get(['speexxResumeContinuous'], ({ speexxResumeContinuous }) => {
      if (!speexxResumeContinuous) return;
      chrome.storage.local.remove(['speexxResumeContinuous']);
      addLog('🔁 กลับมาทำอัตโนมัติต่อเนื่องในหน้าใหม่...', 'info');
      // กลับจากปุ่ม “เรียนรู้ต่อ” ต้องใช้สถิติของเซสชันเดิมต่อไป
      setTimeout(() => startSolving(true, true, true), 1000);
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'startSolveAll') {
        startSolving(true);
        sendResponse({ status: 'started' });
      } else if (message.action === 'startSolveOne') {
        startSolving(false);
        sendResponse({ status: 'started' });
      } else if (message.action === 'getStatus') {
        sendResponse({
          isRunning,
          exerciseCount,
          currentPage,
          type: getExerciseType()
        });
      }
      return true;
    });

    addLog('🎓 พร้อมใช้งาน!', 'info');
  }

  init();

})();







