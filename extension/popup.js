// แผนที่สำหรับแก้ไขหน้า Settings:
// - timeProfiles: ค่าโปรไฟล์ ช้า / ปกติ / ละเอียด
// - normalize...: ขอบเขตนาทีที่อนุญาต
// - saveBtn listener: รายการค่าที่บันทึกลง Chrome storage
// - autoBtn listener: ปุ่มเริ่มทำจาก Popup
document.addEventListener('DOMContentLoaded', async () => {
  const speedSlider = document.getElementById('speedSlider');
  const speedValue = document.getElementById('speedValue');
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');
  const autoBtn = document.getElementById('autoBtn');
  const status = document.getElementById('status');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const reviewMinutes = document.getElementById('reviewMinutes');
  const reminderMinutes = document.getElementById('reminderMinutes');
  const manualReviewBeforeContinue = document.getElementById('manualReviewBeforeContinue');
  const continuousReviewMinutes = document.getElementById('continuousReviewMinutes');
  const profileButtons = Array.from(document.querySelectorAll('.profile-btn'));
  // เปลี่ยนตัวเลขของโปรไฟล์เวลาได้ตรงนี้
  const timeProfiles = {
    slow: { question: 15, review: 8 },
    normal: { question: 10, review: 5 },
    detailed: { question: 20, review: 10 }
  };
  const normalizeMinutes = value => Math.min(120, Math.max(1, Number.parseInt(value, 10) || 5));
  const normalizeReminderMinutes = value => Math.min(30, Math.max(1, Number.parseInt(value, 10) || 1));
  const normalizeContinuousReviewMinutes = value => Math.min(120, Math.max(1, Number.parseInt(value, 10) || 5));
  const isSpeexxTab = tab => Boolean(tab?.url?.startsWith('https://portal.speexx.com/'));
  const showStatus = (text, type = '') => { status.textContent = text; status.className = `status ${type}`; };
  const { theme = 'dark' } = await chrome.storage.sync.get(['theme']);
  const timedSettings = await chrome.storage.sync.get(['questionMinutes', 'reviewMinutes', 'reminderMinutes', 'activeTimeProfile', 'manualReviewBeforeContinue', 'continuousReviewMinutes']);
  speedSlider.value = normalizeMinutes(timedSettings.questionMinutes); speedValue.value = speedSlider.value;
  reviewMinutes.value = Math.min(120, Math.max(1, Number.parseInt(timedSettings.reviewMinutes, 10) || 2));
  reminderMinutes.value = normalizeReminderMinutes(timedSettings.reminderMinutes);
  manualReviewBeforeContinue.checked = timedSettings.manualReviewBeforeContinue !== false;
  continuousReviewMinutes.value = normalizeContinuousReviewMinutes(timedSettings.continuousReviewMinutes);
  const syncContinuousReviewState = () => { continuousReviewMinutes.disabled = !manualReviewBeforeContinue.checked; };
  syncContinuousReviewState();
  manualReviewBeforeContinue.addEventListener('change', syncContinuousReviewState);
  let activeProfile = timedSettings.activeTimeProfile || '';
  const renderProfile = () => profileButtons.forEach(button => {
    const selected = button.dataset.profile === activeProfile;
    button.setAttribute('aria-pressed', String(selected));
  });
  const detectProfile = () => {
    activeProfile = Object.entries(timeProfiles).find(([, profile]) =>
      profile.question === Number(speedSlider.value) && profile.review === Number(reviewMinutes.value)
    )?.[0] || '';
    renderProfile();
  };
  detectProfile();
  document.body.dataset.theme = theme; themeToggleBtn.textContent = theme === 'dark' ? '🌙' : '☀️';
  speedSlider.addEventListener('input', () => { speedValue.value = speedSlider.value; });
  profileButtons.forEach(button => button.addEventListener('click', async () => {
    const profile = timeProfiles[button.dataset.profile];
    speedSlider.value = profile.question; speedValue.value = profile.question;
    reviewMinutes.value = profile.review; activeProfile = button.dataset.profile;
    renderProfile();
    await chrome.storage.sync.set({
      questionMinutes: profile.question,
      reviewMinutes: profile.review,
      activeTimeProfile: activeProfile
    });
    showStatus(`ใช้โปรไฟล์ “${button.textContent}” แล้ว`, 'success');
  }));
  [speedSlider, reviewMinutes].forEach(input => input.addEventListener('input', detectProfile));
  themeToggleBtn.addEventListener('click', async () => {
    const theme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = theme; themeToggleBtn.textContent = theme === 'dark' ? '🌙' : '☀️';
    await chrome.storage.sync.set({ theme });
  });
  // เพิ่ม/ลบค่าที่ต้องบันทึกจากหน้า Settings ในบล็อกนี้
  saveBtn.addEventListener('click', async () => {
    const questionTime = normalizeMinutes(speedSlider.value);
    speedSlider.value = questionTime; speedValue.value = questionTime;
    const reviewTime = Math.min(120, Math.max(1, Number.parseInt(reviewMinutes.value, 10) || 2));
    reviewMinutes.value = reviewTime;
    const reminderTime = normalizeReminderMinutes(reminderMinutes.value);
    reminderMinutes.value = reminderTime;
    const continuousReviewTime = normalizeContinuousReviewMinutes(continuousReviewMinutes.value);
    continuousReviewMinutes.value = continuousReviewTime;
    detectProfile();
    await chrome.storage.sync.set({ questionMinutes: questionTime, reviewMinutes: reviewTime, reminderMinutes: reminderTime, activeTimeProfile: activeProfile, manualReviewBeforeContinue: manualReviewBeforeContinue.checked, continuousReviewMinutes: continuousReviewTime });
    showStatus('บันทึกตั้งค่าแล้ว', 'success');
  });
  // ปุ่มรีเซ็ต: คืนเฉพาะค่าการทำงานในหน้า Settings กลับเป็นค่าเริ่มต้น
  resetBtn.addEventListener('click', async () => {
    speedSlider.value = 5; speedValue.value = 5;
    reviewMinutes.value = 2;
    reminderMinutes.value = 1;
    manualReviewBeforeContinue.checked = true;
    continuousReviewMinutes.value = 5;
    activeProfile = '';
    syncContinuousReviewState();
    renderProfile();
    await chrome.storage.sync.remove(['questionMinutes', 'reviewMinutes', 'reminderMinutes', 'activeTimeProfile', 'manualReviewBeforeContinue', 'continuousReviewMinutes']);
    showStatus('รีเซ็ตการตั้งค่าเป็นค่าเริ่มต้นแล้ว', 'success');
  });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  autoBtn.disabled = !isSpeexxTab(tab);
  if (autoBtn.disabled) showStatus('กรุณาเปิดหน้า Speexx Portal ก่อน', 'error');
  autoBtn.addEventListener('click', async () => {
    try {
      await chrome.storage.sync.set({ questionMinutes: normalizeMinutes(speedSlider.value) });
      await chrome.tabs.sendMessage(tab.id, { action: 'startSolveAll' });
      showStatus('กำลังเริ่มทำแบบฝึกหัด', 'info'); setTimeout(() => window.close(), 1000);
    } catch { showStatus('เชื่อมต่อกับหน้า Speexx ไม่ได้ ลองรีเฟรชหน้าเว็บ', 'error'); }
  });
});
