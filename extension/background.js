// Speexx Helper - Background Service Worker

// Listen for extension install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Speexx Helper installed!');
});

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ ok: true });
  }
  return true;
});
