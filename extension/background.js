// Speexx Helper - Background Service Worker

// Listen for extension install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Speexx Helper installed!');
});

// ตรวจ Release ล่าสุดจาก GitHub โดย cache 12 ชั่วโมง เพื่อลดจำนวนการเรียก API
const UPDATE_REPOSITORY = 'Mithx555/speexx_help';
const UPDATE_CACHE_KEY = 'speexxUpdateCheck';
const UPDATE_CACHE_MS = 12 * 60 * 60 * 1000;

function compareVersions(left, right) {
  const parse = value => String(value || '').replace(/^v/, '').split('.').map(part => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

async function getLatestRelease() {
  const cached = await chrome.storage.local.get([UPDATE_CACHE_KEY]);
  if (cached[UPDATE_CACHE_KEY]?.checkedAt && Date.now() - cached[UPDATE_CACHE_KEY].checkedAt < UPDATE_CACHE_MS) {
    return cached[UPDATE_CACHE_KEY];
  }
  const response = await fetch(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' }
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  const release = await response.json();
  const result = { checkedAt: Date.now(), version: release.tag_name || '', url: release.html_url || '', name: release.name || '' };
  await chrome.storage.local.set({ [UPDATE_CACHE_KEY]: result });
  return result;
}

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ ok: true });
  }
  // Content script ขอข้อมูลเท่านั้น; การเปรียบเทียบเวอร์ชันทำใน service worker เพื่อไม่ให้หน้า Speexx ติดต่อ GitHub เอง
  if (message.action === 'checkForUpdate') {
    getLatestRelease()
      .then(release => sendResponse({ ok: true, updateAvailable: compareVersions(release.version, chrome.runtime.getManifest().version) > 0, ...release }))
      .catch(() => sendResponse({ ok: false }));
  }
  // เปิดลิงก์ Release ในแท็บใหม่จาก extension context เพื่อไม่กระทบหน้าเรียน
  if (message.action === 'openRelease' && typeof message.url === 'string' && message.url.startsWith('https://github.com/')) {
    chrome.tabs.create({ url: message.url });
    sendResponse({ ok: true });
  }
  return true;
});
